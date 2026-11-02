import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import VideocamIcon from "@mui/icons-material/Videocam";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
  uploadCaptureMedia,
  completeCapture,
  reportCaptureProgress,
  type CaptureSession,
} from "../api/capture.js";

/**
 * Phone capture page (opened via the desktop QR). No login — authorized by the
 * session token in the URL. Uses the native camera (file input with `capture`)
 * so it works on iOS Safari and Android without MediaRecorder quirks.
 */
export function MobileCapture() {
  const { sessionId = "" } = useParams();
  const [params] = useSearchParams();
  const session: CaptureSession = {
    sessionId,
    token: params.get("t") ?? "",
    exp: Number(params.get("e") ?? 0),
    captureUrl: "",
  };

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = sessionId && session.token && session.exp;

  const handle = async (files: FileList | null, kind: "video" | "photos") => {
    if (!files || !files.length) return;
    setBusy(true);
    setError(null);
    try {
      await reportCaptureProgress(session, { status: "uploading", message: "Uploading…" });
      const keys: string[] = [];
      const list = [...files];
      for (let i = 0; i < list.length; i++) {
        const f = list[i]!;
        const ext = f.name.split(".").pop() || (kind === "video" ? "mp4" : "jpg");
        const key = await uploadCaptureMedia(session, f, ext, (frac) =>
          setProgress((i + frac) / list.length),
        );
        keys.push(key);
      }
      await completeCapture(session, keys, kind);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
      await reportCaptureProgress(session, { status: "failed", message: (e as Error).message }).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2, bgcolor: "#f5f7fb" }}>
      <Card sx={{ width: 420, maxWidth: "100%" }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Capture for Reno
          </Typography>

          {!valid ? (
            <Alert severity="error">Invalid or expired capture link. Re-open the QR on your desktop.</Alert>
          ) : done ? (
            <Stack spacing={2} alignItems="center" py={3}>
              <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
              <Typography align="center">Uploaded! Return to your desktop — it's building the 3D model.</Typography>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Slowly pan around the room, keeping walls and objects in view. More overlap = better 3D.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}

              <Button
                variant="contained"
                size="large"
                startIcon={<VideocamIcon />}
                component="label"
                disabled={busy}
              >
                Record a video
                <input
                  hidden
                  type="file"
                  accept="video/*"
                  capture="environment"
                  onChange={(e) => handle(e.target.files, "video")}
                />
              </Button>

              <Button
                variant="outlined"
                size="large"
                startIcon={<PhotoCameraIcon />}
                component="label"
                disabled={busy}
              >
                Take photos
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  onChange={(e) => handle(e.target.files, "photos")}
                />
              </Button>

              {busy && (
                <Box>
                  <LinearProgress variant="determinate" value={progress * 100} />
                  <Typography variant="caption">Uploading {Math.round(progress * 100)}%</Typography>
                </Box>
              )}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
