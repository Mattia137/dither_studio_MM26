// Hand-written 1-bit BMP writer (section 6): BITMAPFILEHEADER + BITMAPINFOHEADER
// (BI_RGB), 2-entry palette, rows padded to 4 bytes, bottom-up. No dependency.
// BMP always ignores duotone/transparency — plain black ink on white paper.

const PAPER_BGRA = [255, 255, 255, 0];
const INK_BGRA = [0, 0, 0, 0];

/** @param {Uint8Array} inkBuffer 1 = ink, 0 = paper, row-major top-left origin */
export function buildBmpBlob(inkBuffer, width, height) {
  const rowBytesUnpadded = Math.ceil(width / 8);
  const rowBytes = Math.ceil(rowBytesUnpadded / 4) * 4;
  const pixelDataSize = rowBytes * height;
  const paletteSize = 2 * 4;
  const headerSize = 14 + 40;
  const dataOffset = headerSize + paletteSize;
  const fileSize = dataOffset + pixelDataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  let o = 0;

  // BITMAPFILEHEADER
  view.setUint8(o++, 0x42); // 'B'
  view.setUint8(o++, 0x4d); // 'M'
  view.setUint32(o, fileSize, true);
  o += 4;
  view.setUint32(o, 0, true);
  o += 4; // reserved
  view.setUint32(o, dataOffset, true);
  o += 4;

  // BITMAPINFOHEADER
  view.setUint32(o, 40, true);
  o += 4;
  view.setInt32(o, width, true);
  o += 4;
  view.setInt32(o, height, true); // positive = bottom-up
  o += 4;
  view.setUint16(o, 1, true); // planes
  o += 2;
  view.setUint16(o, 1, true); // bitCount
  o += 2;
  view.setUint32(o, 0, true); // BI_RGB
  o += 4;
  view.setUint32(o, pixelDataSize, true);
  o += 4;
  view.setInt32(o, 2835, true); // ~72 DPI
  o += 4;
  view.setInt32(o, 2835, true);
  o += 4;
  view.setUint32(o, 2, true); // colors used
  o += 4;
  view.setUint32(o, 2, true); // colors important
  o += 4;

  // Palette: index 0 = paper, index 1 = ink
  for (const c of PAPER_BGRA) view.setUint8(o++, c);
  for (const c of INK_BGRA) view.setUint8(o++, c);

  // Pixel data, bottom-up, MSB-first bit packing
  const bytes = new Uint8Array(buffer, dataOffset, pixelDataSize);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const rowOffset = y * rowBytes;
    const srcRowBase = srcY * width;
    for (let x = 0; x < width; x++) {
      if (inkBuffer[srcRowBase + x]) {
        const byteIndex = rowOffset + (x >> 3);
        const bit = 7 - (x & 7);
        bytes[byteIndex] |= 1 << bit;
      }
    }
  }

  return new Blob([buffer], { type: 'image/bmp' });
}
