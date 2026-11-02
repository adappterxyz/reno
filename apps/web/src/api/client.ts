import { config } from "../config.js";
import type { ApiResponse } from "@reno/shared";

/** Token getter injected from the Auth0 React context (see main.tsx). */
let tokenGetter: (() => Promise<string>) | null = null;
export function setTokenGetter(fn: () => Promise<string>) {
  tokenGetter = fn;
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  if (tokenGetter) {
    try {
      headers.Authorization = `Bearer ${await tokenGetter()}`;
    } catch {
      /* unauthenticated — request will 401 */
    }
  }
  return headers;
}

/** Surface an API failure to the console and the global error snackbar. */
function reportError(message: string) {
  console.error("[api]", message);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("reno:api-error", { detail: message }));
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.ok === false) {
    const msg =
      (json && json.ok === false && json.error) || `Request failed (HTTP ${res.status})`;
    reportError(msg);
    throw new Error(msg);
  }
  return json.data;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(config.apiBase + path, init);
  } catch (e) {
    const msg = `Network error: ${(e as Error).message} (${path})`;
    reportError(msg);
    throw new Error(msg);
  }
  return unwrap<T>(res);
}

export const api = {
  async get<T>(path: string): Promise<T> {
    return request<T>(path, { headers: await authHeaders() });
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
  },
  async del<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE", headers: await authHeaders() });
  },
  /** Raw PUT of binary (used by the multipart upload part endpoint). */
  async putBinary<T>(path: string, data: ArrayBuffer | Blob): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      headers: await authHeaders({ "Content-Type": "application/octet-stream" }),
      body: data,
    });
  },
  /** Absolute URL for a splat file (with the auth token appended is not possible for
   *  streamed <gsplat> loads; the viewer fetches via the Range-enabled endpoint and
   *  the token is sent by PlayCanvas' XHR only if same-origin — in dev we proxy). */
  fileUrl(path: string): string {
    return config.apiBase + path;
  },
};
