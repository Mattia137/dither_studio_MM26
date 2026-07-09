// Seeded PRNG (mulberry32) + a small quantized noise grid shared verbatim by
// GPU (baked into a texture) and CPU (read directly as an array) — section 5
// rule 4: randomness only via seeded PRNG, identical on both sides.

export const NOISE_SIZE = 64;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A NOISE_SIZE x NOISE_SIZE grid of values in [0,1), quantized to 8-bit steps
 * so the GPU (which stores this in a Uint8 texture) and CPU (which reads this
 * array directly) see byte-identical values — quantize once, share the result,
 * rather than relying on a tolerance to paper over float/texture drift.
 */
export function generateNoiseGrid(seed) {
  const rand = mulberry32(seed);
  const size = NOISE_SIZE * NOISE_SIZE;
  const grid = new Uint8Array(size);
  for (let i = 0; i < size; i++) grid[i] = Math.round(rand() * 255);
  return grid;
}
