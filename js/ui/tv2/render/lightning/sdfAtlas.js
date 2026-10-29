// Font atlases of the WebGL Home (nuv-091, lot W3): JetBrains Sans regular and semibold (already
// local, see css/base.css) as single-channel signed distance fields in the BMFont JSON shape
// Lightning's SDF text renderer loads. Made from the TTF files by scripts/build-sdf-atlas.mjs
// and versioned in assets/fonts/sdf, so the TV never builds them at startup.

export const ATLAS_FONT_SIZE = 40;
export const ATLAS_RANGE = 8;
export const BUFFER = ATLAS_RANGE / 2;
export const ATLAS_WIDTH = 1024;
const INF = 1e20;

export const ATLAS_WEIGHTS = [400, 600];
/** Same-origin atlas files of one weight. */
export const atlasUrls = (weight) => ({
  atlasUrl: `assets/fonts/sdf/jetbrains-sans-${weight}.png`,
  atlasDataUrl: `assets/fonts/sdf/jetbrains-sans-${weight}.json`
});

// shortcut: Latin-1 plus French typography only, no kerning; any other text is drawn by the
// canvas text renderer (glText). Extend if common titles leave the atlas.
export const CHARSET = (() => {
  let chars = "ŒœŸ€‘’“”…–—•";
  for (let code = 32; code < 127; code += 1) chars += String.fromCharCode(code);
  for (let code = 160; code < 256; code += 1) chars += String.fromCharCode(code);
  // JetBrains Sans has no currency sign ¤ (U+00A4).
  return Array.from(new Set(chars.replace("\u00a4", "")));
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

const GLYPHS = new Set(CHARSET);
// Narrow and non-breaking spaces of French typography are drawn as plain spaces.
const SPACES = /[\u00a0\u2009\u202f]/g;

/**
 * Text as the atlas draws it, and whether it needs the canvas renderer instead (a character the
 * atlas lacks would show as "?": Japanese, Polish, emoji...).
 */
export function glText(value) {
  const text = String(value ?? "").replace(SPACES, " ");
  let canvas = false;
  for (const char of text) if (char !== "\n" && !GLYPHS.has(char)) canvas = true;
  return { text, canvas };
}
