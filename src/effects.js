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
};

export function getEffect(id) {
  return EFFECTS[id] || EFFECTS.none;
}

export function defaultParamsFor(id) {
  return { ...getEffect(id).defaultParams };
}
