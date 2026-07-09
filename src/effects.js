// Effect registry: one entry per `effect` id (section 2, "effect unit"). Each
// entry's `params` schema drives ui/effectparams.js generically — write the
// param UI once, reuse it for every effect and (later) every zone/layer slot.
import { MATRICES } from './matrices.js';

export const EFFECTS = {
  none: {
    id: 'none',
    label: 'None',
    defaultParams: {},
    params: [],
  },
  ordered: {
    id: 'ordered',
    label: 'Ordered Dither',
    defaultParams: { matrix: 'bayer4', cell: 4, jitter: 0, seed: 1 },
    params: [
      {
        key: 'matrix',
        type: 'dropdown',
        label: 'Matrix',
        options: MATRICES.map((m) => ({ value: m.id, label: m.name })),
      },
      { key: 'cell', type: 'slider', label: 'Cell', min: 1, max: 32, step: 1, format: (v) => `${v}px` },
      { key: 'jitter', type: 'slider', label: 'Jitter', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
  halftone: {
    id: 'halftone',
    label: 'Halftone Dots',
    defaultParams: { pitch: 8, angle: 45, dotGain: 1, shape: 'round', maxOverlap: false },
    params: [
      { key: 'pitch', type: 'slider', label: 'Pitch', min: 2, max: 64, step: 1, format: (v) => `${v}px` },
      { key: 'angle', type: 'slider', label: 'Angle', min: 0, max: 90, step: 1, format: (v) => `${v}°` },
      { key: 'dotGain', type: 'slider', label: 'Dot Gain', min: 0.5, max: 1.5, step: 0.01, format: (v) => v.toFixed(2) },
      {
        key: 'shape',
        type: 'dropdown',
        label: 'Dot Shape',
        options: [
          { value: 'round', label: 'Round' },
          { value: 'square', label: 'Square' },
          { value: 'diamond', label: 'Diamond' },
        ],
      },
      { key: 'maxOverlap', type: 'toggle', label: 'Max Overlap' },
    ],
  },
  linescreen: {
    id: 'linescreen',
    label: 'Line Screen',
    defaultParams: { pitch: 8, angle: 0, weight: 1, smoothing: 8, phase: 0 },
    params: [
      { key: 'pitch', type: 'slider', label: 'Pitch', min: 2, max: 64, step: 1, format: (v) => `${v}px` },
      { key: 'angle', type: 'slider', label: 'Angle', min: 0, max: 90, step: 1, format: (v) => `${v}°` },
      { key: 'weight', type: 'slider', label: 'Weight', min: 0.5, max: 1.5, step: 0.01, format: (v) => v.toFixed(2) },
      { key: 'smoothing', type: 'slider', label: 'Smoothing', min: 0, max: 32, step: 0.5, format: (v) => `${v.toFixed(1)}px` },
      { key: 'phase', type: 'slider', label: 'Phase', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
};

export function getEffect(id) {
  return EFFECTS[id] || EFFECTS.none;
}

export function defaultParamsFor(id) {
  return { ...getEffect(id).defaultParams };
}
