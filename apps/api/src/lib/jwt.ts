import { SignJWT, jwtVerify } from "jose";

/**
 * Self-hosted session tokens (HS256), replacing Auth0. Signed with SIGNING_SECRET.
 * Short-ish lifetime; the client re-logs-in via email OTP when it expires.
 */
const ISSUER = "reno";
const AUDIENCE = "reno-app";
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionClaims {
  sub: string; // user id
  email: string;
  roles: string[];
}

function keyFrom(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(secret: string, claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, roles: claims.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(keyFrom(secret));
}

export async function verifySession(secret: string, token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, keyFrom(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return {
    sub: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : "",
    roles: Array.isArray(payload.roles) ? payload.roles.map(String) : [],
  };
}
