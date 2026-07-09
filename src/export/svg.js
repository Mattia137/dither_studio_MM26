// SVG export (section 6). String-built, no DOM — worker-safe. Coordinates are
// authored in native (1x) source-pixel space; the root <svg> width/height is
// scaled and a matching viewBox maps it back to native coordinates (section 5
// rule 1's "transform=scale(k) on root group", expressed via viewBox instead
// of an explicit transform — same effect, standard SVG idiom).

/**
 * Merge horizontally-adjacent ink cells into run-length rects, batched into
 * one `<path>` per section 4.1: `M x y h w v h -w z` subpaths, one per run.
 * @param {Uint8Array} cellInk 1 = ink, 0 = paper, row-major
 */
export function buildOrderedSvgPath(cellInk, cellsWide, cellsHigh, cellSize) {
  const subpaths = [];
  for (let row = 0; row < cellsHigh; row++) {
    const rowBase = row * cellsWide;
    let runStart = -1;
    for (let col = 0; col <= cellsWide; col++) {
      const ink = col < cellsWide && cellInk[rowBase + col];
      if (ink && runStart === -1) {
        runStart = col;
      } else if (!ink && runStart !== -1) {
        const x = runStart * cellSize;
        const y = row * cellSize;
        const w = (col - runStart) * cellSize;
        subpaths.push(`M${x} ${y}h${w}v${cellSize}h${-w}z`);
        runStart = -1;
      }
    }
  }
  return subpaths.join('');
}

/** Number of merged rects a buildOrderedSvgPath() call would emit — used for the pre-export element-count estimate. */
export function countOrderedSvgElements(cellInk, cellsWide, cellsHigh) {
  let count = 0;
  for (let row = 0; row < cellsHigh; row++) {
    const rowBase = row * cellsWide;
    let inRun = false;
    for (let col = 0; col < cellsWide; col++) {
      const ink = cellInk[rowBase + col];
      if (ink && !inRun) {
        count++;
        inRun = true;
      } else if (!ink) {
        inRun = false;
      }
    }
  }
  return count;
}

/**
 * Assembles the full SVG document: optional paper background, one <g> per
 * zone/layer (id="zone-N"/"layer-N" — Phase 5/6 will pass the real id; Phase 7
 * always uses zone-0 for the single effect unit) carrying the ink fill color,
 * containing effect-specific markup (a <path> for ordered/linescreen,
 * <circle>/<rect>/<polygon> for halftone).
 */
export function buildSvgDocument({ width, height, scale, background, paperColor, inkColor, groupId, contentMarkup }) {
  const outW = width * scale;
  const outH = height * scale;
  const bg = background === 'transparent' ? '' : `<rect width="${width}" height="${height}" fill="${paperColor}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${width} ${height}">` +
    bg +
    `<g id="${groupId}" fill="${inkColor}">${contentMarkup || ''}</g>` +
    `</svg>`
  );
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * <circle>/<rect>/<polygon> markup for halftone dots (section 4.2). One
 * primitive per dot — a single shared shape per effect, so no per-dot fill
 * needed beyond the parent <g>'s.
 */
export function buildHalftoneSvgMarkup(dots) {
  if (dots.length === 0) return '';
  const shape = dots[0].shape;
  if (shape === 'square') {
    return dots
      .map((d) => `<rect x="${round2(d.cx - d.r)}" y="${round2(d.cy - d.r)}" width="${round2(d.r * 2)}" height="${round2(d.r * 2)}"/>`)
      .join('');
  }
  if (shape === 'diamond') {
    return dots
      .map((d) => {
        const cx = round2(d.cx);
        const cy = round2(d.cy);
        const r = round2(d.r);
        return `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}"/>`;
      })
      .join('');
  }
  return dots.map((d) => `<circle cx="${round2(d.cx)}" cy="${round2(d.cy)}" r="${round2(d.r)}"/>`).join('');
}

/**
 * Batches linescreen ribbon polygons (section 4.3) — one closed subpath per
 * strip — into a single <path>.
 */
export function buildLinescreenSvgPath(strips) {
  const subpaths = strips.map((pts) => {
    const [first, ...rest] = pts;
    const moveTo = `M${round2(first.x)} ${round2(first.y)}`;
    const lines = rest.map((p) => `L${round2(p.x)} ${round2(p.y)}`).join('');
    return `${moveTo}${lines}Z`;
  });
  return subpaths.join('');
}
