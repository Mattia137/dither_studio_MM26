// PNG export (section 6). DOM-free (OffscreenCanvas) so it runs inside a Worker.

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/**
 * @param {Uint8Array} inkBuffer 1 = ink, 0 = paper, row-major top-left origin
 * @param {{ink:string, paper:string}} colors hex colors for ink/paper (duotone or #000/#fff)
 * @param {boolean} transparent when true, paper pixels get alpha 0 instead of the paper color
 */
export async function buildPngBlob(
  inkBuffer,
  width,
  height,
  colors = { ink: '#000000', paper: '#ffffff' },
  transparent = false
) {
  const inkColor = hexToRgb(colors.ink);
  const paperColor = hexToRgb(colors.paper);

  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let i = 0; i < inkBuffer.length; i++) {
    const isInk = inkBuffer[i];
    const o = i * 4;
    if (!isInk && transparent) {
      data[o + 3] = 0;
      continue;
    }
    const c = isInk ? inkColor : paperColor;
    data[o] = c.r;
    data[o + 1] = c.g;
    data[o + 2] = c.b;
    data[o + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
