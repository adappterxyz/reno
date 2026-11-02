import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { ok, err, newId } from "../lib/http.js";
import { signCaptureToken, verifyCaptureToken } from "../lib/sign.js";

interface SessionRecord {
  modelId: string;
  createdBy: string;
  status: string;
}

const kvKey = (sid: string) => `capture:${sid}`;

async function notifyDO(env: Env, sid: string, patch: Record<string, unknown>) {
  const stub = env.CAPTURE_SESSION.get(env.CAPTURE_SESSION.idFromName(sid));
  await stub.fetch("https://do/update", { method: "POST", body: JSON.stringify(patch) });
}

/** Validate the ?t=&e= capture token for :sessionId. Returns the record or null. */
async function authSession(c: {
  env: Env;
  req: { param: (k: string) => string; query: (k: string) => string | undefined };
}): Promise<{ sid: string; rec: SessionRecord } | null> {
  const sid = c.req.param("sessionId");
  const t = c.req.query("t") ?? "";
  const e = Number(c.req.query("e") ?? 0);
  if (!(await verifyCaptureToken(c.env.SIGNING_SECRET, sid, t, e))) return null;
  const raw = await c.env.CACHE.get(kvKey(sid));
  if (!raw) return null;
  return { sid, rec: JSON.parse(raw) as SessionRecord };
}

// ---------- Authed: desktop creates a capture session ----------
export const captureAuthed = new Hono<{ Bindings: Env; Variables: Variables }>();

captureAuthed.post("/splat-models/:id/capture-session", async (c) => {
  const modelId = c.req.param("id");
  const user = c.get("user");
  const sid = newId("cap");
  const { t, e } = await signCaptureToken(c.env.SIGNING_SECRET, sid);
  const rec: SessionRecord = { modelId, createdBy: user.sub, status: "waiting" };
  await c.env.CACHE.put(kvKey(sid), JSON.stringify(rec), { expirationTtl: 7200 });

  const origin = new URL(c.req.url).origin;
  return ok(c, {
    sessionId: sid,
    token: t,
    exp: e,
    captureUrl: `${origin}/capture/${sid}?t=${t}&e=${e}`,
  });
});

// ---------- Public (token-authed): phone capture + desktop download/signal ----------
export const capturePublic = new Hono<{ Bindings: Env; Variables: Variables }>();

// WebSocket (desktop + phone subscribe to live session state).
capturePublic.get("/capture/:sessionId/ws", async (c) => {
  const auth = await authSession(c);
  if (!auth) return err(c, "Invalid session token", 403);
  const stub = c.env.CAPTURE_SESSION.get(c.env.CAPTURE_SESSION.idFromName(auth.sid));
  return stub.fetch(c.req.raw);
});

// Phone fetches session validity/status.
capturePublic.get("/capture/:sessionId", async (c) => {
  const auth = await authSession(c);
  if (!auth) return err(c, "Invalid or expired session", 403);
  return ok(c, { sessionId: auth.sid, status: auth.rec.status });
});

// Phone reports progress to the desktop.
capturePublic.post("/capture/:sessionId/progress", async (c) => {
  const auth = await authSession(c);
  if (!auth) return err(c, "Invalid session token", 403);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  await notifyDO(c.env, auth.sid, body);
  return ok(c, { ok: true });
});

// Multipart upload of captured media to R2 under captures/<sid>/.
capturePublic.post("/capture/:sessionId/upload/create", async (c) => {
  const auth = await authSession(c);
  if (!auth) return err(c, "Invalid session token", 403);
  const body = (await c.req.json().catch(() => ({}))) as { ext?: string; contentType?: string };
  const key = `captures/${auth.sid}/media-${newId()}.${body.ext ?? "webm"}`;
  const upload = await c.env.SPLATS.createMultipartUpload(key, {
    httpMetadata: { contentType: body.contentType ?? "application/octet-stream" },
  });
  await notifyDO(c.env, auth.sid, { status: "uploading" });
  return ok(c, { uploadId: upload.uploadId, key, partSize: 8 * 1024 * 1024 });
});

capturePublic.put("/capture/:sessionId/upload/part", async (c) => {
  const auth = await authSession(c);
  if (!auth) return err(c, "Invalid session token", 403);
  const uploadId = c.req.query("uploadId");
  const key = c.req.query("key");
  const partNumber = Number(c.req.query("partNumber"));
  if (!uploadId || !key || !Number.isInteger(partNumber)) return err(c, "Bad part params", 400);
  if (!key.startsWith(`captures/${auth.sid}/`)) return err(c, "Key outside session", 403);
  const upload = c.env.SPLATS.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, await c.req.arrayBuffer());
  return ok(c, { partNumber: part.partNumber, etag: part.etag });
});

capturePublic.post("/capture/:sessionId/upload/complete", async (c) => {
  const auth = await authSession(c);
  if (!auth) return err(c, "Invalid session token", 403);
  const body = (await c.req.json().catch(() => ({}))) as {
    uploadId: string;
    key: string;
    parts: { partNumber: number; etag: string }[];
  };
  if (!body.key?.startsWith(`captures/${auth.sid}/`)) return err(c, "Key outside session", 403);
  const upload = c.env.SPLATS.resumeMultipartUpload(body.key, body.uploadId);
  await upload.complete(body.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
  return ok(c, { key: body.key });
});

// Phone marks capture complete -> notify desktop with media keys.
capturePublic.post("/capture/:sessionId/complete", async (c) => {
  const auth = await authSession(c);
  if (!auth) return err(c, "Invalid session token", 403);
  const body = (await c.req.json().catch(() => ({}))) as {
    keys?: string[];
    kind?: "video" | "photos" | "webxr";
  };
  const keys = (body.keys ?? []).filter((k) => k.startsWith(`captures/${auth.sid}/`));
  const kind = body.kind ?? "video";
  await c.env.CACHE.put(
    kvKey(auth.sid),
    JSON.stringify({ ...auth.rec, status: "ready" }),
    { expirationTtl: 7200 },
  );
  // Persist media on the model so the build can be resumed without re-capturing.
  await c.env.DB.prepare(
    "UPDATE splat_models SET capture_media = ?, capture_kind = ?, status = 'capturing', date_updated = ? WHERE id = ?",
  )
    .bind(JSON.stringify(keys), kind, new Date().toISOString(), auth.rec.modelId)
    .run();
  await notifyDO(c.env, auth.sid, { status: "ready", mediaKeys: keys, kind });
  return ok(c, { ok: true });
});

// Desktop downloads a captured media object (token-authed, streamed from R2).
capturePublic.get("/capture/:sessionId/file", async (c) => {
  const auth = await authSession(c);
  if (!auth) return err(c, "Invalid session token", 403);
  const key = c.req.query("key") ?? "";
  if (!key.startsWith(`captures/${auth.sid}/`)) return err(c, "Key outside session", 403);
  const range = c.req.header("Range");
  const obj = await c.env.SPLATS.get(key, range ? { range: c.req.raw.headers } : undefined);
  if (!obj) return err(c, "Not found", 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  const status = (obj as R2ObjectBody & { range?: unknown }).range ? 206 : 200;
  return new Response(obj.body, { status, headers });
});
