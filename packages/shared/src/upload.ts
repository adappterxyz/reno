import { z } from "zod";
import { SplatFormat } from "./splat.js";

/**
 * Multipart upload contract. The trained splat may be large (tens of MB), so we
 * use R2 multipart uploads driven from the client:
 *   1. POST /splat-models/:id/upload/create  -> { uploadId, key }
 *   2. For each part: PUT /splat-models/:id/upload/part (Worker proxies to R2) -> { etag, partNumber }
 *   3. POST /splat-models/:id/upload/complete { uploadId, key, parts } -> finalizes
 * The Worker holds R2 credentials; the client never sees them.
 */
export const CreateUploadInput = z.object({
  format: SplatFormat,
  contentType: z.string().default("application/octet-stream"),
});
export type CreateUploadInput = z.infer<typeof CreateUploadInput>;

export const CreateUploadResult = z.object({
  uploadId: z.string(),
  key: z.string(),
  partSize: z.number().int().positive(),
});
export type CreateUploadResult = z.infer<typeof CreateUploadResult>;

export const UploadedPart = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string(),
});
export type UploadedPart = z.infer<typeof UploadedPart>;

export const CompleteUploadInput = z.object({
  uploadId: z.string(),
  key: z.string(),
  parts: z.array(UploadedPart).min(1),
  fileSize: z.number().int().nonnegative(),
});
export type CompleteUploadInput = z.infer<typeof CompleteUploadInput>;

/** Recommended multipart part size (R2 requires >=5MiB for all parts except the last). */
export const PART_SIZE = 8 * 1024 * 1024;
