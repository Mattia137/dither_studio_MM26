// Export worker (section 6). Runs the CPU pipeline off the main thread so the
// UI doesn't freeze. Must never import from gl/ — Three.js needs a DOM/GL
// context this worker doesn't have.
import { computeAdjustedLuminanceBuffer } from '../cpu/prepare.js';
import { orderedDither, orderedDitherCells } from '../cpu/ordered.js';
import { buildPngBlob } from './png.js';
import { buildBmpBlob } from './bmp.js';
import { buildOrderedSvgPath, buildSvgDocument } from './svg.js';

const BLACK_WHITE = { ink: '#000000', paper: '#ffffff' };

function runEffectPixels(effect, lumBuffer, width, height, params) {
  if (effect === 'ordered') return orderedDither(lumBuffer, width, height, params);
  // none / unknown -> 50% threshold passthrough, mirrors gl/shader.js evalEffect() fallback.
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = lumBuffer[i] < 0.5 ? 1 : 0;
  return out;
}

function resolveColors(duotone) {
  return duotone && duotone.enabled ? { ink: duotone.ink, paper: duotone.paper } : BLACK_WHITE;
}

async function exportSvg({ bitmap, width, height, pre, effect, params, duotone, scale, background }) {
  // SVG stays in native (1x) coordinate space — section 5 rule 1 scales the
  // root viewBox/size, not the geometry, so no supersampling needed here.
  const lumBuffer = computeAdjustedLuminanceBuffer(bitmap, pre, width, height);
  self.postMessage({ type: 'progress', value: 0.5 });

  const colors = resolveColors(duotone);
  let pathD = '';
  if (effect === 'ordered') {
    const { ink, cellsWide, cellsHigh } = orderedDitherCells(lumBuffer, width, height, params);
    pathD = buildOrderedSvgPath(ink, cellsWide, cellsHigh, Math.max(1, params.cell));
  }

  self.postMessage({ type: 'progress', value: 0.9 });
  const svgText = buildSvgDocument({
    width,
    height,
    scale,
    background,
    paperColor: colors.paper,
    inkColor: colors.ink,
    groupId: 'zone-0',
    pathD,
  });
  return new Blob([svgText], { type: 'image/svg+xml' });
}

async function exportRaster({ bitmap, width, height, pre, effect, params, duotone, scale, background, format }) {
  // Raster formats supersample: compute in scaled space with cell*k (section 5 rule 1).
  const outWidth = width * scale;
  const outHeight = height * scale;
  const scaledPre = { ...pre, blur: (pre.blur || 0) * scale };
  const scaledParams = effect === 'ordered' ? { ...params, cell: Math.max(1, params.cell) * scale } : params;

  const lumBuffer = computeAdjustedLuminanceBuffer(bitmap, scaledPre, outWidth, outHeight);
  self.postMessage({ type: 'progress', value: 0.5 });
  const inkBuffer = runEffectPixels(effect, lumBuffer, outWidth, outHeight, scaledParams);
  self.postMessage({ type: 'progress', value: 0.85 });

  if (format === 'bmp') {
    return buildBmpBlob(inkBuffer, outWidth, outHeight);
  }
  const colors = resolveColors(duotone);
  return buildPngBlob(inkBuffer, outWidth, outHeight, colors, background === 'transparent');
}

self.onmessage = async (e) => {
  const payload = e.data;
  try {
    self.postMessage({ type: 'progress', value: 0.05 });
    const blob = payload.format === 'svg' ? await exportSvg(payload) : await exportRaster(payload);
    self.postMessage({ type: 'done', blob });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
