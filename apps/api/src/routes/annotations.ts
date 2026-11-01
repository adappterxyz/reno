import { Hono } from "hono";
import { Ticket, Measurement, type Vec3 } from "@reno/shared";
import type { Env, Variables } from "../env.js";
import { ok, err, newId, nowIso } from "../lib/http.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function rowToTicket(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    splatModelId: String(r.splat_model_id),
    name: String(r.name),
    description: String(r.description ?? ""),
    category: String(r.category ?? ""),
    status: r.status as "Pending" | "InProgress" | "Completed",
    anchor: JSON.parse(String(r.anchor)) as Vec3,
    normal: r.normal ? (JSON.parse(String(r.normal)) as Vec3) : undefined,
    dateAdded: String(r.date_added),
    dateUpdated: String(r.date_updated),
  };
}

function rowToMeasurement(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    splatModelId: String(r.splat_model_id),
    label: String(r.label ?? ""),
    points: JSON.parse(String(r.points)) as Vec3[],
    dateAdded: String(r.date_added),
    dateUpdated: String(r.date_updated),
  };
}

// --- Tickets ---

app.get("/splat-models/:id/tickets", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM tickets WHERE splat_model_id = ? ORDER BY date_added ASC",
  )
    .bind(c.req.param("id"))
    .all();
  return ok(c, (rows.results ?? []).map(rowToTicket));
});

app.post("/splat-models/:id/tickets", async (c) => {
  const splatModelId = c.req.param("id");
  const now = nowIso();
  const parsed = Ticket.omit({ id: true, dateAdded: true, dateUpdated: true }).safeParse({
    ...(await c.req.json().catch(() => ({}))),
    splatModelId,
  });
  if (!parsed.success) return err(c, parsed.error.message, 422);
  const id = newId("tkt");
  const t = parsed.data;
  await c.env.DB.prepare(
    `INSERT INTO tickets
       (id, splat_model_id, name, description, category, status, anchor, normal, date_added, date_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      splatModelId,
      t.name,
      t.description,
      t.category,
      t.status,
      JSON.stringify(t.anchor),
      t.normal ? JSON.stringify(t.normal) : null,
      now,
      now,
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(id).first();
  return ok(c, rowToTicket(row as Record<string, unknown>), 201);
});

app.patch("/tickets/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [col, key] of [
    ["name", "name"],
    ["description", "description"],
    ["category", "category"],
    ["status", "status"],
  ] as const) {
    if (key in body) {
      fields.push(`${col} = ?`);
      values.push(body[key]);
    }
  }
  if ("anchor" in body) {
    fields.push("anchor = ?");
    values.push(JSON.stringify(body.anchor));
  }
  if (!fields.length) return err(c, "No updatable fields", 400);
  fields.push("date_updated = ?");
  values.push(nowIso(), id);
  await c.env.DB.prepare(`UPDATE tickets SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(id).first();
  if (!row) return err(c, "Not found", 404);
  return ok(c, rowToTicket(row as Record<string, unknown>));
});

app.delete("/tickets/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM tickets WHERE id = ?").bind(c.req.param("id")).run();
  return ok(c, { deleted: true });
});

// --- Measurements ---

app.get("/splat-models/:id/measurements", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM measurements WHERE splat_model_id = ? ORDER BY date_added ASC",
  )
    .bind(c.req.param("id"))
    .all();
  return ok(c, (rows.results ?? []).map(rowToMeasurement));
});

app.post("/splat-models/:id/measurements", async (c) => {
  const splatModelId = c.req.param("id");
  const now = nowIso();
  const parsed = Measurement.omit({ id: true, dateAdded: true, dateUpdated: true }).safeParse({
    ...(await c.req.json().catch(() => ({}))),
    splatModelId,
  });
  if (!parsed.success) return err(c, parsed.error.message, 422);
  const id = newId("meas");
  await c.env.DB.prepare(
    `INSERT INTO measurements (id, splat_model_id, label, points, date_added, date_updated)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, splatModelId, parsed.data.label, JSON.stringify(parsed.data.points), now, now)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM measurements WHERE id = ?").bind(id).first();
  return ok(c, rowToMeasurement(row as Record<string, unknown>), 201);
});

app.delete("/measurements/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM measurements WHERE id = ?").bind(c.req.param("id")).run();
  return ok(c, { deleted: true });
});

export default app;
