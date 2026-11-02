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
  /** Cloudflare Email Service send binding (configured as [[send_email]] name="EMAIL"). */
  EMAIL?: SendEmailBinding;
}

/** High-level Cloudflare Email Service send API (env.EMAIL.send). */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string;
    subject: string;
    html?: string;
    text?: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
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
