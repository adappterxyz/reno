/** A colored 3D point from triangulation. */
export interface ColoredPoint {
  x: number;
  y: number;
  z: number;
  r: number; // 0..255
  g: number;
  b: number;
}

const SH_C0 = 0.28209479177387814;

// Gaussian-splat PLY vertex properties, in order (all float32).
const PROPS = [
  "x", "y", "z",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity",
  "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
];

/**
 * Write a colored point cloud as a binary little-endian Gaussian-splat .ply that
 * PlayCanvas' gsplat loader accepts (binary is the universally-supported format;
 * ASCII gsplat PLY is not reliably parsed). Each point becomes one small, opaque,
 * axis-aligned Gaussian — a sparse "point-cloud splat". Colors go into the SH DC
 * term. Splat radius is derived from the scene bounding box.
 */
export function pointsToSplatPly(points: ColoredPoint[]): Blob {
  if (points.length === 0) throw new Error("No points to export");

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const radius = Math.max(diag * 0.004, 1e-3);
  const logScale = Math.log(radius);
  const opacityLogit = 2.944; // sigmoid^-1(0.95)

  const header =
    "ply\n" +
    "format binary_little_endian 1.0\n" +
    `element vertex ${points.length}\n` +
    PROPS.map((p) => `property float ${p}\n`).join("") +
    "end_header\n";

  const headerBytes = new TextEncoder().encode(header);
  const stride = PROPS.length * 4; // 14 float32 per vertex
  const buf = new ArrayBuffer(headerBytes.length + points.length * stride);
  const bytes = new Uint8Array(buf);
  bytes.set(headerBytes, 0);
  const dv = new DataView(buf, headerBytes.length);

  let o = 0;
  for (const p of points) {
    const vals = [
      p.x, p.y, p.z,
      (p.r / 255 - 0.5) / SH_C0, (p.g / 255 - 0.5) / SH_C0, (p.b / 255 - 0.5) / SH_C0,
      opacityLogit,
      logScale, logScale, logScale,
      1, 0, 0, 0,
    ];
    for (const v of vals) {
      dv.setFloat32(o, v, true); // little-endian
      o += 4;
    }
  }
  return new Blob([buf], { type: "application/octet-stream" });
}
