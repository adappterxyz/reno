import * as pc from "playcanvas";
import type { Vec3, Ticket, Measurement } from "@reno/shared";
import { polylineLength } from "@reno/shared";
import { OrbitCamera } from "./OrbitCamera.js";

export type ViewerMode = "view" | "place-ticket" | "measure" | "calibrate";

export interface MarkerScreenPos {
  id: string;
  x: number; // css px
  y: number; // css px
  behindCamera: boolean;
}

export interface SplatViewerEvents {
  /** Fired when the user clicks a 3D point while in place-ticket / measure / calibrate mode. */
  onPick?: (point: Vec3, normal: Vec3 | null) => void;
  /** Fired every frame with projected screen positions of all ticket markers (for HTML overlay). */
  onMarkers?: (positions: MarkerScreenPos[]) => void;
  /** Fired when a ticket marker is clicked in view mode. */
  onTicketClick?: (ticketId: string) => void;
  /** Progress 0..1 while loading the splat file. */
  onLoadProgress?: (p: number) => void;
  onReady?: () => void;
  onError?: (e: Error) => void;
}

/**
 * Framework-agnostic Gaussian-splat viewer built on the PlayCanvas engine.
 *
 * Replaces the Matterport showcase iframe + MP_SDK. Equivalences:
 *   MP_SDK Pointer.intersection + Renderer.getWorldPositionData -> Picker.getWorldPointAsync
 *   Mattertag.add/remove                                        -> addTicketMarker / clear
 *   Mattertag.navigateToTag                                     -> flyToTicket
 *   Measurements tool                                           -> measure mode + polyline
 *
 * Rendering is fully client-side: prefers WebGPU, falls back to WebGL2 so the
 * viewer still works on browsers without WebGPU (training needs WebGPU; viewing does not).
 */
export class SplatViewer {
  private app!: pc.AppBase;
  private camera!: pc.Entity;
  private orbit!: OrbitCamera;
  private picker!: pc.Picker;
  private splatEntity: pc.Entity | null = null;
  private canvas: HTMLCanvasElement;
  private events: SplatViewerEvents;
  private mode: ViewerMode = "view";

  /** ticketId -> world anchor; markers are drawn as billboards + projected for HTML overlay. */
  private markers = new Map<string, pc.Vec3>();
  private measurePoints: pc.Vec3[] = [];

  private constructor(canvas: HTMLCanvasElement, events: SplatViewerEvents) {
    this.canvas = canvas;
    this.events = events;
  }

  static async create(canvas: HTMLCanvasElement, events: SplatViewerEvents = {}) {
    const viewer = new SplatViewer(canvas, events);
    await viewer.init();
    return viewer;
  }

  private async init() {
    const device = await pc.createGraphicsDevice(this.canvas, {
      deviceTypes: ["webgpu", "webgl2"],
      antialias: true,
    });

    const app = new pc.AppBase(this.canvas);
    const opts = new pc.AppOptions();
    opts.graphicsDevice = device;
    opts.mouse = new pc.Mouse(this.canvas);
    opts.touch = new pc.TouchDevice(this.canvas);
    opts.componentSystems = [
      pc.RenderComponentSystem,
      pc.CameraComponentSystem,
      pc.LightComponentSystem,
      pc.GSplatComponentSystem,
      pc.ScriptComponentSystem,
    ];
    opts.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler, pc.GSplatHandler];
    app.init(opts);
    this.app = app;

    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.scene.gsplat.enableIds = true; // required for splat picking

    // Camera
    this.camera = new pc.Entity("camera");
    this.camera.addComponent("camera", {
      clearColor: new pc.Color(0.1, 0.11, 0.13),
      toneMapping: pc.TONEMAP_ACES,
      farClip: 1000,
    });
    app.root.addChild(this.camera);
    this.orbit = new OrbitCamera(this.camera, this.canvas);

    // Soft light so markers (standard material) are visible.
    const light = new pc.Entity("light");
    light.addComponent("light", { type: "directional", intensity: 1 });
    light.setEulerAngles(45, 30, 0);
    app.root.addChild(light);

    this.picker = new pc.Picker(app, this.canvas.clientWidth || 1, this.canvas.clientHeight || 1, true);

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    app.on("update", this.onUpdate);
    window.addEventListener("resize", this.onResize);

    app.start();
  }

  setMode(mode: ViewerMode) {
    this.mode = mode;
  }

  getMode() {
    return this.mode;
  }

  /**
   * Load a splat from a URL and frame it. `filename` tells PlayCanvas which
   * parser to use (it reads the extension, not the content-type) — required
   * because our signed URLs have no extension (`.../file?t=...`).
   */
  async loadSplat(url: string, filename = "model.ply") {
    return new Promise<void>((resolve, reject) => {
      const asset = new pc.Asset("splat", "gsplat", { url, filename });
      asset.on("progress", (received: number, total: number) => {
        if (total > 0) this.events.onLoadProgress?.(received / total);
      });
      asset.once("load", () => {
        try {
          if (this.splatEntity) this.splatEntity.destroy();
          const entity = new pc.Entity("splat");
          entity.addComponent("gsplat", { asset });
          this.app.root.addChild(entity);
          this.splatEntity = entity;
          this.frameSplat(entity);
          this.events.onReady?.();
          resolve();
        } catch (e) {
          reject(e as Error);
        }
      });
      asset.once("error", (msg: string) => {
        const e = new Error(`Failed to load splat: ${msg}`);
        this.events.onError?.(e);
        reject(e);
      });
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  private frameSplat(entity: pc.Entity) {
    // Try to read the splat AABB; fall back to a default framing if unavailable.
    const aabb = (entity.gsplat as unknown as { instance?: { aabb?: pc.BoundingBox } })?.instance?.aabb;
    if (aabb) {
      this.orbit.frame(aabb.center.clone(), aabb.halfExtents.length());
    } else {
      this.orbit.frame(new pc.Vec3(0, 0, 0), 2);
    }
  }

  // --- Markers (tickets) ---

  setTickets(tickets: Ticket[]) {
    this.markers.clear();
    for (const t of tickets) this.markers.set(t.id, new pc.Vec3(t.anchor.x, t.anchor.y, t.anchor.z));
  }

  addTicketMarker(id: string, anchor: Vec3) {
    this.markers.set(id, new pc.Vec3(anchor.x, anchor.y, anchor.z));
  }

  removeTicketMarker(id: string) {
    this.markers.delete(id);
  }

  /** Camera fly-to a ticket (was Mattertag.navigateToTag). */
  flyToTicket(id: string) {
    const p = this.markers.get(id);
    if (p) this.orbit.flyTo(p.clone(), 1.5);
  }

  // --- Measurements ---

  setMeasurements(measurements: Measurement[]) {
    // Rendered on demand via drawMeasurements; store latest for persistent draw.
    this.persistentMeasurements = measurements;
  }
  private persistentMeasurements: Measurement[] = [];

  /** Points picked so far in measure mode. */
  getMeasurePoints(): Vec3[] {
    return this.measurePoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  }

  clearMeasurePoints() {
    this.measurePoints = [];
  }

  /** Raw (splat-space) length of the in-progress measurement. Multiply by scaleFactor for metres. */
  currentMeasureLength(): number {
    return polylineLength(this.getMeasurePoints());
  }

  // --- Picking + rendering loop ---

  private onPointerDown = async (e: PointerEvent) => {
    // Only left button / primary touch initiates a pick.
    if (e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.mode === "view") {
      const hit = this.hitTestMarker(x, y);
      if (hit) this.events.onTicketClick?.(hit);
      return;
    }

    // place-ticket / measure / calibrate: resolve a 3D world point on the splat.
    try {
      const worldLayer = this.app.scene.layers.getLayerByName("World");
      this.picker.prepare(this.camera.camera!, this.app.scene, worldLayer ? [worldLayer] : undefined);
      const point = await this.picker.getWorldPointAsync(Math.round(x), Math.round(y));
      if (!point) return;
      const normal = null; // normal estimation optional; billboard markers face camera
      const v: Vec3 = { x: point.x, y: point.y, z: point.z };
      if (this.mode === "measure") this.measurePoints.push(point.clone());
      this.events.onPick?.(v, normal);
    } catch (err) {
      this.events.onError?.(err as Error);
    }
  };

  /** Screen-space proximity test against projected markers (12px radius). */
  private hitTestMarker(x: number, y: number): string | null {
    let best: { id: string; d: number } | null = null;
    const screen = new pc.Vec3();
    for (const [id, world] of this.markers) {
      this.camera.camera!.worldToScreen(world, screen);
      if (screen.z < 0) continue;
      const d = Math.hypot(screen.x - x, screen.y - y);
      if (d < 14 && (!best || d < best.d)) best = { id, d };
    }
    return best?.id ?? null;
  }

  private onUpdate = () => {
    this.drawMarkers();
    this.drawMeasurements();
    this.emitMarkerPositions();
  };

  private drawMarkers() {
    // Immediate-mode billboard dots so we don't manage per-marker entities.
    const col = new pc.Color(1, 0.3, 0.2);
    for (const world of this.markers.values()) {
      this.drawDot(world, col);
    }
  }

  private drawDot(world: pc.Vec3, color: pc.Color) {
    const size = 0.03;
    const r = this.camera.right.clone().mulScalar(size);
    const u = this.camera.up.clone().mulScalar(size);
    const a = world.clone().sub(r).sub(u);
    const b = world.clone().add(r).sub(u);
    const c = world.clone().add(r).add(u);
    const d = world.clone().sub(r).add(u);
    this.app.drawLine(a, b, color);
    this.app.drawLine(b, c, color);
    this.app.drawLine(c, d, color);
    this.app.drawLine(d, a, color);
  }

  private drawMeasurements() {
    const saved = new pc.Color(0.2, 0.8, 1);
    for (const m of this.persistentMeasurements) {
      for (let i = 1; i < m.points.length; i++) {
        this.app.drawLine(
          new pc.Vec3(m.points[i - 1]!.x, m.points[i - 1]!.y, m.points[i - 1]!.z),
          new pc.Vec3(m.points[i]!.x, m.points[i]!.y, m.points[i]!.z),
          saved,
        );
      }
    }
    const live = new pc.Color(1, 0.9, 0.2);
    for (let i = 1; i < this.measurePoints.length; i++) {
      this.app.drawLine(this.measurePoints[i - 1]!, this.measurePoints[i]!, live);
    }
    for (const p of this.measurePoints) this.drawDot(p, live);
  }

  private emitMarkerPositions() {
    if (!this.events.onMarkers) return;
    const rect = this.canvas.getBoundingClientRect();
    const screen = new pc.Vec3();
    const out: MarkerScreenPos[] = [];
    for (const [id, world] of this.markers) {
      this.camera.camera!.worldToScreen(world, screen);
      out.push({
        id,
        x: (screen.x / this.canvas.clientWidth) * rect.width,
        y: (screen.y / this.canvas.clientHeight) * rect.height,
        behindCamera: screen.z < 0,
      });
    }
    this.events.onMarkers(out);
  }

  private onResize = () => {
    this.app?.resizeCanvas();
  };

  destroy() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("resize", this.onResize);
    this.orbit?.destroy();
    this.app?.destroy();
  }
}
