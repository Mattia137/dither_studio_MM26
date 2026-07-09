// Single app state object + pub/sub. Mutate only through set(path, value).
import { defaultParamsFor } from './effects.js';

function makeInitialState() {
  return {
    image: { name: null, width: 0, height: 0, bitmap: null },
    pre: { brightness: 0, contrast: 0, gamma: 1, blur: 0, invert: false },

    mode: 'zones', // 'zones' | 'layers'

    zones: [{ effect: 'ordered', params: defaultParamsFor('ordered'), feather: 0 }],
    thresholds: [],
    activeZone: 0,

    layers: [
      {
        id: 1,
        effect: 'ordered',
        params: defaultParamsFor('ordered'),
        blend: 'normal',
        opacity: 1,
        visible: true,
        mask: { source: 'none', low: 0, high: 1, invert: false },
      },
    ],
    activeLayer: 0,
    nextLayerId: 2,

    duotone: { enabled: false, ink: '#000000', paper: '#ffffff' },
    view: { zoom: 1, panX: 0, panY: 0 },
    export: { format: 'png', scale: 1, background: 'paper' },
  };
}

const state = makeInitialState();
const subscribers = new Set();

function getAt(obj, pathParts) {
  let cur = obj;
  for (const part of pathParts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setAt(obj, pathParts, value) {
  let cur = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    cur = cur[pathParts[i]];
  }
  cur[pathParts[pathParts.length - 1]] = value;
}

/** Get a value at a dot-separated path, e.g. get('pre.brightness'). Omit path to get the whole state. */
export function get(path) {
  if (!path) return state;
  return getAt(state, path.split('.'));
}

/** Set a value at a dot-separated path and notify subscribers. */
export function set(path, value) {
  setAt(state, path.split('.'), value);
  notify(path, value);
}

/** Subscribe to all state changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify(path, value) {
  for (const fn of subscribers) fn(path, value, state);
}

export default state;
