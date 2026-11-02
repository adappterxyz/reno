import { routes } from "@reno/shared";
import { config } from "../config.js";
import { api } from "./client.js";

export interface CaptureSession {
  sessionId: string;
  token: string;
  exp: number;
  captureUrl: string;
}

export type CaptureKind = "video" | "photos" | "webxr";

export interface CaptureState {
  status: "waiting" | "connected" | "uploading" | "ready" | "failed";
  kind: CaptureKind | null;
  mediaKeys: string[];
  progress: number;
  message: string;
}

/** Desktop: create a capture session for a splat model (authed). */
export function createCaptureSession(modelId: string): Promise<CaptureSession> {
  return api.post<CaptureSession>(routes.captureSession(modelId));
}

function base(): string {
  return config.apiBase || window.location.origin;
}
function tokenQS(s: { token: string; exp: number }): string {
  return `t=${encodeURIComponent(s.token)}&e=${s.exp}`;
}

/** Open a WebSocket to receive live session state. Returns a close fn. */
export function openCaptureSocket(
  s: { sessionId: string; token: string; exp: number },
  onState: (st: CaptureState) => void,
): () => void {
  const wsBase = base().replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}${routes.captureWs(s.sessionId)}?${tokenQS(s)}`);
  ws.onmessage = (e) => {
    try {
      onState(JSON.parse(e.data) as CaptureState);
    } catch {
      /* ignore */
    }
  };
  return () => ws.close();
}

/** Phone: multipart-upload a captured media blob to R2 via the Worker. Returns the key. */
export async function uploadCaptureMedia(
  s: { sessionId: string; token: string; exp: number },
  blob: Blob,
  ext: string,
  onProgress?: (f: number) => void,
): Promise<string> {
  const qs = tokenQS(s);
  const create = await fetchJson<{ uploadId: string; key: string; partSize: number }>(
    `${routes.captureUploadCreate(s.sessionId)}?${qs}`,
    { method: "POST", body: JSON.stringify({ ext, contentType: blob.type || "application/octet-stream" }) },
  );
  const parts: { partNumber: number; etag: string }[] = [];
  let uploaded = 0;
  let n = 1;
  for (let off = 0; off < blob.size; off += create.partSize) {
    const chunk = blob.slice(off, Math.min(off + create.partSize, blob.size));
    const part = await fetchJson<{ partNumber: number; etag: string }>(
      `${routes.captureUploadPart(s.sessionId)}?${qs}&uploadId=${encodeURIComponent(create.uploadId)}&key=${encodeURIComponent(create.key)}&partNumber=${n}`,
      { method: "PUT", body: await chunk.arrayBuffer() },
    );
    parts.push(part);
    uploaded += chunk.size;
    onProgress?.(uploaded / blob.size);
    n++;
  }
  await fetchJson(`${routes.captureUploadComplete(s.sessionId)}?${qs}`, {
    method: "POST",
    body: JSON.stringify({ uploadId: create.uploadId, key: create.key, parts }),
  });
  return create.key;
}

/** Phone: signal capture complete with the uploaded media keys. */
export function completeCapture(
  s: { sessionId: string; token: string; exp: number },
  keys: string[],
  kind: CaptureKind,
): Promise<unknown> {
  return fetchJson(`${routes.captureComplete(s.sessionId)}?${tokenQS(s)}`, {
    method: "POST",
    body: JSON.stringify({ keys, kind }),
  });
}

/** Phone: report progress to the desktop. */
export function reportCaptureProgress(
  s: { sessionId: string; token: string; exp: number },
  patch: Partial<CaptureState>,
): Promise<unknown> {
  return fetchJson(`${routes.captureProgress(s.sessionId)}?${tokenQS(s)}`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

/** Desktop: download a captured media object as a Blob. */
export async function downloadCaptureMedia(
  s: { sessionId: string; token: string; exp: number },
  key: string,
): Promise<Blob> {
  const res = await fetch(
    `${base()}${routes.captureFile(s.sessionId)}?${tokenQS(s)}&key=${encodeURIComponent(key)}`,
  );
  if (!res.ok) throw new Error(`Media download failed (HTTP ${res.status})`);
  return res.blob();
}

async function fetchJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(base() + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    throw new Error((json && json.error) || `Request failed (HTTP ${res.status})`);
  }
  return json.data as T;
}
