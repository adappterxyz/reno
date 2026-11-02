/**
 * Lazily loads OpenCV.js (WASM) on demand. ~8-10MB, so we only fetch it when the
 * SfM path actually runs (video/photo upload), never for WebXR capture or viewing.
 */
let loadPromise: Promise<unknown> | null = null;

const DEFAULT_URL = "https://docs.opencv.org/4.10.0/opencv.js";

type CvGlobal = typeof globalThis & { cv?: unknown };

export function loadOpenCV(url: string = DEFAULT_URL): Promise<unknown> {
  const g = globalThis as CvGlobal;
  // Already initialized.
  if (g.cv && (g.cv as { Mat?: unknown }).Mat) return Promise.resolve(g.cv);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      const start = Date.now();
      const check = () => {
        const cv = (globalThis as CvGlobal).cv as
          | { Mat?: unknown; then?: unknown }
          | undefined;
        // Newer builds expose `cv` as a promise/thenable that resolves to the module.
        if (cv && typeof (cv as { then?: unknown }).then === "function") {
          (cv as Promise<unknown>).then((mod) => {
            (globalThis as CvGlobal).cv = mod;
            resolve(mod);
          });
          return;
        }
        if (cv && (cv as { Mat?: unknown }).Mat) {
          resolve(cv);
          return;
        }
        if (Date.now() - start > 60_000) {
          reject(new Error("OpenCV.js failed to initialize (timeout)"));
          return;
        }
        setTimeout(check, 50);
      };
      check();
    };
    script.onerror = () => reject(new Error(`Failed to load OpenCV.js from ${url}`));
    document.head.appendChild(script);
  });
  return loadPromise;
}
