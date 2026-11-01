import * as pc from "playcanvas";

/**
 * Minimal orbit/pan/zoom camera controller (mouse + touch). Kept dependency-free
 * so the viewer doesn't rely on engine example scripts. Orbits around a focus
 * point; left-drag = orbit, right/two-finger-drag = pan, wheel/pinch = zoom.
 */
export class OrbitCamera {
  private entity: pc.Entity;
  private canvas: HTMLCanvasElement;
  focus = new pc.Vec3();
  private distance = 4;
  private yaw = 0;
  private pitch = -20;
  private minDistance = 0.3;
  private maxDistance = 100;

  private lastX = 0;
  private lastY = 0;
  private orbiting = false;
  private panning = false;
  private activeTouches = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;

  constructor(entity: pc.Entity, canvas: HTMLCanvasElement) {
    this.entity = entity;
    this.canvas = canvas;
    this.bind();
    this.apply();
  }

  frame(center: pc.Vec3, radius: number) {
    this.focus.copy(center);
    this.distance = pc.math.clamp(radius * 2.2, this.minDistance, this.maxDistance);
    this.yaw = 0;
    this.pitch = -20;
    this.apply();
  }

  /** Fly the camera to look at a target point from a sensible offset. */
  flyTo(target: pc.Vec3, distance = 1.5, durationMs = 600) {
    const startFocus = this.focus.clone();
    const startDist = this.distance;
    const startYaw = this.yaw;
    const startPitch = this.pitch;
    const endDist = pc.math.clamp(distance, this.minDistance, this.maxDistance);
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / durationMs);
      const e = t * t * (3 - 2 * t); // smoothstep
      this.focus.lerp(startFocus, target, e);
      this.distance = pc.math.lerp(startDist, endDist, e);
      this.yaw = pc.math.lerp(startYaw, startYaw, e);
      this.pitch = pc.math.lerp(startPitch, Math.max(startPitch, -35), e);
      this.apply();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private apply() {
    const rad = pc.math.DEG_TO_RAD;
    const x = Math.sin(this.yaw * rad) * Math.cos(this.pitch * rad);
    const y = Math.sin(this.pitch * rad);
    const z = Math.cos(this.yaw * rad) * Math.cos(this.pitch * rad);
    const dir = new pc.Vec3(x, y, z).mulScalar(this.distance);
    this.entity.setPosition(this.focus.x + dir.x, this.focus.y + dir.y, this.focus.z + dir.z);
    this.entity.lookAt(this.focus);
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent) => {
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (e.pointerType === "touch") {
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.orbiting = this.activeTouches.size === 1;
      this.panning = this.activeTouches.size === 2;
    } else {
      this.orbiting = e.button === 0;
      this.panning = e.button === 2;
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch" && this.activeTouches.has(e.pointerId)) {
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size === 2) {
        const pts = [...this.activeTouches.values()];
        const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (this.lastPinch) this.zoom((this.lastPinch - d) * 0.01);
        this.lastPinch = d;
        return;
      }
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.orbiting) {
      this.yaw -= dx * 0.3;
      this.pitch = pc.math.clamp(this.pitch - dy * 0.3, -89, 89);
      this.apply();
    } else if (this.panning) {
      this.pan(dx, dy);
    }
  };

  private onUp = (e: PointerEvent) => {
    this.activeTouches.delete(e.pointerId);
    this.orbiting = false;
    this.panning = false;
    this.lastPinch = 0;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom(Math.sign(e.deltaY) * 0.1);
  };

  private zoom(amount: number) {
    this.distance = pc.math.clamp(this.distance * (1 + amount), this.minDistance, this.maxDistance);
    this.apply();
  }

  private pan(dx: number, dy: number) {
    const right = this.entity.right.clone().mulScalar(-dx * this.distance * 0.001);
    const up = this.entity.up.clone().mulScalar(dy * this.distance * 0.001);
    this.focus.add(right).add(up);
    this.apply();
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("wheel", this.onWheel);
  }
}
