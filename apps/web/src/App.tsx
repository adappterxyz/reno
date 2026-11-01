import { Routes, Route, Navigate } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { useAuth } from "./auth/AuthContext.js";
import { AppLayout } from "./components/AppLayout.js";
import { Login } from "./pages/Login.js";
import { ProjectsList } from "./pages/ProjectsList.js";
import { ProjectDetail } from "./pages/ProjectDetail.js";
import { ModelWorkspace } from "./pages/ModelWorkspace.js";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) return <Login />;

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
