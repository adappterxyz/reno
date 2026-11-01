import type { NerfDataset, SplatTrainer, TrainingProgress, TrainingResult } from "../types.js";

export interface BrushTrainerOptions {
  /**
   * URL of the Brush training web worker (ESM). Brush (github.com/arthurbrussee/brush)
   * is a Rust/WGPU Gaussian-splat trainer that compiles to WASM+WebGPU. Build its
   * worker entry and host it in the app's /public, then pass the URL here.
   *
   * The worker must speak this message protocol:
   *   <- { type: "train", dataset: SerializedDataset, config }
   *   -> { type: "progress", phase, progress, previewUrl?, message? }
   *   -> { type: "done", ply: ArrayBuffer }
   *   -> { type: "error", message }
   */
  workerUrl: string;
  /** Training iterations (quality vs. time tradeoff). */
  iterations?: number;
}

/** WebGPU availability check (training requires it; viewing does not). */
export async function isWebGPUAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Client-side trainer backed by a Brush WASM/WebGPU worker. All GPU work happens
 * on the user's device; nothing is sent to a server for training.
 */
export class BrushTrainer implements SplatTrainer {
  private worker: Worker | null = null;
  constructor(private opts: BrushTrainerOptions) {}

  async isSupported(): Promise<boolean> {
    return (await isWebGPUAvailable()) && !!this.opts.workerUrl;
  }

  async train(
    dataset: NerfDataset,
    onProgress: (p: TrainingProgress) => void,
    signal?: AbortSignal,
  ): Promise<TrainingResult> {
    if (!(await isWebGPUAvailable())) {
      throw new Error(
        "WebGPU is not available on this device. Use a WebGPU-capable browser (Chrome 134+) to train, or capture on a supported device.",
      );
    }
    if (!this.opts.workerUrl) {
      throw new Error("BrushTrainer.workerUrl is not configured (Brush WASM worker build required).");
    }

    const worker = new Worker(this.opts.workerUrl, { type: "module" });
    this.worker = worker;

    const serialized = await serializeDataset(dataset);

    return new Promise<TrainingResult>((resolve, reject) => {
      const onAbort = () => {
        worker.terminate();
        reject(new DOMException("Training aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "progress") {
          onProgress(msg as TrainingProgress);
        } else if (msg.type === "done") {
          signal?.removeEventListener("abort", onAbort);
          worker.terminate();
          this.worker = null;
          resolve({ ply: new Blob([msg.ply], { type: "application/octet-stream" }), format: "ply" });
        } else if (msg.type === "error") {
          signal?.removeEventListener("abort", onAbort);
          worker.terminate();
          this.worker = null;
          reject(new Error(msg.message ?? "Brush training failed"));
        }
      };
      worker.onerror = (e) => reject(new Error(e.message));

      worker.postMessage(
        { type: "train", dataset: serialized, config: { iterations: this.opts.iterations ?? 2000 } },
        serialized.images.map((i) => i.buffer),
      );
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}

interface SerializedDataset {
  fl_x: number;
  fl_y: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  poseSource: string;
  transforms: number[][][];
  names: string[];
  images: Uint8Array[]; // transferable
}

async function serializeDataset(ds: NerfDataset): Promise<SerializedDataset> {
  const images: Uint8Array[] = [];
  const transforms: number[][][] = [];
  const names: string[] = [];
  for (const f of ds.frames) {
    images.push(new Uint8Array(await f.image.arrayBuffer()));
    transforms.push(f.transform_matrix);
    names.push(f.file_path);
  }
  return {
    fl_x: ds.fl_x,
    fl_y: ds.fl_y,
    cx: ds.cx,
    cy: ds.cy,
    w: ds.w,
    h: ds.h,
    poseSource: ds.poseSource,
    transforms,
    names,
    images,
  };
}
