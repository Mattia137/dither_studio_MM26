// Fragment shader assembly (plan section 4.6). One evalEffect() GLSL function
// shared by every effect branch — Phase 3 adds `ordered`; Phase 4 adds
// `halftone`/`linescreen` inside the same ===== EFFECT ===== markers. The
// Zones/Layers composite loop (arrays of 8 slots) arrives in Phase 5/6; Phase
// 3 evaluates a single effect unit directly, matching the plan's "single
// effect unit, no composition yet" scope.
import { MATRICES } from '../matrices.js';
import { NOISE_SIZE } from '../noise.js';

export const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function buildFragmentShader() {
  const matrixCount = MATRICES.length;
  const atlasWidth = MATRICES.reduce((sum, m) => sum + m.n * m.n, 0);

  return /* glsl */ `
    precision highp float;

    varying vec2 vUv;

    uniform sampler2D uActiveImage; // source, or CPU-baked blur of source
    uniform vec2 uImageSize;
    uniform vec3 uPre;   // brightness, contrast, gamma
    uniform float uInvert;

    uniform sampler2D uMatrixTex;               // 1D atlas, width = sum(n_i^2), height = 1
    uniform vec2 uMatrixMeta[${matrixCount}];    // (offsetInCells, n) per matrix, indexed by matrix id order
    uniform float uMatrixAtlasWidth;

    uniform sampler2D uNoiseTex;                 // NOISE_SIZE x NOISE_SIZE, quantized to 8-bit (mirrors noise.js)

    uniform int uEffectType;   // 0 = none, 1 = ordered
    uniform vec4 uParamsA;
    uniform vec4 uParamsB;

    const vec3 LUM = vec3(0.2126, 0.7152, 0.0722); // Rec.709 — mirrors cpu/prepare.js
    const float NOISE_SIZE_F = ${NOISE_SIZE.toFixed(1)};

    float luminance(vec3 rgb) {
      return dot(rgb, LUM);
    }

    // Adjusted luminance at a uv — mirrors cpu/prepare.js applyPreAdjust() exactly.
    float adjustedLuminance(vec2 uv) {
      vec3 src = texture2D(uActiveImage, uv).rgb;
      float lum = luminance(src);
      lum += uPre.x;                                 // brightness
      lum = (lum - 0.5) * (1.0 + uPre.y) + 0.5;       // contrast
      lum = pow(clamp(lum, 0.0, 1.0), 1.0 / uPre.z);  // gamma
      if (uInvert > 0.5) lum = 1.0 - lum;
      return clamp(lum, 0.0, 1.0);
    }

    float matrixThreshold(int matrixIndex, vec2 cellCoord) {
      vec2 meta = uMatrixMeta[matrixIndex]; // (offset, n)
      float n = meta.y;
      vec2 m = mod(cellCoord, n);
      float flatIdx = m.y * n + m.x; // row (y) * n + col (x) — mirrors matrices.js layout
      float u = (meta.x + flatIdx + 0.5) / uMatrixAtlasWidth;
      return texture2D(uMatrixTex, vec2(u, 0.5)).r;
    }

    float noiseAt(vec2 cellCoord) {
      vec2 nc = mod(cellCoord, NOISE_SIZE_F);
      vec2 uv = (nc + 0.5) / NOISE_SIZE_F;
      return texture2D(uNoiseTex, uv).r;
    }

    // ===== EFFECT: ordered =====
    // ink = lum < matrix[(x/cell) % n][(y/cell) % n], threshold optionally
    // jittered per-cell by a seeded noise texture (section 4.1 / section 5 rule 4).
    float evalOrdered(vec2 pixelCoord, float lum, vec4 paramsA) {
      float matrixIndexF = paramsA.x;
      float cell = max(paramsA.y, 1.0);
      float jitter = paramsA.z;

      vec2 cellCoord = floor(pixelCoord / cell);
      float threshold = matrixThreshold(int(matrixIndexF + 0.5), cellCoord);

      if (jitter > 0.0) {
        float noiseVal = noiseAt(cellCoord);
        threshold = clamp(threshold + (noiseVal - 0.5) * jitter, 0.0, 1.0);
      }

      return lum < threshold ? 1.0 : 0.0;
    }

    // evalEffect(type, params, pixelCoord, lum) -> binary ink (1 = ink, 0 = paper).
    // Called once per fragment in Phase 3; from Phase 5 onward this same
    // function is called once per Zones/Layers slot.
    float evalEffect(int effectType, vec4 paramsA, vec4 paramsB, vec2 pixelCoord, float lum) {
      if (effectType == 1) return evalOrdered(pixelCoord, lum, paramsA);
      return lum < 0.5 ? 1.0 : 0.0; // ===== EFFECT: none (50% threshold passthrough) =====
    }

    void main() {
      float lum = adjustedLuminance(vUv);
      // vUv.y increases downward here (row 0/top -> vUv.y~0), verified empirically
      // against cpu/prepare.js output — do not "fix" this back to (1.0 - vUv.y)
      // without re-checking the parity harness; that inversion was the actual
      // bug behind a ~14-18% parity mismatch during Phase 3.
      vec2 pixelCoord = vec2(vUv.x * uImageSize.x, vUv.y * uImageSize.y);
      float ink = evalEffect(uEffectType, uParamsA, uParamsB, pixelCoord, lum);
      gl_FragColor = vec4(vec3(1.0 - ink), 1.0); // ink -> black, paper -> white
    }
  `;
}
