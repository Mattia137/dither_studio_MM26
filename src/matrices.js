// Threshold matrix library for ordered dither (section 4.1). Every matrix is
// stored as a flat, row-major (index = row*n + col, row from y, col from x)
// array of GROWTH RANKS 0..n²-1, normalized to thresholds via (i+0.5)/n² —
// exactly the formula section 4.1 specifies, so GPU and CPU both apply it the
// same way from these shared raw ranks.
//
// ink = lum < threshold. For a uniform gray that darkens from 1 -> 0, a cell
// turns to ink as soon as lum drops below its threshold — so the HIGHEST-rank
// (highest-threshold) cells ink first, lowest-rank cells ink last. Keep that
// direction in mind when adding matrices: "grows first" = high rank.

function flattenGrid(grid) {
  const n = grid.length;
  const flat = new Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) flat[y * n + x] = grid[y][x];
  return flat;
}

// Standard recursive Bayer construction: M(2n) built from four copies of M(n).
function makeBayerRanks(size) {
  let m = [[0]];
  while (m.length < size) {
    const n = m.length;
    const next = Array.from({ length: n * 2 }, () => new Array(n * 2));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y][x];
        next[y][x] = 4 * v;
        next[y][x + n] = 4 * v + 2;
        next[y + n][x] = 4 * v + 3;
        next[y + n][x + n] = 4 * v + 1;
      }
    }
    m = next;
  }
  return flattenGrid(m);
}

// Rank cells by a distance metric from the matrix center; the closest cell
// gets the highest rank (inks first), the farthest gets rank 0 (inks last).
// Euclidean distance -> round clustered-dot growth. Manhattan (L1) distance
// -> diamond/plus growth (small radii read as a "+", larger as a diamond).
function makeGrowthRanks(n, distanceFn) {
  const cells = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      cells.push({ x, y, d: distanceFn(x, y, n) });
    }
  }
  cells.sort((a, b) => a.d - b.d || a.y * n + a.x - (b.y * n + b.x));
  const total = n * n;
  const flat = new Array(total);
  cells.forEach((c, idx) => {
    flat[c.y * n + c.x] = total - 1 - idx;
  });
  return flat;
}

function euclideanFromCenter(x, y, n) {
  const c = (n - 1) / 2;
  return Math.hypot(x - c, y - c);
}

function manhattanFromCenter(x, y, n) {
  const c = (n - 1) / 2;
  return Math.abs(x - c) + Math.abs(y - c);
}

// Threshold varies mainly along one axis (row for horizontal, column for
// vertical) so ink sweeps in bands — a cheap directional dither. The other
// axis still spreads ranks across the band's n slots for full n² tonal steps.
function makeLinesRanks(n, horizontal) {
  const flat = new Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const band = horizontal ? y : x;
      const sub = horizontal ? x : y;
      flat[y * n + x] = band * n + sub;
    }
  }
  return flat;
}

// Quantized to 1/255 here — the GPU stores these thresholds in a Uint8 atlas
// texture, so CPU must read the same quantized value rather than the raw
// float, or the two would disagree by up to half a texel at cell edges.
function normalize(ranks) {
  const n2 = ranks.length;
  return Float32Array.from(ranks, (i) => Math.round(((i + 0.5) / n2) * 255) / 255);
}

function defineMatrix(id, name, n, ranks) {
  return { id, name, n, values: normalize(ranks) };
}

export const MATRICES = [
  defineMatrix('bayer2', 'Bayer 2×2', 2, makeBayerRanks(2)),
  defineMatrix('bayer4', 'Bayer 4×4', 4, makeBayerRanks(4)),
  defineMatrix('bayer8', 'Bayer 8×8', 8, makeBayerRanks(8)),
  defineMatrix('cluster-dot-4', 'Cluster Dot 4×4', 4, makeGrowthRanks(4, euclideanFromCenter)),
  defineMatrix('cluster-dot-8', 'Cluster Dot 8×8', 8, makeGrowthRanks(8, euclideanFromCenter)),
  defineMatrix('cross5', 'Cross 5×5', 5, makeGrowthRanks(5, manhattanFromCenter)),
  defineMatrix('diamond8', 'Diamond 8×8', 8, makeGrowthRanks(8, manhattanFromCenter)),
  defineMatrix('lines-h4', 'Lines Horizontal 4×4', 4, makeLinesRanks(4, true)),
  defineMatrix('lines-v4', 'Lines Vertical 4×4', 4, makeLinesRanks(4, false)),
  // v2: grid editor (phase 8+) mutates `values` in place. Seeded with bayer4
  // so it's a sane default the moment it's selected.
  defineMatrix('custom', 'Custom', 4, makeBayerRanks(4)),
];

export function getMatrixById(id) {
  return MATRICES.find((m) => m.id === id) || MATRICES[0];
}

export function matrixIndexById(id) {
  const idx = MATRICES.findIndex((m) => m.id === id);
  return idx === -1 ? 0 : idx;
}
