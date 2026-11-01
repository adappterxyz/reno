import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./env.js";
import { requireAuth } from "./auth.js";
import { ok } from "./lib/http.js";
import projects from "./routes/projects.js";
import splatModels from "./routes/splatModels.js";
import annotations from "./routes/annotations.js";
import files from "./routes/files.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  const handler = cors({
    origin: c.env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    allowHeaders: ["Authorization", "Content-Type", "Range"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Range", "Content-Length", "ETag"],
    maxAge: 86400,
  });
  return handler(c, next);
});

// Public health check.
app.get("/api/health", (c) => ok(c, { status: "up", ts: new Date().toISOString() }));

// Public, signature-validated splat file serving (no Auth0 bearer possible here).
app.route("/api", files);

// Everything else requires a valid Auth0 token.
const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.use("*", requireAuth);
api.route("/", projects);
api.route("/", splatModels);
api.route("/", annotations);

app.route("/api", api);

app.onError((e, c) => {
  console.error("Unhandled error", e);
  return c.json({ ok: false, error: "Internal error" }, 500);
});

export default app;
export { SplatJob } from "./do/SplatJob.js";
