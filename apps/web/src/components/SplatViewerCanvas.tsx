import { useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { SplatViewer, type SplatViewerEvents } from "@reno/splat-viewer";
import { routes } from "@reno/shared";
import { api } from "../api/client.js";

interface Props {
  splatModelId: string;
  events?: SplatViewerEvents;
  /** Receives the viewer instance once ready so the parent can drive modes. */
  onViewer?: (viewer: SplatViewer | null) => void;
}

export function SplatViewerCanvas({ splatModelId, events, onViewer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SplatViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Keep latest events without re-creating the viewer.
  const eventsRef = useRef<SplatViewerEvents>({});
  eventsRef.current = events ?? {};

  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const viewer = await SplatViewer.create(canvas, {
          onPick: (p, n) => eventsRef.current.onPick?.(p, n),
          onMarkers: (m) => eventsRef.current.onMarkers?.(m),
          onTicketClick: (id) => eventsRef.current.onTicketClick?.(id),
          onLoadProgress: (p) => setProgress(p),
          onError: (e) => setError(e.message),
        });
        if (disposed) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;
        onViewer?.(viewer);

        // Mint a signed URL and load the splat.
        // The minted url already includes the /api prefix; fileUrl() adds the host.
        const { url } = await api.get<{ url: string }>(routes.splatModelFileUrl(splatModelId));
        await viewer.loadSplat(api.fileUrl(url));
        if (!disposed) setLoading(false);
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      onViewer?.(null);
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splatModelId]);

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100%", bgcolor: "#1a1d22", borderRadius: 2, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      {loading && (
        <Overlay>
          <CircularProgress sx={{ color: "white" }} />
          <Typography sx={{ color: "white", mt: 2 }}>
            Loading model… {Math.round(progress * 100)}%
          </Typography>
        </Overlay>
      )}
      {error && (
        <Overlay>
          <Typography sx={{ color: "#ff8a80" }}>Failed to load model: {error}</Typography>
        </Overlay>
      )}
    </Box>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        flexDirection: "column",
        bgcolor: "rgba(0,0,0,0.35)",
      }}
    >
      <Box sx={{ textAlign: "center" }}>{children}</Box>
    </Box>
  );
}
