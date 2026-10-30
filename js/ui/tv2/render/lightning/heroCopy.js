import { glImageUrl } from "../../imagePipeline.js";

// Hero copy of the WebGL Home (lot W3): logo or title, two meta lines, description, laid out in
// Lightning nodes from the widths each text node reports on `loaded`, bottom-up above the rows.
// Sizes, colors and gaps of the DOM modern hero (components-16/17.css, measured in headless Chrome
// at 1920×1080: brand box, meta lines, description); weight 500 is drawn in 400 (no 500 atlas).

export const HERO_COPY = {
  x: 220,
  // DOM .home-modern-hero-copy box: top safe 40, bottom at 468; its column ends at the bottom.
  top: 40,
  bottom: 468,
  // --modern-hero-copy-max-width: 42 % of 1920.
  width: 806,
  // --modern-hero-copy-gap between brand, meta lines and description.
  gap: 14.72,
  // .home-hero-logo: 440×200 box, contain, left center.
  logo: { w: 440, h: 200 },
  title: { fontSize: 51.52, lineHeight: 66.24, maxLines: 2, letterSpacing: -1.55 },
  // Meta line height; 40 with a badge (.home-modern-hero-badge min-height).
  line: 32,
  badgeLine: 40,
  meta: 24,
  // .home-modern-hero-meta-line and .home-hero-imdb color.
  metaColor: 0xb3b3b3ff,
  // .home-hero-dot: a 7 px "•" at white 0.34, 43 px from token to token (16 + 11 + 16).
  dot: 7,
  dotGap: 18,
  description: { fontSize: 25.2, lineHeight: 36, maxLines: 4, letterSpacing: 0.5 },
  badge: { padX: 18, fontSize: 18, border: 1, radius: 12, letterSpacing: 0.54 },
  imdb: { w: 40, h: 20, gap: 10 },
  rating: { icon: 36, imdbIcon: 48, gap: 12, between: 28 },
  // A new title: the copy rises from 0.7 and 5 px (homeScreenMethods-05 keyframes), the logo
  // fades as the constrained DOM .home-hero-logo.
  swap: { duration: 160, easing: "ease-out", alpha: 0.7, y: 5 },
  logoFade: { duration: 400, easing: "ease" }
};

/**
 * Meta tokens of buildModernHeroPresentation, in the DOM order (renderModernHeroPrimary and
 * renderModernHeroSecondary): dots between all tokens of a line.
 */
export function heroCopyLines(display) {
  const imdb = { type: "imdb", text: display.imdbText };
  // renderModernHeroPrimary: the leading tokens in one text joined by " • ", then dots.
  const primary = [display.leadingMeta.filter(Boolean).join(" • "), ...display.trailingMeta]
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
  // "none" (no logo: the title), "loading" (the empty logo box, as the DOM: no title meanwhile,
  // WF-15), "loaded", "failed" (the title).
  let logoState = "none";
  let logoUrl = "";
  const logoSlot = deps.slot(logo, 0.01, (state) => {
    // Our own set() reports loading/empty: logoState was set there.
    if (state !== "loaded" && state !== "failed") return;
    logoState = state;
    if (state === "loaded") {
      // Fit in the DOM box without distortion, left and vertically centered by layout().
      const { w = C.logo.w, h = C.logo.h } = logo.texture?.dimensions || {};
      const scale = Math.min(C.logo.w / w, C.logo.h / h);
      logo.w = Math.round(w * scale);
      logo.h = Math.round(h * scale);
      deps.tween(logo, "alpha", 1, deps.fade && C.logoFade);
    } else logoSlot.src = "";
    layout();
  });
  const brandIsLogo = () => logoState === "loading" || logoState === "loaded";
  let parts = null;
  let signature = "";
  let shown = false;
  // Copy on screen, kept while the next one (another title, or the same one enriched) is measured.
  let stale = [];
  // Title of the copy on screen: another one rises in (HERO_COPY.swap), an enrichment does not.
  let shownKey = null;
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

  function dot(parent, lineHeight) {
    return node({
      parent,
      y: (lineHeight - C.dot) / 2,
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

  function icon(parent, src, w, h, lineHeight) {
    const base = globalThis.document?.baseURI;
    return node({
      parent,
      // Absolute, as the font atlases: Lightning failed the relative IMDb SVG under a <base>.
      src: base ? new URL(src, base).href : src,
      w,
      h,
      y: (lineHeight - h) / 2,
      textureOptions: { resizeMode: { type: "contain" } }
    });
  }

  /**
   * One token of a meta line (`first`: the gray primary line, else the secondary one): a group
   * and how to lay it out once its texts are measured (returns its width).
   */
  function token(line, spec, first, lineHeight) {
    const group = node({ parent: line, color: 0 });
    const label = (value, props = {}) =>
      text({
        parent: group,
        text: value,
        fontSize: C.meta,
        lineHeight,
        weight: first ? 400 : 600,
        maxWidth: C.width,
        ...props
      });
    if (spec.type === "text") {
      const styles = {
        meta: { color: C.metaColor },
        highlight: { color: colors.text, letterSpacing: 0.96 },
        detail: { color: colors.text, alpha: 0.74 }
      };
      const value = label(spec.text, styles[spec.style]);
      return { group, texts: [value], place: () => size(value).w };
    }
    if (spec.type === "badge") {
      const frame = node({
        parent: group,
        h: lineHeight,
        color: 0,
        shader: deps.shader({
          radius: C.badge.radius,
          "border-w": C.badge.border,
          "border-color": colors.badge
        })
      });
      const value = label(spec.text, {
        x: C.badge.padX,
        fontSize: C.badge.fontSize,
        letterSpacing: C.badge.letterSpacing,
        color: colors.text
      });
      return {
        group,
        texts: [value],
        place: () => (frame.w = size(value).w + 2 * C.badge.padX)
      };
    }
    if (spec.type === "imdb") {
      icon(group, "assets/icons/imdb_logo_2016.svg", C.imdb.w, C.imdb.h, lineHeight);
      const value = label(spec.text, { x: C.imdb.w + C.imdb.gap, color: C.metaColor });
      return { group, texts: [value], place: () => value.x + size(value).w };
    }
    // MDBList ratings (homeMdbListRatings.js): icon and value per provider.
    const items = spec.items.map((item) => {
      const side = item.provider === "imdb" ? C.rating.imdbIcon : C.rating.icon;
      const image = icon(group, item.icon, side, side, lineHeight);
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
    const old = block.children.filter((child) => child !== logo && !stale.includes(child));
    // The copy on screen stays until the new one is measured; one never shown goes at once.
    if (shown && !stale.length) stale = old;
    else old.forEach((child) => child.destroy());
    if (!shown) dropStale();
    const lines = heroCopyLines(display);
    const lineOf = (specs, first) => {
      if (!specs.length) return null;
      const height = specs.some((spec) => spec.type === "badge") ? C.badgeLine : C.line;
      const group = node({ parent: block, color: 0 });
      return {
        group,
        height,
        tokens: specs.map((spec) => token(group, spec, first, height)),
        dots: specs.slice(1).map(() => dot(group, height))
      };
    };
    const primary = lineOf(lines.primary, true);
    const secondary = lineOf(lines.secondary, false);
    // The DOM description shrinks into what the copy box leaves (4 lines at most): the brand
    // counts as the logo box, or two title lines.
    const brand = display.logo ? C.logo.h : C.title.lineHeight * C.title.maxLines;
    const above = [primary, secondary].reduce(
      (sum, line) => sum + (line ? line.height + C.gap : 0),
      brand + C.gap
    );
    const maxLines = Math.max(
      1,
      Math.min(
        C.description.maxLines,
        Math.floor((C.bottom - C.top - above) / C.description.lineHeight)
      )
    );
    parts = {
      key,
      title: text({
        text: display.title || "",
        weight: 600,
        maxWidth: C.width,
        ...C.title
      }),
      primary,
      secondary,
      description: display.description
        ? text({
            text: display.description,
            weight: 400,
            maxWidth: C.width,
            // .home-hero-description: #fff, not the theme text color.
            color: 0xffffffff,
            ...C.description,
            maxLines
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
  const metaAlpha = () => (metaHidden ? 0 : 1);

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

  /**
   * Bottom-up from C.bottom, as the DOM column ends there: description, secondary, primary, then
   * the logo box (logo centered in it) or the title, C.gap apart.
   */
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
    const rises = Boolean(stale.length) && shownKey !== parts.key;
    if (stale.length) {
      dropStale();
      // The title's alpha follows the logo below.
      tops().forEach((top) => (top.alpha = top === parts.title ? 1 : metaAlpha()));
    }
    let y = C.bottom;
    let gap = 0;
    const stack = (height) => {
      y -= gap + height;
      gap = C.gap;
      return Math.round(y);
    };
    if (parts.description) parts.description.y = stack(size(parts.description).h);
    for (const line of [parts.secondary, parts.primary]) {
      if (!line) continue;
      let x = 0;
      line.tokens.forEach((entry, index) => {
        if (index) {
          line.dots[index - 1].x = x + C.dotGap;
          x += 2 * C.dotGap + C.dot;
        }
        entry.group.x = x;
        x += entry.place();
      });
      line.group.y = stack(line.height);
    }
    if (brandIsLogo()) {
      const box = stack(C.logo.h);
      logo.y = box + Math.round((C.logo.h - logo.h) / 2);
      parts.title.alpha = 0;
    } else {
      parts.title.y = stack(parts.title.text ? size(parts.title).h : 0);
      parts.title.alpha = 1;
    }
    shownKey = parts.key;
    if (!shown) {
      shown = true;
      deps.tween(block, "alpha", 1, deps.fade);
    } else if (rises && deps.fade) {
      // Another title (WF-10): from 0.7 and 5 px lower, never through an empty frame.
      const { alpha, y: rise, ...settings } = C.swap;
      deps.settle(block);
      block.alpha = alpha;
      block.y = rise;
      deps.tween(block, "alpha", 1, settings);
      deps.tween(block, "y", 0, settings);
    }
  }

  return {
    block,
    logo,
    /** `display` of buildModernHeroPresentation, or null to clear. */
    set(display) {
      // Images are not part of the copy: a new backdrop or logo keeps the laid-out texts.
      const next = display
        ? JSON.stringify({ ...display, logo: "", backdrop: "", backdropFallbacks: [] })
        : "";
      const url = display?.logo ? glImageUrl(display.logo, C.logo.w) : "";
      if (url !== logoUrl) {
        deps.settle(logo);
        logoUrl = url;
        logoState = url ? "loading" : "none";
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
        shownKey = null;
        dropStale();
        return;
      }
      build(display);
      layout();
    },
    /** Full-screen trailer (DOM tv2-hero-trailer-active): the meta lines and description fade. */
    hideMeta(on, fade) {
      metaHidden = Boolean(on);
      if (parts && !stale.length)
        metas().forEach((top) => deps.tween(top, "alpha", metaAlpha(), fade));
    },
    parts: () => parts
  };
}
