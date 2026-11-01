import type { Env } from "../env.js";

/**
 * Email OTP backed by KV. We store only a SHA-256 hash of the code plus an
 * attempt counter and expiry, keyed by the normalized email. Codes are 6 digits,
 * valid for 10 minutes, max 5 verify attempts.
 */
const TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

interface OtpRecord {
  hash: string;
  attempts: number;
  expiresAt: number;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function generateCode(): string {
  // 6 digits, uniformly random.
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return n.toString().padStart(6, "0");
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function kvKey(email: string): string {
  return `otp:${email}`;
}

export async function storeCode(env: Env, email: string, code: string): Promise<void> {
  const rec: OtpRecord = {
    hash: await sha256(code),
    attempts: 0,
    expiresAt: Date.now() + TTL_SECONDS * 1000,
  };
  await env.CACHE.put(kvKey(email), JSON.stringify(rec), { expirationTtl: TTL_SECONDS });
}

export type VerifyResult = "ok" | "invalid" | "expired" | "too_many_attempts";

export async function verifyCode(env: Env, email: string, code: string): Promise<VerifyResult> {
  const raw = await env.CACHE.get(kvKey(email));
  if (!raw) return "expired";
  const rec = JSON.parse(raw) as OtpRecord;
  if (Date.now() > rec.expiresAt) {
    await env.CACHE.delete(kvKey(email));
    return "expired";
  }
  if (rec.attempts >= MAX_ATTEMPTS) {
    await env.CACHE.delete(kvKey(email));
    return "too_many_attempts";
  }
  const matches = (await sha256(code)) === rec.hash;
  if (!matches) {
    rec.attempts += 1;
    const remainingTtl = Math.max(1, Math.floor((rec.expiresAt - Date.now()) / 1000));
    await env.CACHE.put(kvKey(email), JSON.stringify(rec), { expirationTtl: remainingTtl });
    return "invalid";
  }
  await env.CACHE.delete(kvKey(email)); // single-use
  return "ok";
}
