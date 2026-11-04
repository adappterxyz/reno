import { WebXRCapture, type NerfDataset } from "@reno/splat-trainer";

/**
 * Run a full WebXR AR capture with a transparent overlay (live camera passthrough
 * + a Finish button) and resolve with the captured posed dataset. Shared by the
 * desktop-QR mobile page and the on-device "Create model" flow.
 */
export function captureWithAR(): Promise<NerfDataset> {
  return new Promise<NerfDataset>((resolve, reject) => {
    const cap = new WebXRCapture();
    let poll: number | null = null;

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:12px;padding:24px;background:transparent;pointer-events:none;z-index:99999;font-family:Inter,system-ui,sans-serif";
    const info = document.createElement("div");
    info.style.cssText =
      "color:#fff;background:rgba(0,0,0,0.55);padding:8px 16px;border-radius:20px;font-size:14px;text-align:center";
    info.textContent = "Walk slowly around the room…";
    const btn = document.createElement("button");
    btn.textContent = "Finish AR capture";
    btn.style.cssText =
      "pointer-events:auto;padding:14px 28px;font-size:16px;border:none;border-radius:28px;background:#17b890;color:#fff;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.3)";
    overlay.append(info, btn);

    const cleanup = () => {
      if (poll) window.clearInterval(poll);
      overlay.remove();
    };

    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const ds = await cap.stop();
        cleanup();
        resolve(ds);
      } catch (e) {
        cleanup();
        reject(e as Error);
      }
    };

    document.body.appendChild(overlay);
    cap
      .start(overlay)
      .then(() => {
        poll = window.setInterval(() => {
          info.textContent = `Captured ${cap.frameCount()} frames — keep moving around the room`;
        }, 400);
      })
      .catch((e) => {
        cleanup();
        reject(e as Error);
      });
  });
}
