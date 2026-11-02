/**
 * Short-lived HMAC signatures for splat file URLs.
 *
 * PlayCanvas loads the splat through its own asset loader, which won't attach the
 * Auth0 bearer token. Rather than make splat files public, an authenticated
 * endpoint mints a signed URL (`?t=<sig>&e=<exp>`) and the public file route
 * verifies it. Secret comes from env (SIGNING_SECRET via `wrangler secret put`).
 */
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generic short-lived signed token over an arbitrary subject string. */
export async function signToken(
  secret: string,
  subject: string,
  ttlSeconds = 3600,
): Promise<{ t: string; e: number }> {
  const e = Math.floor(Date.now() / 1000) + ttlSeconds;
  const t = await hmac(secret, `${subject}.${e}`);
  return { t, e };
}

export async function verifyToken(
  secret: string,
  subject: string,
  t: string,
  e: number,
): Promise<boolean> {
  if (!t || !e || e < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(secret, `${subject}.${e}`);
  if (expected.length !== t.length) return false;
  let diff = 0; // constant-time-ish compare
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ t.charCodeAt(i);
  return diff === 0;
}

// File-URL tokens (subject = model id).
export const signFileToken = (secret: string, modelId: string, ttl = 3600) =>
  signToken(secret, `file:${modelId}`, ttl);
export const verifyFileToken = (secret: string, modelId: string, t: string, e: number) =>
  verifyToken(secret, `file:${modelId}`, t, e);

// Capture-session tokens (subject = session id). Longer TTL: capture can take a while.
export const signCaptureToken = (secret: string, sessionId: string, ttl = 7200) =>
  signToken(secret, `cap:${sessionId}`, ttl);
export const verifyCaptureToken = (secret: string, sessionId: string, t: string, e: number) =>
  verifyToken(secret, `cap:${sessionId}`, t, e);
