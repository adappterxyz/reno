/** Cloudflare bindings available to the Worker. Mirrors wrangler.toml. */
export interface Env {
  DB: D1Database;
  SPLATS: R2Bucket;
  CACHE: KVNamespace;
  SPLAT_JOB: DurableObjectNamespace;
  CORS_ORIGIN: string;
  /** HMAC secret for signed splat-file URLs AND session JWT signing. */
  SIGNING_SECRET: string;
  /** App display name used in OTP emails. */
  APP_NAME: string;
  /** From address for OTP emails, e.g. "Reno <login@adappter.xyz>". */
  OTP_FROM_EMAIL: string;
  /** When "true", the OTP is logged and returned in the request response (dev only). */
  OTP_DEV_MODE: string;
  /** Resend API key (secret). If unset, email sending is skipped (dev fallback). */
  RESEND_API_KEY?: string;
}

/** Authenticated user context attached to requests by the auth middleware. */
export interface AuthUser {
  sub: string; // app user id
  email: string;
  roles: string[];
}

export type Variables = {
  user: AuthUser;
};
