# @reno/splat-trainer

Client-side capture + Gaussian-splat training. All GPU work runs on the user's
device — nothing is sent to a server to be trained.

## Pieces

- `WebXRCapture` — immersive-AR capture that records frames **with camera poses**
  (WebXR raw camera access). Produces a Nerfstudio-format dataset with
  `poseSource: "webxr"`, so **no COLMAP/SfM is needed**. Best on Android Chrome;
  call `isSupported()` and fall back where unavailable (e.g. iOS Safari).
- `extractFramesFromVideo` / `datasetFromPhotos` — upload path. Produces pose-less
  datasets (`poseSource: "sfm"`) that require a Structure-from-Motion step before
  training. **In-browser SfM is the open Phase-1 spike** — see plan risks.
- `BrushTrainer` — drives a Brush WASM/WebGPU web worker to train and return a `.ply`.

## Brush worker contract

`BrushTrainer` expects a web worker (ESM) at `workerUrl` speaking:

```
// main -> worker
{ type: "train", dataset: SerializedDataset, config: { iterations: number } }

// worker -> main
{ type: "progress", phase: "sfm"|"training"|"exporting", progress: 0..1, previewUrl?, message? }
{ type: "done", ply: ArrayBuffer }   // transfer the buffer
{ type: "error", message: string }
```

`SerializedDataset` (see `src/trainer/brush.ts`): intrinsics (`fl_x, fl_y, cx, cy, w, h`),
`poseSource`, `transforms: number[][][]` (row-major 4x4 camera-to-world per frame),
`names: string[]`, `images: Uint8Array[]` (encoded PNG/JPEG, transferred).

Build Brush's worker to this shape, host it under the web app's `public/`, and set
`VITE_BRUSH_WORKER_URL`.
