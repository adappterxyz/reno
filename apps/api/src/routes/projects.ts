import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { ok, err, newId, nowIso } from "../lib/http.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Upsert the app-local user row from the verified Auth0 identity. */
async function upsertUser(c: { env: Env; get: (k: "user") => Variables["user"] }) {
  const user = c.get("user");
  const existing = await c.env.DB.prepare("SELECT id, role FROM users WHERE auth0_sub = ?")
    .bind(user.sub)
    .first<{ id: string; role: string }>();
  if (existing) return existing;
  const id = newId("usr");
  // First user role: prefer an Auth0 role claim, else default Staff.
  const role = user.roles[0] ?? "Staff";
  await c.env.DB.prepare(
    "INSERT INTO users (id, auth0_sub, email, role, status, date_added) VALUES (?, ?, ?, ?, 'Active', ?)",
  )
    .bind(id, user.sub, user.email ?? null, role, nowIso())
    .run();
  return { id, role };
}

app.get("/auth/me", async (c) => {
  const profile = await upsertUser(c);
  const user = c.get("user");
  return ok(c, { id: profile.id, sub: user.sub, email: user.email, role: profile.role });
});

// List projects (Superadmin sees all; others see assigned — assignment port is Phase 4,
// so for now non-superadmins see projects they created).
app.get("/projects", async (c) => {
  const profile = await upsertUser(c);
  const user = c.get("user");
  const isSuper = profile.role === "Superadmin" || user.roles.includes("Superadmin");
  const rows = isSuper
    ? await c.env.DB.prepare("SELECT * FROM projects WHERE status != 'Deleted' ORDER BY date_added DESC").all()
    : await c.env.DB.prepare(
        "SELECT * FROM projects WHERE status != 'Deleted' AND created_by = ? ORDER BY date_added DESC",
      )
        .bind(user.sub)
        .all();
  return ok(c, rows.results ?? []);
});

app.post("/projects", async (c) => {
  await upsertUser(c);
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
