import type { SplatStatus } from "@reno/shared";

/**
 * SplatJob Durable Object — one instance per splat model id.
 *
 * Training itself runs client-side (Brush/WebGPU), so the DO does NOT do heavy
 * work. Its jobs are:
 *  - hold the authoritative lifecycle state (draft -> capturing -> training ->
 *    uploading -> ready / failed) so multiple tabs/devices agree,
 *  - broadcast live progress to any connected clients over WebSocket,
 *  - serialize access so two devices don't train/upload the same model at once.
 *
 * Uses the SQLite-backed DO storage (new_sqlite_classes in wrangler.toml).
 */
interface JobState {
  status: SplatStatus;
  progress: number; // 0..1 for the current phase
  message: string;
  updatedAt: string;
}

export class SplatJob {
  private state: DurableObjectState;
  private sockets = new Set<WebSocket>();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async get(): Promise<JobState> {
    return (
      (await this.state.storage.get<JobState>("job")) ?? {
        status: "draft",
        progress: 0,
        message: "",
        updatedAt: new Date().toISOString(),
      }
    );
  }

  private async put(next: JobState) {
    await this.state.storage.put("job", next);
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

    // WebSocket subscription for live progress.
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

    if (url.pathname.endsWith("/state") && req.method === "GET") {
      return Response.json(await this.get());
    }

    if (url.pathname.endsWith("/update") && req.method === "POST") {
      const body = (await req.json()) as Partial<JobState>;
      const current = await this.get();
      const next: JobState = {
        status: body.status ?? current.status,
        progress: body.progress ?? current.progress,
        message: body.message ?? current.message,
        updatedAt: new Date().toISOString(),
      };
      await this.put(next);
      return Response.json(next);
    }

    return new Response("Not found", { status: 404 });
  }
}
