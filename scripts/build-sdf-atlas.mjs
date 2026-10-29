// SDF font atlases of the WebGL Home (lot W3), made from the local TTF files without a browser:
// glyph outlines → coverage (scanline, non-zero winding) → signed distance field (sdfAtlas.js) →
// grayscale PNG + BMFont JSON in assets/fonts/sdf. Deterministic: the node test regenerates them
// and compares with the versioned files. Run `node scripts/build-sdf-atlas.mjs` after changing
// the charset or the fonts.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  ATLAS_FONT_SIZE,
  ATLAS_RANGE,
  ATLAS_WEIGHTS,
  ATLAS_WIDTH,
  BUFFER,
  CHARSET,
  atlasUrls,
  sdfFromAlpha
} from "../js/ui/tv2/render/lightning/sdfAtlas.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_FILES = {
  400: "assets/fonts/jetbrains_sans_regular.ttf",
  600: "assets/fonts/jetbrains_sans_semibold.ttf"
};
const SUB_ROWS = 16;
const CURVE_STEPS = 8;

/** The TrueType tables the atlas needs: metrics, cmap (format 4) and glyf outlines. */
function parseFont(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const u16 = (at) => view.getUint16(at);
  const i16 = (at) => view.getInt16(at);
  const u32 = (at) => view.getUint32(at);
  const table = {};
  for (let i = 0; i < u16(4); i += 1) {
    const record = 12 + 16 * i;
    table[String.fromCharCode(...buffer.subarray(record, record + 4))] = u32(record + 8);
  }
  const longLoca = i16(table.head + 50) === 1;
  const numHMetrics = u16(table.hhea + 34);
  const loca = (glyph) =>
    longLoca ? u32(table.loca + 4 * glyph) : u16(table.loca + 2 * glyph) * 2;

  let cmap = -1;
  for (let i = 0; i < u16(table.cmap + 2); i += 1) {
    const record = table.cmap + 4 + 8 * i;
    const sub = table.cmap + u32(record + 4);
    if (u16(record) === 3 && u16(record + 2) === 1 && u16(sub) === 4) cmap = sub;
  }
  if (cmap < 0) throw Error("font without a Unicode BMP cmap");
  const segments = u16(cmap + 6) / 2;
  const ends = cmap + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const ranges = deltas + 2 * segments;
  function glyphOf(code) {
    for (let i = 0; i < segments; i += 1) {
      if (u16(ends + 2 * i) < code) continue;
      const start = u16(starts + 2 * i);
      if (start > code) return 0;
      const range = u16(ranges + 2 * i);
      const delta = u16(deltas + 2 * i);
      if (!range) return (code + delta) & 0xffff;
      const glyph = u16(ranges + 2 * i + range + 2 * (code - start));
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  }

  /** Contours of `glyph` as point lists ({x, y, on}), composites resolved. */
  function contours(glyph, matrix = [1, 0, 0, 1, 0, 0]) {
    const at = table.glyf + loca(glyph);
    if (loca(glyph + 1) === loca(glyph)) return [];
    const count = i16(at);
    const apply = (x, y) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5]
    ];
    if (count < 0) {
      const out = [];
      let offset = at + 10;
      for (;;) {
        const flags = u16(offset);
        const child = u16(offset + 2);
        offset += 4;
        let dx, dy;
        if (flags & 1) [dx, dy] = [i16(offset), i16(offset + 2)];
        else [dx, dy] = [view.getInt8(offset), view.getInt8(offset + 1)];
        offset += flags & 1 ? 4 : 2;
        if (!(flags & 2)) throw Error("point-matched composite glyphs are not supported");
        const f2 = (o) => i16(o) / 16384;
        let [a, b, c, d] = [1, 0, 0, 1];
        if (flags & 8) [a, d] = [f2(offset), f2(offset)];
        else if (flags & 0x40) [a, d] = [f2(offset), f2(offset + 2)];
        else if (flags & 0x80) [a, b, c, d] = [0, 2, 4, 6].map((n) => f2(offset + n));
        offset += flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
        const [m0, m1, m2, m3, m4, m5] = matrix;
        out.push(
          ...contours(child, [
            m0 * a + m2 * b,
            m1 * a + m3 * b,
            m0 * c + m2 * d,
            m1 * c + m3 * d,
            ...apply(dx, dy)
          ])
        );
        if (!(flags & 0x20)) return out;
      }
    }
    const endPoints = Array.from({ length: count }, (_, i) => u16(at + 10 + 2 * i));
    const total = count ? endPoints[count - 1] + 1 : 0;
    let offset = at + 10 + 2 * count;
    offset += 2 + u16(offset);
    const flags = [];
    while (flags.length < total) {
      const flag = buffer[offset++];
      flags.push(flag);
      if (flag & 8) for (let n = buffer[offset++]; n > 0; n -= 1) flags.push(flag);
    }
    const coords = (shortBit, sameBit) => {
      let value = 0;
      return flags.map((flag) => {
        if (flag & shortBit) value += flag & sameBit ? buffer[offset++] : -buffer[offset++];
        else if (!(flag & sameBit)) {
          value += i16(offset);
          offset += 2;
        }
        return value;
      });
    };
    const xs = coords(2, 16);
    const ys = coords(4, 32);
    const out = [];
    let first = 0;
    for (const last of endPoints) {
      const points = [];
      for (let i = first; i <= last; i += 1) {
        const [x, y] = apply(xs[i], ys[i]);
        points.push({ x, y, on: Boolean(flags[i] & 1) });
      }
      out.push(points);
      first = last + 1;
    }
    return out;
  }

  return {
    unitsPerEm: u16(table.head + 18),
    ascender: i16(table.hhea + 4),
    descender: i16(table.hhea + 6),
    glyphOf,
    advance: (glyph) => u16(table.hmtx + 4 * Math.min(glyph, numHMetrics - 1)),
    contours
  };
}

/** Contour points (with quadratic off-curve points) to line segments. */
function segmentsOf(contour) {
  const lines = [];
  const n = contour.length;
  if (n < 2) return lines;
  // Start on an on-curve point (or the midpoint of two off-curve ones).
  let startIndex = contour.findIndex((point) => point.on);
  let start;
  if (startIndex < 0) {
    start = {
      x: (contour[0].x + contour[1].x) / 2,
      y: (contour[0].y + contour[1].y) / 2,
      on: true
    };
    startIndex = 0;
  } else start = contour[startIndex];
  let current = start;
  let control = null;
  const curveTo = (end) => {
    if (!control) lines.push([current.x, current.y, end.x, end.y]);
    else {
      let [px, py] = [current.x, current.y];
      for (let step = 1; step <= CURVE_STEPS; step += 1) {
        const t = step / CURVE_STEPS;
        const u = 1 - t;
        const x = u * u * current.x + 2 * u * t * control.x + t * t * end.x;
        const y = u * u * current.y + 2 * u * t * control.y + t * t * end.y;
        lines.push([px, py, x, y]);
        [px, py] = [x, y];
      }
    }
    current = end;
    control = null;
  };
  for (let k = 1; k <= n; k += 1) {
    const point = contour[(startIndex + k) % n];
    if (point.on) curveTo(point);
    else {
      // Two off-curve points in a row imply an on-curve point between them.
      if (control) curveTo({ x: (control.x + point.x) / 2, y: (control.y + point.y) / 2 });
      control = point;
    }
  }
  if (control || current !== start) curveTo(start);
  return lines;
}

/** Coverage (0..255) of pixel-space line segments, non-zero winding, 16 sub-rows per pixel. */
export function coverage(lines, width, height) {
  const sum = new Float64Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let sub = 0; sub < SUB_ROWS; sub += 1) {
      const y = row + (sub + 0.5) / SUB_ROWS;
      const crossings = [];
      for (const [x0, y0, x1, y1] of lines) {
        if ((y0 <= y && y < y1) || (y1 <= y && y < y0))
          crossings.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
      }
      crossings.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      for (let i = 0; i < crossings.length - 1; i += 1) {
        winding += crossings[i][1];
        if (!winding) continue;
        const from = Math.max(0, crossings[i][0]);
        const to = Math.min(width, crossings[i + 1][0]);
        for (let col = Math.floor(from); col < to; col += 1)
          sum[row * width + col] += (Math.min(to, col + 1) - Math.max(from, col)) / SUB_ROWS;
      }
    }
  }
  return Uint8ClampedArray.from(sum, (value) => Math.round(Math.min(1, value) * 255));
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}
/** 8-bit grayscale PNG (the SDF shader reads the color channels). */
function png(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1)
    Buffer.from(pixels.buffer, y * width, width).copy(raw, y * (width + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** PNG and JSON of one weight, in the shape the runtime atlas had (sdfAtlas.js history). */
export async function buildSdfAtlas(weight) {
  const font = parseFont(await readFile(path.join(rootDir, FONT_FILES[weight])));
  const scale = ATLAS_FONT_SIZE / font.unitsPerEm;
  const base = Math.ceil(font.ascender * scale);
  const descent = Math.ceil(-font.descender * scale);
  const glyphs = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const char of CHARSET) {
    const glyph = font.glyphOf(char.codePointAt(0));
    if (!glyph && char !== " ") throw Error(`${FONT_FILES[weight]} lacks ${char}`);
    const outline = font.contours(glyph).flatMap(segmentsOf);
    const xs = outline.flatMap(([x0, , x1]) => [x0, x1]);
    const ys = outline.flatMap(([, y0, , y1]) => [y0, y1]);
    const empty = !outline.length;
    const left = empty ? 0 : Math.ceil(-Math.min(...xs) * scale);
    const ascent = empty ? 0 : Math.ceil(Math.max(...ys) * scale);
    const width = empty ? 0 : left + Math.ceil(Math.max(...xs) * scale) + 2 * BUFFER;
    const height = empty ? 0 : ascent + Math.ceil(-Math.min(...ys) * scale) + 2 * BUFFER;
    if (x + width > ATLAS_WIDTH) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    const sdf = empty
      ? null
      : sdfFromAlpha(
          coverage(
            outline.map(([x0, y0, x1, y1]) => [
              BUFFER + left + x0 * scale,
              BUFFER + ascent - y0 * scale,
              BUFFER + left + x1 * scale,
              BUFFER + ascent - y1 * scale
            ]),
            width,
            height
          ),
          width,
          height
        );
    glyphs.push({
      sdf,
      entry: {
        id: char.codePointAt(0),
        char,
        x,
        y,
        width,
        height,
        xoffset: -left - BUFFER,
        yoffset: base - ascent - BUFFER,
        xadvance: Math.round(font.advance(glyph) * scale * 1000) / 1000,
        page: 0,
        chnl: 15
      }
    });
    x += width;
    shelf = Math.max(shelf, height);
  }
  const atlasHeight = y + shelf;
  const pixels = new Uint8Array(ATLAS_WIDTH * atlasHeight);
  for (const { sdf, entry } of glyphs) {
    if (!sdf) continue;
    for (let row = 0; row < entry.height; row += 1)
      pixels.set(
        sdf.subarray(row * entry.width, (row + 1) * entry.width),
        (entry.y + row) * ATLAS_WIDTH + entry.x
      );
  }
  const data = {
    pages: [path.basename(atlasUrls(weight).atlasUrl)],
    chars: glyphs.map((glyph) => glyph.entry),
    kernings: [],
    info: {
      face: "JetBrains Sans",
      size: ATLAS_FONT_SIZE,
      bold: weight >= 600 ? 1 : 0,
      italic: 0,
      charset: CHARSET,
      unicode: 1,
      stretchH: 100,
      smooth: 1,
      aa: 1,
      padding: [BUFFER, BUFFER, BUFFER, BUFFER],
      spacing: [0, 0],
      outline: 0
    },
    common: {
      lineHeight: base + descent,
      base,
      scaleW: ATLAS_WIDTH,
      scaleH: atlasHeight,
      pages: 1,
      packed: 0,
      alphaChnl: 0,
      redChnl: 0,
      greenChnl: 0,
      blueChnl: 0
    },
    distanceField: { fieldType: "sdf", distanceRange: ATLAS_RANGE },
    lightningMetrics: {
      ascender: base,
      descender: -descent,
      lineGap: 0,
      unitsPerEm: ATLAS_FONT_SIZE
    }
  };
  return { png: png(pixels, ATLAS_WIDTH, atlasHeight), json: `${JSON.stringify(data)}\n` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const weight of ATLAS_WEIGHTS) {
    const { atlasUrl, atlasDataUrl } = atlasUrls(weight);
    const { png: image, json } = await buildSdfAtlas(weight);
    await mkdir(path.join(rootDir, path.dirname(atlasUrl)), { recursive: true });
    await writeFile(path.join(rootDir, atlasUrl), image);
    await writeFile(path.join(rootDir, atlasDataUrl), json);
    console.log(`${atlasUrl}: ${image.length} bytes`);
  }
}
