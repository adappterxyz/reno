# Reno v2

Cloudflare-native renovation-management app with **client-side 3D Gaussian-splat** property models — the open replacement for Matterport in the original sol59 "Reno" app.

- **3D is fully client-side.** Splats are *trained* in the browser (WebGPU, via Brush) and *rendered* in the browser (PlayCanvas, WebGL2 fallback). Cloudflare is pure storage + orchestration + serving — no server GPU.
- **Tickets & measurements** are anchored to 3D points on the splat, replacing Matterport Mattertags and the Measurements tool.

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
wrangler d1 migrations apply reno --local     # apply schema locally
wrangler secret put SIGNING_SECRET            # prod only; dev uses the toml fallback

# Frontend env
cd ../web
cp .env.example .env.local                    # fill Auth0 + API base
```

### Auth0

- Create a **SPA** application → set its Client ID in `web/.env.local` (`VITE_AUTH0_CLIENT_ID`).
- Create an **API** with identifier `https://api.renosphere.co` → set `VITE_AUTH0_AUDIENCE` and `AUTH0_AUDIENCE` (wrangler.toml).
- Add an Auth0 **Action** to put roles in the `https://renosphere.co/roles` claim (see `apps/api/src/auth.ts`).
- Allowed Callback/Logout/Web Origins: `http://localhost:5173`.

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
cd apps/api && pnpm dev          # http://localhost:8787

# Web
cd apps/web && pnpm dev          # http://localhost:5173
```

## Validate

```bash
pnpm -r typecheck                # all packages
cd apps/web && pnpm build        # production web bundle
```

## Phase-1 go/no-go gate

Capture a room → train a splat in-browser → upload to R2 → reload in the viewer →
click to place a ticket (persists in D1, re-anchors on reload) → calibrate scale →
measure a known distance within tolerance. Verify the viewer still renders on a
non-WebGPU browser (WebGL2 fallback).
