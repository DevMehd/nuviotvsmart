// WebGL 1 layer of the hybrid TV Home (nuv-091, lot B2): textured rounded quads, fixed texture budget.
// It outlives a Home mount, so returning from the player reuses its textures; if the context was
// lost meanwhile, the textures are dropped and uploaded again on the next draw.

// shortcut: 16 MP (64 MB RGBA) is an estimate for a 1 GB TV, calibrate it with the TV Diagnostic.
export const TEXTURE_BUDGET_PIXELS = 16e6;

const VERTEX = `
attribute vec2 a_pos;
uniform vec4 u_rect;
uniform vec2 u_view;
varying vec2 v_pos;
void main() {
  v_pos = a_pos;
  vec2 p = (u_rect.xy + a_pos * u_rect.zw) / u_view;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_pos;
uniform sampler2D u_tex;
uniform vec4 u_uv;
uniform vec4 u_color;
uniform float u_textured;
uniform vec2 u_size;
uniform float u_radius;
uniform float u_alpha;
void main() {
  vec2 q = abs(v_pos * u_size - u_size * 0.5) - (u_size * 0.5 - u_radius);
  float mask = clamp(0.5 - (length(max(q, 0.0)) - u_radius), 0.0, 1.0);
  vec4 color = u_textured > 0.5 ? texture2D(u_tex, mix(u_uv.xy, u_uv.zw, v_pos)) : u_color;
  gl_FragColor = color * (mask * u_alpha);
}`;

const UNIFORMS = [
  "u_rect",
  "u_view",
  "u_uv",
  "u_color",
  "u_textured",
  "u_size",
  "u_radius",
  "u_alpha"
];

/** Texture coordinates of `object-fit: cover` for an image in a box. */
export function coverUv(imageWidth, imageHeight, boxWidth, boxHeight) {
  const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
  const u = boxWidth / scale / imageWidth;
  const v = boxHeight / scale / imageHeight;
  return [(1 - u) / 2, (1 - v) / 2, (1 + u) / 2, (1 + v) / 2];
}

/**
 * Null when WebGL 1 is unavailable. `onEvent(type)` reports "ready" and "failed" textures, and the
 * reasons to leave WebGL: "lost" (context lost) and "budget" (one frame needs more than the budget).
 */
export function createGlLayer(canvas, { budgetPixels = TEXTURE_BUDGET_PIXELS } = {}) {
  let gl = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false
    });
  } catch (_) {}
  if (!gl) return null;

  const textures = new Map(); // url → { state: loading|ready|failed, texture, width, height, pixels, frame, image }
  let uniforms = null;
  let lost = false;
  let frame = 0;
  let usedPixels = 0;
  const emit = (type) => layer.onEvent?.(type);

  function init() {
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT]
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    uniforms = {};
    for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    return true;
  }
  if (!init()) return null;

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault(); // allows the browser to restore it, e.g. once the player frees the GPU
    lost = true;
    for (const [url, entry] of textures) if (entry.state !== "failed") textures.delete(url);
    usedPixels = 0;
    emit("lost");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = !init();
  });

  function fail(url, entry) {
    if (textures.get(url) !== entry) return;
    entry.state = "failed";
    entry.image = null;
    emit("failed");
  }

  function upload(url, entry) {
    if (lost || textures.get(url) !== entry || !entry.image) return;
    const { image } = entry;
    entry.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    } catch (_) {
      // Cross-origin image without CORS: the DOM <img> shows it instead.
      gl.deleteTexture(entry.texture);
      entry.texture = null;
      fail(url, entry);
      return;
    }
    entry.width = image.naturalWidth || image.width || 1;
    entry.height = image.naturalHeight || image.height || 1;
    entry.pixels = entry.width * entry.height;
    entry.state = "ready";
    entry.image = null;
    usedPixels += entry.pixels;
    if (!evict()) emit("ready");
  }

  /** Drops least recently drawn textures over budget; true when the last frame alone exceeds it. */
  function evict() {
    if (usedPixels <= budgetPixels) return false;
    const unused = [...textures]
      .filter(([, entry]) => entry.state === "ready" && entry.frame < frame)
      .sort((a, b) => a[1].frame - b[1].frame);
    for (const [url, entry] of unused) {
      if (usedPixels <= budgetPixels) break;
      gl.deleteTexture(entry.texture);
      usedPixels -= entry.pixels;
      textures.delete(url);
    }
    if (usedPixels <= budgetPixels) return false;
    emit("budget");
    return true;
  }

  function texture(url, load) {
    let entry = textures.get(url);
    if (!entry) {
      entry = { state: "loading", image: new Image(), pixels: 0, frame };
      entry.image.crossOrigin = "anonymous";
      const current = entry;
      entry.image.addEventListener("load", () => upload(url, current));
      entry.image.addEventListener("error", () => fail(url, current));
      textures.set(url, entry);
    }
    entry.frame = frame;
    // Asked again each frame: the queue keeps only the latest request and is cleared between mounts.
    if (entry.state === "loading") load(entry.image, url);
    return entry;
  }

  /** Quads: { x, y, w, h, url?, color? (premultiplied rgba), radius?, alpha?, clipTop? } in CSS px. */
  function draw(quads, load) {
    if (lost) return;
    frame += 1;
    const width = canvas.clientWidth || 1920;
    const height = canvas.clientHeight || 1080;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.scissor(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uniforms.u_view, width, height);
    for (const quad of quads) {
      const entry = quad.url ? texture(quad.url, load) : null;
      const ready = entry?.state === "ready";
      if (!ready && !quad.color) continue;
      gl.scissor(0, 0, width, Math.max(0, height - (quad.clipTop || 0)));
      gl.uniform4f(uniforms.u_rect, quad.x, quad.y, quad.w, quad.h);
      gl.uniform2f(uniforms.u_size, quad.w, quad.h);
      gl.uniform1f(uniforms.u_radius, quad.radius || 0);
      gl.uniform1f(uniforms.u_alpha, quad.alpha ?? 1);
      gl.uniform1f(uniforms.u_textured, ready ? 1 : 0);
      if (ready) {
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.uniform4fv(uniforms.u_uv, coverUv(entry.width, entry.height, quad.w, quad.h));
      } else {
        gl.uniform4fv(uniforms.u_color, quad.color);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    for (const [url, entry] of textures) {
      if (entry.state !== "loading" || entry.frame === frame || entry.image.getAttribute("src"))
        continue;
      load(entry.image, ""); // scrolled away before its turn in the queue, like a recycled DOM card
      textures.delete(url);
    }
  }

  const layer = {
    canvas,
    onEvent: null,
    draw,
    state: (url) => textures.get(url)?.state || "",
    isLost: () => lost || gl.isContextLost(),
    get usedPixels() {
      return usedPixels;
    },
    /** Frees every texture, e.g. when the Home falls back to the DOM. */
    clear() {
      for (const [url, entry] of textures) {
        if (entry.texture && !lost) gl.deleteTexture(entry.texture);
        if (entry.state !== "failed") textures.delete(url);
      }
      usedPixels = 0;
    }
  };
  return layer;
}
