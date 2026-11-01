import { z } from "zod";

/** A 3D point in splat space (metres after multiplying by the model scaleFactor). */
export const Vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
export type Vec3 = z.infer<typeof Vec3>;

/**
 * A ticket anchored to a 3D point on the splat. Mirrors the old Matterport
 * "Mattertag" concept: the marker position replaces `Mattertag.add({ anchorPosition })`.
 * The existing backend stores these as JSON in the `tickets` table keyed by modelId.
 */
export const TicketStatus = z.enum(["Pending", "InProgress", "Completed"]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const Ticket = z.object({
  id: z.string(),
  splatModelId: z.string(),
  name: z.string(),
  description: z.string().default(""),
  category: z.string().default(""),
  status: TicketStatus.default("Pending"),
  /** Anchor in splat space. */
  anchor: Vec3,
  /** Surface normal at the anchor (for billboard orientation), optional. */
  normal: Vec3.optional(),
  dateAdded: z.string(),
  dateUpdated: z.string(),
});
export type Ticket = z.infer<typeof Ticket>;

/**
 * A measurement = an ordered list of anchor points. Distance is computed in the
 * viewer as sum of segment lengths * model.scaleFactor (replaces Matterport's
 * built-in Measurements tool).
 */
export const Measurement = z.object({
  id: z.string(),
  splatModelId: z.string(),
  label: z.string().default(""),
  points: z.array(Vec3).min(2),
  dateAdded: z.string(),
  dateUpdated: z.string(),
});
export type Measurement = z.infer<typeof Measurement>;

/** Euclidean distance helper (splat-space units). Multiply by scaleFactor for metres. */
export function segmentLength(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Total polyline length in splat-space units. */
export function polylineLength(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += segmentLength(points[i - 1]!, points[i]!);
  return total;
}
