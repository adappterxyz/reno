/**
 * CaptureSession Durable Object — one per phone→desktop capture handoff.
 *
 * Holds the session's live status and broadcasts changes to connected clients
 * (the desktop waits on a WebSocket; the phone POSTs updates as it captures and
 * uploads). No heavy work — just coordination.
 */
type CaptureStatus = "waiting" | "connected" | "uploading" | "ready" | "failed";

interface SessionState {
  status: CaptureStatus;
  kind: "video" | "photos" | null;
  mediaKeys: string[];
  progress: number; // 0..1 upload progress reported by the phone
  message: string;
  updatedAt: string;
}

export class CaptureSession {
  private state: DurableObjectState;
  private sockets = new Set<WebSocket>();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async get(): Promise<SessionState> {
    return (
      (await this.state.storage.get<SessionState>("s")) ?? {
        status: "waiting",
        kind: null,
        mediaKeys: [],
        progress: 0,
        message: "",
        updatedAt: new Date().toISOString(),
      }
    );
  }

  private async put(next: SessionState) {
    await this.state.storage.put("s", next);
    const payload = JSON.stringify(next);
    for (const ws of this.sockets) {
      try {
        ws.send(payload);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      this.sockets.add(server);
      server.addEventListener("close", () => this.sockets.delete(server));
      server.addEventListener("error", () => this.sockets.delete(server));
      this.get().then((s) => server.send(JSON.stringify(s)));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/state")) {
      return Response.json(await this.get());
    }

    if (url.pathname.endsWith("/update") && req.method === "POST") {
      const body = (await req.json()) as Partial<SessionState>;
      const cur = await this.get();
      const next: SessionState = {
        status: body.status ?? cur.status,
        kind: body.kind ?? cur.kind,
        mediaKeys: body.mediaKeys ?? cur.mediaKeys,
        progress: body.progress ?? cur.progress,
        message: body.message ?? cur.message,
        updatedAt: new Date().toISOString(),
      };
      await this.put(next);
      return Response.json(next);
    }

    return new Response("Not found", { status: 404 });
  }
}
