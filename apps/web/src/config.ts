export const config = {
  apiBase: import.meta.env.VITE_API_BASE ?? "http://localhost:8787",
  auth0Domain: import.meta.env.VITE_AUTH0_DOMAIN ?? "",
  auth0ClientId: import.meta.env.VITE_AUTH0_CLIENT_ID ?? "",
  auth0Audience: import.meta.env.VITE_AUTH0_AUDIENCE ?? "",
  brushWorkerUrl: import.meta.env.VITE_BRUSH_WORKER_URL ?? "",
};
