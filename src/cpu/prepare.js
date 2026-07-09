// Decode, grayscale, pre-adjust. Shared math with gl/shader.js — section 5 rule 2
// requires the same luminance/contrast/gamma constants in both; keep them in sync
// by hand (GLSL can't import this file).

export const LUM_R = 0.2126;
export const LUM_G = 0.7152;
export const LUM_B = 0.0722; // Rec.709

export function luminance(r, g, b) {
  return LUM_R * r + LUM_G * g + LUM_B * b;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/** brightness/contrast/gamma/invert applied to a 0..1 luminance value. Mirrors the GLSL in gl/shader.js exactly. */
export function applyPreAdjust(lum, { brightness, contrast, gamma, invert }) {
  lum += brightness;
  lum = (lum - 0.5) * (1 + contrast) + 0.5;
  lum = Math.pow(clamp01(lum), 1 / gamma);
  if (invert) lum = 1 - lum;
  return clamp01(lum);
}

/**
 * Gaussian-blur a source (ImageBitmap/Canvas) by `radius` px using the native
 * canvas 2D filter. OffscreenCanvas exposes the same `filter` API inside a
 * Worker, so GPU preview baking and CPU export share one blur implementation
 * instead of two hand-rolled kernels that could drift apart.
 */
export function blurBitmap(source, radius, width, height) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.filter = radius > 0 ? `blur(${radius}px)` : 'none';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Raw RGBA ImageData for a source drawn at width x height. DOM-free (OffscreenCanvas) so it also runs inside a Worker. */
export function getImageData(source, width, height) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Full CPU front end of the shared pipeline (section 2): blur -> luminance ->
 * brightness/contrast/gamma/invert. Returns a Float32Array, row-major,
 * top-left origin — the same buffer shape every cpu/ effect module consumes.
 */
export function computeAdjustedLuminanceBuffer(bitmap, pre, width, height) {
  const source = pre.blur > 0 ? blurBitmap(bitmap, pre.blur, width, height) : bitmap;
  const { data } = getImageData(source, width, height);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    const lum = luminance(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255);
    out[i] = applyPreAdjust(lum, pre);
  }
  return out;
}
