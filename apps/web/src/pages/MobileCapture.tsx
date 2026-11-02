import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import VideocamIcon from "@mui/icons-material/Videocam";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { WebXRCapture, datasetToJson } from "@reno/splat-trainer";
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
  const [xrSupported, setXrSupported] = useState(false);
  const [xrActive, setXrActive] = useState(false);
  const [xrFrames, setXrFrames] = useState(0);
  const xrRef = useRef<WebXRCapture | null>(null);

  const valid = sessionId && session.token && session.exp;

  useEffect(() => {
    new WebXRCapture().isSupported().then(setXrSupported);
  }, []);

  // AR capture: records frames WITH camera poses -> no SfM guessing on the desktop.
  const startXR = async () => {
    setError(null);
    try {
      const cap = new WebXRCapture();
      xrRef.current = cap;
      await cap.start(document.body);
      setXrActive(true);
      const poll = setInterval(() => setXrFrames(cap.frameCount()), 500);
      (cap as unknown as { _poll?: number })._poll = poll as unknown as number;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const finishXR = async () => {
    const cap = xrRef.current;
    if (!cap) return;
    setBusy(true);
    setXrActive(false);
    try {
      clearInterval((cap as unknown as { _poll?: number })._poll);
      const dataset = await cap.stop();
      if (dataset.frames.length < 8) throw new Error("Too few frames captured — walk around more.");
      await reportCaptureProgress(session, { status: "uploading", message: "Uploading AR capture…" });
      const json = await datasetToJson(dataset);
      const blob = new Blob([json], { type: "application/json" });
      const key = await uploadCaptureMedia(session, blob, "json", setProgress);
      await completeCapture(session, [key], "webxr");
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
      await reportCaptureProgress(session, { status: "failed", message: (e as Error).message }).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

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
                Walk slowly around the room (don't just turn in place), keeping walls and objects
                in view from different positions. Overlap + movement = good 3D.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}

              {xrActive ? (
                <Stack spacing={1} alignItems="center">
                  <Chip color="secondary" label={`AR capturing… ${xrFrames} frames`} />
                  <Typography variant="body2" color="text.secondary" align="center">
                    Walk around the room. Tap Finish when you've covered it.
                  </Typography>
                  <Button variant="contained" color="secondary" onClick={finishXR} disabled={busy} fullWidth>
                    Finish AR capture
                  </Button>
                </Stack>
              ) : (
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<ViewInArIcon />}
                  onClick={startXR}
                  disabled={busy || !xrSupported}
                >
                  {xrSupported ? "Scan in AR (best — captures depth)" : "AR not supported on this phone"}
                </Button>
              )}

              {!xrActive && (
              <>
              <Button
                variant="outlined"
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
              </>
              )}

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
