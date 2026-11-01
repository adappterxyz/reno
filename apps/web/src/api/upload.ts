import { routes, type CreateUploadResult, type UploadedPart } from "@reno/shared";
import { api } from "./client.js";

/**
 * Client-driven R2 multipart upload of a trained splat .ply blob.
 * Splits the blob into parts, uploads each via the Worker proxy, then completes.
 */
export async function uploadSplatFile(
  modelId: string,
  blob: Blob,
  format: "ply" | "compressed-ply" | "sog",
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const create = await api.post<CreateUploadResult>(routes.uploadCreate(modelId), {
    format,
    contentType: "application/octet-stream",
  });

  const { uploadId, key, partSize } = create;
  const parts: UploadedPart[] = [];
  const total = blob.size;
  let uploaded = 0;
  let partNumber = 1;

  for (let offset = 0; offset < total; offset += partSize) {
    const chunk = blob.slice(offset, Math.min(offset + partSize, total));
    const buf = await chunk.arrayBuffer();
    const q = new URLSearchParams({ uploadId, key, partNumber: String(partNumber) });
    const part = await api.putBinary<UploadedPart>(`${routes.uploadPart(modelId)}?${q}`, buf);
    parts.push({ partNumber: part.partNumber, etag: part.etag });
    uploaded += chunk.size;
    onProgress?.(uploaded / total);
    partNumber++;
  }

  await api.post(routes.uploadComplete(modelId), { uploadId, key, parts, fileSize: total });
}
