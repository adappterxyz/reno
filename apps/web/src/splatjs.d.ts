/** Minimal types for the untyped `splat.js` package (the bits we use). */
declare module "splat.js" {
  export interface StageEvent {
    stage: string;
    done: number;
    total: number;
    detail?: { splats?: number };
  }
  export interface MetricsEvent {
    psnrTrain?: number;
    splats?: number;
    iter?: number;
  }
  export interface TrainEvent {
    kind: "refine" | "train-complete" | string;
  }
  export interface Session {
    on(type: "stage", fn: (e: StageEvent) => void): void;
    on(type: "metrics", fn: (e: MetricsEvent) => void): void;
    on(type: "event", fn: (e: TrainEvent) => void): void;
    on(type: "log", fn: (e: unknown) => void): void;
    load(files: Array<File | Blob>): Promise<void>;
    solve(opts?: unknown): Promise<void>;
    useKnownCameras(cameras: unknown, opts?: unknown): void;
    seed(opts?: unknown): Promise<void>;
    start(): void;
    pause(): void;
    dispose(): void;
    exportPlyBlob(): Promise<Blob>;
    view: { attach(canvas: HTMLCanvasElement): void };
  }
  export function createSession(opts?: { maxIters?: number; frames?: unknown }): Session;
  export function parseCameras(json: unknown): unknown;
}
