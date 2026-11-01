import type { Context } from "hono";
import type { ApiResponse } from "@reno/shared";

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json<ApiResponse<T>>({ ok: true, data }, status as 200);
}

export function err(c: Context, message: string, status = 400, code?: string) {
  return c.json<ApiResponse<never>>({ ok: false, error: message, code }, status as 400);
}

/** Short url-safe id. Avoids pulling in shortid; uses crypto (available in Workers). */
export function newId(prefix = ""): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return prefix ? `${prefix}_${s}` : s;
}

export function nowIso(): string {
  return new Date().toISOString();
}
