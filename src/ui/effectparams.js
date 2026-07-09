// Renders one effect's param block from its effects.js schema. Reused
// verbatim by Zones (Phase 5) and Layers (Phase 6) UIs — write it once.
import { getEffect } from '../effects.js';
import { slider, dropdown } from './controls.js';

/**
 * @param {HTMLElement} container emptied and (re)filled with this effect's controls
 * @param {string} effectId
 * @param {object} params current param values for this effect
 * @param {(key: string, value: any) => void} onParamChange
 */
export function renderEffectParams(container, effectId, params, onParamChange) {
  container.innerHTML = '';
  const effect = getEffect(effectId);

  for (const spec of effect.params) {
    const value = params[spec.key];
    let control = null;

    if (spec.type === 'slider') {
      control = slider({
        label: spec.label,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        value,
        format: spec.format,
        onChange: (v) => onParamChange(spec.key, v),
      });
    } else if (spec.type === 'dropdown') {
      control = dropdown({
        label: spec.label,
        options: spec.options,
        value,
        onChange: (v) => onParamChange(spec.key, v),
      });
    }

    if (control) container.appendChild(control);
  }

  if (effect.params.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'readout';
    empty.textContent = 'No parameters.';
    container.appendChild(empty);
  }
}
