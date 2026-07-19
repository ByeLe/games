import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  throw new Error('Usage: node tools/chroma-key-png.mjs <input.png> <output.png>');
}

const png = readFileSync(inputPath);
const signature = png.subarray(0, 8);
if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw new Error('Input is not a PNG file.');
}

let offset = 8;
let width = 0;
let height = 0;
let colorType = 0;
const idatParts = [];

while (offset < png.length) {
  const length = png.readUInt32BE(offset);
  const type = png.subarray(offset + 4, offset + 8).toString('ascii');
  const data = png.subarray(offset + 8, offset + 8 + length);
  offset += 12 + length;

  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    const bitDepth = data[8];
    colorType = data[9];
    const interlace = data[12];
    if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
      throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`);
    }
  } else if (type === 'IDAT') {
    idatParts.push(data);
  } else if (type === 'IEND') {
    break;
  }
}

const channels = colorType === 6 ? 4 : 3;
const stride = width * channels;
const inflated = zlib.inflateSync(Buffer.concat(idatParts));
const pixels = Buffer.alloc(width * height * 4);
let sourceOffset = 0;
let previous = Buffer.alloc(stride);
let outputOffset = 0;

for (let y = 0; y < height; y += 1) {
  const filter = inflated[sourceOffset];
  sourceOffset += 1;
  const row = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + stride));
  sourceOffset += stride;
  unfilter(row, previous, channels, filter);

  for (let x = 0; x < width; x += 1) {
    const input = x * channels;
    const r = row[input];
    const g = row[input + 1];
    const b = row[input + 2];
    const a = channels === 4 ? row[input + 3] : 255;
    const greenDistance = Math.hypot(r, g - 255, b);
    const greenDominance = g - Math.max(r, b);
    let alpha = a;
    if (g > 180 && r < 90 && b < 90 && greenDominance > 120) {
      alpha = 0;
    } else if (greenDistance < 115 && greenDominance > 65) {
      alpha = Math.max(0, Math.min(255, Math.round((greenDistance - 28) * 3.1)));
    }
    const despelledG = greenDominance > 18 ? Math.min(g, Math.max(r, b) + 8) : g;
    pixels[outputOffset] = alpha < 255 ? Math.round(r * (alpha / 255)) : r;
    pixels[outputOffset + 1] = alpha < 255 ? Math.round(despelledG * (alpha / 255)) : despelledG;
    pixels[outputOffset + 2] = alpha < 255 ? Math.round(b * (alpha / 255)) : b;
    pixels[outputOffset + 3] = alpha;
    outputOffset += 4;
  }

  previous = row;
}

const outputRaw = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y += 1) {
  const rowStart = y * (width * 4 + 1);
  outputRaw[rowStart] = 0;
  pixels.copy(outputRaw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
}

writeFileSync(outputPath, makePng(width, height, outputRaw));

function unfilter(row, previous, bytesPerPixel, filter) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
    const up = previous[i] || 0;
    const upperLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] || 0 : 0;
    if (filter === 1) {
      row[i] = (row[i] + left) & 255;
    } else if (filter === 2) {
      row[i] = (row[i] + up) & 255;
    } else if (filter === 3) {
      row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
    } else if (filter === 4) {
      row[i] = (row[i] + paeth(left, up, upperLeft)) & 255;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter: ${filter}`);
    }
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function makePng(widthValue, heightValue, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(widthValue, 0);
  ihdr.writeUInt32BE(heightValue, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
