// Shared angle -> (cos, sin) helper, snapping to exact axis-aligned values.
// Math.cos(Math.PI / 2) is NOT exactly 0 in JS (~6e-17 residual, since
// Math.PI only approximates the true irrational pi) — negligible for float64
// in practice, but the GPU's float32 cos()/sin() can be off by enough to flip
// a floor() rounding decision on a grid-aligned sample point (an exact
// multiple of pitch, rotated back to source space). Snap explicitly so both
// sides agree bit-for-bit at the angles halftone/linescreen actually expose
// (0-90°) instead of trusting either platform's trig implementation there —
// this was the real cause of a 0.7-2.8% GPU/CPU parity mismatch during Phase 4.
export function computeRotation(angleDeg) {
  const mod = ((angleDeg % 360) + 360) % 360;
  if (mod < 0.01) return { ca: 1, sa: 0 };
  if (Math.abs(mod - 90) < 0.01) return { ca: 0, sa: 1 };
  if (Math.abs(mod - 180) < 0.01) return { ca: -1, sa: 0 };
  if (Math.abs(mod - 270) < 0.01) return { ca: 0, sa: -1 };
  const rad = (angleDeg * Math.PI) / 180;
  return { ca: Math.cos(rad), sa: Math.sin(rad) };
}
