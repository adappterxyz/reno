import { useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { routes, polylineLength, type Vec3, type Ticket, type Measurement } from "@reno/shared";
import type { SplatViewer, ViewerMode, MarkerScreenPos } from "@reno/splat-viewer";
import { SplatViewerCanvas } from "../components/SplatViewerCanvas.js";
import { api } from "../api/client.js";
import { useMeasurements, useSplatModel, useTickets } from "../api/hooks.js";

export function ModelWorkspace() {
  const { modelId = "" } = useParams();
  const qc = useQueryClient();
  const { data: model } = useSplatModel(modelId);
  const { data: tickets } = useTickets(modelId);
  const { data: measurements } = useMeasurements(modelId);

  const viewerRef = useRef<SplatViewer | null>(null);
  const [mode, setMode] = useState<ViewerMode>("view");
  const [tab, setTab] = useState(0);
  const [markers, setMarkers] = useState<MarkerScreenPos[]>([]);

  // Pending interactions
  const [pendingTicket, setPendingTicket] = useState<{ anchor: Vec3; name: string } | null>(null);
  const [measurePoints, setMeasurePoints] = useState<Vec3[]>([]);
  const [calibPoints, setCalibPoints] = useState<Vec3[]>([]);
  const [calibDistance, setCalibDistance] = useState("");

  const scaleFactor = model?.scaleFactor ?? null;

  const setViewerMode = (m: ViewerMode) => {
    setMode(m);
    viewerRef.current?.setMode(m);
    viewerRef.current?.clearMeasurePoints();
    setMeasurePoints([]);
    setCalibPoints([]);
  };

  const events = useMemo(
    () => ({
      onMarkers: setMarkers,
      onTicketClick: (id: string) => {
        setTab(0);
        viewerRef.current?.flyToTicket(id);
      },
      onPick: (point: Vec3) => {
        if (mode === "place-ticket") setPendingTicket({ anchor: point, name: "" });
        else if (mode === "measure") setMeasurePoints((p) => [...p, point]);
        else if (mode === "calibrate") setCalibPoints((p) => (p.length >= 2 ? [point] : [...p, point]));
      },
    }),
    [mode],
  );

  const refetchTickets = () => qc.invalidateQueries({ queryKey: ["tickets", modelId] });
  const refetchMeas = () => qc.invalidateQueries({ queryKey: ["measurements", modelId] });
  const refetchModel = () => qc.invalidateQueries({ queryKey: ["splat-model", modelId] });

  const saveTicket = async () => {
    if (!pendingTicket?.name) return;
    await api.post(routes.tickets(modelId), {
      name: pendingTicket.name,
      anchor: pendingTicket.anchor,
      status: "Pending",
    });
    setPendingTicket(null);
    setViewerMode("view");
    await refetchTickets();
    viewerRef.current?.setTickets((await api.get<Ticket[]>(routes.tickets(modelId))) ?? []);
  };

  const saveMeasurement = async () => {
    if (measurePoints.length < 2) return;
    await api.post(routes.measurements(modelId), { label: "", points: measurePoints });
    setMeasurePoints([]);
    viewerRef.current?.clearMeasurePoints();
    await refetchMeas();
    viewerRef.current?.setMeasurements((await api.get<Measurement[]>(routes.measurements(modelId))) ?? []);
  };

  const saveCalibration = async () => {
    const d = Number(calibDistance);
    if (calibPoints.length !== 2 || !d) return;
    const raw = polylineLength(calibPoints);
    if (raw <= 0) return;
    await api.post(routes.calibrate(modelId), { scaleFactor: d / raw });
    setCalibPoints([]);
    setCalibDistance("");
    setViewerMode("view");
    await refetchModel();
  };

  const fmt = (rawLen: number) =>
    scaleFactor ? `${(rawLen * scaleFactor).toFixed(2)} m` : `${rawLen.toFixed(2)} (uncalibrated)`;

  // Sync annotations into the viewer when data or viewer changes.
  const onViewer = (v: SplatViewer | null) => {
    viewerRef.current = v;
    if (v) {
      v.setMode(mode);
      if (tickets) v.setTickets(tickets);
      if (measurements) v.setMeasurements(measurements);
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h5">{model?.name ?? "Model"}</Typography>
        <Chip
          size="small"
          color={scaleFactor ? "success" : "warning"}
          label={scaleFactor ? "Calibrated (metric)" : "Not calibrated"}
        />
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        {/* Viewer */}
        <Box sx={{ position: "relative", flex: 1, height: { xs: 360, md: 560 } }}>
          <SplatViewerCanvas splatModelId={modelId} events={events} onViewer={onViewer} />

          {/* HTML marker overlay (ticket labels projected to screen). */}
          {markers.map((m) => {
            const t = tickets?.find((x) => x.id === m.id);
            if (m.behindCamera || !t) return null;
            return (
              <Box
                key={m.id}
                sx={{
                  position: "absolute",
                  left: m.x,
                  top: m.y,
                  transform: "translate(-50%, -140%)",
                  px: 1,
                  py: 0.25,
                  bgcolor: "rgba(20,22,26,0.85)",
                  color: "white",
                  borderRadius: 1,
                  fontSize: 12,
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {t.name}
              </Box>
            );
          })}

          {/* Mode toolbar */}
          <Paper sx={{ position: "absolute", top: 12, left: 12, p: 0.5 }}>
            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setViewerMode(v)}>
              <ToggleButton value="view">View</ToggleButton>
              <ToggleButton value="place-ticket">+ Ticket</ToggleButton>
              <ToggleButton value="measure">Measure</ToggleButton>
              <ToggleButton value="calibrate">Calibrate</ToggleButton>
            </ToggleButtonGroup>
          </Paper>

          {/* Mode-specific controls */}
          {mode === "measure" && (
            <Paper sx={{ position: "absolute", bottom: 12, left: 12, p: 1.5 }}>
              <Typography variant="body2">Points: {measurePoints.length}</Typography>
              <Typography variant="body2">Length: {fmt(polylineLength(measurePoints))}</Typography>
              <Stack direction="row" spacing={1} mt={1}>
                <Button size="small" onClick={() => { setMeasurePoints([]); viewerRef.current?.clearMeasurePoints(); }}>
                  Clear
                </Button>
                <Button size="small" variant="contained" onClick={saveMeasurement} disabled={measurePoints.length < 2}>
                  Save
                </Button>
              </Stack>
            </Paper>
          )}
          {mode === "calibrate" && (
            <Paper sx={{ position: "absolute", bottom: 12, left: 12, p: 1.5, maxWidth: 260 }}>
              <Typography variant="body2" gutterBottom>
                Click two points a known real-world distance apart ({calibPoints.length}/2).
              </Typography>
              <TextField
                size="small"
                fullWidth
                label="Real distance (metres)"
                value={calibDistance}
                onChange={(e) => setCalibDistance(e.target.value)}
              />
              <Button
                sx={{ mt: 1 }}
                size="small"
                variant="contained"
                onClick={saveCalibration}
                disabled={calibPoints.length !== 2 || !calibDistance}
              >
                Set scale
              </Button>
            </Paper>
          )}
        </Box>

        {/* Side panel */}
        <Paper sx={{ width: { xs: "100%", md: 320 }, p: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
            <Tab label={`Tickets (${tickets?.length ?? 0})`} />
            <Tab label={`Measurements (${measurements?.length ?? 0})`} />
          </Tabs>
          <Divider sx={{ my: 1 }} />

          {tab === 0 && (
            <>
              {mode !== "place-ticket" && (
                <Button fullWidth variant="outlined" onClick={() => setViewerMode("place-ticket")} sx={{ mb: 1 }}>
                  Place a ticket
                </Button>
              )}
              <List dense>
                {(tickets ?? []).map((t) => (
                  <ListItemButton key={t.id} onClick={() => viewerRef.current?.flyToTicket(t.id)}>
                    <ListItemText primary={t.name} secondary={t.status} />
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await api.del(routes.ticket(t.id));
                        viewerRef.current?.removeTicketMarker(t.id);
                        refetchTickets();
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </ListItemButton>
                ))}
              </List>
            </>
          )}

          {tab === 1 && (
            <List dense>
              {(measurements ?? []).map((m) => (
                <ListItemButton key={m.id}>
                  <ListItemText primary={m.label || "Measurement"} secondary={fmt(polylineLength(m.points))} />
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={async () => {
                      await api.del(routes.measurement(m.id));
                      refetchMeas();
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemButton>
              ))}
              {!measurements?.length && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  Use Measure mode to add one.
                </Typography>
              )}
            </List>
          )}
        </Paper>
      </Stack>

      {/* Add-ticket dialog after a 3D pick */}
      <Dialog open={!!pendingTicket} onClose={() => setPendingTicket(null)} fullWidth maxWidth="xs">
        <DialogTitle>New ticket</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="What needs doing here?"
            value={pendingTicket?.name ?? ""}
            onChange={(e) => setPendingTicket((p) => (p ? { ...p, name: e.target.value } : p))}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingTicket(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveTicket} disabled={!pendingTicket?.name}>
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
