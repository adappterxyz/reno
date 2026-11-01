import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { ok, err, newId, nowIso } from "../lib/http.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Current authenticated user (protected).
app.get("/auth/me", async (c) => {
  const u = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT id, email, role, display_name FROM users WHERE id = ?",
  )
    .bind(u.sub)
    .first();
  if (!row) return err(c, "User not found", 404);
  return ok(c, row);
});

function isSuperadmin(c: { get: (k: "user") => Variables["user"] }) {
  return c.get("user").roles.includes("Superadmin");
}

// List projects (Superadmin sees all; others see what they created — assignment
// port is Phase 4).
app.get("/projects", async (c) => {
  const user = c.get("user");
  const rows = isSuperadmin(c)
    ? await c.env.DB.prepare(
        "SELECT * FROM projects WHERE status != 'Deleted' ORDER BY date_added DESC",
      ).all()
    : await c.env.DB.prepare(
        "SELECT * FROM projects WHERE status != 'Deleted' AND created_by = ? ORDER BY date_added DESC",
      )
        .bind(user.sub)
        .all();
  return ok(c, rows.results ?? []);
});

app.post("/projects", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; location?: string };
  if (!body.name) return err(c, "name required", 422);
  const id = newId("prj");
  const now = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO projects (id, name, location, status, created_by, date_added, date_updated) VALUES (?, ?, ?, 'Pending', ?, ?, ?)",
  )
    .bind(id, body.name, body.location ?? null, user.sub, now, now)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  return ok(c, row, 201);
});

app.get("/projects/:id", async (c) => {
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!project) return err(c, "Not found", 404);
  const spaces = await c.env.DB.prepare(
    "SELECT * FROM project_spaces WHERE project_id = ? ORDER BY date_added ASC",
  )
    .bind(c.req.param("id"))
    .all();
  return ok(c, { project, spaces: spaces.results ?? [] });
});

// Create a space within a project.
app.post("/projects/:id/spaces", async (c) => {
  const projectId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (!body.name) return err(c, "name required", 422);
  const id = newId("spc");
  await c.env.DB.prepare(
    "INSERT INTO project_spaces (id, project_id, name, status, date_added) VALUES (?, ?, ?, 'Pending', ?)",
  )
    .bind(id, projectId, body.name, nowIso())
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM project_spaces WHERE id = ?").bind(id).first();
  return ok(c, row, 201);
});

export default app;
