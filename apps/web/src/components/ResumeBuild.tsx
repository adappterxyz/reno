import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import {
  downloadModelMedia,
  datasetFromBlobs,
  buildSplatFromDataset,
  type BuildProgress,
} from "../lib/buildModel.js";

/**
 * Resume a model build from media already uploaded by the phone — no re-capture.
 * Downloads the stored media, runs in-browser SfM, and uploads the splat.
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

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setLabel("Fetching captured media…");
      const { blobs, kind } = await downloadModelMedia(modelId);
      setLabel("Extracting frames…");
      const dataset = await datasetFromBlobs(blobs, kind);
      await buildSplatFromDataset(modelId, dataset, (p: BuildProgress) => {
        setProgress(p.progress);
        setLabel(p.message ? `${p.phase}: ${p.message}` : p.phase);
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Build from captured media</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Reconstructs the 3D model from the media your phone already uploaded — no need to
            re-capture. Runs in-browser SfM (best on desktop).
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
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
          {busy ? "Building…" : "Build now"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
