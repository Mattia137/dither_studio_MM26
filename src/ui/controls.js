// Slider / numeric-field / dropdown / color / toggle factory functions.
// Every control is a plain DOM builder: (opts) => HTMLElement. No ad-hoc inputs elsewhere.

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Horizontal track with a filled portion and a centered value.
 * Drag to scrub, click the number to type an exact value, double-click resets to default.
 */
export function slider({ label, min, max, step = 1, value, defaultValue = value, format, onChange }) {
  const field = document.createElement('div');
  field.className = 'field';

  const labelRow = document.createElement('div');
  labelRow.className = 'field-label-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelRow.appendChild(labelEl);
  field.appendChild(labelRow);

  const track = document.createElement('div');
  track.className = 'slider-track';

  const fill = document.createElement('div');
  fill.className = 'slider-fill';
  track.appendChild(fill);

  const valueWrap = document.createElement('div');
  valueWrap.className = 'slider-value';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.className = 'slider-num-input';
  valueWrap.appendChild(input);
  track.appendChild(valueWrap);
  field.appendChild(track);

  const fmt = format || ((v) => String(Math.round(v * 100) / 100));

  function paint(v) {
    const pct = ((v - min) / (max - min)) * 100;
    fill.style.width = `${clamp(pct, 0, 100)}%`;
    input.value = fmt(v);
  }

  let current = value;
  paint(current);

  function commit(v, { fromDrag = false } = {}) {
    v = clamp(v, min, max);
    v = Math.round(v / step) * step;
    current = v;
    paint(current);
    if (onChange) onChange(current, { fromDrag });
  }

  let dragging = false;

  track.addEventListener('pointerdown', (e) => {
    if (e.target === input) return;
    dragging = true;
    track.setPointerCapture(e.pointerId);
    scrub(e);
  });
  track.addEventListener('pointermove', (e) => {
    if (dragging) scrub(e);
  });
  track.addEventListener('pointerup', (e) => {
    dragging = false;
    track.releasePointerCapture(e.pointerId);
  });

  function scrub(e) {
    const rect = track.getBoundingClientRect();
    const t = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    commit(min + t * (max - min), { fromDrag: true });
  }

  track.addEventListener('dblclick', () => commit(defaultValue));

  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  input.addEventListener('blur', () => {
    const parsed = parseFloat(input.value);
    commit(Number.isFinite(parsed) ? parsed : current);
  });

  field.setValue = (v) => {
    current = v;
    paint(current);
  };

  return field;
}

/** Native <select>, restyled dark and flat. */
export function dropdown({ label, options, value, onChange }) {
  const field = document.createElement('div');
  field.className = 'field';

  if (label) {
    const labelRow = document.createElement('div');
    labelRow.className = 'field-label-row';
    labelRow.innerHTML = `<span>${label}</span>`;
    field.appendChild(labelRow);
  }

  const select = document.createElement('select');
  select.className = 'dd';
  for (const opt of options) {
    const optEl = document.createElement('option');
    optEl.value = opt.value;
    optEl.textContent = opt.label;
    select.appendChild(optEl);
  }
  select.value = value;
  select.addEventListener('change', () => onChange && onChange(select.value));
  field.appendChild(select);

  field.setValue = (v) => {
    select.value = v;
  };
  field.setDisabled = (d) => {
    select.disabled = d;
  };

  return field;
}

/** Numeric field only (no fill bar) — for pure-numeric rows like Seed offset. */
export function numberField({ label, min = -Infinity, max = Infinity, step = 1, value, onChange }) {
  const field = document.createElement('div');
  field.className = 'field';

  const labelRow = document.createElement('div');
  labelRow.className = 'field-label-row';
  labelRow.innerHTML = `<span>${label}</span>`;
  field.appendChild(labelRow);

  const track = document.createElement('div');
  track.className = 'slider-track';
  const valueWrap = document.createElement('div');
  valueWrap.className = 'slider-value';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.value = String(value);
  valueWrap.appendChild(input);
  track.appendChild(valueWrap);
  field.appendChild(track);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  input.addEventListener('blur', () => {
    let v = parseFloat(input.value);
    if (!Number.isFinite(v)) v = value;
    v = clamp(v, min, max);
    v = Math.round(v / step) * step;
    input.value = String(v);
    if (onChange) onChange(v);
  });

  field.setValue = (v) => {
    input.value = String(v);
  };

  return field;
}

/** Toggle switch. */
export function toggle({ label, value, onChange }) {
  const row = document.createElement('div');
  row.className = 'toggle-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const sw = document.createElement('div');
  sw.className = 'toggle' + (value ? ' on' : '');
  row.appendChild(sw);

  let current = value;
  sw.addEventListener('click', () => {
    current = !current;
    sw.classList.toggle('on', current);
    if (onChange) onChange(current);
  });

  row.setValue = (v) => {
    current = v;
    sw.classList.toggle('on', current);
  };

  return row;
}

/** Native color input with a hex text field beside it. */
export function colorField({ label, value, onChange }) {
  const field = document.createElement('div');
  field.className = 'field';

  const labelRow = document.createElement('div');
  labelRow.className = 'field-label-row';
  labelRow.innerHTML = `<span>${label}</span>`;
  field.appendChild(labelRow);

  const row = document.createElement('div');
  row.className = 'color-row';

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.value = value;

  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'color-hex';
  hex.value = value;

  function commit(v) {
    swatch.value = v;
    hex.value = v;
    if (onChange) onChange(v);
  }

  swatch.addEventListener('input', () => commit(swatch.value));
  hex.addEventListener('blur', () => {
    const v = /^#[0-9a-fA-F]{6}$/.test(hex.value) ? hex.value : swatch.value;
    commit(v);
  });
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hex.blur();
  });

  row.appendChild(swatch);
  row.appendChild(hex);
  field.appendChild(row);

  field.setValue = (v) => commit(v);

  return field;
}

/** Simple button. */
export function button({ label, accent = false, onClick }) {
  const btn = document.createElement('button');
  btn.className = 'btn' + (accent ? ' accent' : '');
  btn.textContent = label;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}
