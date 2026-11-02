import type { NerfDataset, TrainingProgress } from "../types.js";
import { loadOpenCV } from "./opencvLoader.js";
import type { ColoredPoint } from "./ply.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// OpenCV.js has no types; use `any` for the cv module and its Mats.

export interface SfmResult {
  /** Dataset with transform_matrix filled in per frame (camera-to-world, OpenGL). */
  dataset: NerfDataset;
  /** Triangulated colored point cloud (world space). */
  points: ColoredPoint[];
}

interface Frame {
  width: number;
  height: number;
  data: ImageData;
  keypoints: Array<{ x: number; y: number }>;
  descriptors: any; // cv.Mat
}

/** Decode an image Blob to ImageData via an ImageBitmap + canvas. */
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
 * In-browser Structure-from-Motion (best-effort spike) using OpenCV.js.
 * ORB features -> pairwise essential matrix -> recoverPose -> chained global
 * poses -> midpoint-triangulated colored point cloud.
 *
 * Limitations (inherent to monocular, no bundle adjustment): translations are
 * per-pair unit scale, so global scale drifts; drift accumulates over long
 * sequences. Good enough to produce a connected preview cloud.
 */
export async function runSfmOnDataset(
  dataset: NerfDataset,
  onProgress: (p: TrainingProgress) => void,
): Promise<SfmResult> {
  const cv: any = await loadOpenCV();
  onProgress({ phase: "sfm", progress: 0.02, message: "OpenCV loaded" });

  const n = dataset.frames.length;
  if (n < 2) throw new Error("Need at least 2 frames for SfM");

  const f = dataset.fl_x || 1.2 * Math.max(dataset.w, dataset.h);
  const cx = dataset.cx || dataset.w / 2;
  const cy = dataset.cy || dataset.h / 2;
  const Kinv = (u: number, v: number): [number, number, number] => [(u - cx) / f, (v - cy) / f, 1];

  // --- 1. Features per frame ---
  const orb = new cv.ORB(2000);
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const data = await decode(dataset.frames[i]!.image);
    const mat = cv.matFromImageData(data);
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    const kp = new cv.KeyPointVector();
    const des = new cv.Mat();
    orb.detectAndCompute(gray, new cv.Mat(), kp, des);
    const keypoints: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < kp.size(); k++) {
      const p = kp.get(k).pt;
      keypoints.push({ x: p.x, y: p.y });
    }
    frames.push({ width: data.width, height: data.height, data, keypoints, descriptors: des });
    mat.delete();
    gray.delete();
    kp.delete();
    onProgress({ phase: "sfm", progress: 0.02 + 0.33 * ((i + 1) / n), message: `Features ${i + 1}/${n}` });
  }

  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const K = cv.matFromArray(3, 3, cv.CV_64F, [f, 0, cx, 0, f, cy, 0, 0, 1]);

  // --- 2. Chained poses + triangulation ---
  // world->cam 4x4 per frame; cam0 = identity.
  const worldToCam: number[][][] = [identity4()];
  const points: ColoredPoint[] = [];

  for (let i = 1; i < n; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    const good = matchPairs(cv, matcher, a.descriptors, b.descriptors);
    let relOk = false;
    if (good.length >= 15) {
      const ptsA: number[] = [];
      const ptsB: number[] = [];
      for (const m of good) {
        ptsA.push(a.keypoints[m.q]!.x, a.keypoints[m.q]!.y);
        ptsB.push(b.keypoints[m.t]!.x, b.keypoints[m.t]!.y);
      }
      const matA = cv.matFromArray(good.length, 1, cv.CV_64FC2, ptsA);
      const matB = cv.matFromArray(good.length, 1, cv.CV_64FC2, ptsB);
      const mask = new cv.Mat();
      const E = cv.findEssentialMat(matA, matB, K, cv.RANSAC, 0.999, 1.0, mask);
      if (E.rows === 3 && E.cols === 3) {
        const R = new cv.Mat();
        const t = new cv.Mat();
        cv.recoverPose(E, matA, matB, K, R, t, mask);
        const Rj = readMat3(R);
        const tj = [t.doubleAt(0, 0), t.doubleAt(1, 0), t.doubleAt(2, 0)] as [number, number, number];
        const rel = rigid4(Rj, tj);
        const Mb = mul4(rel, worldToCam[i - 1]!);
        worldToCam.push(Mb);
        relOk = true;

        // Triangulate inlier matches into world points.
        triangulateInto(points, good, mask, a, b, worldToCam[i - 1]!, Mb, Kinv);

        R.delete();
        t.delete();
      }
      matA.delete();
      matB.delete();
      mask.delete();
      E.delete();
    }
    if (!relOk) worldToCam.push(worldToCam[i - 1]!.map((row) => row.slice())); // carry pose forward
    onProgress({
      phase: "sfm",
      progress: 0.35 + 0.6 * (i / (n - 1)),
      message: `Poses ${i}/${n - 1}, ${points.length} points`,
    });
  }

  // --- 3. Fill dataset poses (camera-to-world, OpenGL convention) ---
  for (let i = 0; i < n; i++) {
    const c2wCv = invertRigid4(worldToCam[i]!);
    dataset.frames[i]!.transform_matrix = cvToOpenGL(c2wCv);
  }

  // Cleanup cv Mats.
  for (const fr of frames) fr.descriptors.delete();
  K.delete();
  orb.delete();
  matcher.delete();

  if (points.length === 0) throw new Error("SfM produced no points (too little overlap/parallax between frames)");
  onProgress({ phase: "sfm", progress: 1, message: `${points.length} points` });
  return { dataset, points };
}

// --- matching ---
function matchPairs(cv: any, matcher: any, desA: any, desB: any): Array<{ q: number; t: number }> {
  const knn = new cv.DMatchVectorVector();
  matcher.knnMatch(desA, desB, knn, 2);
  const good: Array<{ q: number; t: number }> = [];
  for (let i = 0; i < knn.size(); i++) {
    const pair = knn.get(i);
    if (pair.size() < 2) continue;
    const m = pair.get(0);
    const nmatch = pair.get(1);
    if (m.distance < 0.75 * nmatch.distance) good.push({ q: m.queryIdx, t: m.trainIdx });
  }
  knn.delete();
  return good;
}

// --- triangulation ---
function triangulateInto(
  out: ColoredPoint[],
  good: Array<{ q: number; t: number }>,
  mask: any,
  a: Frame,
  b: Frame,
  Ma: number[][],
  Mb: number[][],
  Kinv: (u: number, v: number) => [number, number, number],
) {
  const [Ca, Rca] = camCenterAndC2W(Ma);
  const [Cb, Rcb] = camCenterAndC2W(Mb);
  for (let i = 0; i < good.length; i++) {
    if (mask.ucharAt(i, 0) === 0) continue; // RANSAC outlier
    const pa = a.keypoints[good[i]!.q]!;
    const pb = b.keypoints[good[i]!.t]!;
    const da = norm3(mul3(Rca, Kinv(pa.x, pa.y)));
    const db = norm3(mul3(Rcb, Kinv(pb.x, pb.y)));
    const X = midpoint(Ca, da, Cb, db);
    if (!X) continue;
    const col = sampleColor(a.data, pa.x, pa.y);
    out.push({ x: X[0], y: X[1], z: X[2], r: col[0], g: col[1], b: col[2] });
  }
}

function midpoint(
  Ca: [number, number, number],
  da: [number, number, number],
  Cb: [number, number, number],
  db: [number, number, number],
): [number, number, number] | null {
  const r: [number, number, number] = [Ca[0] - Cb[0], Ca[1] - Cb[1], Ca[2] - Cb[2]];
  const bdot = dot3(da, db);
  const d = dot3(da, r);
  const e = dot3(db, r);
  const denom = 1 - bdot * bdot;
  if (Math.abs(denom) < 1e-6) return null;
  const s = (bdot * e - d) / denom;
  const tt = (e - bdot * d) / denom;
  if (s <= 0 || tt <= 0) return null; // behind a camera
  const Pa: [number, number, number] = [Ca[0] + s * da[0], Ca[1] + s * da[1], Ca[2] + s * da[2]];
  const Pb: [number, number, number] = [Cb[0] + tt * db[0], Cb[1] + tt * db[1], Cb[2] + tt * db[2]];
  return [(Pa[0] + Pb[0]) / 2, (Pa[1] + Pb[1]) / 2, (Pa[2] + Pb[2]) / 2];
}

function sampleColor(img: ImageData, x: number, y: number): [number, number, number] {
  const xi = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const idx = (yi * img.width + xi) * 4;
  return [img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!];
}

// --- small linear algebra (row-major) ---
function identity4(): number[][] {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}
function rigid4(R: number[][], t: [number, number, number]): number[][] {
  return [
    [R[0]![0]!, R[0]![1]!, R[0]![2]!, t[0]],
    [R[1]![0]!, R[1]![1]!, R[1]![2]!, t[1]],
    [R[2]![0]!, R[2]![1]!, R[2]![2]!, t[2]],
    [0, 0, 0, 1],
  ];
}
function mul4(A: number[][], B: number[][]): number[][] {
  const C = identity4();
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[i]![k]! * B[k]![j]!;
      C[i]![j] = s;
    }
  return C;
}
/** Inverse of a rigid 4x4 [R|t]: [R^T | -R^T t]. */
function invertRigid4(M: number[][]): number[][] {
  const R = [
    [M[0]![0]!, M[0]![1]!, M[0]![2]!],
    [M[1]![0]!, M[1]![1]!, M[1]![2]!],
    [M[2]![0]!, M[2]![1]!, M[2]![2]!],
  ];
  const t: [number, number, number] = [M[0]![3]!, M[1]![3]!, M[2]![3]!];
  const Rt = transpose3(R);
  const nt: [number, number, number] = [
    -(Rt[0]![0]! * t[0] + Rt[0]![1]! * t[1] + Rt[0]![2]! * t[2]),
    -(Rt[1]![0]! * t[0] + Rt[1]![1]! * t[1] + Rt[1]![2]! * t[2]),
    -(Rt[2]![0]! * t[0] + Rt[2]![1]! * t[1] + Rt[2]![2]! * t[2]),
  ];
  return rigid4(Rt, nt);
}
/** From world->cam M, return [center, c2w-rotation]. */
function camCenterAndC2W(M: number[][]): [[number, number, number], number[][]] {
  const inv = invertRigid4(M);
  const C: [number, number, number] = [inv[0]![3]!, inv[1]![3]!, inv[2]![3]!];
  const Rc = [
    [inv[0]![0]!, inv[0]![1]!, inv[0]![2]!],
    [inv[1]![0]!, inv[1]![1]!, inv[1]![2]!],
    [inv[2]![0]!, inv[2]![1]!, inv[2]![2]!],
  ];
  return [C, Rc];
}
/** Convert an OpenCV camera-to-world (x right, y down, z fwd) to OpenGL (y up, z back). */
function cvToOpenGL(c2w: number[][]): number[][] {
  // Right-multiply by diag(1,-1,-1,1): negate columns 1 and 2.
  return c2w.map((row) => [row[0]!, -row[1]!, -row[2]!, row[3]!]);
}
function transpose3(M: number[][]): number[][] {
  return [
    [M[0]![0]!, M[1]![0]!, M[2]![0]!],
    [M[0]![1]!, M[1]![1]!, M[2]![1]!],
    [M[0]![2]!, M[1]![2]!, M[2]![2]!],
  ];
}
function mul3(M: number[][], v: [number, number, number]): [number, number, number] {
  return [
    M[0]![0]! * v[0] + M[0]![1]! * v[1] + M[0]![2]! * v[2],
    M[1]![0]! * v[0] + M[1]![1]! * v[1] + M[1]![2]! * v[2],
    M[2]![0]! * v[0] + M[2]![1]! * v[1] + M[2]![2]! * v[2],
  ];
}
function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm3(v: [number, number, number]): [number, number, number] {
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
