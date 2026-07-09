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
 * always uses zone-0 for the single effect unit) containing one ink <path>.
 */
export function buildSvgDocument({ width, height, scale, background, paperColor, inkColor, groupId, pathD }) {
  const outW = width * scale;
  const outH = height * scale;
  const bg = background === 'transparent' ? '' : `<rect width="${width}" height="${height}" fill="${paperColor}"/>`;
  const path = pathD ? `<path d="${pathD}" fill="${inkColor}" fill-rule="nonzero"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${width} ${height}">` +
    bg +
    `<g id="${groupId}">${path}</g>` +
    `</svg>`
  );
}
