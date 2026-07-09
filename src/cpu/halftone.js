// CPU halftone dot screen — mirrors gl/shader.js's evalHalftone() exactly:
// same rotated-grid math, same grid-center luminance sampling, same shape
// tests, so GPU/CPU stay in parity (section 5 rule 3: "GPU samples luminance
// at the same characteristic points the CPU uses — grid centers for halftone").
import { computeRotation } from '../rotation.js';

function clampIndex(v, max) {
  return Math.min(max, Math.max(0, v));
}

// Rotate a source-pixel-space point into grid space (angle=0 is identity).
function toGrid(x, y, ca, sa) {
  return [x * ca + y * sa, -x * sa + y * ca];
}
// Grid space back to source-pixel space.
function toSource(gx, gy, ca, sa) {
  return [gx * ca - gy * sa, gx * sa + gy * ca];
}

function sampleLumAtGridPoint(gx, gy, ca, sa, lumBuffer, width, height) {
  const [sx, sy] = toSource(gx, gy, ca, sa);
  const sampleX = clampIndex(Math.floor(sx), width - 1);
  const sampleY = clampIndex(Math.floor(sy), height - 1);
  return lumBuffer[sampleY * width + sampleX];
}

function dotRadius(lum, pitch, dotGain, maxOverlap) {
  let r = pitch * dotGain * Math.sqrt(Math.max(0, 1 - lum)) * 0.5; // sqrt: area-linear tone
  if (!maxOverlap) r = Math.min(r, pitch * 0.5);
  return r;
}

/**
 * Binary ink/paper raster for halftone dots, one decision per pixel.
 * @returns {Uint8Array} 1 = ink, 0 = paper
 */
export function halftoneDither(lumBuffer, width, height, params) {
  const pitch = Math.max(1, params.pitch);
  const { ca, sa } = computeRotation(params.angle);
  const { dotGain, shape } = params;
  const maxOverlap = !!params.maxOverlap;

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const [gx, gy] = toGrid(px, py, ca, sa);

      const centerX = Math.floor(gx / pitch + 0.5) * pitch;
      const centerY = Math.floor(gy / pitch + 0.5) * pitch;

      const lum = sampleLumAtGridPoint(centerX, centerY, ca, sa, lumBuffer, width, height);
      const r = dotRadius(lum, pitch, dotGain, maxOverlap);

      const offsetX = gx - centerX;
      const offsetY = gy - centerY;

      let ink;
      if (shape === 'square') {
        ink = Math.max(Math.abs(offsetX), Math.abs(offsetY)) < r;
      } else if (shape === 'diamond') {
        ink = Math.abs(offsetX) + Math.abs(offsetY) < r;
      } else {
        ink = Math.hypot(offsetX, offsetY) < r;
      }

      out[rowBase + x] = ink ? 1 : 0;
    }
  }
  return out;
}

/**
 * Dot descriptors for SVG export (section 4.2), in source-pixel space.
 * Culls dots with r < 0.1px. Uses the same grid-center sampling as the raster
 * path above, so SVG dot sizes match the PNG/BMP export exactly.
 */
export function halftoneDots(lumBuffer, width, height, params) {
  const pitch = Math.max(1, params.pitch);
  const { ca, sa } = computeRotation(params.angle);
  const { dotGain, shape } = params;
  const maxOverlap = !!params.maxOverlap;

  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => toGrid(x, y, ca, sa));
  const gxs = corners.map((c) => c[0]);
  const gys = corners.map((c) => c[1]);
  const minIndexX = Math.floor(Math.min(...gxs) / pitch) - 1;
  const maxIndexX = Math.ceil(Math.max(...gxs) / pitch) + 1;
  const minIndexY = Math.floor(Math.min(...gys) / pitch) - 1;
  const maxIndexY = Math.ceil(Math.max(...gys) / pitch) + 1;

  const dots = [];
  for (let iy = minIndexY; iy <= maxIndexY; iy++) {
    for (let ix = minIndexX; ix <= maxIndexX; ix++) {
      const centerX = ix * pitch;
      const centerY = iy * pitch;
      const [sx, sy] = toSource(centerX, centerY, ca, sa);
      if (sx < -pitch || sx > width + pitch || sy < -pitch || sy > height + pitch) continue;

      const lum = sampleLumAtGridPoint(centerX, centerY, ca, sa, lumBuffer, width, height);
      const r = dotRadius(lum, pitch, dotGain, maxOverlap);
      if (r < 0.1) continue;

      dots.push({ cx: sx, cy: sy, r, shape });
    }
  }
  return dots;
}
