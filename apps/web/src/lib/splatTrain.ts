import { createSession } from "splat.js";
import { extractFramesFromVideo } from "@reno/splat-trainer";

export interface TrainProgress {
  phase: string;
  progress: number; // 0..1
  message?: string;
}

/**
 * Real in-browser Gaussian-splat training via Splat.js (WebGPU): SfM + training
 * -> a standard 3DGS .ply. Slower than a GPU server but genuinely photoreal.
 * Needs a canvas (the trainer renders live progress into it).
 */
export async function trainSplat(
  images: Array<File | Blob>,
  canvas: HTMLCanvasElement,
  onProgress: (p: TrainProgress) => void,
  maxIters = 20000,
): Promise<Blob> {
  // Conservative settings so each GPU submission stays under the Windows GPU
  // watchdog (~2s) — default itersPerFrame=15 at full res causes DXGI_DEVICE_HUNG.
  const session = createSession({
    maxIters,
    itersPerFrame: 1, // one training step per GPU submit — safest vs the GPU watchdog
    initTarget: 8000, // few initial gaussians
    frames: { trainMaxDim: 480, featMaxDim: 640 }, // low training + feature resolution
    lowMem: true,
  });

  session.on("stage", (e) => {
    const frac = e.total ? e.done / e.total : 0;
    onProgress({ phase: e.stage, progress: frac, message: `${e.stage} ${e.done}/${e.total}` });
  });
  session.on("metrics", (e) => {
    onProgress({
      phase: "train",
      progress: Math.min(1, (e.iter ?? 0) / maxIters),
      message: `training · ${e.splats ?? 0} splats · PSNR ${e.psnrTrain?.toFixed(1) ?? "–"}`,
    });
  });

  await session.load(images);
  onProgress({ phase: "sfm", progress: 0.1, message: "Solving camera poses…" });
  await session.solve();
  await session.seed();
  session.view.attach(canvas);

  const done = new Promise<void>((resolve) => {
    session.on("event", (e) => {
      if (e.kind === "train-complete") resolve();
    });
  });
  session.start();
  await done;

  onProgress({ phase: "export", progress: 0.99, message: "Exporting splat…" });
  const ply = await session.exportPlyBlob();
  session.dispose();
  return ply;
}

/** Turn downloaded capture media into image files for the trainer. */
export async function mediaToImageFiles(
  blobs: Blob[],
  kind: "video" | "photos" | "webxr",
): Promise<File[]> {
  if (kind === "video") {
    const file = new File([blobs[0]!], "capture.mp4", { type: blobs[0]!.type || "video/mp4" });
    const { images } = await extractFramesFromVideo(file, { maxFrames: 120 });
    return images.map((im, i) => new File([im.image], `f_${i}.jpg`, { type: "image/jpeg" }));
  }
  // webxr: blobs[0] is the poses manifest (json) -> skip it; rest are frames.
  let frameBlobs = kind === "webxr" ? blobs.slice(1) : blobs;
  // Cap frames (evenly) — fewer frames = far less SfM + training GPU work.
  const CAP = 24;
  if (frameBlobs.length > CAP) {
    frameBlobs = Array.from({ length: CAP }, (_, i) => frameBlobs[Math.round((i * (frameBlobs.length - 1)) / (CAP - 1))]!);
  }
  return frameBlobs.map((b, i) => new File([b], `f_${i}.jpg`, { type: b.type || "image/jpeg" }));
}
