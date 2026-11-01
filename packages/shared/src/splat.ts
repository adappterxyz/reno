import { z } from "zod";

/** Supported splat file formats the viewer can load. */
export const SplatFormat = z.enum(["ply", "compressed-ply", "sog"]);
export type SplatFormat = z.infer<typeof SplatFormat>;

/** How camera poses were obtained for training (drives quality/UX expectations). */
export const PoseSource = z.enum(["webxr", "sfm", "external"]);
export type PoseSource = z.infer<typeof PoseSource>;

/** Lifecycle of a splat model from capture to ready-to-view. */
export const SplatStatus = z.enum([
  "draft", // created, not yet trained
  "capturing", // frames/poses being captured
  "training", // on-device training in progress
  "uploading", // trained, uploading to R2
  "ready", // viewable
  "failed",
]);
export type SplatStatus = z.infer<typeof SplatStatus>;

/**
 * A 3D Gaussian-splat model for a project space.
 * Replaces the Matterport model SID. The splat file lives in R2 (`r2Key`).
 *
 * `scaleFactor` converts splat-space units -> real-world metres. Splats have no
 * inherent scale, so this is set by the in-app two-point calibration step and is
 * required for trustworthy measurements. null = not yet calibrated.
 */
export const SplatModel = z.object({
  id: z.string(),
  projectSpaceId: z.string(),
  name: z.string(),
  r2Key: z.string().nullable(),
  format: SplatFormat.nullable(),
  fileSize: z.number().int().nonnegative().nullable(),
  thumbnailKey: z.string().nullable(),
  scaleFactor: z.number().positive().nullable(),
  status: SplatStatus,
  poseSource: PoseSource.nullable(),
  createdBy: z.string(),
  dateAdded: z.string(),
  dateUpdated: z.string(),
});
export type SplatModel = z.infer<typeof SplatModel>;

export const CreateSplatModelInput = z.object({
  projectSpaceId: z.string(),
  name: z.string().min(1),
  poseSource: PoseSource.optional(),
});
export type CreateSplatModelInput = z.infer<typeof CreateSplatModelInput>;
