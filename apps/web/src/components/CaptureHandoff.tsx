import { useEffect, useRef, useState } from "react";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import QRCode from "qrcode";
import type { NerfDataset } from "@reno/splat-trainer";
import {
  createCaptureSession,
  openCaptureSocket,
  downloadCaptureMedia,
  type CaptureSession,
  type CaptureState,
} from "../api/capture.js";
import { datasetFromBlobs } from "../lib/buildModel.js";

/**
 * Desktop side of the phone→desktop handoff. Creates a capture session, shows a
 * QR the phone scans, waits over WebSocket, then downloads the uploaded media and
 * turns it into a training dataset (which the wizard feeds to SfM).
 */
export function CaptureHandoff({
  modelId,
  onDataset,
}: {
  modelId: string;
  onDataset: (ds: NerfDataset) => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState("Starting…");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode guard: create one session
    started.current = true;

    let closeWs: (() => void) | null = null;
    let handled = false;

    (async () => {
      try {
        const session: CaptureSession = await createCaptureSession(modelId);
        setQr(await QRCode.toDataURL(session.captureUrl, { width: 240, margin: 1 }));
        setStatus("Scan the QR with your phone, then record the room.");

        closeWs = openCaptureSocket(session, async (st: CaptureState) => {
          if (st.status === "uploading") setStatus(`Phone uploading… ${Math.round(st.progress * 100)}%`);
          if (st.status === "failed") setError(st.message || "Capture failed on the phone.");
          if (st.status === "ready" && !handled) {
            handled = true;
            setStatus("Downloading media from the phone…");
            try {
              const blobs = await Promise.all(
                st.mediaKeys.map((k) => downloadCaptureMedia(session, k)),
              );
              const ds = await datasetFromBlobs(blobs, st.kind ?? "video");
              onDataset(ds);
            } catch (e) {
              setError((e as Error).message);
            }
          }
        });
      } catch (e) {
        setError((e as Error).message);
      }
    })();

    return () => {
      closeWs?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2} alignItems="center">
      {qr ? (
        <Box
          component="img"
          src={qr}
          alt="Scan to capture on your phone"
          sx={{ width: 240, height: 240, border: "1px solid #eceef3", borderRadius: 2 }}
        />
      ) : (
        <CircularProgress />
      )}
      <Typography variant="body2" color="text.secondary" align="center">
        {status}
      </Typography>
    </Stack>
  );
}
