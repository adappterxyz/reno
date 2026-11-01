/** Cloudflare bindings available to the Worker. Mirrors wrangler.toml. */
export interface Env {
  DB: D1Database;
  SPLATS: R2Bucket;
  CACHE: KVNamespace;
  SPLAT_JOB: DurableObjectNamespace;
  AUTH0_DOMAIN: string;
  AUTH0_AUDIENCE: string;
  CORS_ORIGIN: string;
  /** HMAC secret for signed splat-file URLs. Set via `wrangler secret put SIGNING_SECRET`. */
  SIGNING_SECRET: string;
}

/** Authenticated user context attached to requests by the auth middleware. */
export interface AuthUser {
  sub: string; // Auth0 subject (stable user id)
  email?: string;
  roles: string[];
}

export type Variables = {
  user: AuthUser;
};
