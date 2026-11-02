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

/**
 * Write a colored point cloud as a Gaussian-splat .ply (ASCII) that PlayCanvas'
 * gsplat loader accepts. Each point becomes one small, opaque, axis-aligned
 * Gaussian — a sparse "point-cloud splat". Colors go into the SH DC term.
 *
 * This is a preview-quality result (no training/densification). Splat radius is
 * derived from the scene bounding box so it looks reasonable at any scale.
 */
export function pointsToSplatPly(points: ColoredPoint[]): Blob {
  if (points.length === 0) throw new Error("No points to export");

  // Scene extent -> per-splat radius.
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
    "format ascii 1.0\n" +
    `element vertex ${points.length}\n` +
    "property float x\nproperty float y\nproperty float z\n" +
    "property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n" +
    "property float opacity\n" +
    "property float scale_0\nproperty float scale_1\nproperty float scale_2\n" +
    "property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n" +
    "end_header\n";

  const lines: string[] = [header];
  for (const p of points) {
    const fdc0 = (p.r / 255 - 0.5) / SH_C0;
    const fdc1 = (p.g / 255 - 0.5) / SH_C0;
    const fdc2 = (p.b / 255 - 0.5) / SH_C0;
    lines.push(
      `${p.x.toFixed(5)} ${p.y.toFixed(5)} ${p.z.toFixed(5)} ` +
        `${fdc0.toFixed(4)} ${fdc1.toFixed(4)} ${fdc2.toFixed(4)} ` +
        `${opacityLogit.toFixed(4)} ` +
        `${logScale.toFixed(4)} ${logScale.toFixed(4)} ${logScale.toFixed(4)} ` +
        `1 0 0 0\n`,
    );
  }
  return new Blob(lines, { type: "application/octet-stream" });
}
