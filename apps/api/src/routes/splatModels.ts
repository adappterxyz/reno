import { Hono } from "hono";
import {
  CreateSplatModelInput,
  CreateUploadInput,
  CompleteUploadInput,
  PART_SIZE,
  type SplatModel,
} from "@reno/shared";
import type { Env, Variables } from "../env.js";
import { ok, err, newId, nowIso } from "../lib/http.js";
import { signFileToken, signMediaToken } from "../lib/sign.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Map a D1 row to the SplatModel DTO. */
function rowToModel(r: Record<string, unknown>): SplatModel {
  return {
    id: String(r.id),
    projectSpaceId: String(r.project_space_id),
    name: String(r.name),
    r2Key: (r.r2_key as string) ?? null,
    format: (r.format as SplatModel["format"]) ?? null,
    fileSize: r.file_size == null ? null : Number(r.file_size),
    thumbnailKey: (r.thumbnail_key as string) ?? null,
    scaleFactor: r.scale_factor == null ? null : Number(r.scale_factor),
    status: r.status as SplatModel["status"],
    poseSource: (r.pose_source as SplatModel["poseSource"]) ?? null,
    createdBy: String(r.created_by),
    dateAdded: String(r.date_added),
    dateUpdated: String(r.date_updated),
  };
}

async function doUpdateStatus(env: Env, id: string, status: string, message = "") {
  const stub = env.SPLAT_JOB.get(env.SPLAT_JOB.idFromName(id));
  await stub.fetch(`https://do/update`, {
    method: "POST",
    body: JSON.stringify({ status, message }),
  });
}

// List models for a project space.
app.get("/project-spaces/:spaceId/splat-models", async (c) => {
  const spaceId = c.req.param("spaceId");
  const rows = await c.env.DB.prepare(
    "SELECT * FROM splat_models WHERE project_space_id = ? ORDER BY date_added DESC",
  )
    .bind(spaceId)
    .all();
  return ok(c, (rows.results ?? []).map(rowToModel));
});

// Create a draft model (before capture/training).
app.post("/project-spaces/:spaceId/splat-models", async (c) => {
  const spaceId = c.req.param("spaceId");
  const parsed = CreateSplatModelInput.safeParse({
    ...(await c.req.json().catch(() => ({}))),
    projectSpaceId: spaceId,
  });
  if (!parsed.success) return err(c, parsed.error.message, 422);

  const user = c.get("user");
  const id = newId("splat");
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO splat_models
       (id, project_space_id, name, status, pose_source, created_by, date_added, date_updated)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
  )
    .bind(id, spaceId, parsed.data.name, parsed.data.poseSource ?? null, user.sub, now, now)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM splat_models WHERE id = ?").bind(id).first();
  return ok(c, rowToModel(row as Record<string, unknown>), 201);
});

// Resume: signed download URLs for the model's persisted capture media.
app.get("/splat-models/:id/media-urls", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT capture_media, capture_kind FROM splat_models WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ capture_media: string | null; capture_kind: string | null }>();
  if (!row?.capture_media) return ok(c, { kind: null, urls: [] as string[] });
  const keys = JSON.parse(row.capture_media) as string[];
  const urls = await Promise.all(
    keys.map(async (key) => {
      const { t, e } = await signMediaToken(c.env.SIGNING_SECRET, key);
      return `/api/files/media?key=${encodeURIComponent(key)}&t=${t}&e=${e}`;
    }),
  );
  return ok(c, { kind: row.capture_kind, urls });
});

// Get one.
app.get("/splat-models/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM splat_models WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!row) return err(c, "Not found", 404);
  return ok(c, rowToModel(row as Record<string, unknown>));
});

// --- R2 multipart upload of the trained splat file ---

// 1) Begin a multipart upload. Returns an uploadId + object key.
app.post("/splat-models/:id/upload/create", async (c) => {
  const id = c.req.param("id");
  const parsed = CreateUploadInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return err(c, parsed.error.message, 422);

  const key = `models/${id}/splat.${parsed.data.format === "sog" ? "sog" : "ply"}`;
  const upload = await c.env.SPLATS.createMultipartUpload(key, {
    httpMetadata: { contentType: parsed.data.contentType },
  });
  await doUpdateStatus(c.env, id, "uploading", "Upload started");
  return ok(c, { uploadId: upload.uploadId, key, partSize: PART_SIZE });
});

// 2) Upload one part. Body is the raw part bytes. Query: uploadId, key, partNumber.
app.put("/splat-models/:id/upload/part", async (c) => {
  const uploadId = c.req.query("uploadId");
  const key = c.req.query("key");
  const partNumber = Number(c.req.query("partNumber"));
  if (!uploadId || !key || !Number.isInteger(partNumber)) return err(c, "Bad part params", 400);

  const upload = c.env.SPLATS.resumeMultipartUpload(key, uploadId);
  const body = await c.req.arrayBuffer();
  const part = await upload.uploadPart(partNumber, body);
  return ok(c, { partNumber: part.partNumber, etag: part.etag });
});

// 3) Complete the upload, finalize the model row.
app.post("/splat-models/:id/upload/complete", async (c) => {
  const id = c.req.param("id");
  const parsed = CompleteUploadInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return err(c, parsed.error.message, 422);

  const upload = c.env.SPLATS.resumeMultipartUpload(parsed.data.key, parsed.data.uploadId);
  await upload.complete(parsed.data.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));

  const format = parsed.data.key.endsWith(".sog") ? "sog" : "ply";
  const now = nowIso();
  await c.env.DB.prepare(
    `UPDATE splat_models
       SET r2_key = ?, format = ?, file_size = ?, status = 'ready', date_updated = ?
     WHERE id = ?`,
  )
    .bind(parsed.data.key, format, parsed.data.fileSize, now, id)
    .run();
  await doUpdateStatus(c.env, id, "ready", "Model ready");

  const row = await c.env.DB.prepare("SELECT * FROM splat_models WHERE id = ?").bind(id).first();
  return ok(c, rowToModel(row as Record<string, unknown>));
});

// Store the metric scale factor from the two-point calibration step.
app.post("/splat-models/:id/calibrate", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { scaleFactor?: number };
  if (!body.scaleFactor || body.scaleFactor <= 0) return err(c, "scaleFactor must be > 0", 422);
  await c.env.DB.prepare("UPDATE splat_models SET scale_factor = ?, date_updated = ? WHERE id = ?")
    .bind(body.scaleFactor, nowIso(), id)
    .run();
  return ok(c, { id, scaleFactor: body.scaleFactor });
});

// Mint a short-lived signed URL for the splat file (PlayCanvas loads it directly,
// without the Auth0 bearer). The public /files route validates the signature.
app.get("/splat-models/:id/file-url", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT r2_key FROM splat_models WHERE id = ?")
    .bind(id)
    .first<{ r2_key: string | null }>();
  if (!row?.r2_key) return err(c, "No file", 404);
  const { t, e } = await signFileToken(c.env.SIGNING_SECRET, id);
  return ok(c, { url: `/api/files/splat-models/${id}/file?t=${t}&e=${e}` });
});

// Live job state (also available over WebSocket at the DO).
app.get("/splat-models/:id/state", async (c) => {
  const id = c.req.param("id");
  const stub = c.env.SPLAT_JOB.get(c.env.SPLAT_JOB.idFromName(id));
  const res = await stub.fetch("https://do/state");
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
});

export default app;
