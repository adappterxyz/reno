import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useNavigate } from "react-router-dom";
import { useCreateProject, useProjects } from "../api/hooks.js";

export function ProjectsList() {
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  const submit = async () => {
    if (!name) return;
    await createProject.mutateAsync({ name, location });
    setOpen(false);
    setName("");
    setLocation("");
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h5">Projects</Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpen(true)}>
          New project
        </Button>
      </Stack>

      {isLoading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : !projects?.length ? (
        <Typography color="text.secondary">No projects yet. Create your first one.</Typography>
      ) : (
        <Grid container spacing={2}>
          {projects.map((p) => (
            <Grid key={p.id} item xs={12} sm={6} md={4}>
              <Card>
                <CardActionArea onClick={() => navigate(`/projects/${p.id}`)}>
                  <CardContent>
                    <Typography variant="h6" noWrap>
                      {p.name}
                    </Typography>
                    <Typography color="text.secondary" noWrap>
                      {p.location || "—"}
                    </Typography>
                    <Typography variant="caption" color="primary">
                      {p.status}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus fullWidth />
            <TextField label="Location" value={location} onChange={(e) => setLocation(e.target.value)} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={!name || createProject.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
