import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { useNavigate, useParams } from "react-router-dom";
import { useCreateSpace, useProject, useSplatModels, type ProjectSpace } from "../api/hooks.js";
import { CreateModelWizard } from "../components/CreateModelWizard.js";

export function ProjectDetail() {
  const { projectId = "" } = useParams();
  const { data, isLoading } = useProject(projectId);
  const createSpace = useCreateSpace(projectId);
  const [spaceName, setSpaceName] = useState("");

  if (isLoading || !data) return <Typography color="text.secondary">Loading…</Typography>;

  return (
    <Box>
      <Typography variant="h5">{data.project.name}</Typography>
      <Typography color="text.secondary" gutterBottom>
        {data.project.location || "—"}
      </Typography>
      <Divider sx={{ my: 3 }} />

      <Stack direction="row" spacing={1} mb={2} alignItems="center">
        <TextField
          size="small"
          label="New space (room)"
          value={spaceName}
          onChange={(e) => setSpaceName(e.target.value)}
        />
        <Button
          startIcon={<AddIcon />}
          onClick={async () => {
            if (!spaceName) return;
            await createSpace.mutateAsync({ name: spaceName });
            setSpaceName("");
          }}
        >
          Add space
        </Button>
      </Stack>

      <Stack spacing={2}>
        {data.spaces.map((s) => (
          <SpaceCard key={s.id} space={s} />
        ))}
        {!data.spaces.length && (
          <Typography color="text.secondary">No spaces yet. Add a room to start capturing 3D models.</Typography>
        )}
      </Stack>
    </Box>
  );
}

function SpaceCard({ space }: { space: ProjectSpace }) {
  const { data: models, refetch } = useSplatModels(space.id);
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">{space.name}</Typography>
          <Button startIcon={<ViewInArIcon />} variant="contained" onClick={() => setWizardOpen(true)}>
            Create 3D model
          </Button>
        </Stack>

        <Stack direction="row" spacing={1} mt={2} flexWrap="wrap" useFlexGap>
          {(models ?? []).map((m) => (
            <Chip
              key={m.id}
              label={`${m.name} · ${m.status}`}
              color={m.status === "ready" ? "success" : "default"}
              onClick={
                m.status === "ready"
                  ? () => navigate(`/spaces/${space.id}/model/${m.id}`)
                  : undefined
              }
              clickable={m.status === "ready"}
            />
          ))}
          {!models?.length && (
            <Typography variant="body2" color="text.secondary">
              No models yet.
            </Typography>
          )}
        </Stack>
      </CardContent>

      {wizardOpen && (
        <CreateModelWizard
          spaceId={space.id}
          onClose={() => {
            setWizardOpen(false);
            refetch();
          }}
          onReady={(modelId) => navigate(`/spaces/${space.id}/model/${modelId}`)}
        />
      )}
    </Card>
  );
}
