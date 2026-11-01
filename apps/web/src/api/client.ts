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

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

export const api = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(config.apiBase + path, { headers: await authHeaders() });
    return unwrap<T>(res);
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(config.apiBase + path, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return unwrap<T>(res);
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(config.apiBase + path, {
      method: "PATCH",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return unwrap<T>(res);
  },
  async del<T>(path: string): Promise<T> {
    const res = await fetch(config.apiBase + path, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    return unwrap<T>(res);
  },
  /** Raw PUT of binary (used by the multipart upload part endpoint). */
  async putBinary<T>(path: string, data: ArrayBuffer | Blob): Promise<T> {
    const res = await fetch(config.apiBase + path, {
      method: "PUT",
      headers: await authHeaders({ "Content-Type": "application/octet-stream" }),
      body: data,
    });
    return unwrap<T>(res);
  },
  /** Absolute URL for a splat file (with the auth token appended is not possible for
   *  streamed <gsplat> loads; the viewer fetches via the Range-enabled endpoint and
   *  the token is sent by PlayCanvas' XHR only if same-origin — in dev we proxy). */
  fileUrl(path: string): string {
    return config.apiBase + path;
  },
};
