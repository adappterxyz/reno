import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env, Variables, AuthUser } from "./env.js";

/**
 * Auth0 JWT verification middleware.
 *
 * Replaces the old app's custom HS256 JWT with a hardcoded secret
 * (`reno#@!@2022`). Here we verify RS256 access tokens against Auth0's public
 * JWKS. The JWKS endpoint is fetched by `jose` and cached in-isolate; we also
 * reuse a module-level set per domain so warm isolates skip the fetch.
 *
 * NOTE: in the old backend the auth middleware was commented out and most routes
 * were unprotected. Here every route under `requireAuth` is enforced.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(domain: string) {
  let jwks = jwksCache.get(domain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
    jwksCache.set(domain, jwks);
  }
  return jwks;
}

/** Auth0 puts roles in a namespaced custom claim; adjust to your tenant's Action. */
const ROLES_CLAIM = "https://renosphere.co/roles";

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return c.json({ ok: false, error: "Missing bearer token" }, 401);

    try {
      const { payload } = await jwtVerify(token, getJwks(c.env.AUTH0_DOMAIN), {
        issuer: `https://${c.env.AUTH0_DOMAIN}/`,
        audience: c.env.AUTH0_AUDIENCE,
      });
      const rawRoles = payload[ROLES_CLAIM];
      const user: AuthUser = {
        sub: String(payload.sub),
        email: typeof payload.email === "string" ? payload.email : undefined,
        roles: Array.isArray(rawRoles) ? rawRoles.map(String) : [],
      };
      c.set("user", user);
      await next();
    } catch (err) {
      return c.json({ ok: false, error: "Invalid token", code: "auth_invalid" }, 401);
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
