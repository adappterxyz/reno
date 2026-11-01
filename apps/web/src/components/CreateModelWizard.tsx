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
  type NerfDataset,
  type TrainingProgress,
} from "@reno/splat-trainer";
import { routes, type SplatModel } from "@reno/shared";
import { api } from "../api/client.js";
import { uploadSplatFile } from "../api/upload.js";
import { config } from "../config.js";

type Method = "webxr" | "upload-video" | "upload-photos" | "upload-ply";
const STEPS = ["Name & method", "Capture / input", "Train", "Upload"];

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
  const [method, setMethod] = useState<Method>("upload-ply");
  const [webgpu, setWebgpu] = useState(false);
  const [xrSupported, setXrSupported] = useState(false);

  const [dataset, setDataset] = useState<NerfDataset | null>(null);
  const [plyBlob, setPlyBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const modelRef = useRef<SplatModel | null>(null);
  const xrRef = useRef<WebXRCapture | null>(null);

  useEffect(() => {
    isWebGPUAvailable().then(setWebgpu);
    new WebXRCapture().isSupported().then(setXrSupported);
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

  const runWebXR = async () => {
    try {
      setBusy(true);
      const cap = new WebXRCapture();
      xrRef.current = cap;
      await cap.start(document.body);
      // The AR session runs; user taps "Finish" (below) to stop.
    } catch (e) {
      fail(e);
    }
  };

  const finishWebXR = async () => {
    try {
      const ds = await xrRef.current!.stop();
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
    if (dataset.poseSource === "sfm") {
      setError(
        "This input has no camera poses, so it needs a Structure-from-Motion step before training. " +
          "SfM-in-browser is the Phase-1 spike; for now use WebXR capture or upload a pre-trained .ply.",
      );
      return;
    }
    if (!webgpu) {
      setError("WebGPU is not available in this browser. Use Chrome 134+ to train, or upload a .ply.");
      return;
    }
    try {
      setBusy(true);
      setError(null);
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
                AR capture (WebXR){xrSupported ? "" : " — not supported on this device"}
              </ToggleButton>
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
            {method === "webxr" && (
              <>
                <Typography>Walk slowly around the room keeping surfaces in view.</Typography>
                {!busy ? (
                  <Button variant="contained" onClick={runWebXR}>Start AR capture</Button>
                ) : (
                  <Button variant="contained" color="secondary" onClick={finishWebXR}>Finish capture</Button>
                )}
              </>
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
              {dataset?.frames.length ?? 0} frames captured ({dataset?.poseSource} poses).
            </Typography>
            <Button variant="contained" onClick={train} disabled={busy}>Train splat on-device</Button>
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
