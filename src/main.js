// Boot + wiring.
import { set, get } from './state.js';
import { initCollapsibleGroups, initTabStrip, initModeSwitch } from './ui/panel.js';
import { createViewer } from './gl/viewer.js';
import { slider, toggle, dropdown, button } from './ui/controls.js';
import { luminance, applyPreAdjust, computeAdjustedLuminanceBuffer } from './cpu/prepare.js';
import { orderedDither, orderedDitherCells } from './cpu/ordered.js';
import { halftoneDither, halftoneDots } from './cpu/halftone.js';
import { linescreenDither, linescreenStrips } from './cpu/linescreen.js';
import { countOrderedSvgElements } from './export/svg.js';
import { defaultParamsFor } from './effects.js';
import { renderEffectParams } from './ui/effectparams.js';

/** CPU ink raster for the given effect — mirrors gl/shader.js's evalEffect() dispatch, used by the dev parity check. */
function computeCpuInk(effect, lumBuffer, width, height, params) {
  if (effect === 'ordered') return orderedDither(lumBuffer, width, height, params);
  if (effect === 'halftone') return halftoneDither(lumBuffer, width, height, params);
  if (effect === 'linescreen') return linescreenDither(lumBuffer, width, height, params);
  return Uint8Array.from(lumBuffer, (l) => (l < 0.5 ? 1 : 0));
}

/** SVG element-count estimate for the given effect, or null if not yet supported for SVG. */
function computeSvgElementCount(effect, lumBuffer, width, height, params) {
  if (effect === 'ordered') {
    const { ink, cellsWide, cellsHigh } = orderedDitherCells(lumBuffer, width, height, params);
    return countOrderedSvgElements(ink, cellsWide, cellsHigh);
  }
  if (effect === 'halftone') return halftoneDots(lumBuffer, width, height, params).length;
  if (effect === 'linescreen') return linescreenStrips(lumBuffer, width, height, params).length;
  return null;
}

const thumbGrid = document.getElementById('thumb-grid');
const canvas = document.getElementById('viewer-canvas');
const canvasViewport = document.getElementById('canvas-viewport');

const statusName = document.getElementById('status-name');
const statusDims = document.getElementById('status-dims');
const statusZoom = document.getElementById('status-zoom');
const statusLum = document.getElementById('status-lum');
const imageReadout = document.getElementById('image-readout');

const IMAGE_DECODE_OPTS = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };

const viewer = createViewer(canvas, canvasViewport);

// Hidden sample canvas: raw (unadjusted) pixel readback for the lum@cursor status readout.
const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

// ---- Image loading ----

async function setImage(bitmap, name) {
  set('image', { name, width: bitmap.width, height: bitmap.height, bitmap });

  sampleCanvas.width = bitmap.width;
  sampleCanvas.height = bitmap.height;
  sampleCtx.clearRect(0, 0, bitmap.width, bitmap.height);
  sampleCtx.drawImage(bitmap, 0, 0);

  viewer.setImage(bitmap);
  viewer.setPre(get('pre'));
  applyEffectToViewer();
  onExportSettingsChange();

  statusName.textContent = name;
  statusDims.textContent = `${bitmap.width}×${bitmap.height}`;
  imageReadout.textContent = `${name} — ${bitmap.width}×${bitmap.height}`;

  thumbGrid.querySelectorAll('.thumb-cell').forEach((cell) => {
    cell.classList.toggle('selected', cell.dataset.name === name);
  });
}

async function loadImageFromURL(url, name) {
  const res = await fetch(url);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob, IMAGE_DECODE_OPTS);
  await setImage(bitmap, name);
}

async function loadImageFromFile(file) {
  const bitmap = await createImageBitmap(file, IMAGE_DECODE_OPTS);
  await setImage(bitmap, file.name);
}

// ---- IMPORT thumbnail grid ----

// import.meta.env.BASE_URL (Vite's configured `base`) rather than a hardcoded
// leading slash — this endpoint/folder is served live by the dev-server
// plugin at "/" but lives under "/<repo-name>/" on a GitHub Pages project
// site, where a build-time step bakes the same __input_list + input/* files
// as static assets (see vite.config.js).
const inputListUrl = `${import.meta.env.BASE_URL}__input_list`;
const inputFileUrl = (name) => `${import.meta.env.BASE_URL}input/${encodeURIComponent(name)}`;

async function refreshInputList() {
  thumbGrid.innerHTML = '';
  let files = [];
  try {
    const res = await fetch(inputListUrl);
    files = await res.json();
  } catch {
    files = [];
  }

  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'thumb-empty';
    empty.textContent = 'No images in /input';
    thumbGrid.appendChild(empty);
    return;
  }

  for (const name of files) {
    const cell = document.createElement('div');
    cell.className = 'thumb-cell';
    cell.dataset.name = name;

    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.src = inputFileUrl(name);
    img.loading = 'lazy';
    cell.appendChild(img);

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = name;
    cell.appendChild(label);

    cell.addEventListener('click', () => loadImageFromURL(inputFileUrl(name), name));

    thumbGrid.appendChild(cell);
  }
}

document.getElementById('btn-refresh-input').addEventListener('click', refreshInputList);

document.getElementById('btn-load-file').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    if (input.files[0]) loadImageFromFile(input.files[0]);
  });
  input.click();
});

// ---- Drag and drop onto canvas ----

canvasViewport.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvasViewport.classList.add('drag-over');
});
canvasViewport.addEventListener('dragleave', () => {
  canvasViewport.classList.remove('drag-over');
});
canvasViewport.addEventListener('drop', (e) => {
  e.preventDefault();
  canvasViewport.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadImageFromFile(file);
});

// ---- ADJUST panel ----

const adjustBody = document.getElementById('adjust-body');
adjustBody.innerHTML = '';

function updatePre(field, value) {
  set(`pre.${field}`, value);
  viewer.setPre(get('pre'));
}

const pre = get('pre');

adjustBody.appendChild(
  slider({
    label: 'Brightness',
    min: -1,
    max: 1,
    step: 0.01,
    value: pre.brightness,
    format: (v) => v.toFixed(2),
    onChange: (v) => updatePre('brightness', v),
  })
);
adjustBody.appendChild(
  slider({
    label: 'Contrast',
    min: -1,
    max: 1,
    step: 0.01,
    value: pre.contrast,
    format: (v) => v.toFixed(2),
    onChange: (v) => updatePre('contrast', v),
  })
);
adjustBody.appendChild(
  slider({
    label: 'Gamma',
    min: 0.1,
    max: 4,
    step: 0.01,
    value: pre.gamma,
    format: (v) => v.toFixed(2),
    onChange: (v) => updatePre('gamma', v),
  })
);
adjustBody.appendChild(
  slider({
    label: 'Blur',
    min: 0,
    max: 20,
    step: 0.5,
    value: pre.blur,
    format: (v) => `${v.toFixed(1)}px`,
    onChange: (v) => updatePre('blur', v),
  })
);
adjustBody.appendChild(
  toggle({
    label: 'Invert',
    value: pre.invert,
    onChange: (v) => updatePre('invert', v),
  })
);

// Phase-1 placeholders for sections built in later phases.
document.getElementById('duotone-body').innerHTML = '<div class="readout">Duotone — Phase 9</div>';
document.getElementById('preset-list').innerHTML = '<div class="readout">Presets — Phase 9</div>';

// ---- EFFECT (single unit — full Zones/Layers composition in Phase 5–6) ----

function currentEffectUnit() {
  return get('zones')[0];
}

function applyEffectToViewer() {
  const unit = currentEffectUnit();
  viewer.setEffect(unit.effect, unit.params);
}

function onEffectParamChange(key, value) {
  const unit = currentEffectUnit();
  set('zones.0.params', { ...unit.params, [key]: value });
  applyEffectToViewer();
  onExportSettingsChange();
}

const compositionBody = document.getElementById('composition-body');
compositionBody.innerHTML = '';

const compositionNote = document.createElement('div');
compositionNote.className = 'section-note';
compositionNote.textContent = 'Single effect unit for now — full Zones/Layers composition arrives in Phase 5–6.';
compositionBody.appendChild(compositionNote);

const effectParamsContainer = document.createElement('div');
effectParamsContainer.style.display = 'flex';
effectParamsContainer.style.flexDirection = 'column';
effectParamsContainer.style.gap = '10px';

const effectDropdown = dropdown({
  label: 'Effect',
  options: [
    { value: 'none', label: 'None' },
    { value: 'ordered', label: 'Ordered Dither' },
    { value: 'halftone', label: 'Halftone Dots' },
    { value: 'linescreen', label: 'Line Screen' },
  ],
  value: currentEffectUnit().effect,
  onChange: (effectId) => {
    const params = defaultParamsFor(effectId);
    set('zones.0.effect', effectId);
    set('zones.0.params', params);
    renderEffectParams(effectParamsContainer, effectId, params, onEffectParamChange);
    applyEffectToViewer();
    onExportSettingsChange();
  },
});
compositionBody.appendChild(effectDropdown);
compositionBody.appendChild(effectParamsContainer);

renderEffectParams(effectParamsContainer, currentEffectUnit().effect, currentEffectUnit().params, onEffectParamChange);
applyEffectToViewer();

// ---- EXPORT (format / scale / background / filename / SVG element estimate) + dev Parity check ----

const EXPORT_EXT = { png: 'png', bmp: 'bmp', svg: 'svg' };
const SVG_WARN_THRESHOLD = 300000;

const exportWorker = new Worker(new URL('./export/worker.js', import.meta.url), { type: 'module' });

const exportBody = document.getElementById('export-body');
exportBody.innerHTML = '';

const formatDropdown = dropdown({
  label: 'Format',
  options: [
    { value: 'png', label: 'PNG' },
    { value: 'bmp', label: 'BMP (1-bit)' },
    { value: 'svg', label: 'SVG' },
  ],
  value: get('export').format,
  onChange: (v) => {
    set('export.format', v);
    onExportSettingsChange();
  },
});
exportBody.appendChild(formatDropdown);

const scaleDropdown = dropdown({
  label: 'Scale',
  options: [
    { value: '1', label: '1×' },
    { value: '2', label: '2×' },
    { value: '4', label: '4×' },
  ],
  value: String(get('export').scale),
  onChange: (v) => {
    set('export.scale', Number(v));
    onExportSettingsChange();
  },
});
exportBody.appendChild(scaleDropdown);

const backgroundDropdown = dropdown({
  label: 'Background',
  options: [
    { value: 'paper', label: 'Paper' },
    { value: 'transparent', label: 'Transparent' },
  ],
  value: get('export').background,
  onChange: (v) => {
    set('export.background', v);
    onExportSettingsChange();
  },
});
exportBody.appendChild(backgroundDropdown);

const filenamePreview = document.createElement('div');
filenamePreview.className = 'readout';
exportBody.appendChild(filenamePreview);

const elementEstimate = document.createElement('div');
elementEstimate.className = 'section-note';
exportBody.appendChild(elementEstimate);

const exportBtn = button({ label: 'Export', accent: true, onClick: () => runExport() });
exportBody.appendChild(exportBtn);

const progressTrack = document.createElement('div');
progressTrack.className = 'progress-track';
const progressFill = document.createElement('div');
progressFill.className = 'progress-fill';
progressTrack.appendChild(progressFill);
exportBody.appendChild(progressTrack);

const divider = document.createElement('div');
divider.className = 'divider';
exportBody.appendChild(divider);

const parityBtn = button({ label: 'Parity Check (dev)', onClick: () => runParityCheck() });
exportBody.appendChild(parityBtn);

const parityResult = document.createElement('div');
parityResult.className = 'parity-result';
exportBody.appendChild(parityResult);

const diffCanvas = document.createElement('canvas');
diffCanvas.className = 'diff-canvas';
exportBody.appendChild(diffCanvas);

function setProgress(v) {
  progressFill.style.width = `${Math.round(v * 100)}%`;
}

function computeFilename() {
  const image = get('image');
  const unit = currentEffectUnit();
  const exp = get('export');
  const baseName = (image.name || 'export').replace(/\.[^.]+$/, '');
  return `${baseName}_${unit.effect}_${exp.scale}x.${EXPORT_EXT[exp.format]}`;
}

function updateBackgroundAvailability() {
  const exp = get('export');
  const isBmp = exp.format === 'bmp'; // BMP always paper, ignores duotone/transparency (assumptions section)
  if (isBmp && exp.background !== 'paper') set('export.background', 'paper');
  backgroundDropdown.setValue(get('export').background);
  backgroundDropdown.setDisabled(isBmp);
}

function updateElementEstimate() {
  const exp = get('export');
  if (exp.format !== 'svg') {
    elementEstimate.textContent = '';
    return;
  }
  const image = get('image');
  if (!image.bitmap) {
    elementEstimate.textContent = 'Load an image to estimate SVG element count.';
    return;
  }
  const unit = currentEffectUnit();
  const lumBuffer = computeAdjustedLuminanceBuffer(image.bitmap, get('pre'), image.width, image.height);
  const count = computeSvgElementCount(unit.effect, lumBuffer, image.width, image.height, unit.params);
  if (count === null) {
    elementEstimate.textContent = 'SVG export is not available for this effect yet.';
    return;
  }
  const over = count > SVG_WARN_THRESHOLD;
  elementEstimate.textContent = `~${count.toLocaleString()} SVG elements${over ? ' — warning: very large, consider PNG/BMP' : ''}`;
  elementEstimate.style.color = over ? 'var(--warn)' : '';
}

function onExportSettingsChange() {
  updateBackgroundAvailability();
  filenamePreview.textContent = computeFilename();
  updateElementEstimate();
}

onExportSettingsChange();

async function runExport() {
  const image = get('image');
  if (!image.bitmap) {
    alert('Load an image first.');
    return;
  }
  exportBtn.disabled = true;
  setProgress(0.05);

  const unit = currentEffectUnit();
  const exp = get('export');
  const bitmapCopy = await createImageBitmap(image.bitmap);

  try {
    const blob = await new Promise((resolve, reject) => {
      const handler = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') setProgress(msg.value);
        else if (msg.type === 'done') {
          exportWorker.removeEventListener('message', handler);
          resolve(msg.blob);
        } else if (msg.type === 'error') {
          exportWorker.removeEventListener('message', handler);
          reject(new Error(msg.message));
        }
      };
      exportWorker.addEventListener('message', handler);
      exportWorker.postMessage(
        {
          bitmap: bitmapCopy,
          width: image.width,
          height: image.height,
          pre: get('pre'),
          effect: unit.effect,
          params: unit.params,
          duotone: get('duotone'),
          format: exp.format,
          scale: exp.scale,
          background: exp.background,
        },
        [bitmapCopy]
      );
    });

    setProgress(1);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = computeFilename();
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  } finally {
    exportBtn.disabled = false;
    setTimeout(() => setProgress(0), 600);
  }
}

/** Dev-only: renders GPU at 1:1, runs the CPU pipeline, diffs, reports % mismatch (section 5 rule 5, target <0.5%). */
function runParityCheck() {
  const image = get('image');
  if (!image.bitmap) {
    alert('Load an image first.');
    return;
  }
  const unit = currentEffectUnit();
  const { width, height } = image;

  const lumBuffer = computeAdjustedLuminanceBuffer(image.bitmap, get('pre'), width, height);
  const cpuInk = computeCpuInk(unit.effect, lumBuffer, width, height, unit.params);

  const gpuPixels = viewer.renderToPixels();
  if (!gpuPixels) return;

  diffCanvas.width = width;
  diffCanvas.height = height;
  const dctx = diffCanvas.getContext('2d');
  const diffImg = dctx.createImageData(width, height);

  let mismatches = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const gpuInk = gpuPixels[o] < 128 ? 1 : 0; // shader renders ink -> black
    const mismatch = gpuInk !== cpuInk[i];
    if (mismatch) mismatches++;
    diffImg.data[o] = 255;
    diffImg.data[o + 1] = 0;
    diffImg.data[o + 2] = 0;
    diffImg.data[o + 3] = mismatch ? 255 : 0;
  }
  dctx.putImageData(diffImg, 0, 0);
  diffCanvas.classList.add('visible');

  const pct = (mismatches / (width * height)) * 100;
  const pass = pct < 0.5;
  parityResult.textContent = `Parity: ${pct.toFixed(3)}% mismatch (target < 0.5%)`;
  parityResult.classList.toggle('pass', pass);
  parityResult.classList.toggle('fail', !pass);

  console.log(`[parity] ${mismatches}/${width * height} px mismatched (${pct.toFixed(3)}%)`);
}

// ---- Status bar: zoom % and lum@cursor ----

viewer.onViewChange(({ zoom }) => {
  statusZoom.textContent = `${Math.round(zoom * 100)}%`;
});

canvas.addEventListener('pointermove', (e) => {
  const px = viewer.pixelUnderCursor(e.clientX, e.clientY);
  if (!px) {
    statusLum.textContent = 'lum —';
    return;
  }
  const [r, g, b] = sampleCtx.getImageData(px.x, px.y, 1, 1).data;
  const rawLum = luminance(r / 255, g / 255, b / 255);
  const adjusted = applyPreAdjust(rawLum, get('pre'));
  statusLum.textContent = `lum ${adjusted.toFixed(2)}`;
});
canvas.addEventListener('pointerleave', () => {
  statusLum.textContent = 'lum —';
});

// ---- Keyboard: H / Home fits ----

window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'h' || e.key === 'H' || e.key === 'Home') {
    e.preventDefault();
    viewer.fit();
  }
});

// ---- Panel wiring ----

initTabStrip();
initCollapsibleGroups();
initModeSwitch();

refreshInputList();
