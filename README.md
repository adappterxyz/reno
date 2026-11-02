# Reno v2

Cloudflare-native renovation-management app with **client-side 3D Gaussian-splat** property models — the open replacement for Matterport in the original sol59 "Reno" app.

- **3D is fully client-side.** Splats are *trained* in the browser (WebGPU, via Brush) and *rendered* in the browser (PlayCanvas, WebGL2 fallback). Cloudflare is pure storage + orchestration + serving — no server GPU.
- **Tickets & measurements** are anchored to 3D points on the splat, replacing Matterport Mattertags and the Measurements tool.
- **Single Worker, one origin.** The built SPA (`apps/web/dist`) is served as static assets by the *same* Worker that handles `/api/*` — no separate frontend host, no CORS. SPA routes fall back to `index.html`; `/api/*` runs the Worker first.
- **Self-hosted email-OTP auth** (no third-party IdP). No external dependencies at all.

**Live:** https://reno-api.uranusim.workers.dev

See the full design in `../.claude/plans/quiet-forging-map.md`.

## Monorepo layout

| Path | What |
|---|---|
| `apps/api` | Cloudflare Workers + Hono + D1 + R2 + Durable Object. Auth0-verified. |
| `apps/web` | Vite + React 18 + MUI SPA. |
| `packages/shared` | Shared zod types + API route constants. |
| `packages/splat-viewer` | PlayCanvas `SplatViewer` — render, pick (`getWorldPointAsync`), markers, measurements. |
| `packages/splat-trainer` | WebXR capture, video/photo frame extraction, Brush (WebGPU) training wrapper. |

## Prerequisites

- **Node.js 22+** (Wrangler 4 requires it; this is the one hard version gate).
- A Cloudflare account + `wrangler login`.
- An Auth0 tenant (SPA app + API).

## First-time setup

```bash
pnpm install

# Create Cloudflare resources and paste the returned ids into apps/api/wrangler.toml
cd apps/api
wrangler d1 create reno                       # -> database_id
wrangler kv namespace create CACHE            # -> kv id
wrangler r2 bucket create reno-splats
wrangler d1 migrations apply reno --remote    # apply schema (or --local for dev)
wrangler secret put SIGNING_SECRET            # sessions + signed file URLs

# (optional) real email delivery — otherwise dev mode returns the OTP in the response
wrangler secret put RESEND_API_KEY            # and set OTP_DEV_MODE=false in wrangler.toml

# Frontend env (for running the web dev server separately)
cd ../web
cp .env.example .env.local                    # VITE_API_BASE=http://localhost:8787
```

### Auth = self-hosted email OTP

No third-party IdP. Sign-in: enter email → 6-digit code → session JWT. In dev
(`OTP_DEV_MODE=true`) the code is returned in the request response and logged, so
sign-in works with zero email setup. For real emails, set `RESEND_API_KEY`, verify
the `OTP_FROM_EMAIL` sender domain in Resend, and set `OTP_DEV_MODE=false`.

### Brush training worker (in-browser splat training)

In-browser training uses [Brush](https://github.com/arthurbrussee/brush) compiled to a WebGPU WASM worker.
Build Brush's worker entry, host the output in `apps/web/public/brush/`, and set
`VITE_BRUSH_WORKER_URL=/brush/worker.js`. The worker must speak the protocol in
`packages/splat-trainer/src/trainer/brush.ts`. Until then, the "Upload a pre-trained
.ply" path in the Create-3D-model wizard exercises the full capture→store→view→annotate
flow end to end.

## Develop

```bash
# API (Workers) — needs Node 22+
cd apps/api && pnpm dev          # http://localhost:8787  (serves /api)

# Web (separate dev server with HMR; calls the API at VITE_API_BASE)
cd apps/web && pnpm dev          # http://localhost:5173
```

## Deploy (single Worker: SPA + API, one origin)

```bash
pnpm deploy        # builds apps/web then `wrangler deploy` the Worker with the dist assets
```

The Worker serves the SPA as static assets and runs the Worker first only for
`/api/*` (see `apps/api/wrangler.toml` `[assets]`). Production builds use
`apps/web/.env.production` (`VITE_API_BASE=` → same-origin).

## Validate

```bash
pnpm -r typecheck                # all packages
pnpm build:web                   # production web bundle
```

## Phase-1 go/no-go gate

Capture a room → train a splat in-browser → upload to R2 → reload in the viewer →
click to place a ticket (persists in D1, re-anchors on reload) → calibrate scale →
measure a known distance within tolerance. Verify the viewer still renders on a
non-WebGPU browser (WebGL2 fallback).
