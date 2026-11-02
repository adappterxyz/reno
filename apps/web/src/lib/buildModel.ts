import {
  runSfmOnDataset,
  pointsToSplatPly,
  extractFramesFromVideo,
  datasetFromPhotos,
  type NerfDataset,
  type TrainingProgress,
} from "@reno/splat-trainer";
import { routes } from "@reno/shared";
import { config } from "../config.js";
import { uploadSplatFile } from "../api/upload.js";

export interface BuildProgress {
  phase: string;
  progress: number; // 0..1
  message?: string;
}

/** Build a dataset from already-downloaded media blobs (video or photos). */
export async function datasetFromBlobs(blobs: Blob[], kind: "video" | "photos"): Promise<NerfDataset> {
  if (kind === "video") {
    const file = new File([blobs[0]!], "capture.mp4", { type: blobs[0]!.type || "video/mp4" });
    const { images, width, height } = await extractFramesFromVideo(file);
    return { fl_x: width, fl_y: width, cx: width / 2, cy: height / 2, w: width, h: height, frames: images, poseSource: "sfm" };
  }
  const files = blobs.map((b, i) => new File([b], `p${i}.jpg`, { type: b.type || "image/jpeg" }));
  return datasetFromPhotos(files);
}

/** Download the model's persisted capture media (signed URLs) as blobs. */
export async function downloadModelMedia(
  modelId: string,
): Promise<{ blobs: Blob[]; kind: "video" | "photos" }> {
  const base = config.apiBase || window.location.origin;
  const res = await fetch(base + routes.mediaUrls(modelId), {
    headers: { Authorization: `Bearer ${localStorage.getItem("reno.token") ?? ""}` },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Could not list capture media");
  const { urls, kind } = json.data as { urls: string[]; kind: "video" | "photos" | null };
  if (!urls.length) throw new Error("No stored capture media to build from");
  const blobs = await Promise.all(
    urls.map(async (u) => {
      const r = await fetch(base + u);
      if (!r.ok) throw new Error(`Media download failed (HTTP ${r.status})`);
      return r.blob();
    }),
  );
  return { blobs, kind: kind ?? "video" };
}

/** Full build: dataset -> in-browser SfM -> point-cloud splat -> upload. */
export async function buildSplatFromDataset(
  modelId: string,
  dataset: NerfDataset,
  onProgress: (p: BuildProgress) => void,
): Promise<void> {
  const { points } = await runSfmOnDataset(dataset, (p: TrainingProgress) =>
    onProgress({ phase: p.phase, progress: p.progress * 0.9, message: p.message }),
  );
  onProgress({ phase: "exporting", progress: 0.9, message: `Exporting ${points.length} points` });
  const ply = pointsToSplatPly(points);
  await uploadSplatFile(modelId, ply, "ply", (f) =>
    onProgress({ phase: "uploading", progress: 0.9 + f * 0.1, message: "Uploading splat" }),
  );
}
