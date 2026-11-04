import type { NerfDataset, NerfFrame } from "../types.js";

// WebXR Raw Camera Access (experimental; not yet in @types/webxr).
// https://immersive-web.github.io/raw-camera-access/
interface XRCamera {
  readonly width: number;
  readonly height: number;
}
declare global {
  interface XRView {
    readonly camera?: XRCamera;
  }
  interface XRWebGLBinding {
    getCameraImage(camera: XRCamera): WebGLTexture | null;
  }
}

/**
 * WebXR AR capture — records camera frames WITH poses so no COLMAP/SfM is needed.
 * This is the preferred, fully-client-side capture path.
 *
 * Requires the WebXR "camera-access" feature (raw camera access), currently best
 * supported on Android Chrome. On unsupported devices (notably iOS Safari), call
 * `isSupported()` first and fall back to the upload+SfM path.
 *
 * Usage:
 *   const cap = new WebXRCapture();
 *   if (!(await cap.isSupported())) { ...fall back... }
 *   await cap.start(overlayEl);     // begins immersive-ar
 *   // user walks around the room; frames are grabbed on an interval
 *   const dataset = await cap.stop();
 */
export class WebXRCapture {
  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private binding: XRWebGLBinding | null = null;
  private frames: NerfFrame[] = [];
  private intrinsics: { fl_x: number; fl_y: number; cx: number; cy: number; w: number; h: number } | null =
    null;
  private lastGrab = 0;
  private grabIntervalMs = 400; // ~2.5 fps keyframes — enough parallax, manageable count
  private rafActive = false;
  private maxDim = 960; // downscale images to this longest edge (upload size)
  private maxFrames = 80; // cap keyframes so the payload stays small

  async isSupported(): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return false;
    try {
      return await xr.isSessionSupported("immersive-ar");
    } catch {
      return false;
    }
  }

  async start(domOverlayRoot?: HTMLElement) {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error("WebXR not available");

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { xrCompatible: true } as WebGLContextAttributes);
    if (!gl) throw new Error("WebGL2 required for WebXR capture");
    this.gl = gl as WebGL2RenderingContext;

    const init: XRSessionInit = {
      requiredFeatures: ["camera-access"],
      optionalFeatures: domOverlayRoot ? ["dom-overlay"] : [],
      ...(domOverlayRoot ? { domOverlay: { root: domOverlayRoot } } : {}),
    } as XRSessionInit;

    this.session = await xr.requestSession("immersive-ar", init);
    this.binding = new XRWebGLBinding(this.session, gl);
    await this.session.updateRenderState({ baseLayer: new XRWebGLLayer(this.session, gl) });
    this.refSpace = await this.session.requestReferenceSpace("local");
    this.frames = [];
    this.rafActive = true;
    this.session.requestAnimationFrame(this.onXRFrame);
  }

  private onXRFrame = (time: number, frame: XRFrame) => {
    if (!this.rafActive || !this.session || !this.refSpace) return;
    this.session.requestAnimationFrame(this.onXRFrame);

    // Clear the XR base layer transparent so the device shows the camera
    // passthrough (the live preview of what the user is pointing at).
    const glLayer = this.session.renderState.baseLayer;
    if (glLayer && this.gl) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, glLayer.framebuffer);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    }

    const pose = frame.getViewerPose(this.refSpace);
    if (!pose) return;

    if (time - this.lastGrab < this.grabIntervalMs) return;
    if (this.frames.length >= this.maxFrames) return; // enough keyframes captured

    for (const view of pose.views) {
      // Raw camera access: view.camera present only with "camera-access".
      const cam = (view as XRView & { camera?: XRCamera }).camera;
      if (!cam || !this.binding) continue;
      const image = this.grabCameraImage(view, cam);
      if (!image) continue;

      if (!this.intrinsics) this.intrinsics = this.deriveIntrinsics(view, cam);
      const m = view.transform.matrix; // 4x4 column-major (camera->world)
      this.frames.push({
        file_path: `frame_${this.frames.length.toString().padStart(4, "0")}.png`,
        transform_matrix: colMajorToRowMajor4(m),
        image,
      });
      this.lastGrab = time;
      break; // one view per keyframe
    }
  };

  private grabCameraImage(view: XRView, camera: XRCamera): Blob | null {
    if (!this.gl || !this.binding) return null;
    const tex = this.binding.getCameraImage(camera);
    if (!tex) return null;
    const w = camera.width;
    const h = camera.height;
    const gl = this.gl;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);

    const full = document.createElement("canvas");
    full.width = w;
    full.height = h;
    const fctx = full.getContext("2d")!;
    const img = fctx.createImageData(w, h);
    // Flip vertically (GL origin bottom-left -> image top-left).
    for (let row = 0; row < h; row++) {
      const src = (h - 1 - row) * w * 4;
      const dst = row * w * 4;
      img.data.set(pixels.subarray(src, src + w * 4), dst);
    }
    fctx.putImageData(img, 0, 0);

    // Downscale + JPEG to keep the uploaded payload small (phones upload this).
    const s = this.scale(w, h);
    const dw = Math.round(w * s);
    const dh = Math.round(h * s);
    const out = document.createElement("canvas");
    out.width = dw;
    out.height = dh;
    out.getContext("2d")!.drawImage(full, 0, 0, dw, dh);
    return dataURLtoBlob(out.toDataURL("image/jpeg", 0.6));
  }

  private scale(w: number, h: number): number {
    return Math.min(1, this.maxDim / Math.max(w, h));
  }

  private deriveIntrinsics(view: XRView, cam: XRCamera) {
    // Intrinsics must match the DOWNSCALED stored image, so scale them too.
    const p = view.projectionMatrix;
    const w = cam.width;
    const h = cam.height;
    const s = this.scale(w, h);
    return {
      fl_x: ((p[0]! * w) / 2) * s,
      fl_y: ((p[5]! * h) / 2) * s,
      cx: (w / 2) * s,
      cy: (h / 2) * s,
      w: Math.round(w * s),
      h: Math.round(h * s),
    };
  }

  frameCount() {
    return this.frames.length;
  }

  async stop(): Promise<NerfDataset> {
    this.rafActive = false;
    await this.session?.end().catch(() => {});
    this.session = null;
    const intr = this.intrinsics ?? { fl_x: 500, fl_y: 500, cx: 320, cy: 240, w: 640, h: 480 };
    return { ...intr, frames: this.frames, poseSource: "webxr" };
  }
}

function colMajorToRowMajor4(m: Float32Array | number[]): number[][] {
  return [
    [m[0]!, m[4]!, m[8]!, m[12]!],
    [m[1]!, m[5]!, m[9]!, m[13]!],
    [m[2]!, m[6]!, m[10]!, m[14]!],
    [m[3]!, m[7]!, m[11]!, m[15]!],
  ];
}

function dataURLtoBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head!)?.[1] ?? "image/png";
  const bin = atob(b64!);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
