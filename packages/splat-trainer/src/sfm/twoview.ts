/**
 * Pure-JS two-view geometry (no OpenCV calib3d — the default opencv.js build
 * omits findEssentialMat/recoverPose). Normalized 8-point essential matrix with
 * RANSAC + SVD pose decomposition + cheirality selection.
 *
 * All matrices are row-major number[][]. Points are pixel coords; K is the
 * intrinsic (f, cx, cy). Returns a unit-translation relative pose (world = cam A).
 */
export interface K {
  f: number;
  cx: number;
  cy: number;
}
export interface Pose {
  R: number[][]; // 3x3
  t: [number, number, number]; // unit
  mask: Uint8Array; // inliers among the input correspondences
}

export function estimatePose(
  ptsA: Array<[number, number]>,
  ptsB: Array<[number, number]>,
  K: K,
  opts: { iters?: number; pixelThresh?: number } = {},
): Pose | null {
  const n = ptsA.length;
  if (n < 8) return null;
  // Normalized camera coords (K^-1 x).
  const xa = ptsA.map(([x, y]) => [(x - K.cx) / K.f, (y - K.cy) / K.f] as [number, number]);
  const xb = ptsB.map(([x, y]) => [(x - K.cx) / K.f, (y - K.cy) / K.f] as [number, number]);

  const thresh = ((opts.pixelThresh ?? 2.0) / K.f) ** 2;
  const iters = opts.iters ?? 150;

  let bestInliers: number[] = [];
  for (let it = 0; it < iters; it++) {
    const idx = sample8(n);
    const E = eightPoint(idx.map((i) => xa[i]!), idx.map((i) => xb[i]!));
    if (!E) continue;
    const inl: number[] = [];
    for (let i = 0; i < n; i++) if (sampson(E, xa[i]!, xb[i]!) < thresh) inl.push(i);
    if (inl.length > bestInliers.length) {
      bestInliers = inl;
      if (inl.length > 0.9 * n) break;
    }
  }
  if (bestInliers.length < 8) return null;

  // Re-estimate from all inliers (eightPoint returns an enforced essential matrix).
  const E = eightPoint(bestInliers.map((i) => xa[i]!), bestInliers.map((i) => xb[i]!));
  if (!E) return null;
  const pose = decomposeAndSelect(E, bestInliers.map((i) => xa[i]!), bestInliers.map((i) => xb[i]!));
  if (!pose) return null;

  const mask = new Uint8Array(n);
  for (const i of bestInliers) mask[i] = 1;
  return { R: pose.R, t: pose.t, mask };
}

/** Hartley isotropic normalization: centroid to origin, mean distance sqrt(2). */
function hartley(pts: Array<[number, number]>): { norm: Array<[number, number]>; T: number[][] } {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let md = 0;
  for (const p of pts) md += Math.hypot(p[0] - mx, p[1] - my);
  md /= n;
  const s = Math.SQRT2 / (md || 1);
  const T = [[s, 0, -s * mx], [0, s, -s * my], [0, 0, 1]];
  const norm = pts.map((p) => [s * (p[0] - mx), s * (p[1] - my)] as [number, number]);
  return { norm, T };
}

/**
 * Normalized 8-point essential matrix with Hartley conditioning + degeneracy
 * rejection. Returns null for degenerate (near-planar / low-parallax) samples.
 */
function eightPoint(xa: Array<[number, number]>, xb: Array<[number, number]>): number[][] | null {
  const { norm: na, T: Ta } = hartley(xa);
  const { norm: nb, T: Tb } = hartley(xb);
  const N = na.length;
  const AtA = zeros(9, 9);
  for (let k = 0; k < N; k++) {
    const [a1, b1] = na[k]!;
    const [a2, b2] = nb[k]!;
    const row = [a2 * a1, a2 * b1, a2, b2 * a1, b2 * b1, b2, a1, b1, 1];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) AtA[i]![j]! += row[i]! * row[j]!;
  }
  const { values, vectors } = jacobiEigen(AtA, 9);
  let min = 0;
  for (let i = 1; i < 9; i++) if (values[i]! < values[min]!) min = i;
  const e = vectors.map((r) => r[min]!);
  const En = [
    [e[0]!, e[1]!, e[2]!],
    [e[3]!, e[4]!, e[5]!],
    [e[6]!, e[7]!, e[8]!],
  ];
  // Denormalize: E = Tb^T En Ta
  const E = mm(mm(transpose(Tb), En), Ta);
  // Reject degenerate solutions (need two comparable non-zero singular values).
  // Do NOT enforce diag(1,1,0): equal singular values make the SVD eigenbasis
  // ill-conditioned and destabilize the pose decomposition. R = U W V^T ignores
  // the singular values, so a raw (distinct-SV) E decomposes stably.
  const { S } = svd3(E);
  if (S[0]! < 1e-12 || S[1]! / S[0]! < 0.1) return null;
  return E;
}

function sampson(E: number[][], xa: [number, number], xb: [number, number]): number {
  const x1 = [xa[0], xa[1], 1];
  const x2 = [xb[0], xb[1], 1];
  const Ex1 = matVec(E, x1);
  const Etx2 = matVec(transpose(E), x2);
  const x2Ex1 = x2[0]! * Ex1[0]! + x2[1]! * Ex1[1]! + x2[2]! * Ex1[2]!;
  const denom = Ex1[0]! ** 2 + Ex1[1]! ** 2 + Etx2[0]! ** 2 + Etx2[1]! ** 2;
  return denom > 1e-12 ? (x2Ex1 * x2Ex1) / denom : 1e9;
}

function decomposeAndSelect(
  E: number[][],
  xa: Array<[number, number]>,
  xb: Array<[number, number]>,
): { R: number[][]; t: [number, number, number] } | null {
  let { U, V } = svd3(E);
  // Ensure U and V are proper rotations (det = +1) by negating the WHOLE matrix
  // if needed — this is the standard Hartley-Zisserman conditioning so that
  // R1 = U W V^T and R2 = U W^T V^T come out as valid rotations.
  if (det3(U) < 0) U = U.map((r) => r.map((x) => -x));
  if (det3(V) < 0) V = V.map((r) => r.map((x) => -x));
  const W = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
  const R1 = mm(mm(U, W), transpose(V));
  const R2 = mm(mm(U, transpose(W)), transpose(V));
  const t: [number, number, number] = [U[0]![2]!, U[1]![2]!, U[2]![2]!];
  const nt: [number, number, number] = [-t[0], -t[1], -t[2]];
  const cands: Array<{ R: number[][]; t: [number, number, number] }> = [
    { R: R1, t },
    { R: R1, t: nt },
    { R: R2, t },
    { R: R2, t: nt },
  ];
  let best: { R: number[][]; t: [number, number, number] } | null = null;
  let bestCount = -1;
  for (const c of cands) {
    let count = 0;
    for (let i = 0; i < xa.length; i++) {
      const d = cheirality(c.R, c.t, xa[i]!, xb[i]!);
      if (d) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

/** True if the correspondence triangulates in front of both cameras. */
function cheirality(R: number[][], t: [number, number, number], xa: [number, number], xb: [number, number]): boolean {
  // cam1 at origin (identity). cam2 world->cam = [R|t]; center C2 = -R^T t.
  const Rt = transpose(R);
  const C2: [number, number, number] = [
    -(Rt[0]![0]! * t[0] + Rt[0]![1]! * t[1] + Rt[0]![2]! * t[2]),
    -(Rt[1]![0]! * t[0] + Rt[1]![1]! * t[1] + Rt[1]![2]! * t[2]),
    -(Rt[2]![0]! * t[0] + Rt[2]![1]! * t[1] + Rt[2]![2]! * t[2]),
  ];
  const d1 = norm([xa[0], xa[1], 1]);
  const d2w = norm(matVec(Rt, [xb[0], xb[1], 1]));
  const X = midpoint([0, 0, 0], d1, C2, d2w);
  if (!X) return false;
  const depth1 = X[2];
  const Xc2 = [
    R[0]![0]! * X[0] + R[0]![1]! * X[1] + R[0]![2]! * X[2] + t[0],
    R[1]![0]! * X[0] + R[1]![1]! * X[1] + R[1]![2]! * X[2] + t[1],
    R[2]![0]! * X[0] + R[2]![1]! * X[1] + R[2]![2]! * X[2] + t[2],
  ];
  return depth1 > 0 && Xc2[2]! > 0;
}

// ---- symmetric eigen (Jacobi) + 3x3 SVD ----
export function jacobiEigen(Ain: number[][], n: number): { values: number[]; vectors: number[][] } {
  const A = Ain.map((r) => r.slice());
  const V = identity(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p]![q]! * A[p]![q]!;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p]![q]!) < 1e-18) continue;
        const phi = 0.5 * Math.atan2(2 * A[p]![q]!, A[q]![q]! - A[p]![p]!);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let i = 0; i < n; i++) {
          const aip = A[i]![p]!;
          const aiq = A[i]![q]!;
          A[i]![p] = c * aip - s * aiq;
          A[i]![q] = s * aip + c * aiq;
        }
        for (let i = 0; i < n; i++) {
          const api = A[p]![i]!;
          const aqi = A[q]![i]!;
          A[p]![i] = c * api - s * aqi;
          A[q]![i] = s * api + c * aqi;
        }
        for (let i = 0; i < n; i++) {
          const vip = V[i]![p]!;
          const viq = V[i]![q]!;
          V[i]![p] = c * vip - s * viq;
          V[i]![q] = s * vip + c * viq;
        }
      }
  }
  return { values: A.map((r, i) => r[i]!), vectors: V };
}

/** SVD of a 3x3 matrix via eigen of M^T M. Returns U, S (desc), V. */
export function svd3(M: number[][]): { U: number[][]; S: number[]; V: number[][] } {
  const MtM = mm(transpose(M), M);
  const { values, vectors } = jacobiEigen(MtM, 3);
  const order = [0, 1, 2].sort((a, b) => values[b]! - values[a]!);
  const V = order.map((_, col) => [vectors[0]![order[col]!]!, vectors[1]![order[col]!]!, vectors[2]![order[col]!]!]);
  // V columns = eigenvectors in desc order -> rebuild as column matrix
  const Vcol = [
    [V[0]![0]!, V[1]![0]!, V[2]![0]!],
    [V[0]![1]!, V[1]![1]!, V[2]![1]!],
    [V[0]![2]!, V[1]![2]!, V[2]![2]!],
  ];
  const S = order.map((o) => Math.sqrt(Math.max(values[o]!, 0)));
  // U columns = M v_i / sigma_i
  const Ucols: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const v = [Vcol[0]![i]!, Vcol[1]![i]!, Vcol[2]![i]!];
    const mv = matVec(M, v);
    if (S[i]! > 1e-9) Ucols.push([mv[0]! / S[i]!, mv[1]! / S[i]!, mv[2]! / S[i]!]);
    else Ucols.push([0, 0, 0]);
  }
  // Fix a zero/third U column via cross product to keep orthonormal.
  if (S[2]! <= 1e-9) {
    const u0 = [Ucols[0]![0]!, Ucols[0]![1]!, Ucols[0]![2]!];
    const u1 = [Ucols[1]![0]!, Ucols[1]![1]!, Ucols[1]![2]!];
    Ucols[2] = cross(u0, u1);
  }
  const U = [
    [Ucols[0]![0]!, Ucols[1]![0]!, Ucols[2]![0]!],
    [Ucols[0]![1]!, Ucols[1]![1]!, Ucols[2]![1]!],
    [Ucols[0]![2]!, Ucols[1]![2]!, Ucols[2]![2]!],
  ];
  return { U, S, V: Vcol };
}

// ---- small matrix helpers ----
function zeros(r: number, c: number): number[][] {
  return Array.from({ length: r }, () => new Array(c).fill(0));
}
function identity(n: number): number[][] {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i]![i] = 1;
  return I;
}
function transpose(M: number[][]): number[][] {
  return M[0]!.map((_, j) => M.map((r) => r[j]!));
}
function mm(A: number[][], B: number[][]): number[][] {
  const r = A.length;
  const c = B[0]!.length;
  const k = B.length;
  const C = zeros(r, c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
    let s = 0;
    for (let x = 0; x < k; x++) s += A[i]![x]! * B[x]![j]!;
    C[i]![j] = s;
  }
  return C;
}
function matVec(M: number[][], v: number[]): number[] {
  return M.map((row) => row.reduce((s, m, i) => s + m * v[i]!, 0));
}
function det3(M: number[][]): number {
  return (
    M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!) -
    M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!) +
    M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!)
  );
}
function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
function norm(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}
function midpoint(
  Ca: [number, number, number],
  da: [number, number, number],
  Cb: [number, number, number],
  db: [number, number, number],
): [number, number, number] | null {
  const r: [number, number, number] = [Ca[0] - Cb[0], Ca[1] - Cb[1], Ca[2] - Cb[2]];
  const bd = da[0] * db[0] + da[1] * db[1] + da[2] * db[2];
  const d = da[0] * r[0] + da[1] * r[1] + da[2] * r[2];
  const e = db[0] * r[0] + db[1] * r[1] + db[2] * r[2];
  const denom = 1 - bd * bd;
  if (Math.abs(denom) < 1e-7) return null;
  const s = (bd * e - d) / denom;
  const tt = (e - bd * d) / denom;
  return [
    (Ca[0] + s * da[0] + Cb[0] + tt * db[0]) / 2,
    (Ca[1] + s * da[1] + Cb[1] + tt * db[1]) / 2,
    (Ca[2] + s * da[2] + Cb[2] + tt * db[2]) / 2,
  ];
}
function sample8(n: number): number[] {
  const s = new Set<number>();
  while (s.size < 8) s.add(Math.floor(Math.random() * n));
  return [...s];
}
