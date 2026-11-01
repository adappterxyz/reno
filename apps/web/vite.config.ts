import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // COOP/COEP headers enable SharedArrayBuffer / WASM threads that the Brush
    // WebGPU trainer may require. Harmless for the rest of the app.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  worker: { format: "es" },
  optimizeDeps: {
    exclude: ["@reno/splat-viewer", "@reno/splat-trainer", "@reno/shared"],
  },
});
