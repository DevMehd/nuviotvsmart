// Synthetic subtitle test data; no media files, accounts or network.
import { deflateSync } from "node:zlib";

const id = (hex) => Buffer.from(hex, "hex");
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
const element = (hex, ...data) => {
  const payload = Buffer.concat(data);
  return Buffer.concat([id(hex), size(payload.length), payload]);
};
const numeric = (hex, value) => element(hex, uint(value));
const text = (hex, value) => element(hex, Buffer.from(value, "utf8"));

export function createEmbeddedTextFixture(options = {}) {
  const codecId = options.codecId || "S_TEXT/UTF8";
  const scaleNs = options.scaleNs || 1000000;
  const ticks = (ms) => (ms * 1000000) / scaleNs;
  const knownCues = [
    { startMs: 1250, endMs: 3500, clusterMs: 1000, text: "Cue iniziale: città" },
    { startMs: 89500, endMs: 91500, clusterMs: 89000, text: "Cue sul confine 90 s" },
    { startMs: 181250, endMs: 183500, clusterMs: 181000, text: "Cue dopo seek" }
  ];
  if (options.cueCount) {
    knownCues.length = 0;
    for (let index = 0; index < options.cueCount; index++) {
      const startMs = 1250 + index * 500;
      knownCues.push({
        startMs,
        endMs: startMs + 400,
        clusterMs: Math.floor(startMs / 1000) * 1000,
        text: `Cue ${index}: città`
      });
    }
  }
  const ebml = element(
    "1a45dfa3",
    numeric("4286", 1),
    numeric("42f7", 1),
    numeric("42f2", 4),
    numeric("42f3", 8),
    text("4282", "matroska"),
    numeric("4287", 4),
    numeric("4285", 2)
  );
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(190000);
  const info = element(
    "1549a966",
    numeric("2ad7b1", scaleNs),
    element("4489", duration),
    text("4d80", "Nuvio test fixture"),
    text("5741", "Nuvio test fixture")
  );
  const encode = (bytes, scope = 1) => {
    if (!options.compression || !((options.compressionScope || 1) & scope)) return bytes;
    if (options.compression === "zlib") return deflateSync(bytes);
    return bytes.subarray(Buffer.byteLength(options.compressionPrefix || "Cue "));
  };
  const encodings = options.compression
    ? element(
        "6d80",
        element(
          "6240",
          numeric("5032", options.compressionScope || 1),
          numeric("5033", options.encrypted ? 1 : 0),
          element(
            "5034",
            numeric("4254", options.compression === "zlib" ? 0 : 3),
            ...(options.compression === "header"
              ? [text("4255", options.compressionPrefix || "Cue ")]
              : [])
          )
        )
      )
    : Buffer.alloc(0);
  const tracks = element(
    "1654ae6b",
    element(
      "ae",
      numeric("d7", 7),
      numeric("73c5", 7001),
      numeric("83", 17),
      text("86", codecId),
      text("22b59c", "ita"),
      text("536e", "Known UTF8 test cues"),
      encodings,
      ...(options.codecPrivate
        ? [element("63a2", encode(Buffer.from(options.codecPrivate), 2))]
        : []),
      ...(options.defaultDurationNs ? [numeric("23e383", options.defaultDurationNs)] : [])
    ),
    ...(options.secondTrack
      ? [
          element(
            "ae",
            numeric("d7", 9),
            numeric("73c5", 7009),
            numeric("83", 17),
            text("86", "S_TEXT/UTF8"),
            text("22b59c", "eng"),
            text("536e", "Second track")
          )
        ]
      : []),
    ...(options.videoIndex || options.videoBytes
      ? [element("ae", numeric("d7", 1), numeric("83", 1), text("86", "V_TEST"))]
      : [])
  );
  const seek = (hex, position) =>
    element("4dbb", element("53ab", id(hex)), numeric("53ac", position));
  const seekHead = (position, infoAt = 0, tracksAt = 0) =>
    options.noSeekHead
      ? Buffer.alloc(0)
      : element(
          "114d9b74",
          seek(options.chainedSeekHead ? "114d9b74" : "1c53bb6b", position),
          ...(options.lateMetadata ? [seek("1549a966", infoAt), seek("1654ae6b", tracksAt)] : [])
        );
  const padding = element("ec", Buffer.alloc(512 * 1024));
  const clusters = knownCues.map((cue) => {
    const timecode = numeric("e7", ticks(cue.clusterMs));
    const clusterPadding = options.lateTimestamp
      ? element("ec", Buffer.alloc(128))
      : Buffer.alloc(0);
    const videoHeader = Buffer.from([0x81, 0, 0, 0x80]);
    const video = options.videoBytes
      ? element("a0", element("a1", videoHeader, Buffer.alloc(options.videoBytes)))
      : Buffer.alloc(0);
    const blockHeader = Buffer.alloc(4);
    blockHeader[0] = 0x87; // TrackNumber 7 as EBML VINT; native index is unknown.
    blockHeader.writeInt16BE(ticks(cue.startMs - cue.clusterMs), 1);
    blockHeader[3] = options.lacing || 0;
    const cueText =
      options.emptyFirstCue && knownCues.indexOf(cue) === 0
        ? ""
        : /ASS|SSA/.test(codecId)
          ? `${knownCues.indexOf(cue)},2,Signs,Speaker,10,20,30,,{\\an8\\i1}${cue.text}, coda`
          : options.markup
            ? `<i>${cue.text}</i><br>Seconda riga`
            : cue.text;
    let payload = encode(Buffer.from(options.inflateBomb ? "X".repeat(100000) : cueText));
    if (options.lacing) {
      const second = encode(Buffer.from(cueText));
      const lace =
        options.lacing === 4
          ? Buffer.from([1])
          : options.lacing === 2
            ? Buffer.from([1, payload.length])
            : Buffer.concat([Buffer.from([1]), size(payload.length)]);
      payload = Buffer.concat([lace, payload, second]);
    }
    const block = element(options.simpleBlock ? "a3" : "a1", blockHeader, payload);
    const group = options.simpleBlock
      ? block
      : element(
          "a0",
          block,
          ...(options.noDuration ? [] : [numeric("9b", ticks(cue.endMs - cue.startMs))]),
          ...(options.vttSettings
            ? [
                element(
                  "75a1",
                  element("a6", numeric("ee", 1), text("a5", options.vttSettings + "\ncue-id\n"))
                )
              ]
            : [])
        );
    const secondHeader = Buffer.from(blockHeader);
    secondHeader[0] = 0x89;
    secondHeader[3] = 0;
    const second = options.secondTrack
      ? element(
          "a0",
          element("a1", secondHeader, Buffer.from("English: " + cue.text)),
          numeric("9b", ticks(cue.endMs - cue.startMs))
        )
      : Buffer.alloc(0);
    const buffer = element("1f43b675", clusterPadding, timecode, video, group, second);
    return {
      buffer: options.unknownClusters
        ? Buffer.concat([
            id("1f43b675"),
            Buffer.from([0xff]),
            clusterPadding,
            timecode,
            video,
            group,
            second
          ])
        : buffer,
      relativePosition: clusterPadding.length + timecode.length + video.length,
      secondRelativePosition: clusterPadding.length + timecode.length + video.length + group.length,
      videoRelativePosition: clusterPadding.length + timecode.length
    };
  });
  const headSize = seekHead(0).length;
  const infoAt = headSize + (options.lateMetadata ? padding.length : 0);
  const tracksAt = infoAt + info.length;
  const secondSeekHead = options.chainedSeekHead
    ? element("114d9b74", seek("1c53bb6b", 0))
    : Buffer.alloc(0);
  const secondSeekAt = headSize + info.length + tracks.length + padding.length;
  const cuesAt = secondSeekAt + secondSeekHead.length;
  const buildCues = (positions) =>
    element(
      "1c53bb6b",
      ...knownCues.map((cue, index) =>
        element(
          "bb",
          numeric("b3", ticks(options.videoIndex ? cue.clusterMs : cue.startMs)),
          element(
            "b7",
            numeric("f7", options.videoIndex ? 1 : 7),
            numeric("f1", positions[index]),
            ...(options.noRelativePosition
              ? []
              : [
                  numeric(
                    "f0",
                    options.videoIndex
                      ? clusters[index].videoRelativePosition
                      : clusters[index].relativePosition
                  )
                ]),
            ...(options.noCueDuration || options.videoIndex
              ? []
              : [numeric("b2", ticks(cue.endMs - cue.startMs))])
          ),
          ...(options.secondTrack && !options.videoIndex
            ? [
                element(
                  "b7",
                  numeric("f7", 9),
                  numeric("f1", positions[index]),
                  numeric("f0", clusters[index].secondRelativePosition),
                  numeric("b2", ticks(cue.endMs - cue.startMs))
                )
              ]
            : [])
        )
      )
    );
  const placeholder = buildCues([0, 0, 0]);
  let position = options.cuesAtEnd ? cuesAt : cuesAt + placeholder.length;
  const positions = clusters.map((cluster) => {
    const start = position;
    position += cluster.buffer.length;
    return start;
  });
  const cues = buildCues(positions);
  const realCuesAt = options.cuesAtEnd ? position : cuesAt;
  const firstSeek = seekHead(options.chainedSeekHead ? secondSeekAt : realCuesAt, infoAt, tracksAt);
  const metadataParts = options.lateMetadata
    ? [firstSeek, padding, info, tracks]
    : [firstSeek, info, tracks, padding];
  const headerPayload = Buffer.concat(
    options.lateMetadata ? [firstSeek] : [firstSeek, info, tracks]
  );
  const segmentPayload = Buffer.concat([
    ...metadataParts,
    ...(options.chainedSeekHead ? [element("114d9b74", seek("1c53bb6b", realCuesAt))] : []),
    ...(options.cuesAtEnd ? [] : [cues]),
    ...clusters.map((cluster) => cluster.buffer),
    ...(options.cuesAtEnd ? [cues] : [])
  ]);
  const segmentHeader = Buffer.concat([id("18538067"), size(segmentPayload.length)]);
  const segmentDataStart = ebml.length + segmentHeader.length;
  const header = Buffer.concat([ebml, segmentHeader, headerPayload]);
  const buffer = Buffer.concat([ebml, segmentHeader, segmentPayload]);
  const range = (start, data) => ({
    start,
    end: start + data.length - 1,
    expectedOffset: 0,
    expectedHex: data.toString("hex")
  });
  return {
    buffer,
    header,
    cues,
    clusters,
    segmentDataStart,
    positions,
    manifest: {
      version: 1,
      sample: "vidaa-embedded-text-access.mkv",
      subtitleOnly: true,
      fileSize: buffer.length,
      trackNumber: 7,
      trackOrdinal: 0,
      codecId,
      timecodeScaleNs: scaleNs,
      knownCues: knownCues.map(({ startMs, endMs, text: cueText }) => ({
        startMs,
        endMs,
        text: cueText
      })),
      ranges: [
        range(0, header),
        range(segmentDataStart + realCuesAt, cues),
        range(segmentDataStart + positions[1], clusters[1].buffer)
      ]
    }
  };
}
