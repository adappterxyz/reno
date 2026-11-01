import { useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { setTokenGetter } from "./api/client.js";
import { AppLayout } from "./components/AppLayout.js";
import { ProjectsList } from "./pages/ProjectsList.js";
import { ProjectDetail } from "./pages/ProjectDetail.js";
import { ModelWorkspace } from "./pages/ModelWorkspace.js";

export function App() {
  const { isLoading, isAuthenticated, loginWithRedirect, getAccessTokenSilently } = useAuth0();

  // Wire the Auth0 token into the API client once authenticated.
  useEffect(() => {
    if (isAuthenticated) {
      setTokenGetter(async () => (await getAccessTokenSilently()) ?? "");
    }
  }, [isAuthenticated, getAccessTokenSilently]);

  if (isLoading) {
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  }

  if (!isAuthenticated) {
    return (
      <Centered>
        <Stack spacing={3} alignItems="center">
          <Typography variant="h4">Reno</Typography>
          <Typography color="text.secondary">Renovation workspace with 3D property models.</Typography>
          <Button size="large" variant="contained" onClick={() => loginWithRedirect()}>
            Sign in
          </Button>
        </Stack>
      </Centered>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsList />} />
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/spaces/:spaceId/model/:modelId" element={<ModelWorkspace />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </AppLayout>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>{children}</Box>
  );
}
