// Compact fallback badges use only declared source fields and recognizable
// release tokens. URLs and unknown values never become labels or cache claims.
export function getStreamPresentationBadges(stream = {}) {
  const raw = stream.raw || {};
  const presentation = stream.streamPresentation || raw.streamPresentation || {};
  const parsed = raw.parsed || stream.clientResolve?.stream?.raw?.parsed || {};
  const list = (value) => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []);
  const fields = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
    stream.quality,
    presentation.resolution,
    presentation.quality,
    presentation.encode,
    parsed.resolution,
    parsed.codec,
    ...list(presentation.visualTags),
    ...list(presentation.audioTags),
    ...list(presentation.languages),
    ...list(parsed.languages)
  ];
  const source = fields
    .flat()
    .filter((v) => typeof v === "string")
    .join(" ")
    .replace(/https?:\/\/\S+/gi, "")
    .slice(0, 4096);
  let text = source;
  try {
    text = source.normalize("NFKC");
  } catch (_) {}
  const labels = [];
  const add = (label) => {
    if (label && !labels.includes(label)) labels.push(label);
  };
  const resolution = text.match(/\b(2160|1440|1080|720|576|480|360)\s*p\b/i);
  if (resolution) add(resolution[1] + "p");
  else if (/\b(?:4k|uhd|p2160)\b/i.test(text)) add("2160p");
  else if (/\bfhd\b/i.test(String(stream.name || ""))) add("1080p");
  else if (/\bhd\b/i.test(String(stream.name || ""))) add("720p");
  if (/\b(?:hevc|[hx][ .-]?265)\b/i.test(text)) add("HEVC");
  else if (/\b(?:avc|[hx][ .-]?264)\b/i.test(text)) add("H.264");
  else if (/\bav1\b/i.test(text)) add("AV1");
  if (/\b(?:dolby[ .-]?vision|dovi|dv)\b/i.test(text)) add("Dolby Vision");
  if (/\bhdr10\+|\bhdr10plus\b/i.test(text)) add("HDR10+");
  else if (/\bhdr10\b/i.test(text)) add("HDR10");
  else if (/\bhdr\b/i.test(text)) add("HDR");
  if (/\batmos\b/i.test(text)) add("Atmos");
  else if (/\btrue[ .-]?hd\b/i.test(text)) add("TrueHD");
  else if (/\bdts\b/i.test(text)) add("DTS");
  else if (/\b(?:ddp|eac3|e[ .-]?ac[ .-]?3)\b|dd\+/i.test(text)) add("DD+");
  if (/🇫🇷|\b(?:fr|fra|fre|french|français|vf|vff|vfi)\b/i.test(text)) add("FR");
  if (/🇬🇧|🇺🇸|\b(?:en|eng|english|anglais)\b/i.test(text)) add("EN");
  if (/\bmulti\b/i.test(text)) add("MULTI");
  const provider = stream.debridCacheStatus?.providerId || stream.clientResolve?.service || "";
  if (/^torbox$/i.test(provider) || /\btorbox\b|(?:\[|\()tb\+?(?:\]|\))/i.test(text)) add("TorBox");
  if (presentation.cached === true || stream.debridCacheStatus?.status === "cached")
    add("En cache");
  return labels.slice(0, 9);
}

export function getDeclaredStreamBadges(stream = {}) {
  const declared = stream.badges?.length ? stream.badges : stream.raw?.badges;
  return Array.isArray(declared)
    ? declared.filter((badge) => badge && typeof badge === "object").slice(0, 9)
    : [];
}
