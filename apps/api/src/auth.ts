import { createMiddleware } from "hono/factory";
import type { Env, Variables, AuthUser } from "./env.js";
import { verifySession } from "./lib/jwt.js";

/**
 * Session auth middleware. Verifies our own HS256 JWT (issued at OTP verify),
 * replacing the former Auth0 JWKS verification. Every route under `requireAuth`
 * is enforced (the old app left most routes unprotected).
 */
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return c.json({ ok: false, error: "Missing bearer token" }, 401);
    try {
      const claims = await verifySession(c.env.SIGNING_SECRET, token);
      const user: AuthUser = { sub: claims.sub, email: claims.email, roles: claims.roles };
      c.set("user", user);
      await next();
    } catch {
      return c.json({ ok: false, error: "Invalid or expired session", code: "auth_invalid" }, 401);
    }
  },
);

/** Role gate — mirrors the old AuthGuard per-route role checks. */
export function requireRole(...allowed: string[]) {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const user = c.get("user");
    if (!user || !user.roles.some((r) => allowed.includes(r))) {
      return c.json({ ok: false, error: "Forbidden", code: "forbidden" }, 403);
    }
    await next();
  });
}
