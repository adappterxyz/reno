import { useRef, useState } from "react";
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
  Typography,
} from "@mui/material";
import { downloadModelMedia } from "../lib/buildModel.js";
import { trainSplat, mediaToImageFiles, type TrainProgress } from "../lib/splatTrain.js";
import { uploadSplatFile } from "../api/upload.js";

/**
 * Build a model from its stored capture media using real in-browser Gaussian-splat
 * training (Splat.js / WebGPU) — SfM + training -> photoreal .ply. Runs best on a
 * desktop GPU. The trainer renders live into the canvas as it optimizes.
 */
export function ResumeBuild({
  modelId,
  onClose,
  onDone,
}: {
  modelId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setLabel("Fetching captured frames…");
      const { blobs, kind } = await downloadModelMedia(modelId);
      const images = await mediaToImageFiles(blobs, kind);
      if (images.length < 8) throw new Error(`Only ${images.length} frames — capture more coverage.`);
      const ply = await trainSplat(images, canvasRef.current!, (p: TrainProgress) => {
        setProgress(p.progress);
        setLabel(p.message ?? p.phase);
      });
      setLabel("Uploading splat…");
      await uploadSplatFile(modelId, ply, "ply", setProgress);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Build 3D model (WebGPU training)</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Trains a real Gaussian splat from your captured frames, in-browser via WebGPU. This is
            compute-heavy — best on a desktop with a decent GPU, and it can take a few minutes.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {/* Live training preview */}
          <Box
            sx={{
              width: "100%",
              aspectRatio: "16 / 10",
              bgcolor: "#1a1d22",
              borderRadius: 2,
              overflow: "hidden",
              display: busy ? "block" : "none",
            }}
          >
            <canvas
              ref={canvasRef}
              width={960}
              height={600}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </Box>
          {busy && (
            <>
              <LinearProgress variant="determinate" value={progress * 100} />
              <Typography variant="caption">{label}</Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={run} disabled={busy}>
          {busy ? "Training…" : "Build now"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
