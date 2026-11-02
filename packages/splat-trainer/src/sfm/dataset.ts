import type { NerfDataset, NerfFrame } from "../types.js";

/**
 * Serialize a posed dataset (WebXR capture) to a single JSON string so the phone
 * can upload one file and the desktop can rebuild it. Images are base64-encoded.
 * Simpler than transferring N images + a separate poses manifest.
 */
export async function datasetToJson(ds: NerfDataset): Promise<string> {
  const frames = await Promise.all(
    ds.frames.map(async (f) => ({
      file_path: f.file_path,
      transform_matrix: f.transform_matrix,
      image: await blobToBase64(f.image),
      mime: f.image.type || "image/png",
    })),
  );
  return JSON.stringify({
    fl_x: ds.fl_x,
    fl_y: ds.fl_y,
    cx: ds.cx,
    cy: ds.cy,
    w: ds.w,
    h: ds.h,
    poseSource: ds.poseSource,
    frames,
  });
}

export function datasetFromJson(json: string): NerfDataset {
  const o = JSON.parse(json) as {
    fl_x: number; fl_y: number; cx: number; cy: number; w: number; h: number;
    poseSource: NerfDataset["poseSource"];
    frames: Array<{ file_path: string; transform_matrix: number[][]; image: string; mime: string }>;
  };
  const frames: NerfFrame[] = o.frames.map((f) => ({
    file_path: f.file_path,
    transform_matrix: f.transform_matrix,
    image: base64ToBlob(f.image, f.mime),
  }));
  return { fl_x: o.fl_x, fl_y: o.fl_y, cx: o.cx, cy: o.cy, w: o.w, h: o.h, poseSource: o.poseSource, frames };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
