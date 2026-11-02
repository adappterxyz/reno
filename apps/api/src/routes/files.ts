import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { verifyFileToken, verifyMediaToken } from "../lib/sign.js";

/**
 * Public (signature-validated) splat file serving. Mounted OUTSIDE the Auth0
 * middleware because PlayCanvas' loader can't send a bearer token. Access is
 * gated by the short-lived HMAC token minted at /splat-models/:id/file-url.
 * Streams from R2 with HTTP Range support for large splat files.
 */
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Resume-build media download (token subject = exact R2 key).
app.get("/files/media", async (c) => {
  const key = c.req.query("key") ?? "";
  const t = c.req.query("t") ?? "";
  const e = Number(c.req.query("e") ?? 0);
  if (!key.startsWith("captures/") || !(await verifyMediaToken(c.env.SIGNING_SECRET, key, t, e))) {
    return c.json({ ok: false, error: "Invalid or expired token" }, 403);
  }
  const range = c.req.header("Range");
  const obj = await c.env.SPLATS.get(key, range ? { range: c.req.raw.headers } : undefined);
  if (!obj) return c.json({ ok: false, error: "Not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  const status = (obj as R2ObjectBody & { range?: unknown }).range ? 206 : 200;
  return new Response(obj.body, { status, headers });
});

app.get("/files/splat-models/:id/file", async (c) => {
  const id = c.req.param("id");
  const t = c.req.query("t") ?? "";
  const e = Number(c.req.query("e") ?? 0);
  if (!(await verifyFileToken(c.env.SIGNING_SECRET, id, t, e))) {
    return c.json({ ok: false, error: "Invalid or expired token" }, 403);
  }

  const row = await c.env.DB.prepare("SELECT r2_key FROM splat_models WHERE id = ?")
    .bind(id)
    .first<{ r2_key: string | null }>();
  if (!row?.r2_key) return c.json({ ok: false, error: "No file" }, 404);

  const range = c.req.header("Range");
  const obj = await c.env.SPLATS.get(row.r2_key, range ? { range: c.req.raw.headers } : undefined);
  if (!obj) return c.json({ ok: false, error: "Object missing" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=3600");
  const status = (obj as R2ObjectBody & { range?: unknown }).range ? 206 : 200;
  return new Response(obj.body, { status, headers });
});

export default app;
