// CPU line screen — mirrors gl/shader.js's evalLinescreen() exactly: same
// rotated-grid math, same line-center + fixed 9-tap smoothing sampling, same
// width comparison, so GPU/CPU stay in parity (section 5).
import { computeRotation } from '../rotation.js';

function toGrid(x, y, ca, sa) {
  return [x * ca + y * sa, -x * sa + y * ca];
}
function toSource(u, v, ca, sa) {
  return [u * ca - v * sa, u * sa + v * ca];
}

function makeSampler(lumBuffer, width, height, ca, sa) {
  return function sampleLumAtGrid(u, v) {
    const [sx, sy] = toSource(u, v, ca, sa);
    const sampleX = Math.min(width - 1, Math.max(0, Math.floor(sx)));
    const sampleY = Math.min(height - 1, Math.max(0, Math.floor(sy)));
    return lumBuffer[sampleY * width + sampleX];
  };
}

function lineWidthAt(sampleLumAtGrid, lineCenterU, v, pitch, weight, smoothing) {
  let lum;
  if (smoothing > 0) {
    const step = smoothing / 4;
    lum = 0;
    for (let k = -4; k <= 4; k++) lum += sampleLumAtGrid(lineCenterU, v + k * step);
    lum /= 9;
  } else {
    lum = sampleLumAtGrid(lineCenterU, v);
  }
  return pitch * weight * (1 - lum);
}

/**
 * Binary ink/paper raster for line screen, one decision per pixel.
 * @returns {Uint8Array} 1 = ink, 0 = paper
 */
export function linescreenDither(lumBuffer, width, height, params) {
  const pitch = Math.max(1, params.pitch);
  const { ca, sa } = computeRotation(params.angle);
  const { weight } = params;
  const smoothing = params.smoothing || 0;
  const phase = params.phase || 0;
  const sampleLumAtGrid = makeSampler(lumBuffer, width, height, ca, sa);

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const [u, v] = toGrid(px, py, ca, sa);

      const lineIndex = Math.floor((u - phase * pitch) / pitch + 0.5);
      const lineCenterU = lineIndex * pitch + phase * pitch;

      const lw = lineWidthAt(sampleLumAtGrid, lineCenterU, v, pitch, weight, smoothing);
      out[rowBase + x] = Math.abs(u - lineCenterU) < lw / 2 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Variable-width ribbon polygons for SVG export (section 4.3): walks each
 * line in steps of max(1, pitch/2) px, tracking half-width, splitting into a
 * new subpath wherever the width collapses to ~0. Returns an array of point
 * lists (closed polygons), in source-pixel space.
 */
export function linescreenStrips(lumBuffer, width, height, params) {
  const pitch = Math.max(1, params.pitch);
  const { ca, sa } = computeRotation(params.angle);
  const { weight } = params;
  const smoothing = params.smoothing || 0;
  const phase = params.phase || 0;
  const sampleLumAtGrid = makeSampler(lumBuffer, width, height, ca, sa);
  const stepV = Math.max(1, pitch / 2);

  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => toGrid(x, y, ca, sa));
  const us = corners.map((c) => c[0]);
  const vs = corners.map((c) => c[1]);
  const minU = Math.min(...us);
  const maxU = Math.max(...us);
  const minV = Math.min(...vs) - stepV;
  const maxV = Math.max(...vs) + stepV;

  const minLineIndex = Math.floor((minU - phase * pitch) / pitch) - 1;
  const maxLineIndex = Math.ceil((maxU - phase * pitch) / pitch) + 1;

  const strips = [];

  for (let lineIndex = minLineIndex; lineIndex <= maxLineIndex; lineIndex++) {
    const lineCenterU = lineIndex * pitch + phase * pitch;
    let leftEdge = [];
    let rightEdge = [];

    const flush = () => {
      if (leftEdge.length >= 2) strips.push(leftEdge.concat(rightEdge.slice().reverse()));
      leftEdge = [];
      rightEdge = [];
    };

    for (let v = minV; v <= maxV; v += stepV) {
      const lw = lineWidthAt(sampleLumAtGrid, lineCenterU, v, pitch, weight, smoothing);
      if (lw < 0.05) {
        flush();
        continue;
      }
      const halfW = lw / 2;
      const [lx, ly] = toSource(lineCenterU - halfW, v, ca, sa);
      const [rx, ry] = toSource(lineCenterU + halfW, v, ca, sa);
      leftEdge.push({ x: lx, y: ly });
      rightEdge.push({ x: rx, y: ry });
    }
    flush();
  }

  return strips;
}
