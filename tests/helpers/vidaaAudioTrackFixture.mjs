// Synthetic MKV/MP4 headers with several audio tracks; no media files, accounts or network.
const uint = (value, width = 4) => {
  const data = Buffer.alloc(width);
  data.writeUIntBE(value, 0, width);
  return data;
};
function size(value) {
  for (let width = 1; width <= 4; width++) {
    if (value < 2 ** (7 * width) - 1) return uint(2 ** (7 * width) + value, width);
  }
  throw new Error("Fixture element too large");
}
const ebml = (hex, ...data) => {
  const payload = Buffer.concat(data);
  return Buffer.concat([Buffer.from(hex, "hex"), size(payload.length), payload]);
};
const num = (hex, value) => ebml(hex, uint(value));
const str = (hex, value) => ebml(hex, Buffer.from(value, "utf8"));

/** Matroska audio tracks used by both fixtures, in container order. */
export const AUDIO_TRACKS = [
  { language: "fre", codecId: "A_EAC3", fourcc: "ec-3", channels: 6, name: "VFF" },
  { language: "eng", codecId: "A_TRUEHD", fourcc: "mlpa", channels: 8, name: "" },
  { language: "ita", codecId: "A_AAC", fourcc: "mp4a", channels: 2, name: "Commento regista" }
];

/** MKV: video, the audio tracks above, one subtitle; Tracks after `tracksOffset` padding bytes. */
export function createMkvAudioFixture({ tracksOffset = 0, mediaBytes = 600 * 1024 } = {}) {
  const tracks = ebml(
    "1654ae6b",
    ebml("ae", num("d7", 1), num("83", 1), str("86", "V_MPEGH/ISO/HEVC")),
    ...AUDIO_TRACKS.map((track, index) =>
      ebml(
        "ae",
        num("d7", index + 2),
        num("83", 2),
        str("86", track.codecId),
        str("22b59c", track.language),
        ...(track.name ? [str("536e", track.name)] : []),
        ebml("e1", num("9f", track.channels))
      )
    ),
    ebml("ae", num("d7", 9), num("83", 17), str("86", "S_HDMV/PGS"), str("22b59c", "fre"))
  );
  const info = ebml("1549a966", num("2ad7b1", 1000000));
  const padding = tracksOffset ? ebml("ec", Buffer.alloc(tracksOffset)) : Buffer.alloc(0);
  // SeekHead (fixed width) points at Tracks after the padding.
  const seekHead = (position) =>
    ebml(
      "114d9b74",
      ebml("4dbb", ebml("53ab", Buffer.from("1654ae6b", "hex")), num("53ac", position))
    );
  const tracksAt = seekHead(0).length + info.length + padding.length;
  const media = ebml("1f43b675", num("e7", 0), ebml("a3", Buffer.alloc(mediaBytes)));
  const payload = Buffer.concat([seekHead(tracksAt), info, padding, tracks, media]);
  const header = ebml("1a45dfa3", str("4282", "matroska"));
  return Buffer.concat([header, Buffer.from("18538067", "hex"), size(payload.length), payload]);
}

const box = (type, ...data) => {
  const payload = Buffer.concat(data);
  return Buffer.concat([uint(payload.length + 8), Buffer.from(type, "latin1"), payload]);
};
const full = (type, version, ...data) => box(type, Buffer.from([version, 0, 0, 0]), ...data);
const packedLanguage = (code) =>
  uint(
    ((code.charCodeAt(0) - 0x60) << 10) |
      ((code.charCodeAt(1) - 0x60) << 5) |
      (code.charCodeAt(2) - 0x60),
    2
  );
function trak(
  handler,
  {
    language = "und",
    name = "",
    fourcc = "avc1",
    channels = 2,
    version = 0,
    quickTime = false
  } = {}
) {
  const mdhd =
    version === 1
      ? full("mdhd", 1, Buffer.alloc(28), packedLanguage(language), Buffer.alloc(2))
      : full("mdhd", 0, Buffer.alloc(16), packedLanguage(language), Buffer.alloc(2));
  const hdlr = full(
    "hdlr",
    0,
    Buffer.alloc(4),
    Buffer.from(handler, "latin1"),
    Buffer.alloc(12),
    // QuickTime names are counted (Pascal) strings; ISO names end with NUL.
    quickTime
      ? Buffer.concat([
          uint(Buffer.byteLength(name || "Core Media Audio"), 1),
          Buffer.from(name || "Core Media Audio")
        ])
      : Buffer.from(`${name || (handler === "soun" ? "SoundHandler" : "VideoHandler")}\0`, "utf8")
  );
  const entry =
    handler === "soun"
      ? box(
          fourcc,
          Buffer.alloc(6),
          uint(1, 2),
          Buffer.alloc(8),
          uint(channels, 2),
          uint(16, 2),
          Buffer.alloc(8)
        )
      : box(fourcc, Buffer.alloc(78));
  // A large sample table after stsd: the reader must skip it, not download it.
  const stbl = box(
    "stbl",
    full("stsd", 0, uint(1), entry),
    full("stsz", 0, Buffer.alloc(64 * 1024))
  );
  const minf = box("minf", box(handler === "soun" ? "smhd" : "vmhd", Buffer.alloc(8)), stbl);
  return box(
    "trak",
    full("tkhd", 0, Buffer.alloc(80)),
    box("mdia", mdhd, hdlr, minf),
    box("udta", Buffer.alloc(32))
  );
}

/** MP4: video + the audio tracks above; moov before the media, or after it. */
export function createMp4AudioFixture({
  moovAtEnd = false,
  mediaBytes = 300 * 1024,
  quickTime = false
} = {}) {
  const ftyp = box(
    "ftyp",
    Buffer.from("isom", "latin1"),
    uint(512),
    Buffer.from("isomiso2mp41", "latin1")
  );
  const moov = box(
    "moov",
    full("mvhd", 0, Buffer.alloc(96)),
    trak("vide"),
    ...AUDIO_TRACKS.map((track, index) =>
      trak("soun", {
        ...track,
        version: index === 1 ? 1 : 0,
        name: index === 2 ? track.name : "",
        quickTime
      })
    )
  );
  const mdat = box("mdat", Buffer.alloc(mediaBytes));
  return Buffer.concat(moovAtEnd ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

/** A fetch answering Range requests from `buffer`, recording each request. */
export function rangeTransport(buffer) {
  const calls = [];
  let time = 0;
  const fetchImpl = async (_url, options) => {
    const [, first, last] = /bytes=(\d+)-(\d+)/.exec(options.headers.get("Range"));
    const start = Number(first);
    const end = Math.min(Number(last), buffer.length - 1);
    calls.push({ start, end });
    const headers = new Headers({
      "Content-Range": `bytes ${start}-${end}/${buffer.length}`,
      "Content-Length": String(end - start + 1),
      ETag: '"audio-fixture"'
    });
    return new Response(new Uint8Array(buffer.subarray(start, end + 1)), { status: 206, headers });
  };
  return {
    calls,
    fetchImpl,
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
    bytes: () => calls.reduce((sum, call) => sum + call.end - call.start + 1, 0)
  };
}
