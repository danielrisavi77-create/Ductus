// DAN-242 follow-up to #1851: hardening of ZIP reader edge cases (F-262,
// F-263, F-264). Written before the fix: one table row per input class from the
// contract on #1836, plus the valid neighbours of each class. Every input is
// invented and built here.
import { constants, crc32, deflateRawSync, inflateRawSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DocxRejected } from "./limits";
import { openDocxZip } from "./zip";
import { concat, descriptorFor, extraRecord, type FixtureEntry, fixtureZip } from "./zip.fixture";

const enc = (s: string) => new TextEncoder().encode(s);
const TEXT = "<w:p>izmisljeni odlomak, izmisljeni odlomak, izmisljeni odlomak</w:p>";
const deflated = new Uint8Array(deflateRawSync(enc(TEXT)));
const ok: FixtureEntry[] = [
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "word/document.xml", data: TEXT, method: 8 },
];

/** A ZIP64 end of central directory locator: signature, disk, offset, disk count. */
const locator = (() => {
  const v = new DataView(new ArrayBuffer(20));
  v.setUint32(0, 0x07064b50, true);
  v.setUint32(16, 1, true);
  return new Uint8Array(v.buffer);
})();
const zip64Info = extraRecord(0x0001, new Uint8Array(16));

/** A deflated entry with the data descriptor flag and a matching signed descriptor. */
const described = (over: Partial<FixtureEntry> = {}): FixtureEntry => ({
  name: "word/document.xml",
  data: TEXT,
  method: 8,
  flags: 0x8,
  after: descriptorFor(TEXT, true, undefined, true),
  ...over,
});

type Row = [cls: string, what: string, entries: FixtureEntry[], code: string];
const rows: Row[] = [
  // F-262: one end record only, no ZIP64 and no per-entry text other readers show.
  ["H1", "ZIP64 locator signature at eocd-20, in the last entry comment", [...ok, { name: "a.xml", data: "<a/>", comment: locator }], "ZIP_UNSUPPORTED"],
  ["H2", "ZIP64 locator signature at eocd-20, in the last entry extra field", [...ok, { name: "a.xml", data: "<a/>", extra: extraRecord(0x9999, locator), localExtra: new Uint8Array() }], "ZIP_UNSUPPORTED"],
  ["H2", "locator-like bytes that do not end 20 bytes before the end record", [...ok, { name: "a.xml", data: "<a/>", extra: extraRecord(0x9999, concat([locator, new Uint8Array(1)])) }], "OK"],
  ["H3", "non-empty central directory entry comment", [{ name: "a.xml", data: "<a/>", comment: enc("x") }, ...ok], "ZIP_UNSUPPORTED"],
  ["H4", "ZIP64 extended information extra field in the directory", [{ name: "a.xml", data: "<a/>", extra: zip64Info, localExtra: new Uint8Array() }, ...ok], "ZIP_UNSUPPORTED"],
  ["H4", "ZIP64 extended information extra field in the local header", [{ name: "a.xml", data: "<a/>", localExtra: zip64Info }, ...ok], "ZIP_UNSUPPORTED"],
  // F-263: the deflate stream ends exactly where the compressed data ends.
  ["H5", "bytes after the end of the deflate stream", [{ name: "a.xml", data: TEXT, method: 8, raw: concat([deflated, new Uint8Array([0, 0, 0, 0])]) }, ...ok], "ZIP_INVALID"],
  ["H5", "a second deflate stream after the first", [{ name: "a.xml", data: TEXT, method: 8, raw: concat([deflated, new Uint8Array(deflateRawSync(new Uint8Array()))]) }, ...ok], "ZIP_INVALID"],
  ["H6", "truncated deflate stream", [{ name: "a.xml", data: TEXT, method: 8, raw: deflated.subarray(0, deflated.length - 1) }, ...ok], "ZIP_INVALID"],
  [
    "H6",
    "deflate stream without a final block although all output is there",
    [{ name: "a.xml", data: TEXT, method: 8, raw: new Uint8Array(deflateRawSync(enc(TEXT), { finishFlush: constants.Z_SYNC_FLUSH })) }, ...ok],
    "ZIP_INVALID",
  ],
  ["H5", "deflate stream that ends exactly at the compressed size", [{ name: "a.xml", data: TEXT, method: 8 }, ...ok], "OK"],
  // F-264: with a data descriptor the local header is zero or agrees with the directory.
  ["H7", "data descriptor, local compressed size neither zero nor the directory's", [described({ localCsize: 1 }), ok[0]], "ZIP_INVALID"],
  ["H7", "data descriptor, local uncompressed size neither zero nor the directory's", [described({ localUsize: TEXT.length + 1 }), ok[0]], "ZIP_INVALID"],
  ["H8", "data descriptor, local CRC neither zero nor the directory's", [described({ localCrc: (crc32(TEXT) ^ 1) >>> 0 }), ok[0]], "ZIP_INVALID"],
  ["H7", "data descriptor, local CRC and sizes all zero", [described({ localCrc: 0, localCsize: 0, localUsize: 0 }), ok[0]], "OK"],
  ["H7", "data descriptor, local CRC zero and sizes equal to the directory's", [described({ localCrc: 0 }), ok[0]], "OK"],
  ["H7", "data descriptor, local CRC and sizes equal to the directory's", [described(), ok[0]], "OK"],
  ["H9", "stored entry with the data descriptor flag", [{ name: "a.xml", data: "<a/>", flags: 0x8, after: descriptorFor("<a/>", true) }, ...ok], "ZIP_UNSUPPORTED"],
  ["H9", "stored entry with the data descriptor flag and zero local fields", [{ name: "a.xml", data: "<a/>", flags: 0x8, localCrc: 0, localCsize: 0, localUsize: 0, after: descriptorFor("<a/>", false) }, ...ok], "ZIP_UNSUPPORTED"],
];

async function codeOf(bytes: Uint8Array): Promise<string> {
  try {
    const zip = openDocxZip(bytes);
    for (const name of zip.names) await zip.read(name);
  } catch (e) {
    if (e instanceof DocxRejected) return e.code;
    throw e;
  }
  return "OK";
}

describe("DAN-242 ZIP reader edge cases (F-262, F-263, F-264)", () => {
  it.each(rows)("%s %s", async (_cls, _what, entries, code) => {
    expect(await codeOf(fixtureZip(entries))).toBe(code);
  });

  it("H1 the locator rows put the signature exactly 20 bytes before the end record", () => {
    for (const [, what, entries, code] of rows.filter(([cls]) => cls === "H1" || cls === "H2")) {
      const bytes = fixtureZip(entries);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const eocd = bytes.length - 22;
      expect(view.getUint32(eocd, true), what).toBe(0x06054b50);
      expect(view.getUint32(eocd - 20, true) === 0x07064b50, what).toBe(code !== "OK");
    }
  });

  it.each([
    [0, "OK"],
    [4, "ZIP_INVALID"],
    [19, "ZIP_INVALID"],
    [20, "ZIP_UNSUPPORTED"],
  ])("H1 an end record at offset %i is checked without reading before the buffer", async (at, code) => {
    // Leading bytes start with the locator signature; offset 20 is the first that holds one, and below it a
    // refusal code (leading bytes are not an archive), never a read before the buffer, is the expected answer.
    const before = concat([locator, new Uint8Array(20)]).subarray(0, at);
    const bytes = fixtureZip([], { before });
    expect(bytes.length - 22).toBe(at);
    expect(await codeOf(bytes)).toBe(code);
  });

  it("H6 the stream without a final block inflates to the full text, so only the stream end can reject it", () => {
    const raw = deflateRawSync(enc(TEXT), { finishFlush: constants.Z_SYNC_FLUSH });
    expect(inflateRawSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }).toString()).toBe(TEXT);
  });

  it("H5 an archive with a single empty entry and the end record near offset 0 is still read", async () => {
    expect(await codeOf(fixtureZip([{ name: "a.xml", data: "" }]))).toBe("OK");
    expect(await codeOf(fixtureZip([]))).toBe("OK");
  });
});

/** A runtime whose deflate-raw ignores bytes after the final block and a missing final block. */
class LenientDecompressionStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  constructor() {
    const chunks: Uint8Array[] = [];
    const t = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk) => void chunks.push(chunk),
      flush: (c) => c.enqueue(new Uint8Array(inflateRawSync(concat(chunks), { finishFlush: constants.Z_SYNC_FLUSH }))),
    });
    [this.readable, this.writable] = [t.readable, t.writable];
  }
}

describe("DAN-242 F-263 on a runtime that does not enforce the end of the deflate stream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("refuses every deflated part instead of trusting it", async () => {
    vi.resetModules();
    vi.stubGlobal("DecompressionStream", LenientDecompressionStream);
    const { openDocxZip: open } = await import("./zip");
    const trailing = fixtureZip([{ name: "a.xml", data: TEXT, method: 8, raw: concat([deflated, new Uint8Array(4)]) }]);
    for (const bytes of [trailing, fixtureZip(ok)]) {
      const zip = open(bytes);
      const err = await zip.read(zip.names[zip.names.length - 1]).catch((e: unknown) => e);
      // A fresh module graph has its own DocxRejected class, so compare the shape.
      expect(err).toMatchObject({ name: "DocxRejected", code: "ZIP_UNSUPPORTED" });
    }
    // Stored parts do not inflate, so they are still read.
    expect(new TextDecoder().decode(await open(fixtureZip(ok)).read("[Content_Types].xml"))).toBe("<Types/>");
  });
});
