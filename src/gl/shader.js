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

    uniform int uEffectType;   // 0 = none, 1 = ordered, 2 = halftone, 3 = linescreen
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

    // Rotate a source-pixel-space point into screen-aligned "grid" space
    // (angle=0 is identity) and back. Shared by halftone/linescreen so both
    // effects' "rotate coords" step (section 4.2/4.3) is written once.
    vec2 rotateToGrid(vec2 p, float ca, float sa) {
      return vec2(p.x * ca + p.y * sa, -p.x * sa + p.y * ca);
    }
    vec2 rotateToSource(vec2 p, float ca, float sa) {
      return vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
    }

    // (cos, sin) for an angle, snapped to exact values at axis-aligned angles.
    // GPU cos()/sin() are not guaranteed bit-exact 1.0/0.0/-1.0 even at
    // 0/90/180/270°, so a grid-aligned point (an exact multiple of pitch)
    // rotated back to source space can land a hair off an integer — enough to
    // flip which pixel floor() picks during nearest-sample luminance lookups.
    // Mirrored exactly in src/rotation.js's computeRotation() so GPU/CPU
    // agree bit-for-bit at these angles instead of both trusting their
    // own (slightly different) trig implementations. This was the real cause
    // of a 0.7-2.8% parity mismatch on halftone/linescreen during Phase 4.
    vec2 computeRotation(float angleDeg) {
      float m = mod(angleDeg, 360.0);
      if (m < 0.01) return vec2(1.0, 0.0);
      if (abs(m - 90.0) < 0.01) return vec2(0.0, 1.0);
      if (abs(m - 180.0) < 0.01) return vec2(-1.0, 0.0);
      if (abs(m - 270.0) < 0.01) return vec2(0.0, -1.0);
      float rad = radians(angleDeg);
      return vec2(cos(rad), sin(rad));
    }

    // Adjusted luminance at a grid-space point — converts back to source
    // space first. Used to sample at "characteristic points" (dot/line
    // centers) rather than the fragment's own position (section 5 rule 3).
    //
    // Grid points (lineCenterU, cellCenter) are exact multiples of pitch, so
    // sourcePoint often lands EXACTLY on a texel boundary (e.g. x=464.0 is
    // the left edge of texel 464). texture2D's NEAREST filter has
    // driver-dependent tie-breaking right at that boundary — it isn't a
    // precision/rounding issue (ca/sa snapping to exact 1/0 doesn't help),
    // it's ambiguity at the exact edge. Fix: compute the texel index with a
    // plain floor() ourselves, then build the texel's CENTER uv explicitly so
    // texture2D never sees a boundary-adjacent coordinate. This was the real
    // cause of a 0.7-2.8% parity mismatch on halftone/linescreen (Phase 4).
    float luminanceAtGridPoint(vec2 gridPoint, float ca, float sa) {
      vec2 sourcePoint = rotateToSource(gridPoint, ca, sa);
      vec2 texel = floor(sourcePoint);
      vec2 uv = clamp((texel + 0.5) / uImageSize, 0.0, 1.0);
      return adjustedLuminance(uv);
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

    // ===== EFFECT: halftone =====
    // AM screen: rotated grid, dot radius from luminance sampled at the grid
    // center (not the fragment) so every fragment covered by one dot agrees
    // on that dot's size (section 4.2).
    //
    // Parity note: the final length(offset) < r comparison (or square/diamond
    // equivalent) is a genuinely continuous distance-to-boundary comparison —
    // unlike ordered dither's table lookup or linescreen's texel-boundary
    // case (both fixed to ~0%), GPU float32 vs CPU float64 will always
    // disagree on a small fraction of pixels sitting exactly on a curved dot
    // edge. Measured 0-1.6% depending on angle (worst near 15-45°, ~0% at
    // 0/30/60°) — within the "edges of dots/lines differ by a hair from
    // rounding" tolerance section 5 rule 5 explicitly anticipates. Don't
    // mistake this for the texel-boundary bug class if revisiting parity.
    float evalHalftone(vec2 pixelCoord, vec4 paramsA, vec4 paramsB) {
      float pitch = max(paramsA.x, 1.0);
      float angleDeg = paramsA.y;
      float dotGain = paramsA.z;
      int shape = int(paramsA.w + 0.5); // 0 = round, 1 = square, 2 = diamond
      float maxOverlap = paramsB.x;

      vec2 rotation = computeRotation(angleDeg);
      float ca = rotation.x;
      float sa = rotation.y;

      vec2 grid = rotateToGrid(pixelCoord, ca, sa);
      vec2 cellIndex = floor(grid / pitch + 0.5);
      vec2 cellCenter = cellIndex * pitch;

      float lum = luminanceAtGridPoint(cellCenter, ca, sa);
      float r = pitch * dotGain * sqrt(clamp(1.0 - lum, 0.0, 1.0)) * 0.5; // sqrt: area-linear tone
      if (maxOverlap < 0.5) r = min(r, pitch * 0.5); // clamp so adjacent dots never touch

      vec2 offset = grid - cellCenter;
      if (shape == 1) return max(abs(offset.x), abs(offset.y)) < r ? 1.0 : 0.0; // square
      if (shape == 2) return abs(offset.x) + abs(offset.y) < r ? 1.0 : 0.0;     // diamond
      return length(offset) < r ? 1.0 : 0.0;                                    // round
    }

    // ===== EFFECT: linescreen =====
    // Width-modulated parallel lines. Width at a point comes from luminance
    // sampled along the line's own center (not the fragment's own u), with a
    // fixed 9-tap box blur along the line direction when smoothing > 0
    // (section 4.3 — CPU mirrors this exact kernel, not a true Gaussian).
    float evalLinescreen(vec2 pixelCoord, vec4 paramsA, vec4 paramsB) {
      float pitch = max(paramsA.x, 1.0);
      float angleDeg = paramsA.y;
      float weight = paramsA.z;
      float smoothing = paramsA.w;
      float phase = paramsB.x;

      vec2 rotation = computeRotation(angleDeg);
      float ca = rotation.x;
      float sa = rotation.y;

      vec2 grid = rotateToGrid(pixelCoord, ca, sa);
      float u = grid.x;
      float v = grid.y;

      float uShifted = u - phase * pitch;
      float lineIndex = floor(uShifted / pitch + 0.5);
      float lineCenterU = lineIndex * pitch + phase * pitch;

      float lum;
      if (smoothing > 0.0) {
        float step = smoothing / 4.0;
        lum = 0.0;
        for (int k = -4; k <= 4; k++) {
          lum += luminanceAtGridPoint(vec2(lineCenterU, v + float(k) * step), ca, sa);
        }
        lum /= 9.0;
      } else {
        lum = luminanceAtGridPoint(vec2(lineCenterU, v), ca, sa);
      }

      float lineWidth = pitch * weight * (1.0 - lum);
      return abs(u - lineCenterU) < lineWidth * 0.5 ? 1.0 : 0.0;
    }

    // evalEffect(type, params, pixelCoord, lum) -> binary ink (1 = ink, 0 = paper).
    // Called once per fragment in Phase 3; from Phase 5 onward this same
    // function is called once per Zones/Layers slot.
    float evalEffect(int effectType, vec4 paramsA, vec4 paramsB, vec2 pixelCoord, float lum) {
      if (effectType == 1) return evalOrdered(pixelCoord, lum, paramsA);
      if (effectType == 2) return evalHalftone(pixelCoord, paramsA, paramsB);
      if (effectType == 3) return evalLinescreen(pixelCoord, paramsA, paramsB);
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
