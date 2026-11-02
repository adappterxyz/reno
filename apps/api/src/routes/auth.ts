import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { ok, err, newId, nowIso } from "../lib/http.js";
import { signSession } from "../lib/jwt.js";
import {
  generateCode,
  storeCode,
  verifyCode,
  normalizeEmail,
  isValidEmail,
} from "../lib/otp.js";
import { sendOtpEmail } from "../lib/email.js";

/**
 * Email-OTP auth (public routes). Flow:
 *   POST /auth/otp/request { email }          -> emails a 6-digit code
 *   POST /auth/otp/verify  { email, code }    -> { token, user }
 * The token is a 7-day HS256 session JWT consumed by requireAuth.
 */
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.post("/auth/otp/request", async (c) => {
  const { email } = (await c.req.json().catch(() => ({}))) as { email?: string };
  const norm = normalizeEmail(email ?? "");
  if (!isValidEmail(norm)) return err(c, "Valid email required", 422);

  const code = generateCode();
  await storeCode(c.env, norm, code);
  const dev = c.env.OTP_DEV_MODE === "true";

  let sent = false;
  let sendError: string | null = null;
  try {
    sent = await sendOtpEmail(c.env, norm, code);
  } catch (e) {
    sendError = (e as Error).message;
    console.error("[otp] send failed:", sendError);
  }

  // Production: a failed send is a hard error. Dev: still return the code so the
  // flow is testable while email delivery is being set up.
  if (!sent && !dev) return err(c, "Could not send code, try again", 502);
  return ok(c, { sent, ...(dev ? { devCode: code, sendError } : {}) });
});

app.post("/auth/otp/verify", async (c) => {
  const { email, code } = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
  };
  const norm = normalizeEmail(email ?? "");
  if (!isValidEmail(norm) || !code) return err(c, "Email and code required", 422);

  const result = await verifyCode(c.env, norm, code.trim());
  if (result !== "ok") {
    const msg =
      result === "expired"
        ? "Code expired — request a new one"
        : result === "too_many_attempts"
          ? "Too many attempts — request a new code"
          : "Incorrect code";
    return err(c, msg, 401, result);
  }

  // Upsert the user by email.
  const now = nowIso();
  let user = await c.env.DB.prepare("SELECT id, email, role FROM users WHERE email = ?")
    .bind(norm)
    .first<{ id: string; email: string; role: string }>();
  if (!user) {
    const id = newId("usr");
    // First-ever user becomes Superadmin; everyone after is Staff by default.
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    const role = (count?.n ?? 0) === 0 ? "Superadmin" : "Staff";
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, role, status, date_added, last_login) VALUES (?, ?, ?, 'Active', ?, ?)",
    )
      .bind(id, norm, role, now, now)
      .run();
    user = { id, email: norm, role };
  } else {
    await c.env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(now, user.id).run();
  }

  const token = await signSession(c.env.SIGNING_SECRET, {
    sub: user.id,
    email: user.email,
    roles: [user.role],
  });
  return ok(c, { token, user: { id: user.id, email: user.email, role: user.role } });
});

export default app;
