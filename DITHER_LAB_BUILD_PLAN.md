# DITHER LAB — BUILD PLAN

Browser-based B/W dithering + halftone image editor. WebGL real-time preview, CPU export pipeline (PNG / 1-bit BMP / SVG). **Two switchable compositing modes** for combining effects on one image: **Zones** (split by luminance threshold) and **Layers** (stack effects with blend modes + per-layer mask). Dark UI modeled on the supplied reference screenshot. Runs locally via Vite on `http://localhost:5173/`, launched with a `.bat`. Still images only — no animation, no timeline, no A/B transition.

This document is the single source of truth for Claude Code. Build in the phase order at the bottom. Do not skip the parity requirements in section 5.

**Two compositing modes, one toggle.** A mode switch at the top of the sidebar flips between Zones and Layers. They are independent tools that share everything below them — the same effects (section 4), the same image pipeline, the same GPU/CPU parity model, the same export. Only the *composition* differs: Zones assigns one effect per luminance band; Layers stacks effects and blends them. Switching modes does not convert one into the other; each keeps its own state. Export uses whichever mode is active.

---

## 0. ASSUMPTIONS (edit these before building if wrong)

- **OS:** Windows, Node.js ≥ 18 installed.
- **Effects v1:** ordered dither (matrix library incl. custom cluster shapes), halftone dots, line screen (any angle, width-modulated), error diffusion (Floyd–Steinberg, Atkinson). Error diffusion is CPU-only by nature — see 4.4.
- **"Bitmap" export** = literal `.bmp` file, 1-bit monochrome.
- **Duotone** = two user-picked hex colors replacing ink (black) and paper (white). Applies on top of any effect, preview + PNG/SVG export. BMP export ignores duotone (stays 1-bit).
- **SVG export** = true vector, one shape per dot/cell/bar, batched into few `<path>` elements. Show an element-count estimate before export and warn above 300k elements. No hard cap.
- **Export resolution:** multiplier over source image — 1× / 2× / 4×.
- **Downloads:** normal browser downloads (no backend). The repo still contains an `/output` folder as the conventional place to move files, and the README tells the user they can point their browser's default download directory there if they want automatic landing.
- **Input:** `/input` folder in the repo served by Vite + drag-and-drop onto the canvas.

---

## 1. TECH STACK

- **Vite + vanilla JS (ES modules).** No framework, no TypeScript.
- **Three.js** only as a thin WebGL wrapper: one `OrthographicCamera`, one full-quad `Mesh` with `ShaderMaterial`. All effect logic lives in GLSL fragment shaders.
- **No backend.** Pure static dev server.
- **No CSS framework.** One hand-written `style.css`.

```
dither-lab/
├─ run.bat
├─ package.json
├─ vite.config.js
├─ index.html
├─ README.md
├─ input/                  ← user drops source images here
├─ output/                 ← conventional landing spot for downloads
└─ src/
   ├─ main.js              ← boot, wiring
   ├─ state.js             ← single app state object + pub/sub
   ├─ matrices.js          ← threshold matrix library
   ├─ presets.js           ← save/load full state as JSON
   ├─ gl/
   │  ├─ viewer.js         ← Three.js setup, render loop, pan/zoom
   │  └─ shader.js         ← fragment shader assembly (see 4.6)
   ├─ cpu/
   │  ├─ prepare.js        ← decode, grayscale, pre-adjust, zone map
   │  ├─ ordered.js
   │  ├─ halftone.js
   │  ├─ linescreen.js
   │  └─ errordiffusion.js
   ├─ export/
   │  ├─ png.js
   │  ├─ bmp.js            ← manual 1-bit BMP writer
   │  └─ svg.js
   └─ ui/
      ├─ panel.js          ← sidebar shell, section builder, mode switch
      ├─ controls.js       ← slider / dropdown / color / toggle factories
      ├─ effectparams.js   ← renders one effect's param block (shared by zones + layers)
      ├─ zones.js          ← Zones-mode UI (threshold strip + zone blocks)
      └─ layers.js         ← Layers-mode UI (layer stack + per-layer mask)
```

### run.bat
```bat
@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found. Install from nodejs.org & pause & exit /b)
if not exist node_modules ( echo Installing dependencies... & call npm install )
start "" http://localhost:5173/
call npm run dev
```
Configure `vite.config.js` with `server: { port: 5173, strictPort: true }` so the URL is stable.

### /input folder handling
Add `input/` to Vite's `publicDir` allow-list by serving it via a tiny Vite plugin that exposes `GET /__input_list` returning a JSON array of filenames in `/input` (read with `fs.readdirSync` inside the plugin — this runs in the dev server, not the browser). The UI shows a dropdown "Input folder" populated from that endpoint, loading images as `/input/<name>`. Drag-and-drop anywhere on the canvas also loads a file (FileReader → ImageBitmap). Refresh button re-fetches the list.

---

## 2. IMAGE PIPELINE (shared model)

Everything is defined in **source-image pixel space**. Two implementations (GPU preview, CPU export) that must stay in parity (section 5). Common front end, then the active mode's composition:

```
source RGBA
 → luminance (Rec.709)
 → pre-adjustments: brightness, contrast, gamma, blur (Gaussian, radius px), invert   [shared]
 → COMPOSITION  ── Zones mode ──┐
                 └─ Layers mode ─┤
 → binary ink/paper result
 → duotone mapping (optional): ink→colorA, paper→colorB                                [shared]
```

An **effect unit** is the same object in both modes: `{ effect, params }`, where `effect` ∈ `ordered | halftone | linescreen | errordiffusion | solid-black | solid-white | none`. Each effect unit, given adjusted luminance, produces a binary ink/paper value per pixel. `none` = passthrough at 50% threshold. `ui/effectparams.js` renders the param block for an effect unit and is reused verbatim by both Zones and Layers UIs — write it once.

### 2a. Zones mode
`zones` is an ordered array. Zone `i` covers luminance `[t_i, t_{i+1})` where `t_0 = 0`, `t_last = 1`, and interior thresholds are user-added sliders. Each zone: `{ effect, params, feather }`. Feather (0–0.2 luminance units) blends the binary outputs of adjacent zones using a small Bayer-8 dither on the blend factor — the output stays strictly binary, never gray. Feather 0 = hard cut. Adding a zone splits the zone under the current midpoint; removing merges into the neighbor below. Max 8 zones (GPU uniform budget, 4.6).

### 2b. Layers mode
`layers` is an ordered array, bottom-to-top, max 8. Each layer:
```
{ effect, params,
  blend: 'normal'|'multiply'|'screen'|'darken'|'lighten'|'xor',
  opacity: 0..1,
  visible: bool,
  mask: { source: 'none'|'luminance'|'luminance-inv'|'layer-<id>', low: 0, high: 1, invert: false } }
```
Each layer renders its effect to a binary result, then composites onto the accumulator below it. Because results are binary (ink/paper), blend modes operate on binary values with a defined truth table: `multiply`/`darken` = ink if either is ink (AND on paper); `screen`/`lighten` = ink if both are ink; `normal` = layer over base by mask/opacity; `xor` = ink where exactly one is ink. **Opacity < 1 and partial masks resolve to binary via the same Bayer-8 dither used for feather** — so a 50%-opacity layer stipples in at 50% coverage rather than going gray. Document this truth table in `layers.js` next to the composite loop; GPU and CPU share it.

**Per-layer mask (MIX FACTOR).** `mask.source`:
- `none` — layer applies everywhere (mix = 1).
- `luminance` / `luminance-inv` — mix factor derived from adjusted source luminance, remapped through `low`/`high` (a two-handle range) and optional `invert`. This is how "square 2×2 dither in highlights, line dither in shadows" is done in Layers mode: bottom layer = line dither unmasked, top layer = 2×2 ordered masked to `luminance` with `low=0.6, high=1.0`.
- `layer-<id>` — use another layer's ink coverage as the mask (reference-by-id, must not form a cycle; validate).

The mask multiplies the layer's contribution before the binary dither resolve.

> **Note on redundancy:** Zones and Layers can both express "different effect per tonal range." That overlap is intentional per the design decision — Zones is the fast path for tonal splits, Layers is the general path for stacking/blending. They are not merged.

---

## 3. STATE

Single plain object in `state.js`, mutated only through `set(path, value)` which notifies subscribers (viewer re-render, UI sync, export uses snapshot). Shape:

```js
{
  image: { name, width, height, bitmap },
  pre:   { brightness: 0, contrast: 0, gamma: 1, blur: 0, invert: false },

  mode: 'zones',             // 'zones' | 'layers' — the active compositing mode

  // Zones mode state
  zones: [ { effect: 'ordered', params: {...}, feather: 0 } ],
  thresholds: [],            // interior thresholds, sorted, length = zones.length - 1
  activeZone: 0,

  // Layers mode state
  layers: [ { id, effect: 'ordered', params: {...}, blend: 'normal',
              opacity: 1, visible: true,
              mask: { source: 'none', low: 0, high: 1, invert: false } } ],
  activeLayer: 0,

  duotone: { enabled: false, ink: '#000000', paper: '#ffffff' },
  view:  { zoom, panX, panY },
  export: { format: 'png', scale: 1, background: 'paper' } // paper | transparent (png/svg only)
}
```

Both `zones` and `layers` persist independently across mode switches. Layer `id`s are stable ints (monotonic counter) so masks can reference `layer-<id>` safely across reorders.

Presets: "Save preset" downloads state (minus `image`, `view`) as JSON; "Load preset" file input restores it.

---

## 4. EFFECTS — SPEC

Every effect has (a) GLSL branch for preview, (b) CPU function for export returning both a binary pixel buffer segment and SVG primitives. Both take identical params. All cell/scale params are in **source-image pixels** so preview zoom never changes the effect.

### 4.1 Ordered dither (`ordered`)
Classic threshold-matrix comparison: `ink = lum < matrix[(x/cell) % n][(y/cell) % n]` where matrix values are normalized (i+0.5)/n².

Params:
- `matrix`: dropdown from `matrices.js`
- `cell`: px per matrix cell, 1–32 (this is the "scale")
- `jitter`: 0–1, random offset added to threshold per cell (seeded PRNG, seed in params so CPU matches GPU — pass a small noise texture to the GPU generated from the same seed)

`matrices.js` library (each entry: name, n, flat threshold array):
- `bayer2`, `bayer4`, `bayer8` — standard
- `cluster-dot-4`, `cluster-dot-8` — clustered-dot (round growth, print-like)
- `cross5` — 5×5 plus/cross-shaped cluster growth. **This replicates reference image 1**: thresholds ordered so ink grows from center outward in a + shape, reading as diamonds/crosses at mid tones
- `diamond8` — 8×8 diagonal cluster
- `lines-h4`, `lines-v4` — 1×4 / 4×1 line-growth matrices (cheap line dither)
- `custom` — v2, grid editor (see phase 8); data model supports it from day one (matrix stored as data, not code)

SVG output: one `rect` per ink cell at `cell` size; merge runs of horizontally adjacent ink cells into single wider rects before writing (cuts element count massively in dark areas). Batch all rects of a zone into one `<path>` using `M x y h w v h -w z` subpaths.

### 4.2 Halftone dots (`halftone`)
AM screen: rotated grid, dot radius from local average luminance. **Reference image 2.**

Params:
- `pitch`: grid spacing px, 2–64
- `angle`: 0–90°
- `dotGain`: 0.5–1.5 multiplier on radius
- `shape`: round | square | diamond
- `maxOverlap`: allow radius > pitch/2 so shadows fuse solid (toggle)

GPU: rotate coords by angle, find nearest grid center, sample luminance **at the grid center** (not the fragment) so dot size is uniform per dot, compare fragment distance to radius `r = pitch * dotGain * sqrt(1 - lum) / 2` (sqrt for area-linear tone). CPU: iterate grid centers covering the image, average luminance over the cell footprint, emit circle/square/diamond.

SVG: `<circle>` (or path for square/diamond) per dot, grouped per zone. Cull dots with r < 0.1px.

### 4.3 Line screen (`linescreen`)
Width-modulated parallel lines. **Reference images 3 and 4.** Vertical bars with segment-wise width changes (image 3) are this effect with small `smoothing`; clean rulings (image 4) with high `smoothing` along the line.

Params:
- `pitch`: line spacing px
- `angle`: 0° = vertical lines, 90° = horizontal
- `weight`: 0.5–1.5 multiplier on line width
- `smoothing`: 0–32 px, 1-D blur of luminance *along* the line direction — low = choppy barcode segments (image 3), high = smooth swelling lines (image 4)
- `phase`: 0–1, shifts the line grid

GPU: rotate coords, line index = `floor(u/pitch)`, width at this point = `pitch * weight * (1 - lum_smoothed)`, ink if distance from line center < width/2. The along-line smoothing on GPU: sample luminance at ±k offsets along line direction (fixed 9-tap, spacing = smoothing/4). CPU must use the same 9-tap kernel, not a true Gaussian — parity beats purity.

SVG: per line, walk along it in steps of `max(1, pitch/2)` px, emit a polygon strip (single `<path>`) whose half-width tracks the computed width; split the path where width hits 0. This gives real variable-width strokes, not thousands of rects.

### 4.4 Error diffusion (`errordiffusion`)
Floyd–Steinberg and Atkinson. Sequential by nature → **no GPU implementation.**

Preview strategy: when any zone uses error diffusion, run the CPU pipeline for that zone at **preview resolution** (canvas display size, capped 2048px long edge) into a texture, debounced 150ms after the last param change, and composite it in the shader as a pre-baked mask for that zone's luminance range. UI shows a small "CPU" tag on the zone header so the slight update lag is expected behavior, Blender-style.

Params: `algorithm` (fs | atkinson), `strength` 0–1 (scales diffused error), `serpentine` toggle.

SVG: 1px rects merged into horizontal run-length rects, batched into one path. Warn loudly in the export dialog: error diffusion SVG at high res is huge; suggest PNG/BMP for this effect.

### 4.5 Utility zone effects
`solid black`, `solid white`, `none`. Trivial but essential for masking compositions (e.g. crush shadows to solid, drop highlights to paper).

### 4.6 GPU shader assembly (`gl/shader.js`)
One über-shader, not per-effect materials. It has **one `evalEffect(type, params, uv, lum)` GLSL function** returning binary ink, called by both the Zones path and the Layers path — the effect math is written once. Uniforms:

- `uImage` (source texture, `NearestFilter` when zoom ≥ 4 to show true pixels, `LinearFilter` below)
- `uPre` (vec4: brightness, contrast, gamma, blur radius) + a pre-blurred copy of the source updated on blur change (blur runs once on CPU into a second texture; don't blur per-frame in the shader)
- `uMode` int — 0 = zones, 1 = layers
- `uMatrixTex` + `uMatrixMeta[8]` — all threshold matrices in one atlas
- `uEDTex[?]` — baked error-diffusion textures for any zone/layer using error diffusion
- `uDuotone` (ink vec3, paper vec3, enabled) — applied once at the end, after composition
- Shared per-slot (max 8, reused by whichever mode is active): `uEffectType[8]` int, `uParamsA[8]` vec4, `uParamsB[8]` vec4 — documented packing table per effect
- **Zones-only:** `uZoneCount`, `uThresholds[7]`, `uFeather[8]`
- **Layers-only:** `uLayerCount`, `uBlend[8]` int, `uOpacity[8]`, `uVisible[8]`, `uMaskSrc[8]` int, `uMaskRange[8]` vec2 (low, high), `uMaskInvert[8]`. `layer-<id>` masks: because a layer referencing another needs that layer's result first, evaluate layers strictly bottom-to-top in the loop and cache each slot's binary result in a local array; a `layer-N` mask reads the cached earlier result (reject forward references at validation time in JS, so the shader only ever looks backward).

Fragment flow: luminance → adjust → **branch on `uMode`**:
- **Zones:** pick zone by thresholds (feather dither on boundary) → `evalEffect` → binary.
- **Layers:** loop slots 0..count-1 bottom-to-top; for each, `evalEffect` → binary result; compute mix factor (opacity × mask, resolved to binary via Bayer-8 dither); composite onto accumulator with the blend truth table (2b). Cache results for `layer-<id>` masks.

→ duotone → out. Keep every effect branch in one file with clear `// ===== EFFECT: name =====` markers and the blend truth table with `// ===== BLEND =====`; Claude Code edits this file constantly. **The composite loop and blend table are mirrored exactly in `cpu/` — same slot order, same dither, same truth table.**

---

## 5. PREVIEW/EXPORT PARITY — NON-NEGOTIABLE RULES

The whole point of the GPU+CPU split is speed with WYSIWYG. To keep them identical:

1. All coordinates in **source pixel space**, origin top-left, y-down, in both implementations. Export scale multiplies coordinates at the very end (SVG: `transform="scale(k)"` on root group; raster: supersample by computing in scaled space with `cell*k`, `pitch*k`).
2. Same luminance formula, same contrast/gamma math, copy-pasted constants.
3. Sampling: GPU samples luminance at the **same characteristic points** the CPU uses (grid centers for halftone, cell origin for ordered, line-walk points for linescreen). Documented per effect above.
4. Randomness only via seeded PRNG (mulberry32) rendered to a noise texture for GPU; CPU calls the same PRNG. Seed stored in params.
5. **Parity harness (build in phase 3, keep forever):** a dev-only button "Parity check" renders the GPU preview at 1:1 into a framebuffer, runs the CPU raster pipeline at 1×, diffs, and logs % mismatched pixels + shows a diff overlay. Target < 0.5% (edges of dots/lines will differ by a hair from rounding; that's fine). Run it after touching any effect.

---

## 6. EXPORT

Export dialog (modal or bottom sidebar section): format (png / bmp / svg), scale (1/2/4×), background (paper / transparent — png+svg only, bmp always paper), filename preview `"<source>_<effectsummary>_<scale>x.<ext>"`, element-count estimate for SVG, then Export → CPU pipeline runs in a **Web Worker** (don't freeze the UI; show a progress bar fed by row-progress messages) → Blob → `<a download>` click.

- **PNG** (`export/png.js`): OffscreenCanvas at `w*k × h*k`, putImageData from the CPU binary buffer (with duotone colors applied), `convertToBlob({type:'image/png'})`.
- **BMP** (`export/bmp.js`): hand-written BI_RGB 1-bit BMP: BITMAPFILEHEADER + BITMAPINFOHEADER, 2-entry palette (black, white), rows padded to 4 bytes, bottom-up. ~60 lines, no dependency.
- **SVG** (`export/svg.js`): assemble from per-unit primitive lists (section 4 defines primitives per effect). Structure: root `<svg>` at source dims × scale, paper background optional `<rect>`, then one `<g>` per zone (`id="zone-N"`) or per layer (`id="layer-N"`) depending on active mode. **Layers-mode caveat:** SVG has no true binary blend compositing, so vector export can only faithfully represent `normal` blend with `luminance`/`none` masks (each layer's ink shapes clipped by its mask range, painted in stack order). For `multiply`/`screen`/`xor`/`darken`/`lighten` or `layer-<id>` masks, the vector result would diverge from the raster preview — in those cases the export dialog **rasterizes the composite to a single traced layer** (or just warns and suggests PNG/BMP; simplest correct behavior is to disable SVG with a tooltip when a non-representable blend/mask is present). Colors from duotone or pure #000/#fff. String-build, don't use the DOM (worker-safe).

---

## 7. UI SPEC

Modeled directly on the supplied reference screenshot. **Dark theme.** Match it closely.

### Design tokens (put in `style.css` as CSS variables)
- `--bg: #1a1a1c` (app background, near-black), `--panel: #202024` (sidebars), `--canvas-bg: #0d0d0f` (viewport void)
- `--row: #2a2a2f` (control track/field background), `--row-hi: #33333a` (hover)
- `--fill: #3a4a63` (slider filled portion — the muted blue-grey from the reference)
- `--text: #e6e6e6`, `--text-dim: #8a8a90` (labels), `--text-faint: #5a5a60` (disabled/inactive layer)
- `--line: #303036` (1px dividers), `--accent: #4a9eff` (active radio, focus, `+` buttons), `--warn: #e0a020` (project name / CPU tags)
- Font: `font-family: Helvetica, 'Helvetica Neue', Arial, sans-serif;` — reference uses Helvetica. **11px** base, **10px** uppercase section labels with `letter-spacing: 0.5px`, `--text-dim`. No rounded corners beyond ~3px on fields, no shadows, flat.
- Numeric fields: value right-aligned or centered in the field, monospace-ish tabular feel (use `font-variant-numeric: tabular-nums`).

### Layout (single `index.html`, CSS grid)
```
┌─────────────┬───────────────────────────┬──────────────┐
│  LEFT       │                           │  RIGHT       │
│  PANEL      │        CANVAS             │  PANEL       │
│  ~260px     │     (fills middle)        │  ~300px      │
│  IMPORT /   │                           │  MODE switch │
│  FONTS(*)/  │                           │  ZONES or    │
│  PROJECTS   │                           │  LAYERS      │
│             │                           │  PROPERTIES  │
│             │                           │  DUOTONE     │
│             ├───────────────────────────┤  MASK        │
│             │ STATUS BAR (WxH·zoom·lum)  │  EXPORT      │
└─────────────┴───────────────────────────┴──────────────┘
```
Two side panels like the reference (import/thumbnails on the left, properties on the right). `(*)` **FONTS tab is not built** — this is an image tool, not the reference's font animator; either omit the tab or leave it disabled/hidden. PROJECTS = the presets list (saved JSON states).

### Left panel — IMPORT
- Tab strip: **IMPORT** · **PROJECTS** (drop FONTS).
- IMPORT tab: refresh + reload icons, then a **thumbnail grid** (2 columns) of everything in `/input`, each cell showing the image and filename beneath (as in the reference). Click a thumbnail to load it as the source. Drag-drop onto canvas still works and appears here too. No "LOAD INTO A/B" — single source only.
- PROJECTS tab: list of saved presets with load/delete; "Save current" button.

### Canvas (center)
Dark void (`--canvas-bg`), image centered with a thin 1px `--line` frame like the reference's bordered preview. Scroll-wheel zoom to cursor (10%–3200%), middle-drag or space+drag pan, `Home`/`H` fits. Render at devicePixelRatio. Status bar below: `<name> · WxH · zoom% · lum@cursor · <MODE>: active zone/layer`.

### Right panel — properties
Top: **MODE SWITCH** — a two-segment toggle `ZONES | LAYERS` (styled like the reference's flat segmented control). Everything below depends on the selected mode.

**Collapsible property groups** (uppercase 10px header, click to fold — like HALFTONE/STIPPLE, DUOTONE, MASK in the reference):

1. **IMAGE** — source dims readout.
2. **ADJUST** — brightness / contrast / gamma / blur sliders, invert toggle.

3a. **ZONES** (when mode = zones) — vertical black→white gradient strip with draggable threshold handles; "+ add threshold", per-zone "×". Below: one foldable block per zone, header `ZONE 2 · 0.35–0.72 · HALFTONE` (+ amber "CPU" tag for error diffusion). Selecting a zone shows its **PROPERTIES** block (effect dropdown + params via `effectparams.js`) and a feather slider. Clicking a zone header flashes that luminance range on the canvas ~1s.

3b. **LAYERS** (when mode = layers) — a **layer stack** exactly like the reference's LAYERS panel:
- Header row with a `+` to add a layer.
- Each layer row: drag handle (⠿), a **radio/eye** for visible+select (reference shows a radio dot on the active layer), the layer name (`Halftone / Stipple`, `Dither (1-bit / ordered)` — auto-named from effect, strikethrough/dimmed when hidden as in the reference), and a blend-mode abbreviation on the right (`NOR`, etc.). Drag to reorder. Top of list = top of stack.
- Selecting a layer populates the **PROPERTIES** group below with: Blend (dropdown), Opacity (slider), then that effect's params via `effectparams.js` (effect dropdown at top so you can change the layer's effect), matching the reference's field list (Seed offset, Cells/edge, Dot shape, Angle, Dot gain, Jitter map onto our halftone/linescreen/ordered params).
- **MASK (MIX FACTOR)** group (per selected layer, as in reference): Source dropdown (`none` / `luminance` / `luminance-inv` / each other layer by name), a low–high range control (shown when source ≠ none), invert toggle.

4. **DUOTONE** — enable toggle, Ink + Paper swatches (native `<input type="color">` with the value field beside them like the reference's Ink/Paper rows), swap button.
5. **EXPORT** — section 6 (format / scale / background / filename preview / element estimate / Export button + progress).

### Controls (`ui/controls.js`)
Reference-style fields — a horizontal track with a filled portion (`--fill`) and the value printed centered/right. Drag to scrub, click the number to type an exact value, double-click resets to default. Some rows (like the reference's Opacity/Dot gain) show the fill bar; pure numeric rows (Seed offset) show just a field. Dropdowns are native `<select>` restyled dark and flat (small chevron). Build slider / numeric-field / dropdown / color / toggle as factory functions; no ad-hoc inputs.

### Keyboard
`Z`/`L` switch mode, `1–8` select active zone/layer, `E` export, `H` fit view, `Del` remove selected zone/layer.

---

## 8. BUILD PHASES (Claude Code execution order)

Each phase ends in a runnable state. Commit per phase.

1. **Scaffold.** Vite project, `run.bat`, folders, `index.html` three-panel grid, both side panels + canvas + status bar shells, `style.css` with the full **dark design token set** (section 7). Left IMPORT thumbnail grid from the `/input` Vite plugin; click/drag-drop loads a source, drawn 1:1 via plain 2D canvas as placeholder. Mode switch present but inert. *Runnable: launch bat, pick a thumbnail, see it.*
2. **GL viewer.** Three.js ortho quad, image texture, pan/zoom, status bar readouts, pre-adjustments in shader (blur = CPU-baked second texture). *Runnable: adjust brightness live.*
3. **Ordered dither GPU + CPU + parity harness + one effect unit.** `evalEffect` for ordered dither, full matrix library (incl. `cross5`), cell/jitter, `effectparams.js` renders its param block, PNG export at 1× through the worker, parity button. Single effect unit, no composition yet. *This phase sets every pattern the rest copies. Get it right.*
4. **Halftone + line screen** added to `evalEffect`, GPU + CPU, parity-checked. Targets: ref image 2 (halftone ~pitch 6, angle 45), ref image 3 (linescreen angle 0, low smoothing), ref image 4 (linescreen angle 0/90, high smoothing).
5. **Zones mode.** Threshold strip UI, N zones, feather Bayer-8 blend, solid/none effects, zone flash. Über-shader zones branch + CPU zone map. Mode switch wired (layers still stub).
6. **Layers mode.** Layer stack UI (`layers.js`) per the reference — add/reorder/visibility/select, per-layer blend + opacity, **MASK (MIX FACTOR)** with luminance + `layer-<id>` sources. Über-shader layers branch (bottom-to-top loop, cached results, blend truth table) + CPU mirror. Cycle validation on `layer-<id>` masks. *Both compositing modes now work and share effects.*
7. **Exports complete.** Export dialog, scale multiplier, SVG writers per effect (rect-merging, line strips) with the Layers-mode blend caveat (section 6), BMP writer, element estimate, transparent background.
8. **Error diffusion.** CPU implementation, baked-texture preview compositing (works in both modes), debounce, amber "CPU" tag on the zone/layer.
9. **Polish.** Duotone, PROJECTS/presets save-load, keyboard shortcuts, README (add images, point downloads at /output, add a matrix to `matrices.js`, zones-vs-layers explainer), and if time: custom matrix grid editor.

> Before starting phase 1, read the `frontend-design` skill for styling discipline, but the dark token palette in section 7 overrides any default it suggests — match the reference screenshot, not a generic theme.

---

## 9. GOTCHAS

- `ImageBitmap` premultiplies alpha in some browsers — decode via `createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })` and flip Y consistently between Three.js (`texture.flipY`) and CPU buffers. Decide once, assert in the parity harness.
- Three.js `ShaderMaterial`: declare precision `highp` for the fragment shader; ordered dither at cell=1 shows precision artifacts on mediump mobile GPUs (irrelevant here but cheap insurance).
- Large sources (> 8k px) exceed GPU texture limits on some machines — downscale the *preview* texture to `min(size, 4096)` but keep full res for CPU export; effects are defined in source pixels so output is unaffected.
- Web Worker can't use Three.js state — the CPU pipeline must never import from `gl/`. Keep `cpu/` and `export/` dependency-free of DOM except OffscreenCanvas.
- SVG in Illustrator: avoid `fill-rule` surprises by keeping all merged-rect subpaths same-winding.
- Uniform arrays of structs are flaky across drivers — stick to the flat `uParamsA/uParamsB` vec4 packing described in 4.6.
- **Binary blending is the subtle part.** Blend modes and opacity operate on *binary* ink/paper values, not grays — resolve opacity/mask to coverage via the shared Bayer-8 dither so a 50% layer stipples in. Write the truth table once (2b), mirror it byte-for-byte in CPU, and add it to the parity harness (run parity in Layers mode too, not just Zones).
- **`layer-<id>` mask ordering:** a layer may only reference layers *below* it. Enforce in JS on every reorder/add (reject or auto-clamp), so the shader's backward-only cache lookup is always valid. A layer referencing a hidden layer still reads that layer's computed coverage (visibility affects compositing, not mask availability) — decide this explicitly and document it.
- SVG can't express arbitrary binary blends — the export dialog must detect non-representable Layers setups and either rasterize-then-trace or disable SVG with a tooltip (section 6). Don't silently emit a wrong vector.
