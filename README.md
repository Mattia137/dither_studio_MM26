# Dither Lab

Browser-based B/W dithering + halftone image editor. WebGL live preview, CPU export pipeline (PNG / 1-bit BMP / SVG). No backend — runs entirely in the browser.

Full design/build plan: [`DITHER_LAB_BUILD_PLAN.md`](DITHER_LAB_BUILD_PLAN.md).

**Current status:** ordered dither (full matrix library, GPU+CPU parity harness) and complete PNG/BMP/SVG export are working. Halftone, line screen, Zones/Layers composition, error diffusion, and duotone are still being built — see the build plan for the phase order.

## Run locally

Requires Node.js ≥ 18.

- Double-click `run.bat` (Windows), or
- `npm install && npm run dev`, then open `http://localhost:5173/`

Drop images into the `input/` folder to see them in the IMPORT thumbnail grid, or drag-and-drop / use the file picker directly in the app.

## Live demo (GitHub Pages)

This repo deploys automatically to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`.

**One-time setup** (do this once per GitHub repo):
1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab) — the site publishes at `https://<username>.github.io/<repo-name>/`.

The static build has no server, so the dev-only `/input` folder listing is baked into a static file at build time (see `vite.config.js`) — whatever images are committed under `input/` at build time show up in the live site's thumbnail grid. Drag-and-drop and the file picker work identically to local dev either way.

## Project layout

See the build plan's [tech stack section](DITHER_LAB_BUILD_PLAN.md#1-tech-stack) for the full folder structure and architecture (GPU/CPU parity model, Zones vs Layers compositing, effect param schema, etc.).
