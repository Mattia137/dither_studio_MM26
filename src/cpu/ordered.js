// CPU ordered dither — mirrors gl/shader.js's evalOrdered() exactly: same
// matrix lookup, same jitter noise, same threshold comparison, so the two
// stay in parity (section 5).
import { getMatrixById } from '../matrices.js';
import { generateNoiseGrid, NOISE_SIZE } from '../noise.js';

const noiseCache = new Map();
function getNoiseGrid(seed) {
  if (!noiseCache.has(seed)) noiseCache.set(seed, generateNoiseGrid(seed));
  return noiseCache.get(seed);
}

function cellThreshold(matrix, cellX, cellY, jitter, noise) {
  const n = matrix.n;
  const mx = cellX % n;
  const my = cellY % n;
  let threshold = matrix.values[my * n + mx];
  if (noise) {
    const noiseX = cellX % NOISE_SIZE;
    const noiseY = cellY % NOISE_SIZE;
    const noiseVal = noise[noiseY * NOISE_SIZE + noiseX] / 255;
    threshold = Math.min(1, Math.max(0, threshold + (noiseVal - 0.5) * jitter));
  }
  return threshold;
}

/**
 * Binary ink/paper raster for ordered dither, one decision per PIXEL (each
 * pixel's own luminance vs. its cell's threshold) — this is what stays in
 * GPU/CPU parity and what PNG/BMP export rasterizes.
 * @param {Float32Array} lumBuffer adjusted luminance, row-major, top-left origin
 * @returns {Uint8Array} 1 = ink, 0 = paper, same layout as lumBuffer
 */
export function orderedDither(lumBuffer, width, height, params) {
  const matrix = getMatrixById(params.matrix);
  const cell = Math.max(1, params.cell);
  const jitter = params.jitter || 0;
  const noise = jitter > 0 ? getNoiseGrid(params.seed || 1) : null;

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const cellY = Math.floor(y / cell);
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      const cellX = Math.floor(x / cell);
      const threshold = cellThreshold(matrix, cellX, cellY, jitter, noise);
      const idx = rowBase + x;
      out[idx] = lumBuffer[idx] < threshold ? 1 : 0;
    }
  }
  return out;
}

/**
 * Binary ink/paper grid, one decision per CELL (luminance sampled once at the
 * cell's center pixel) — used for SVG export only (section 4.1: "one rect per
 * ink cell"). This intentionally trades pixel-exact raster fidelity for a
 * vastly smaller element count; PNG/BMP export always uses orderedDither()
 * above instead.
 */
export function orderedDitherCells(lumBuffer, width, height, params) {
  const matrix = getMatrixById(params.matrix);
  const cell = Math.max(1, params.cell);
  const jitter = params.jitter || 0;
  const noise = jitter > 0 ? getNoiseGrid(params.seed || 1) : null;

  const cellsWide = Math.ceil(width / cell);
  const cellsHigh = Math.ceil(height / cell);
  const out = new Uint8Array(cellsWide * cellsHigh);

  for (let cellY = 0; cellY < cellsHigh; cellY++) {
    const sampleY = Math.min(height - 1, Math.floor(cellY * cell + cell / 2));
    const rowBase = cellY * cellsWide;
    for (let cellX = 0; cellX < cellsWide; cellX++) {
      const sampleX = Math.min(width - 1, Math.floor(cellX * cell + cell / 2));
      const threshold = cellThreshold(matrix, cellX, cellY, jitter, noise);
      const lum = lumBuffer[sampleY * width + sampleX];
      out[rowBase + cellX] = lum < threshold ? 1 : 0;
    }
  }
  return { ink: out, cellsWide, cellsHigh };
}
