import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import {
  WebXRCapture,
  extractFramesFromVideo,
  datasetFromPhotos,
  BrushTrainer,
  isWebGPUAvailable,
  runSfmOnDataset,
  pointsToSplatPly,
  type NerfDataset,
  type TrainingProgress,
} from "@reno/splat-trainer";
import { routes, type SplatModel } from "@reno/shared";
import { api } from "../api/client.js";
import { uploadSplatFile } from "../api/upload.js";
import { config } from "../config.js";
import { CaptureHandoff } from "./CaptureHandoff.js";
import { captureWithAR } from "../lib/arCapture.js";
import { persistDatasetToModel } from "../api/capture.js";

type Method = "phone" | "webxr" | "upload-video" | "upload-photos" | "upload-ply";
const STEPS = ["Name & method", "Capture / input", "Build", "Upload"];

export function CreateModelWizard({
  spaceId,
  onClose,
  onReady,
}: {
  spaceId: string;
  onClose: () => void;
  onReady: (modelId: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<Method>("phone");
  const [webgpu, setWebgpu] = useState(false);
  const [xrSupported, setXrSupported] = useState(false);

  const [dataset, setDataset] = useState<NerfDataset | null>(null);
  const [plyBlob, setPlyBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const modelRef = useRef<SplatModel | null>(null);

  useEffect(() => {
    isWebGPUAvailable().then(setWebgpu);
    // On a WebXR-capable device (Android phone), default to on-device AR capture —
    // no QR handoff needed.
    new WebXRCapture().isSupported().then((s) => {
      setXrSupported(s);
      if (s) setMethod("webxr");
    });
  }, []);

  const fail = (e: unknown) => {
    setError((e as Error).message);
    setBusy(false);
  };

  // Step 0 -> create a draft model row, advance.
  const startDraft = async () => {
    try {
      setBusy(true);
      setError(null);
      const poseSource = method === "webxr" ? "webxr" : method === "upload-ply" ? "external" : "sfm";
      const model = await api.post<SplatModel>(routes.splatModels(spaceId), { name: name || "Untitled", poseSource });
      modelRef.current = model;
      setBusy(false);
      setStep(1);
    } catch (e) {
      fail(e);
    }
  };

  // --- Capture / input handlers (step 1) ---

  // On-device AR capture with live camera preview (shared helper). Captures, then
  // saves the posed frames to the cloud so the build can run here OR on a PC later.
  const runWebXR = async () => {
    try {
      setError(null);
      const ds = await captureWithAR();
      if (ds.frames.length < 8) throw new Error("Too few frames — walk around more.");
      setBusy(true);
      setProgressLabel("Saving capture to the cloud…");
      await persistDatasetToModel(modelRef.current!.id, ds, setProgress);
      setDataset(ds);
      setBusy(false);
      setStep(2);
    } catch (e) {
      fail(e);
    }
  };

  const onVideo = async (file: File) => {
    try {
      setBusy(true);
      setProgressLabel("Extracting frames…");
      const { images, width, height } = await extractFramesFromVideo(file);
      setDataset({ fl_x: width, fl_y: width, cx: width / 2, cy: height / 2, w: width, h: height, frames: images, poseSource: "sfm" });
      setBusy(false);
      setStep(2);
    } catch (e) {
      fail(e);
    }
  };

  const onPhotos = async (files: FileList) => {
    try {
      setBusy(true);
      setDataset(await datasetFromPhotos([...files]));
      setBusy(false);
      setStep(2);
    } catch (e) {
      fail(e);
    }
  };

  const onPly = async (file: File) => {
    setPlyBlob(file);
    setStep(3);
  };

  // --- Train (step 2) ---

  const train = async () => {
    if (!dataset) return;
    try {
      setBusy(true);
      setError(null);

      // sfm = estimate poses (video/photos); webxr = use captured poses. Both run
      // the in-browser reconstruction (OpenCV.js) -> point-cloud splat. No Brush worker.
      if (dataset.poseSource === "sfm" || dataset.poseSource === "webxr") {
        const { points } = await runSfmOnDataset(dataset, (p: TrainingProgress) => {
          setProgress(p.progress);
          setProgressLabel(p.message ? `${p.phase}: ${p.message}` : `${p.phase}…`);
        });
        setProgressLabel(`Exporting splat (${points.length} points)…`);
        setPlyBlob(pointsToSplatPly(points));
        setBusy(false);
        setStep(3);
        return;
      }

      // Posed input (WebXR / external) -> Brush WebGPU training.
      if (!webgpu) {
        throw new Error("WebGPU is not available in this browser. Use Chrome 134+ to train, or upload a .ply.");
      }
      const trainer = new BrushTrainer({ workerUrl: config.brushWorkerUrl });
      if (!(await trainer.isSupported())) {
        throw new Error("Brush trainer unavailable (set VITE_BRUSH_WORKER_URL to the Brush WASM worker).");
      }
      const result = await trainer.train(dataset, (p: TrainingProgress) => {
        setProgress(p.progress);
        setProgressLabel(`${p.phase}: ${Math.round(p.progress * 100)}%`);
      });
      setPlyBlob(result.ply);
      setBusy(false);
      setStep(3);
    } catch (e) {
      fail(e);
    }
  };

  // --- Upload (step 3) ---

  const upload = async () => {
    if (!plyBlob || !modelRef.current) return;
    try {
      setBusy(true);
      setProgressLabel("Uploading to Cloudflare R2…");
      await uploadSplatFile(modelRef.current.id, plyBlob, "ply", setProgress);
      setBusy(false);
      onReady(modelRef.current.id);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create 3D model</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map((s) => (
            <Step key={s}>
              <StepLabel>{s}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

        {step === 0 && (
          <Stack spacing={2}>
            <TextField label="Model name" value={name} onChange={(e) => setName(e.target.value)} fullWidth autoFocus />
            <Typography variant="subtitle2">Capture method</Typography>
            <ToggleButtonGroup
              orientation="vertical"
              value={method}
              exclusive
              onChange={(_, v) => v && setMethod(v)}
              fullWidth
            >
              <ToggleButton value="webxr" disabled={!xrSupported}>
                📷 AR capture on this device{xrSupported ? "" : " — not supported here"}
              </ToggleButton>
              <ToggleButton value="phone">📱 Capture with a phone (scan QR from desktop)</ToggleButton>
              <ToggleButton value="upload-video">Upload a video</ToggleButton>
              <ToggleButton value="upload-photos">Upload photos</ToggleButton>
              <ToggleButton value="upload-ply">Upload a pre-trained .ply</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              WebGPU {webgpu ? "available" : "unavailable"} — required for in-browser training.
            </Typography>
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={2}>
            {method === "phone" && modelRef.current && (
              <CaptureHandoff
                modelId={modelRef.current.id}
                onDataset={(ds) => {
                  setDataset(ds);
                  setStep(2);
                }}
              />
            )}
            {method === "webxr" && (
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  Tap Start, then walk around the room (move between positions — don't just turn in
                  place). You'll see the live camera; tap "Finish AR capture" when you've covered it.
                </Typography>
                <Button variant="contained" onClick={runWebXR} disabled={busy}>
                  Start AR capture
                </Button>
              </Stack>
            )}
            {method === "upload-video" && (
              <Button variant="contained" component="label">
                Choose video
                <input hidden type="file" accept="video/*" onChange={(e) => e.target.files?.[0] && onVideo(e.target.files[0])} />
              </Button>
            )}
            {method === "upload-photos" && (
              <Button variant="contained" component="label">
                Choose photos
                <input hidden type="file" accept="image/*" multiple onChange={(e) => e.target.files && onPhotos(e.target.files)} />
              </Button>
            )}
            {method === "upload-ply" && (
              <Button variant="contained" component="label">
                Choose .ply
                <input hidden type="file" accept=".ply" onChange={(e) => e.target.files?.[0] && onPly(e.target.files[0])} />
              </Button>
            )}
          </Stack>
        )}

        {step === 2 && (
          <Stack spacing={2}>
            <Typography>
              {dataset?.frames.length ?? 0} frames ·{" "}
              {dataset?.poseSource === "webxr"
                ? "AR camera poses — direct reconstruction"
                : "no poses — in-browser SfM (OpenCV.js)"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {dataset?.poseSource === "webxr"
                ? "Saved to the cloud. Building is heavy — you can build here, or close this and click \"Build\" on this model from your computer (faster)."
                : "Produces a colored point-cloud splat. Best with lots of movement and overlap."}
            </Typography>
            <Button variant="contained" onClick={train} disabled={busy}>
              Reconstruct 3D model
            </Button>
            {busy && <LinearProgress variant="determinate" value={progress * 100} />}
            {progressLabel && <Typography variant="caption">{progressLabel}</Typography>}
          </Stack>
        )}

        {step === 3 && (
          <Stack spacing={2}>
            <Typography>Ready to upload {plyBlob ? `(${(plyBlob.size / 1e6).toFixed(1)} MB)` : ""}.</Typography>
            <Button variant="contained" onClick={upload} disabled={busy || !plyBlob}>Upload & finish</Button>
            {busy && <LinearProgress variant="determinate" value={progress * 100} />}
            {progressLabel && <Typography variant="caption">{progressLabel}</Typography>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        {step === 0 && (
          <Button variant="contained" onClick={startDraft} disabled={busy}>Next</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
