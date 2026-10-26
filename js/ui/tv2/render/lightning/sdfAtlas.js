// Font atlas of the WebGL Home (nuv-091, lot B2): JetBrains Sans (already local, see
// css/base.css) rasterised once per run into a single-channel signed distance field, in the
// BMFont JSON shape Lightning's SDF text renderer loads.

export const ATLAS_FONT_SIZE = 40;
export const ATLAS_RANGE = 8;
const BUFFER = ATLAS_RANGE / 2;
const ATLAS_WIDTH = 1024;
const INF = 1e20;

// shortcut: Latin-1 plus French typography only, no kerning; extend if titles show gaps.
const CHARSET = (() => {
  let chars = "ŒœŸ€‘’“”…–—•";
  for (let code = 32; code < 127; code += 1) chars += String.fromCharCode(code);
  for (let code = 160; code < 256; code += 1) chars += String.fromCharCode(code);
  return Array.from(new Set(chars));
})();

// 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher), in place.
function edt1d(grid, offset, stride, length, f, v, z) {
  for (let q = 0; q < length; q += 1) f[q] = grid[offset + q * stride];
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1, k = 0, s = 0; q < length; q += 1) {
    do {
      const r = v[k];
      s = (f[q] - f[r] + q * q - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q += 1) {
    while (z[k + 1] < q) k += 1;
    const r = v[k];
    grid[offset + q * stride] = f[r] + (q - r) * (q - r);
  }
}

function edt(grid, width, height) {
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const v = new Uint16Array(size);
  const z = new Float64Array(size + 1);
  for (let x = 0; x < width; x += 1) edt1d(grid, x, width, height, f, v, z);
  for (let y = 0; y < height; y += 1) edt1d(grid, y * width, 1, width, f, v, z);
}

/**
 * Coverage (0..255 per pixel) to distance bytes: 128 on the edge, above inside, `range` px
 * across the full byte scale, the encoding Lightning's SDF shader decodes.
 */
export function sdfFromAlpha(alpha, width, height, range = ATLAS_RANGE) {
  const outer = new Float64Array(width * height);
  const inner = new Float64Array(width * height);
  for (let i = 0; i < alpha.length; i += 1) {
    const a = alpha[i] / 255;
    outer[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  }
  edt(outer, width, height);
  edt(inner, width, height);
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const outside = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    out[i] = Math.round(255 * (0.5 - outside / range));
  }
  return out;
}

/** Atlas canvas and glyph data for `family`, which must be loadable through document.fonts. */
export async function buildSdfAtlas(family = "JetBrains Sans") {
  const font = `${ATLAS_FONT_SIZE}px "${family}"`;
  await document.fonts.load(font);
  const scratch = document.createElement("canvas");
  scratch.width = ATLAS_FONT_SIZE * 3;
  scratch.height = ATLAS_FONT_SIZE * 3;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  const probe = ctx.measureText("Hg");
  const base = Math.ceil(probe.fontBoundingBoxAscent || ATLAS_FONT_SIZE * 0.8);
  const descent = Math.ceil(probe.fontBoundingBoxDescent || ATLAS_FONT_SIZE * 0.25);

  const glyphs = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const char of CHARSET) {
    const m = ctx.measureText(char);
    const left = Math.ceil(m.actualBoundingBoxLeft || 0);
    const ascent = Math.ceil(m.actualBoundingBoxAscent || 0);
    const glyphWidth = Math.max(0, left + Math.ceil(m.actualBoundingBoxRight || 0));
    const glyphHeight = Math.max(0, ascent + Math.ceil(m.actualBoundingBoxDescent || 0));
    const empty = !glyphWidth || !glyphHeight;
    const width = empty ? 0 : glyphWidth + 2 * BUFFER;
    const height = empty ? 0 : glyphHeight + 2 * BUFFER;
    if (x + width > ATLAS_WIDTH) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    let sdf = null;
    if (!empty) {
      ctx.clearRect(0, 0, width, height);
      ctx.fillText(char, BUFFER + left, BUFFER + ascent);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const alpha = new Uint8ClampedArray(width * height);
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3];
      sdf = sdfFromAlpha(alpha, width, height);
    }
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
        xadvance: m.width,
        page: 0,
        chnl: 15
      }
    });
    x += width;
    shelf = Math.max(shelf, height);
  }
  const atlasHeight = y + shelf;

  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_WIDTH;
  atlas.height = atlasHeight;
  const atlasCtx = atlas.getContext("2d");
  const image = atlasCtx.createImageData(ATLAS_WIDTH, atlasHeight);
  for (const { sdf, entry } of glyphs) {
    if (!sdf) continue;
    for (let row = 0; row < entry.height; row += 1) {
      for (let col = 0; col < entry.width; col += 1) {
        const value = sdf[row * entry.width + col];
        const at = ((entry.y + row) * ATLAS_WIDTH + entry.x + col) * 4;
        image.data[at] = image.data[at + 1] = image.data[at + 2] = value;
        image.data[at + 3] = 255;
      }
    }
  }
  atlasCtx.putImageData(image, 0, 0);

  return {
    canvas: atlas,
    data: {
      pages: ["atlas.png"],
      chars: glyphs.map((glyph) => glyph.entry),
      kernings: [],
      info: {
        face: family,
        size: ATLAS_FONT_SIZE,
        bold: 0,
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
    }
  };
}
