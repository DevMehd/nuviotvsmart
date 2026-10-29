import { glImageUrl } from "../../imagePipeline.js";

// Hero copy of the WebGL Home (lot W3): logo or title, two meta lines, description, laid out in
// Lightning nodes from the widths each text node reports on `loaded`, bottom-up above the rows.
// Mobile reference HomeHeroSection.kt / HomeHeroMetaRows.kt, TV sizes ≈ dp × 2 and sp × 1.75–2.

export const HERO_COPY = {
  x: 220,
  // DOM copy bottom: 1080 − 561.6 (rows viewport) − 32.
  bottom: 486,
  width: 1000,
  // Mobile logo box (ratio 2.6), Fit, left aligned.
  logo: { w: 600, h: 230, width: 480 },
  title: { fontSize: 64, lineHeight: 76, maxLines: 2 },
  // Meta line height, also the badge height.
  line: 40,
  meta: 26,
  dot: 6,
  // Between a token and a dot (mobile 8 dp around a 4 dp dot).
  gap: 14,
  // 14 dp before the meta, 10 dp under it.
  brandGap: 28,
  lineGap: 12,
  descriptionGap: 20,
  description: { fontSize: 26, lineHeight: 36, maxLines: 2, alpha: 0.72 },
  badge: { padX: 16, fontSize: 22, border: 2, radius: 12, alpha: 0.55 },
  imdb: { w: 48, h: 24, gap: 10, color: 0xf5c518ff },
  rating: { icon: 36, imdbIcon: 48, gap: 12, between: 28 }
};

/**
 * Meta tokens of buildModernHeroPresentation, in the DOM order (renderModernHeroPrimary and
 * renderModernHeroSecondary): dots between all tokens of a line.
 */
export function heroCopyLines(display) {
  const imdb = { type: "imdb", text: display.imdbText };
  const primary = [...display.leadingMeta, ...display.trailingMeta]
    .filter(Boolean)
    .map((text) => ({ type: "text", text: String(text), style: "meta" }));
  if (display.showImdbPrimary) primary.push(imdb);
  const secondary = [];
  if (display.secondaryHighlightText)
    secondary.push({ type: "text", text: display.secondaryHighlightText, style: "highlight" });
  display.badges.forEach((text) => secondary.push({ type: "badge", text }));
  if (display.showImdbSecondary) secondary.push(imdb);
  if (display.languageText)
    secondary.push({ type: "text", text: display.languageText, style: "detail" });
  if (display.mdbListItems?.length)
    secondary.push({ type: "ratings", items: display.mdbListItems });
  return { primary, secondary };
}

/**
 * `deps`: `parent`; `node(props)`, `text(props)` (a weight-600 or 400 text node, canvas renderer
 * for text outside the atlas); `shader(props)` (RoundedWithBorder); `slot(node, alpha, onState)`
 * (imageSlot); `tween`, `settle`; `colors`; `fade` (motion settings or null). The block stays
 * hidden until every text of the current hero has reported its size, then fades in. `x`: left
 * edge (the rails' content start), HERO_COPY.x by default.
 */
export function createHeroCopy(deps) {
  const { node, colors } = deps;
  const C = HERO_COPY;
  const measured = new WeakMap();
  const block = node({ parent: deps.parent, x: deps.x ?? C.x, color: 0, alpha: 0 });
  const logo = node({ parent: block, w: C.logo.w, h: C.logo.h });
  let logoReady = false;
  let logoUrl = "";
  const logoSlot = deps.slot(logo, 0.01, (state) => {
    if (state === "loading" || state === "empty") return void (logoReady = false);
    logoReady = state === "loaded";
    if (logoReady) {
      // Fit in the mobile box without distortion, anchored bottom left by layout().
      const { w = C.logo.w, h = C.logo.h } = logo.texture?.dimensions || {};
      const scale = Math.min(C.logo.w / w, C.logo.h / h);
      logo.w = Math.round(w * scale);
      logo.h = Math.round(h * scale);
      deps.tween(logo, "alpha", 1, deps.fade);
    } else logoSlot.src = "";
    layout();
  });
  let parts = null;
  let signature = "";
  let shown = false;
  // Previous copy of the same title, kept on screen while its enriched copy is measured.
  let stale = [];
  // Full-screen trailer (lot W5): meta lines and description hidden, the logo or title stays.
  let metaHidden = false;

  function measure(textNode) {
    const done = (w, h) => {
      measured.set(textNode, { text: textNode.text, w, h });
      layout();
    };
    textNode.on("loaded", (_, payload) => {
      const { w = 0, h = 0 } = payload?.dimensions || {};
      done(w, h);
    });
    textNode.on("failed", () => done(0, 0));
    return textNode;
  }
  const text = (props) => measure(deps.text({ parent: block, forceLoad: true, ...props }));
  const size = (textNode) => {
    if (!textNode.text) return { w: 0, h: 0 };
    const entry = measured.get(textNode);
    return entry && entry.text === textNode.text ? entry : null;
  };

  function dot(parent) {
    return node({
      parent,
      y: (C.line - C.dot) / 2,
      w: C.dot,
      h: C.dot,
      color: 0,
      shader: deps.shader({
        radius: C.dot / 2,
        "border-w": C.dot / 2,
        "border-color": colors.dot
      })
    });
  }

  function icon(parent, src, w, h) {
    return node({
      parent,
      src,
      w,
      h,
      y: (C.line - h) / 2,
      textureOptions: { resizeMode: { type: "contain" } }
    });
  }

  /** One token: a group and how to lay it out once its texts are measured (returns its width). */
  function token(line, spec) {
    const group = node({ parent: line, color: 0 });
    const label = (value, props = {}) =>
      text({
        parent: group,
        text: value,
        fontSize: C.meta,
        lineHeight: C.line,
        weight: 600,
        maxWidth: C.width,
        ...props
      });
    if (spec.type === "text") {
      const styles = {
        meta: { color: colors.text },
        highlight: { color: colors.text },
        detail: { color: colors.text, alpha: 0.74 }
      };
      const value = label(spec.text, styles[spec.style]);
      return { group, texts: [value], place: () => size(value).w };
    }
    if (spec.type === "badge") {
      const frame = node({
        parent: group,
        h: C.line,
        color: 0,
        shader: deps.shader({
          radius: C.badge.radius,
          "border-w": C.badge.border,
          "border-color": colors.badge
        })
      });
      const value = label(spec.text, { x: C.badge.padX, fontSize: C.badge.fontSize });
      return {
        group,
        texts: [value],
        place: () => (frame.w = size(value).w + 2 * C.badge.padX)
      };
    }
    if (spec.type === "imdb") {
      icon(group, "assets/icons/imdb_logo_2016.svg", C.imdb.w, C.imdb.h);
      const value = label(spec.text, { x: C.imdb.w + C.imdb.gap, color: C.imdb.color });
      return { group, texts: [value], place: () => value.x + size(value).w };
    }
    // MDBList ratings (homeMdbListRatings.js): icon and value per provider.
    const items = spec.items.map((item) => {
      const side = item.provider === "imdb" ? C.rating.imdbIcon : C.rating.icon;
      const image = icon(group, item.icon, side, side);
      return { image, side, value: label(item.text, { color: colors.secondary, weight: 400 }) };
    });
    return {
      group,
      texts: items.map((item) => item.value),
      place: () =>
        items.reduce((x, item, index) => {
          const start = x + (index ? C.rating.between : 0);
          item.image.x = start;
          item.value.x = start + item.side + C.rating.gap;
          return item.value.x + size(item.value).w;
        }, 0)
    };
  }

  function build(display) {
    const key = display.title || "";
    const keep = shown && parts?.key === key;
    const old = block.children.filter((child) => child !== logo && !stale.includes(child));
    if (keep && !stale.length) stale = old;
    else old.forEach((child) => child.destroy());
    if (!keep) dropStale();
    const lines = heroCopyLines(display);
    const lineOf = (specs) => {
      if (!specs.length) return null;
      const group = node({ parent: block, color: 0 });
      return {
        group,
        tokens: specs.map((spec) => token(group, spec)),
        dots: specs.slice(1).map(() => dot(group))
      };
    };
    parts = {
      key,
      title: text({
        text: display.title || "",
        weight: 600,
        maxWidth: C.width,
        ...C.title
      }),
      primary: lineOf(lines.primary),
      secondary: lineOf(lines.secondary),
      description: display.description
        ? text({
            text: display.description,
            weight: 400,
            maxWidth: C.width,
            color: colors.text,
            ...C.description
          })
        : null
    };
    if (stale.length) tops().forEach((top) => (top.alpha = 0));
    else if (metaHidden) metas().forEach((top) => (top.alpha = 0));
  }

  function dropStale() {
    stale.forEach((child) => child.destroy());
    stale = [];
  }

  const metas = () =>
    [parts.description, parts.primary?.group, parts.secondary?.group].filter(Boolean);
  const tops = () => [parts.title, ...metas()];
  const metaAlpha = (top) => (metaHidden ? 0 : top === parts.description ? C.description.alpha : 1);

  function texts() {
    if (!parts) return [];
    const lineTexts = (line) => line?.tokens.flatMap((entry) => entry.texts) || [];
    return [
      parts.title,
      parts.description,
      ...lineTexts(parts.primary),
      ...lineTexts(parts.secondary)
    ].filter((textNode) => textNode?.text);
  }

  /** Bottom-up from C.bottom: description, secondary, primary, then the logo or the title. */
  function layout() {
    if (!parts) return;
    if (!texts().every(size)) {
      if (shown && !stale.length) {
        deps.settle(block);
        block.alpha = 0;
        shown = false;
      }
      return;
    }
    if (stale.length) {
      dropStale();
      // The title's alpha follows the logo below; the description keeps its 0.72.
      tops().forEach((top) => (top.alpha = top === parts.title ? 1 : metaAlpha(top)));
    }
    let y = C.bottom;
    let gap = 0;
    const stack = (height, gapAbove) => {
      y -= gap + height;
      gap = gapAbove;
      return y;
    };
    if (parts.description) parts.description.y = stack(size(parts.description).h, C.descriptionGap);
    for (const line of [parts.secondary, parts.primary]) {
      if (!line) continue;
      let x = 0;
      line.tokens.forEach((entry, index) => {
        if (index) {
          line.dots[index - 1].x = x + C.gap;
          x += 2 * C.gap + C.dot;
        }
        entry.group.x = x;
        x += entry.place();
      });
      line.group.y = stack(C.line, C.lineGap);
    }
    if (parts.primary || parts.secondary) gap = C.brandGap;
    if (logoReady) {
      logo.y = stack(logo.h, 0);
      parts.title.alpha = 0;
    } else {
      parts.title.y = stack(parts.title.text ? size(parts.title).h : 0, 0);
      parts.title.alpha = 1;
    }
    if (!shown) {
      shown = true;
      deps.tween(block, "alpha", 1, deps.fade);
    }
  }

  return {
    block,
    /** `display` of buildModernHeroPresentation, or null to clear. */
    set(display) {
      // Images are not part of the copy: a new backdrop or logo keeps the laid-out texts.
      const next = display
        ? JSON.stringify({ ...display, logo: "", backdrop: "", backdropFallbacks: [] })
        : "";
      const url = display?.logo ? glImageUrl(display.logo, C.logo.width) : "";
      if (url !== logoUrl) {
        deps.settle(logo);
        logoUrl = url;
        logoReady = false;
        logo.w = C.logo.w;
        logo.h = C.logo.h;
        logoSlot.src = url;
      }
      if (next === signature) return layout();
      signature = next;
      if (!display) {
        parts = null;
        deps.settle(block);
        block.alpha = 0;
        shown = false;
        return;
      }
      build(display);
      layout();
    },
    /** Full-screen trailer (DOM tv2-hero-trailer-active): the meta lines and description fade. */
    hideMeta(on, fade) {
      metaHidden = Boolean(on);
      if (parts && !stale.length)
        metas().forEach((top) => deps.tween(top, "alpha", metaAlpha(top), fade));
    },
    parts: () => parts,
    logo
  };
}
