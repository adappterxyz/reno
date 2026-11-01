import type { NerfDataset, NerfFrame } from "../types.js";

/**
 * Extract keyframes from an uploaded video File using a hidden <video> + canvas.
 * No ffmpeg dependency. Produces images WITHOUT poses, so the resulting dataset
 * has `poseSource: "sfm"` and must go through the SfM step before training.
 */
export async function extractFramesFromVideo(
  file: File,
  opts: { maxFrames?: number; everySeconds?: number } = {},
): Promise<{ images: NerfFrame[]; width: number; height: number }> {
  const maxFrames = opts.maxFrames ?? 120;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("Cannot read video"));
  });

  const duration = video.duration;
  const every = opts.everySeconds ?? Math.max(duration / maxFrames, 0.1);
  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const images: NerfFrame[] = [];
  for (let t = 0; t < duration && images.length < maxFrames; t += every) {
    await seek(video, t);
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (blob) {
      images.push({
        file_path: `frame_${images.length.toString().padStart(4, "0")}.jpg`,
        transform_matrix: identity4(), // unknown until SfM
        image: blob,
      });
    }
  }
  URL.revokeObjectURL(url);
  return { images, width, height };
}

/** Build a dataset from a photo set (also pose-less -> needs SfM). */
export async function datasetFromPhotos(files: File[]): Promise<NerfDataset> {
  const frames: NerfFrame[] = [];
  let w = 0;
  let h = 0;
  for (const [i, f] of files.entries()) {
    const dim = await imageSize(f);
    w = dim.w;
    h = dim.h;
    frames.push({
      file_path: `photo_${i.toString().padStart(4, "0")}.jpg`,
      transform_matrix: identity4(),
      image: f,
    });
  }
  return { fl_x: w, fl_y: w, cx: w / 2, cy: h / 2, w, h, frames, poseSource: "sfm" };
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const handler = () => {
      video.removeEventListener("seeked", handler);
      res();
    };
    video.addEventListener("seeked", handler);
    video.currentTime = t;
  });
}

async function imageSize(file: File): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function identity4(): number[][] {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}
