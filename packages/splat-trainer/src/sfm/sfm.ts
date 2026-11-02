import type { NerfDataset, TrainingProgress } from "../types.js";
import { loadOpenCV } from "./opencvLoader.js";
import type { ColoredPoint } from "./ply.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// OpenCV.js has no types; `any` for the cv module and its Mats.

export interface SfmResult {
  dataset: NerfDataset;
  points: ColoredPoint[];
}

export interface SfmOptions {
  nFeatures?: number;
  minMatches?: number;
  maxReprojErr?: number; // px
  outlierK?: number;
  outlierStd?: number;
  maxFrames?: number; // subsample to keep in-browser runtime tractable
}

/** Evenly pick up to `max` indices from [0, n). */
function evenlySample(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(Math.round((i * (n - 1)) / (max - 1)));
  return [...new Set(out)];
}

type Vec3 = [number, number, number];
type Mat4 = number[][]; // 4x4 world->cam

interface Frame {
  w: number;
  h: number;
  img: ImageData;
  kps: Array<{ x: number; y: number }>;
  des: any; // cv.Mat
  trackOf: Int32Array; // kp index -> track id (-1 none)
}

interface Track {
  obs: Array<{ frame: number; kp: number }>;
  point?: Vec3; // incremental global point
}

async function decode(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Track-based incremental Structure-from-Motion (in-browser, OpenCV.js).
 * Produces a cleaner, denser, scale-consistent colored point cloud than naive
 * pairwise SfM. Still monocular/no global bundle adjustment, so some drift
 * remains on long sequences.
 */
export async function runSfmOnDataset(
  dataset: NerfDataset,
  onProgress: (p: TrainingProgress) => void,
  opts: SfmOptions = {},
): Promise<SfmResult> {
  const cv: any = await loadOpenCV();
  const nFeatures = opts.nFeatures ?? 4000;
  const minMatches = opts.minMatches ?? 20;
  const maxReprojErr = opts.maxReprojErr ?? 4.0;
  onProgress({ phase: "sfm", progress: 0.02, message: "OpenCV loaded" });

  if (dataset.frames.length < 2) throw new Error("Need at least 2 frames for SfM");
  // Subsample to a tractable number of keyframes for in-browser runtime.
  const sel = evenlySample(dataset.frames.length, opts.maxFrames ?? 48);
  const n = sel.length;

  const f = dataset.fl_x || 1.2 * Math.max(dataset.w, dataset.h);
  const cx = dataset.cx || dataset.w / 2;
  const cy = dataset.cy || dataset.h / 2;
  const K = { f, cx, cy };

  // --- 1. Features ---
  const orb = new cv.ORB(nFeatures);
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const img = await decode(dataset.frames[sel[i]!]!.image);
    const mat = cv.matFromImageData(img);
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    const kpv = new cv.KeyPointVector();
    const des = new cv.Mat();
    orb.detectAndCompute(gray, new cv.Mat(), kpv, des);
    const kps: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < kpv.size(); k++) {
      const p = kpv.get(k).pt;
      kps.push({ x: p.x, y: p.y });
    }
    frames.push({ w: img.width, h: img.height, img, kps, des, trackOf: new Int32Array(kps.length).fill(-1) });
    mat.delete();
    gray.delete();
    kpv.delete();
    onProgress({ phase: "sfm", progress: 0.02 + 0.28 * ((i + 1) / n), message: `Features ${i + 1}/${n}` });
  }

  // --- 2. Cross-checked matches between consecutive frames + build tracks ---
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, true); // crossCheck
  const tracks: Track[] = [];
  const pairMatches: Array<Array<{ a: number; b: number }>> = []; // per i>=1: matches (i-1,i)

  for (let i = 1; i < n; i++) {
    const good = matchCross(cv, matcher, frames[i - 1]!.des, frames[i]!.des);
    pairMatches.push(good);
    for (const m of good) {
      const prevTrack = frames[i - 1]!.trackOf[m.a];
      if (prevTrack !== undefined && prevTrack >= 0) {
        tracks[prevTrack]!.obs.push({ frame: i, kp: m.b });
        frames[i]!.trackOf[m.b] = prevTrack;
      } else {
        const id = tracks.length;
        tracks.push({ obs: [{ frame: i - 1, kp: m.a }, { frame: i, kp: m.b }] });
        frames[i - 1]!.trackOf[m.a] = id;
        frames[i]!.trackOf[m.b] = id;
      }
    }
    onProgress({ phase: "sfm", progress: 0.3 + 0.2 * (i / (n - 1)), message: `Matching ${i}/${n - 1}` });
  }

  // --- 3. Pose chain with scale propagation + incremental triangulation ---
  const M: Mat4[] = [identity4()];
  let prevScale = 1;
  for (let i = 1; i < n; i++) {
    const good = pairMatches[i - 1]!;
    let R: number[][] | null = null;
    let tUnit: Vec3 | null = null;
    let inlierMask: Uint8Array | null = null;
    if (good.length >= minMatches) {
      const est = essential(cv, frames[i - 1]!, frames[i]!, good, K);
      if (est) {
        R = est.R;
        tUnit = est.t;
        inlierMask = est.mask;
      }
    }
    if (!R || !tUnit) {
      M.push(M[i - 1]!.map((r) => r.slice())); // carry forward
      continue;
    }

    // Scale: compare known global points' depth in cam (i-1) to a unit-scale local triangulation.
    const Mprev = M[i - 1]!;
    const sCandidates: number[] = [];
    const localCamB = rigid4(R, tUnit);
    for (let g = 0; g < good.length; g++) {
      if (inlierMask && inlierMask[g] === 0) continue;
      const tid = frames[i - 1]!.trackOf[good[g]!.a]!;
      const X = tid >= 0 ? tracks[tid]!.point : undefined;
      if (!X) continue;
      const depthPrev = applyRigid(Mprev, X)[2];
      // local triangulation in cam(i-1) frame (origin) at unit scale
      const pa = frames[i - 1]!.kps[good[g]!.a]!;
      const pb = frames[i]!.kps[good[g]!.b]!;
      const Plocal = triangulatePair(identity4(), localCamB, pa, pb, K);
      if (!Plocal) continue;
      const depthLocal = Plocal[2];
      if (depthLocal > 1e-4 && depthPrev > 1e-4) sCandidates.push(depthPrev / depthLocal);
    }
    const s = sCandidates.length >= 3 ? median(sCandidates) : prevScale;
    prevScale = s;

    const rel = rigid4(R, [tUnit[0] * s, tUnit[1] * s, tUnit[2] * s]);
    M.push(mul4(rel, Mprev));

    // Incrementally triangulate tracks newly completing at this pair (no global point yet).
    const Mi = M[i]!;
    for (let g = 0; g < good.length; g++) {
      if (inlierMask && inlierMask[g] === 0) continue;
      const tid = frames[i]!.trackOf[good[g]!.b]!;
      if (tid < 0 || tracks[tid]!.point) continue;
      const pa = frames[i - 1]!.kps[good[g]!.a]!;
      const pb = frames[i]!.kps[good[g]!.b]!;
      const X = triangulateGlobal(Mprev, Mi, pa, pb, K);
      if (X) tracks[tid]!.point = X;
    }
    onProgress({ phase: "sfm", progress: 0.5 + 0.35 * (i / (n - 1)), message: `Poses ${i}/${n - 1}` });
  }

  // --- 4. Final per-track: re-triangulate from widest baseline, reproject-filter, color ---
  onProgress({ phase: "sfm", progress: 0.88, message: "Refining points" });
  let points: ColoredPoint[] = [];
  for (const tr of tracks) {
    if (tr.obs.length < 2) continue;
    // widest-baseline observation pair
    let best = { d: -1, a: tr.obs[0]!, b: tr.obs[1]! };
    for (let i = 0; i < tr.obs.length; i++)
      for (let j = i + 1; j < tr.obs.length; j++) {
        const ca = camCenter(M[tr.obs[i]!.frame]!);
        const cb = camCenter(M[tr.obs[j]!.frame]!);
        const d = dist3(ca, cb);
        if (d > best.d) best = { d, a: tr.obs[i]!, b: tr.obs[j]! };
      }
    const pa = frames[best.a.frame]!.kps[best.a.kp]!;
    const pb = frames[best.b.frame]!.kps[best.b.kp]!;
    const X = triangulateGlobal(M[best.a.frame]!, M[best.b.frame]!, pa, pb, K);
    if (!X) continue;

    // reprojection error across all observations
    let maxErr = 0;
    let ok = true;
    for (const o of tr.obs) {
      const pr = project(M[o.frame]!, X, K);
      if (!pr) { ok = false; break; }
      const obs = frames[o.frame]!.kps[o.kp]!;
      maxErr = Math.max(maxErr, Math.hypot(pr[0] - obs.x, pr[1] - obs.y));
    }
    if (!ok || maxErr > maxReprojErr) continue;

    // averaged color across observations
    let r = 0, g = 0, b = 0;
    for (const o of tr.obs) {
      const c = sampleColor(frames[o.frame]!.img, frames[o.frame]!.kps[o.kp]!.x, frames[o.frame]!.kps[o.kp]!.y);
      r += c[0]; g += c[1]; b += c[2];
    }
    const nc = tr.obs.length;
    points.push({ x: X[0], y: X[1], z: X[2], r: r / nc, g: g / nc, b: b / nc });
  }

  // --- 5. Statistical outlier removal + recenter/normalize ---
  points = removeOutliers(points, opts.outlierK ?? 8, opts.outlierStd ?? 2.0);
  points = normalize(points);

  // cleanup cv
  for (const fr of frames) fr.des.delete();
  orb.delete();
  matcher.delete();

  // --- 6. Fill dataset poses (camera-to-world, OpenGL) for the keyframes used ---
  for (let i = 0; i < n; i++)
    dataset.frames[sel[i]!]!.transform_matrix = cvToOpenGL(invertRigid4(M[i]!));

  if (points.length === 0) throw new Error("SfM produced no points (need more overlap/parallax and texture)");
  onProgress({ phase: "sfm", progress: 1, message: `${points.length} points` });
  return { dataset, points };
}

// ---------- matching ----------
function matchCross(cv: any, matcher: any, desA: any, desB: any): Array<{ a: number; b: number }> {
  const dm = new cv.DMatchVector();
  matcher.match(desA, desB, dm);
  const out: Array<{ a: number; b: number }> = [];
  for (let i = 0; i < dm.size(); i++) {
    const m = dm.get(i);
    if (m.distance < 64) out.push({ a: m.queryIdx, b: m.trainIdx }); // Hamming threshold
  }
  dm.delete();
  return out;
}

// ---------- geometry (OpenCV for essential; pure-JS for the rest) ----------
function essential(
  cv: any,
  a: Frame,
  b: Frame,
  good: Array<{ a: number; b: number }>,
  K: { f: number; cx: number; cy: number },
): { R: number[][]; t: Vec3; mask: Uint8Array } | null {
  const pa: number[] = [];
  const pb: number[] = [];
  for (const m of good) {
    pa.push(a.kps[m.a]!.x, a.kps[m.a]!.y);
    pb.push(b.kps[m.b]!.x, b.kps[m.b]!.y);
  }
  const matA = cv.matFromArray(good.length, 1, cv.CV_64FC2, pa);
  const matB = cv.matFromArray(good.length, 1, cv.CV_64FC2, pb);
  const Kmat = cv.matFromArray(3, 3, cv.CV_64F, [K.f, 0, K.cx, 0, K.f, K.cy, 0, 0, 1]);
  const maskMat = new cv.Mat();
  const E = cv.findEssentialMat(matA, matB, Kmat, cv.RANSAC, 0.999, 1.0, maskMat);
  let result: { R: number[][]; t: Vec3; mask: Uint8Array } | null = null;
  if (E.rows === 3 && E.cols === 3) {
    const R = new cv.Mat();
    const t = new cv.Mat();
    cv.recoverPose(E, matA, matB, Kmat, R, t, maskMat);
    const mask = new Uint8Array(good.length);
    for (let i = 0; i < good.length; i++) mask[i] = maskMat.ucharAt(i, 0);
    result = {
      R: readMat3(R),
      t: [t.doubleAt(0, 0), t.doubleAt(1, 0), t.doubleAt(2, 0)],
      mask,
    };
    R.delete();
    t.delete();
  }
  matA.delete();
  matB.delete();
  Kmat.delete();
  maskMat.delete();
  E.delete();
  return result;
}

/** Triangulate a correspondence given two world->cam poses. Returns world point or null. */
function triangulateGlobal(
  Ma: Mat4,
  Mb: Mat4,
  pa: { x: number; y: number },
  pb: { x: number; y: number },
  K: { f: number; cx: number; cy: number },
): Vec3 | null {
  const [Ca, Rca] = centerAndC2W(Ma);
  const [Cb, Rcb] = centerAndC2W(Mb);
  const da = norm3(mul3(Rca, ray(pa, K)));
  const db = norm3(mul3(Rcb, ray(pb, K)));
  return midpoint(Ca, da, Cb, db);
}
/** Triangulate directly in cam-a frame (Ma=identity typical). */
function triangulatePair(
  Ma: Mat4,
  Mb: Mat4,
  pa: { x: number; y: number },
  pb: { x: number; y: number },
  K: { f: number; cx: number; cy: number },
): Vec3 | null {
  const X = triangulateGlobal(Ma, Mb, pa, pb, K);
  if (!X) return null;
  return applyRigid(Ma, X); // depth in cam-a frame
}
function ray(p: { x: number; y: number }, K: { f: number; cx: number; cy: number }): Vec3 {
  return [(p.x - K.cx) / K.f, (p.y - K.cy) / K.f, 1];
}
function project(M: Mat4, X: Vec3, K: { f: number; cx: number; cy: number }): [number, number] | null {
  const c = applyRigid(M, X);
  if (c[2] <= 1e-4) return null;
  return [(K.f * c[0]) / c[2] + K.cx, (K.f * c[1]) / c[2] + K.cy];
}
function midpoint(Ca: Vec3, da: Vec3, Cb: Vec3, db: Vec3): Vec3 | null {
  const r: Vec3 = [Ca[0] - Cb[0], Ca[1] - Cb[1], Ca[2] - Cb[2]];
  const bd = dot3(da, db);
  const d = dot3(da, r);
  const e = dot3(db, r);
  const denom = 1 - bd * bd;
  if (Math.abs(denom) < 1e-7) return null;
  const s = (bd * e - d) / denom;
  const tt = (e - bd * d) / denom;
  if (s <= 0 || tt <= 0) return null;
  return [
    (Ca[0] + s * da[0] + Cb[0] + tt * db[0]) / 2,
    (Ca[1] + s * da[1] + Cb[1] + tt * db[1]) / 2,
    (Ca[2] + s * da[2] + Cb[2] + tt * db[2]) / 2,
  ];
}

// ---------- cleanup / normalize ----------
function removeOutliers(points: ColoredPoint[], k: number, stdMul: number): ColoredPoint[] {
  if (points.length < k + 1) return points;
  // Mean distance to k nearest neighbors (brute force; capped for performance).
  const cap = 20000;
  const pts = points.length > cap ? points.filter((_, i) => i % Math.ceil(points.length / cap) === 0) : points;
  const meanDists = pts.map((p) => {
    const ds: number[] = [];
    for (const q of pts) {
      if (q === p) continue;
      ds.push((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);
    }
    ds.sort((a, b) => a - b);
    let s = 0;
    const kk = Math.min(k, ds.length);
    for (let i = 0; i < kk; i++) s += Math.sqrt(ds[i]!);
    return s / kk;
  });
  const mu = mean(meanDists);
  const sd = Math.sqrt(mean(meanDists.map((d) => (d - mu) ** 2)));
  const thresh = mu + stdMul * sd;
  return pts.filter((_, i) => meanDists[i]! <= thresh);
}
function normalize(points: ColoredPoint[]): ColoredPoint[] {
  if (!points.length) return points;
  const cx = mean(points.map((p) => p.x));
  const cy = mean(points.map((p) => p.y));
  const cz = mean(points.map((p) => p.z));
  let maxr = 0;
  for (const p of points) maxr = Math.max(maxr, Math.hypot(p.x - cx, p.y - cy, p.z - cz));
  const scale = maxr > 1e-6 ? 2 / maxr : 1; // fit roughly in radius 2
  return points.map((p) => ({ ...p, x: (p.x - cx) * scale, y: (p.y - cy) * scale, z: (p.z - cz) * scale }));
}

// ---------- linear algebra ----------
function identity4(): Mat4 {
  return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
}
function rigid4(R: number[][], t: Vec3): Mat4 {
  return [
    [R[0]![0]!, R[0]![1]!, R[0]![2]!, t[0]],
    [R[1]![0]!, R[1]![1]!, R[1]![2]!, t[1]],
    [R[2]![0]!, R[2]![1]!, R[2]![2]!, t[2]],
    [0, 0, 0, 1],
  ];
}
function mul4(A: Mat4, B: Mat4): Mat4 {
  const C = identity4();
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[i]![k]! * B[k]![j]!;
      C[i]![j] = s;
    }
  return C;
}
function invertRigid4(M: Mat4): Mat4 {
  const R = [[M[0]![0]!, M[0]![1]!, M[0]![2]!], [M[1]![0]!, M[1]![1]!, M[1]![2]!], [M[2]![0]!, M[2]![1]!, M[2]![2]!]];
  const t: Vec3 = [M[0]![3]!, M[1]![3]!, M[2]![3]!];
  const Rt = transpose3(R);
  return rigid4(Rt, [
    -(Rt[0]![0]! * t[0] + Rt[0]![1]! * t[1] + Rt[0]![2]! * t[2]),
    -(Rt[1]![0]! * t[0] + Rt[1]![1]! * t[1] + Rt[1]![2]! * t[2]),
    -(Rt[2]![0]! * t[0] + Rt[2]![1]! * t[1] + Rt[2]![2]! * t[2]),
  ]);
}
function centerAndC2W(M: Mat4): [Vec3, number[][]] {
  const inv = invertRigid4(M);
  return [
    [inv[0]![3]!, inv[1]![3]!, inv[2]![3]!],
    [[inv[0]![0]!, inv[0]![1]!, inv[0]![2]!], [inv[1]![0]!, inv[1]![1]!, inv[1]![2]!], [inv[2]![0]!, inv[2]![1]!, inv[2]![2]!]],
  ];
}
function camCenter(M: Mat4): Vec3 {
  return centerAndC2W(M)[0];
}
function applyRigid(M: Mat4, X: Vec3): Vec3 {
  return [
    M[0]![0]! * X[0] + M[0]![1]! * X[1] + M[0]![2]! * X[2] + M[0]![3]!,
    M[1]![0]! * X[0] + M[1]![1]! * X[1] + M[1]![2]! * X[2] + M[1]![3]!,
    M[2]![0]! * X[0] + M[2]![1]! * X[1] + M[2]![2]! * X[2] + M[2]![3]!,
  ];
}
function cvToOpenGL(c2w: Mat4): Mat4 {
  return c2w.map((row) => [row[0]!, -row[1]!, -row[2]!, row[3]!]);
}
function transpose3(M: number[][]): number[][] {
  return [[M[0]![0]!, M[1]![0]!, M[2]![0]!], [M[0]![1]!, M[1]![1]!, M[2]![1]!], [M[0]![2]!, M[1]![2]!, M[2]![2]!]];
}
function mul3(M: number[][], v: Vec3): Vec3 {
  return [
    M[0]![0]! * v[0] + M[0]![1]! * v[1] + M[0]![2]! * v[2],
    M[1]![0]! * v[0] + M[1]![1]! * v[1] + M[1]![2]! * v[2],
    M[2]![0]! * v[0] + M[2]![1]! * v[1] + M[2]![2]! * v[2],
  ];
}
function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function readMat3(m: any): number[][] {
  return [
    [m.doubleAt(0, 0), m.doubleAt(0, 1), m.doubleAt(0, 2)],
    [m.doubleAt(1, 0), m.doubleAt(1, 1), m.doubleAt(1, 2)],
    [m.doubleAt(2, 0), m.doubleAt(2, 1), m.doubleAt(2, 2)],
  ];
}
function sampleColor(img: ImageData, x: number, y: number): [number, number, number] {
  const xi = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const idx = (yi * img.width + xi) * 4;
  return [img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!];
}
function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / (a.length || 1);
}
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
}
