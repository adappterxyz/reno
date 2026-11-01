/**
 * Nerfstudio-compatible training dataset. Brush ingests COLMAP or Nerfstudio
 * format; we target Nerfstudio because the WebXR capture path can emit camera
 * poses directly (no COLMAP/SfM needed), which is the key to a fully client-side
 * pipeline. Each frame carries a 4x4 camera-to-world transform.
 */
export interface NerfFrame {
  /** Relative path/name of the image blob within the dataset. */
  file_path: string;
  /** Row-major 4x4 camera-to-world matrix (OpenGL convention). */
  transform_matrix: number[][];
  image: Blob;
}

export interface NerfDataset {
  /** Camera intrinsics. */
  fl_x: number;
  fl_y: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  frames: NerfFrame[];
  /** How poses were obtained — drives whether an SfM step is still required. */
  poseSource: "webxr" | "sfm" | "external";
}

export interface TrainingProgress {
  phase: "sfm" | "training" | "exporting";
  /** 0..1 within the current phase. */
  progress: number;
  /** Optional live preview frame (data URL) rendered by the trainer. */
  previewUrl?: string;
  message?: string;
}

export interface TrainingResult {
  /** Trained splat as a .ply blob (PlayCanvas-loadable). */
  ply: Blob;
  thumbnail?: Blob;
  format: "ply";
}

export interface SplatTrainer {
  /** True if this environment can run the trainer (WebGPU + adapter checks). */
  isSupported(): Promise<boolean>;
  train(
    dataset: NerfDataset,
    onProgress: (p: TrainingProgress) => void,
    signal?: AbortSignal,
  ): Promise<TrainingResult>;
  dispose(): void;
}
