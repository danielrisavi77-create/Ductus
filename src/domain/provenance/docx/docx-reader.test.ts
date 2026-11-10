// DAN-242 (M8.1-P02): bounded ZIP and XML reader for DOCX traces. Written
// before the reader: one table row per input class from the contract on #1836
// (Z1-Z13 ZIP, X1-X8 XML, L1-L2 limits). Every input is invented.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CORPUS_DIR, MANIFEST_FILE } from "../../../../tests/fixtures/docx-corpus/generate";
import { DEFAULT_DOCX_LIMITS, type DocxLimits, DocxRejected, resolveDocxLimits } from "./limits";
import { scanXml, type XmlName } from "./xml";
import { openDocxZip } from "./zip";
import { concat, descriptorFor, extraRecord, type FixtureEntry, fixtureZip } from "./zip.fixture";

const enc = (s: string) => new TextEncoder().encode(s);
const DOC = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="urn:w"><w:body/></w:document>';
const ok: FixtureEntry[] = [
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "word/document.xml", data: DOC },
];

async function readAll(bytes: unknown, limits?: Partial<DocxLimits>): Promise<Map<string, Uint8Array>> {
  const zip = openDocxZip(bytes as Uint8Array, limits);
  const out = new Map<string, Uint8Array>();
  for (const name of zip.names) out.set(name, await zip.read(name));
  return out;
}

async function codeOf(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof DocxRejected) {
      expect(e.message).toBe(e.code);
      return e.code;
    }
    throw e;
  }
  return "OK";
}

type Row = [cls: string, what: string, bytes: unknown, code: string, limits?: Partial<DocxLimits>];
const big = "a".repeat(100_000);
// About 2:1 under raw deflate, so both sides of the boundary are below the default limit.
const noisy = Array.from({ length: 20_000 }, (_, i) => "abcdefghijklmnop"[((i * 7919) ^ (i >> 3)) % 16]).join("");
const valid = fixtureZip(ok);
const timestamp = extraRecord(0x5455, new Uint8Array([1, 0, 0, 0, 0]));
// Version 1, CRC-32 of the header name "a.xml", then the name other readers would show.
const unicodePath = extraRecord(0x7075, concat([new Uint8Array([1, 0x9c, 0x70, 0x28, 0xec]), enc("word/document.xml")]));
const unicodeComment = extraRecord(0x6375, concat([new Uint8Array([1, 0, 0, 0, 0]), enc("komentar")]));

const zipRows: Row[] = [
  ["Z1", "string input", "PK", "INPUT_INVALID"],
  ["Z1", "ArrayBuffer input", new ArrayBuffer(4), "INPUT_INVALID"],
  ["Z1", "array of numbers", [0x50, 0x4b], "INPUT_INVALID"],
  ["Z1", "empty input", new Uint8Array(), "ZIP_INVALID"],
  ["Z1", "one byte over maxInputBytes", valid, "INPUT_TOO_LARGE", { maxInputBytes: valid.length - 1 }],
  ["Z1", "exactly maxInputBytes", valid, "OK", { maxInputBytes: valid.length }],
  ["Z2", "no end record", enc("Izmišljen sadržaj koji nije ZIP."), "ZIP_INVALID"],
  ["Z2", "truncated by one byte", valid.subarray(0, valid.length - 1), "ZIP_INVALID"],
  ["Z2", "data after the comment", fixtureZip(ok, { comment: enc("k"), trailing: enc("xyz") }), "ZIP_INVALID"],
  ["Z2", "data after the end record", fixtureZip(ok, { trailing: enc("x") }), "ZIP_INVALID"],
  ["Z2", "a second end record hidden in the comment", fixtureZip(ok, { comment: fixtureZip([]) }), "ZIP_INVALID"],
  ["Z2", "bytes before the first entry", fixtureZip(ok, { before: enc("prefiks") }), "ZIP_INVALID"],
  ["Z2", "comment that ends at the end", fixtureZip(ok, { comment: enc("izmišljeni komentar") }), "OK"],
  ["Z3", "disk number 1", fixtureZip(ok, { diskNumber: 1 }), "ZIP_UNSUPPORTED"],
  ["Z3", "directory on disk 1", fixtureZip(ok, { cdDisk: 1 }), "ZIP_UNSUPPORTED"],
  ["Z3", "ZIP64 entry count", fixtureZip(ok, { countOnDisk: 0xffff, countTotal: 0xffff }), "ZIP_UNSUPPORTED"],
  ["Z3", "ZIP64 directory offset", fixtureZip(ok, { cdOffset: 0xffffffff }), "ZIP_UNSUPPORTED"],
  ["Z3", "entry starts on disk 1", fixtureZip([{ name: "a.xml", data: "<a/>", diskStart: 1 }]), "ZIP_UNSUPPORTED"],
  ["Z3", "ZIP64 entry start disk", fixtureZip([{ name: "a.xml", data: "<a/>", diskStart: 0xffff }]), "ZIP_UNSUPPORTED"],
  ["Z3", "ZIP64 entry size", fixtureZip([{ name: "a.xml", data: "<a/>", usize: 0xffffffff }]), "ZIP_UNSUPPORTED"],
  ["Z3", "patched data flag", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x20 }]), "ZIP_UNSUPPORTED"],
  ["Z3", "patched data flag only in the local header", fixtureZip([{ name: "a.xml", data: "<a/>", localFlags: 0x20 }]), "ZIP_UNSUPPORTED"],
  ["Z3", "version needed above 6.3", fixtureZip([{ name: "a.xml", data: "<a/>", version: 64 }]), "ZIP_UNSUPPORTED"],
  ["Z3", "version needed above 6.3 only in the local header", fixtureZip([{ name: "a.xml", data: "<a/>", localVersion: 64 }]), "ZIP_UNSUPPORTED"],
  ["Z3", "version needed 6.3", fixtureZip([{ name: "a.xml", data: "<a/>", version: 63 }]), "OK"],
  ["Z3", "high byte of version needed names the host, not the version", fixtureZip([{ name: "a.xml", data: "<a/>", version: 0x0314 }]), "OK"],
  ["Z4", "counts disagree", fixtureZip(ok, { countOnDisk: 1 }), "ZIP_INVALID"],
  ["Z4", "count larger than the directory", fixtureZip(ok, { countOnDisk: 3, countTotal: 3 }), "ZIP_INVALID"],
  ["Z4", "count smaller than the directory", fixtureZip(ok, { countOnDisk: 1, countTotal: 1 }), "ZIP_INVALID"],
  ["Z4", "directory size off by one", fixtureZip(ok, { cdSize: 46 * 2 + 19 + 17 + 1 }), "ZIP_INVALID"],
  ["Z4", "directory offset past the end", fixtureZip(ok, { cdOffset: 1_000_000 }), "ZIP_INVALID"],
  ["Z5", "more entries than maxEntries", valid, "ZIP_TOO_MANY_ENTRIES", { maxEntries: 1 }],
  ["Z5", "exactly maxEntries", valid, "OK", { maxEntries: 2 }],
  ["Z5", "huge declared count, checked before the directory", fixtureZip([], { countOnDisk: 60_000, countTotal: 60_000 }), "ZIP_TOO_MANY_ENTRIES"],
  ["Z7", "same name twice", fixtureZip([...ok, ok[1]]), "ZIP_DUPLICATE"],
  ["Z7", "names that differ only in case", fixtureZip([...ok, { name: "WORD/Document.XML", data: DOC }]), "ZIP_DUPLICATE"],
  ["Z7", "NFC and NFD of one name", fixtureZip([{ name: "word/\u00e9.xml" }, { name: "word/e\u0301.xml" }]), "ZIP_DUPLICATE"],
  ["Z8", "traditional encryption flag", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x1 }]), "ZIP_ENCRYPTED"],
  ["Z8", "strong encryption flag", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x40 }]), "ZIP_ENCRYPTED"],
  ["Z8", "encrypted directory flag", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x2000 }]), "ZIP_ENCRYPTED"],
  ["Z8", "AES method 99", fixtureZip([{ name: "a.xml", data: "<a/>", method: 99 }]), "ZIP_ENCRYPTED"],
  ["Z8", "encryption flag only in the local header", fixtureZip([{ name: "a.xml", data: "<a/>", localFlags: 0x1 }]), "ZIP_ENCRYPTED"],
  ["Z8", "bzip2 method", fixtureZip([{ name: "a.xml", data: "<a/>", method: 12 }]), "ZIP_METHOD"],
  ["Z8", "deflate64 method", fixtureZip([{ name: "a.xml", data: "<a/>", method: 9 }]), "ZIP_METHOD"],
  ["Z9", "part one byte over maxPartBytes", fixtureZip([{ name: "a.xml", data: "x".repeat(11) }]), "ZIP_PART_TOO_LARGE", { maxPartBytes: 10 }],
  ["Z9", "part exactly maxPartBytes", fixtureZip([{ name: "a.xml", data: "x".repeat(10) }]), "OK", { maxPartBytes: 10 }],
  ["Z9", "declared total one byte over", fixtureZip([{ name: "a", data: "123456" }, { name: "b", data: "123456" }]), "ZIP_TOTAL_TOO_LARGE", { maxTotalBytes: 11 }],
  ["Z9", "declared total exactly at the limit", fixtureZip([{ name: "a", data: "123456" }, { name: "b", data: "123456" }]), "OK", { maxTotalBytes: 12 }],
  ["Z10", "compression ratio above maxRatio", fixtureZip([{ name: "a.xml", data: big, method: 8 }]), "ZIP_RATIO"],
  ["Z11", "directory points into an entry", fixtureZip([{ name: "a.xml", data: "<a/>", offset: 5 }]), "ZIP_INVALID"],
  ["Z11", "local name differs from the directory", fixtureZip([{ name: "a.xml", data: "<a/>", localName: "b.xml" }]), "ZIP_INVALID"],
  ["Z11", "local method differs", fixtureZip([{ name: "a.xml", data: "<a/>", localMethod: 8 }]), "ZIP_INVALID"],
  ["Z11", "local CRC differs without a data descriptor", fixtureZip([{ name: "a.xml", data: "<a/>", localCrc: 1 }]), "ZIP_INVALID"],
  ["Z11", "local header past the directory", fixtureZip([{ name: "a.xml", data: "<a/>", offset: 900 }]), "ZIP_INVALID"],
  ["Z11", "entry data runs into the next entry", fixtureZip([{ name: "a.xml", data: big.slice(0, 900), method: 8, csize: 40 }, { name: "b.xml", data: "<b/>" }]), "ZIP_INVALID"],
  ["Z12", "stored sizes disagree", fixtureZip([{ name: "a.xml", data: "<a/>", usize: 5 }]), "ZIP_SIZE_MISMATCH"],
  ["Z12", "stored CRC wrong", fixtureZip([{ name: "a.xml", data: "<a/>", crc: 1, localCrc: 1 }]), "ZIP_CRC"],
  ["Z12", "deflate bomb that declares a small size", fixtureZip([{ name: "a.xml", data: "a".repeat(2_000_000), method: 8, usize: 1000 }]), "ZIP_SIZE_MISMATCH"],
  ["Z12", "deflate shorter than declared", fixtureZip([{ name: "a.xml", data: "<a>izmišljeno</a>", method: 8, usize: 40 }]), "ZIP_SIZE_MISMATCH"],
  ["Z12", "deflate CRC wrong", fixtureZip([{ name: "a.xml", data: "<a/>", method: 8, crc: 1, localCrc: 1 }]), "ZIP_CRC"],
  ["Z12", "corrupt deflate stream", fixtureZip([{ name: "a.xml", raw: new Uint8Array([0xff, 0xff, 0xff, 0xff]), method: 8, usize: 4 }]), "ZIP_INVALID"],
  ["Z12", "truncated deflate stream", fixtureZip([{ name: "a.xml", raw: deflated("<a>izmišljeno, izmišljeno</a>").subarray(0, 6), method: 8, usize: 31 }]), "ZIP_INVALID"],
  ["Z12", "bytes after the end of the deflate stream", fixtureZip([{ name: "a.xml", raw: withTail(deflated("<a/>")), method: 8, usize: 4 }]), "ZIP_INVALID"],
  ["Z13", "empty archive", fixtureZip([]), "OK"],
  ["Z13", "deflated parts", fixtureZip(ok.map((e) => ({ ...e, method: 8 }))), "OK"],
  ["Z13", "directory entry", fixtureZip([{ name: "word/" }, ...ok]), "OK"],
  ["Z13", "data descriptor with signature", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x8, after: descriptorFor("<a/>", true) }, ...ok]), "OK"],
  ["Z13", "data descriptor without signature", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x8, after: descriptorFor("<a/>", false) }]), "OK"],
  ["Z11", "data descriptor flag without a descriptor", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x8 }, ...ok]), "ZIP_INVALID"],
  ["Z11", "data descriptor that disagrees with the directory", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x8, after: descriptorFor("<a/>", true, 1) }]), "ZIP_INVALID"],
  ["Z11", "bytes hidden between two entries", fixtureZip([{ name: "a.xml", data: "<a/>", after: enc("PK\u0003\u0004xx") }, ...ok]), "ZIP_INVALID"],
  ["Z11", "bytes hidden before the central directory", fixtureZip([...ok, { name: "b.xml", data: "<b/>", after: new Uint8Array(4) }]), "ZIP_INVALID"],
  ["Z13", "UTF-8 name flag and Croatian name", fixtureZip([{ name: "word/čćžšđ.xml", data: "<a/>", flags: 0x800 }]), "OK"],
  ["Z6", "non-ASCII name without the UTF-8 flag", fixtureZip([{ name: "word/č.xml", data: "<a/>", flags: 0 }]), "ZIP_PATH"],
  ["Z11", "UTF-8 name flag only in the directory", fixtureZip([{ name: "word/č.xml", data: "<a/>", flags: 0x800, localFlags: 0 }]), "ZIP_INVALID"],
  ["Z11", "UTF-8 name flag only in the local header", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0, localFlags: 0x800 }]), "ZIP_INVALID"],
  ["Z11", "data descriptor flag only in the directory", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x8, localFlags: 0 }, ...ok]), "ZIP_INVALID"],
  ["Z11", "data descriptor flag only in the local header", fixtureZip([{ name: "a.xml", data: "<a/>", localFlags: 0x8, after: descriptorFor("<a/>", true) }]), "ZIP_INVALID"],
  ["Z6", "UTF-8 name with a leading byte order mark", fixtureZip([{ name: "\ufeffword/document.xml", data: "<a/>", flags: 0x800 }]), "ZIP_PATH"],
  ["Z6", "UTF-8 name with a byte order mark inside", fixtureZip([{ name: "word/a\ufeff.xml", data: "<a/>", flags: 0x800 }]), "ZIP_PATH"],
  ["Z13", "UTF-8 name flag on an ASCII name", fixtureZip([{ name: "a.xml", data: "<a/>", flags: 0x800 }]), "OK"],
  ["Z6", "directory entry with data", fixtureZip([{ name: "word/", data: "x" }]), "ZIP_INVALID"],
  // Info-ZIP Unicode Path (0x7075) renames the entry in readers that honour it,
  // and Unicode Comment (0x6375) is the same mechanism; the extra field is read
  // as whole records so that neither can hide behind a malformed one (#1851).
  ["Z6", "Unicode Path extra in the directory", fixtureZip([{ name: "a.xml", data: "<a/>", extra: unicodePath, localExtra: new Uint8Array() }]), "ZIP_PATH"],
  ["Z6", "Unicode Path extra only in the local header", fixtureZip([{ name: "a.xml", data: "<a/>", localExtra: unicodePath }]), "ZIP_PATH"],
  ["Z6", "Unicode Path extra after a harmless record", fixtureZip([{ name: "a.xml", data: "<a/>", extra: concat([timestamp, unicodePath]) }]), "ZIP_PATH"],
  ["Z3", "Unicode Comment extra in the directory", fixtureZip([{ name: "a.xml", data: "<a/>", extra: unicodeComment, localExtra: new Uint8Array() }]), "ZIP_UNSUPPORTED"],
  ["Z3", "Unicode Comment extra only in the local header", fixtureZip([{ name: "a.xml", data: "<a/>", localExtra: unicodeComment }]), "ZIP_UNSUPPORTED"],
  ["Z11", "extra record longer than the extra field", fixtureZip([{ name: "a.xml", data: "<a/>", extra: extraRecord(0x5455, "\u0001abcd", 9) }]), "ZIP_INVALID"],
  ["Z11", "local extra record longer than the extra field", fixtureZip([{ name: "a.xml", data: "<a/>", localExtra: concat([timestamp, extraRecord(0x7075, "", 40)]) }]), "ZIP_INVALID"],
  ["Z11", "extra field ends in a partial record header", fixtureZip([{ name: "a.xml", data: "<a/>", extra: concat([timestamp, new Uint8Array([0x75, 0x70, 0])]) }]), "ZIP_INVALID"],
  ["Z13", "extended timestamp extra in both headers", fixtureZip([{ name: "a.xml", data: "<a/>", extra: timestamp }, ...ok]), "OK"],
  ["Z13", "Unicode Path ID only inside another record's data", fixtureZip([{ name: "a.xml", data: "<a/>", extra: extraRecord(0x5455, new Uint8Array([1, 0x75, 0x70, 5, 0])) }]), "OK"],
];

function deflated(s: string): Uint8Array {
  // Same deflate the fixture builder uses, read back out of a one-entry archive.
  const z = fixtureZip([{ name: "a", data: s, method: 8 }]);
  const csize = new DataView(z.buffer).getUint32(18, true);
  return z.subarray(31, 31 + csize);
}
function withTail(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length + 3);
  out.set(b);
  out.set([1, 2, 3], b.length);
  return out;
}

const unsafeNames: (string | Uint8Array)[] = [
  "../izmisljeno.xml", "word/../../izmisljeno.xml", "word/..", "/word/document.xml", "word\\document.xml",
  "C:/word/document.xml", "word/a:b.xml", "word//document.xml", "./word/document.xml", "word/./document.xml",
  "", "/", "word/a\u0000.xml", "word/a\u0001.xml", "word/a\u007f.xml", "word/a\n.xml", new Uint8Array([0x77, 0xff, 0xfe]),
];

describe("DAN-242 ZIP reader: input classes Z1-Z13", () => {
  it.each(zipRows)("%s %s", async (_cls, _what, bytes, code, limits) => {
    expect(await codeOf(() => readAll(bytes, limits))).toBe(code);
  });

  it.each(unsafeNames.map((n) => [n]))("Z6 unsafe name %j is rejected before any part is read", async (name) => {
    expect(await codeOf(() => openDocxZip(fixtureZip([{ name, data: "<a/>" }])))).toBe("ZIP_PATH");
  });

  it("Z10 ratio is checked on the declared sizes, with the limit inclusive", async () => {
    const bytes = fixtureZip([{ name: "a.xml", data: noisy, method: 8 }]);
    const csize = new DataView(bytes.buffer).getUint32(18, true);
    const at = noisy.length / csize;
    expect(at % 1).not.toBe(0);
    expect(await codeOf(() => readAll(bytes, { maxRatio: Math.ceil(at) }))).toBe("OK");
    expect(await codeOf(() => readAll(bytes, { maxRatio: Math.floor(at) }))).toBe("ZIP_RATIO");
  });

  it("Z13 reads back exactly what was written, stored and deflated, by case-insensitive name", async () => {
    const parts = await readAll(fixtureZip([{ name: "word/document.xml", data: DOC, method: 8 }, { name: "b.xml", data: "<b>č</b>" }]));
    expect(new TextDecoder().decode(parts.get("word/document.xml"))).toBe(DOC);
    expect(new TextDecoder().decode(parts.get("b.xml"))).toBe("<b>č</b>");
    const zip = openDocxZip(fixtureZip(ok));
    expect(new TextDecoder().decode(await zip.read("WORD/DOCUMENT.XML"))).toBe(DOC);
    expect(await codeOf(() => zip.read("word/missing.xml"))).toBe("ZIP_NO_PART");
    expect(openDocxZip(fixtureZip([{ name: "word/" }, ...ok])).names).toEqual(["[Content_Types].xml", "word/document.xml"]);
  });

  it("Z13 opens every fixture of the synthetic corpus and lists its parts in file order", async () => {
    const manifest = JSON.parse(readFileSync(join(CORPUS_DIR, MANIFEST_FILE), "utf8")) as { fixtures: { file: string; parts: string[] }[] };
    const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".docx")).sort();
    expect(files).toEqual(manifest.fixtures.map((f) => f.file).sort());
    for (const f of manifest.fixtures) {
      const parts = await readAll(new Uint8Array(readFileSync(join(CORPUS_DIR, f.file))));
      expect([...parts.keys()]).toEqual(f.parts);
      for (const bytes of parts.values()) scanXml(bytes, {}, {});
    }
  });
});

const xmlRows: [cls: string, xml: string | Uint8Array, code: string, limits?: Partial<DocxLimits>][] = [
  ["X1", new Uint8Array([0x3c, 0x61, 0xff, 0x2f, 0x3e]), "XML_ENCODING"],
  ["X1", new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00, 0x2f, 0x00, 0x3e, 0x00]), "XML_ENCODING"],
  ["X1", '<?xml version="1.0" encoding="ISO-8859-1"?><a/>', "XML_ENCODING"],
  ["X1", '<?xml version="1.0" encoding="UTF-16"?><a/>', "XML_ENCODING"],
  ["X1", new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e]), "OK"],
  ["X1", '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<a/>', "OK"],
  ["X1", '<?xml version="1.0" encoding="UTF-8" ?><a/>', "OK"],
  ["X1", "<a>\u0001</a>", "XML_INVALID"],
  ["X1", '<?xml version="1.0" encoding="UTF-8"<a/>', "XML_INVALID"],
  ["X2", '<!DOCTYPE a [<!ENTITY e "izmišljeno">]><a>&e;</a>', "XML_DOCTYPE"],
  ["X2", '<!DOCTYPE a SYSTEM "http://example.invalid/a.dtd"><a/>', "XML_DOCTYPE"],
  ["X2", '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY a "a"><!ENTITY b "&a;&a;&a;&a;">]><a>&b;</a>', "XML_DOCTYPE"],
  ["X2", '<a><!ENTITY e "x"></a>', "XML_DOCTYPE"],
  ["X2", "<a/><!DOCTYPE a>", "XML_DOCTYPE"],
  ["X3", "<a>&e;</a>", "XML_ENTITY"],
  ["X3", "<a>&amp</a>", "XML_ENTITY"],
  ["X3", "<a>a & b</a>", "XML_ENTITY"],
  ["X3", "<a>&#0;</a>", "XML_ENTITY"],
  ["X3", "<a>&#xD800;</a>", "XML_ENTITY"],
  ["X3", "<a>&#x110000;</a>", "XML_ENTITY"],
  ["X3", "<a>&#xFFFE;</a>", "XML_ENTITY"],
  ["X3", "<a>&#x;</a>", "XML_ENTITY"],
  ["X3", "<a>&#12a;</a>", "XML_ENTITY"],
  ["X3", '<a b="&e;"/>', "XML_ENTITY"],
  ["X3", '<a b="&lt;&#x41;&#65;&#x10FFFF;">&amp;&quot;&apos;&gt;&#9;</a>', "OK"],
  ["X4", "<a><?izmisljeno x?></a>", "XML_PI"],
  ["X4", '<?xml-stylesheet href="a.xsl"?><a/>', "XML_PI"],
  ["X4", ' <?xml version="1.0"?><a/>', "XML_PI"],
  ["X4", '<?xml version="1.0"?><?xml version="1.0"?><a/>', "XML_PI"],
  ["X5", "<a><a><a></a></a></a>", "OK", { maxXmlDepth: 3 }],
  ["X5", "<a><a><a><a/></a></a></a>", "XML_DEPTH", { maxXmlDepth: 3 }],
  ["X5", `${"<a>".repeat(DEFAULT_DOCX_LIMITS.maxXmlDepth + 1)}${"</a>".repeat(DEFAULT_DOCX_LIMITS.maxXmlDepth + 1)}`, "XML_DEPTH"],
  ["X6", "", "XML_INVALID"],
  ["X6", "<a>", "XML_INVALID"],
  ["X6", "<a></b>", "XML_INVALID"],
  ["X6", "</a>", "XML_INVALID"],
  ["X6", '<a b="1" b="2"/>', "XML_INVALID"],
  ["X6", "<a/><b/>", "XML_INVALID"],
  ["X6", "x<a/>", "XML_INVALID"],
  ["X6", "<a/>x", "XML_INVALID"],
  ["X6", '<a b="<"/>', "XML_INVALID"],
  ["X6", "<a b=1/>", "XML_INVALID"],
  ["X6", '<a b="1"c="2"/>', "XML_INVALID"],
  ["X6", "<a><!-- x -- y --></a>", "XML_INVALID"],
  ["X6", "<a><!-- x </a>", "XML_INVALID"],
  ["X6", "<a>]]></a>", "XML_INVALID"],
  ["X6", "<a><![CDATA[x</a>", "XML_INVALID"],
  ["X6", "<![CDATA[x]]><a/>", "XML_INVALID"],
  ["X6", "<1a/>", "XML_INVALID"],
  ["X6", "<a:b:c/>", "XML_INVALID"],
  ["X6", "<a", "XML_INVALID"],
  ["X6", '<a\u00a0b="1"/>', "XML_INVALID"],
  ["X6", '<a b\u2003="1"/>', "XML_INVALID"],
  ["X6", '<a b="1"\u00a0/>', "XML_INVALID"],
  ["X6", "<a></a\u00a0>", "XML_INVALID"],
  ["X6", "\u00a0<a/>", "XML_INVALID"],
  ["X6", "<a/>\u3000", "XML_INVALID"],
  ["X6", "<a/>\ufeff", "XML_INVALID"],
  ["X4", '<?xml\u00a0version="1.0"?><a/>', "XML_PI"],
  ["X6", '<?xml version="1.0"\u00a0?><a/>', "XML_INVALID"],
  ["X6", "<a\tb='1'\r\n c=\"2\"\n/>\r\n", "OK"],
  ["X6", "<a>\u00a0</a\t>", "OK"],
  ["X7", "<p:a/>", "XML_NAMESPACE"],
  ["X7", '<a p:b="1"/>', "XML_NAMESPACE"],
  ["X7", '<a xmlns:p=""/>', "XML_NAMESPACE"],
  ["X7", '<a xmlns:xmlns="urn:x"/>', "XML_NAMESPACE"],
  ["X7", '<a xmlns:xml="urn:x"/>', "XML_NAMESPACE"],
  ["X7", '<r><a xmlns:x="urn:x"/><x:b/></r>', "XML_NAMESPACE"],
  ["X7", '<a xmlns:p="urn:x" xmlns:q="urn:x" p:b="1" q:b="2"/>', "XML_INVALID"],
  ["X7", '<a xmlns:p="urn:x" xmlns:p="urn:y"/>', "XML_INVALID"],
  ["X7", '<a xmlns="urn:x" xmlns="urn:x"/>', "XML_INVALID"],
  ["X7", '<a b="1" b="1"/>', "XML_INVALID"],
  ["X7", '<a xmlns:p="urn:x y" xmlns:q="urn:x\ty" p:b="1" q:b="2"/>', "XML_INVALID"],
  ["X7", '<a xmlns:p="urn:x y" xmlns:q="urn:x\r\ny" p:b="1" q:b="2"/>', "XML_INVALID"],
  ["X7", '<a xmlns:p="urn:x\ry" xmlns:q="urn:x\ny" p:b="1" q:b="2"/>', "XML_INVALID"],
  ["X7", '<a xmlns:p="urn:x  y" xmlns:q="urn:x\r\ny" p:b="1" q:b="2"/>', "OK"],
  ["X7", '<a xmlns:p="urn:x\ty" xmlns:q="urn:x&#9;y" p:b="1" q:b="2"/>', "OK"],
  ["X8", '<!-- k --><a><![CDATA[<b>&e;]]><!-- d --></a><!-- e -->\n', "OK"],
];

describe("DAN-242 XML reader: input classes X1-X8", () => {
  it.each(xmlRows)("%s %j", async (_cls, xml, code, limits) => {
    const bytes = typeof xml === "string" ? enc(xml) : xml;
    expect(await codeOf(() => scanXml(bytes, limits ?? {}, {}))).toBe(code);
  });

  it("X7 checks duplicate attributes in time linear in the input, whatever the namespace URI length", () => {
    // One long URI bound to two prefixes and 2000 distinct attributes in it:
    // the check must not copy the URI once per attribute.
    const uri = `urn:${"u".repeat(200_000)}`;
    const attrs = Array.from({ length: 2000 }, (_, k) => ` ${k % 2 ? "p" : "q"}:a${k}="1"`).join("");
    const xml = enc(`<r xmlns:p="${uri}" xmlns:q="${uri}"${attrs}/>`);
    const started = performance.now();
    expect(() => scanXml(xml, {}, {})).not.toThrow();
    expect(performance.now() - started).toBeLessThan(1000);
    const twice = enc(`<r xmlns:p="${uri}" xmlns:q="${uri}"${attrs} q:a1="2"/>`);
    expect(() => scanXml(twice, {}, {})).toThrow(new DocxRejected("XML_INVALID"));
  });

  it("X7 resolves prefixes in scope, rebinding and the default namespace", () => {
    const seen: string[] = [];
    const show = (n: XmlName) => `${n.uri}|${n.local}`;
    scanXml(
      enc('<x:a xmlns:x="urn:1" xmlns="urn:d" b="1" x:c="2" xml:space="preserve"><x:b xmlns:x="urn:2"><d xmlns=""/></x:b><x:e/></x:a>'),
      {},
      {
        open: (el) => seen.push(`<${show(el)} ${el.attributes.map(show).join(",")}`),
        close: (el) => seen.push(`/${show(el)}`),
      },
    );
    expect(seen).toEqual([
      "<urn:1|a |b,urn:1|c,http://www.w3.org/XML/1998/namespace|space",
      "<urn:2|b ",
      "<|d ",
      "/|d",
      "/urn:2|b",
      "<urn:1|e ",
      "/urn:1|e",
      "/urn:1|a",
    ]);
  });

  it("X8 D-198 t. 5: the reader hands out names only, never text or attribute values", () => {
    const events: unknown[] = [];
    scanXml(
      enc('<w:ins xmlns:w="urn:w" w:author="Sintetički Autor" w:date="2026-01-01"><w:t>Izmišljeni tekst</w:t><!--tajno--></w:ins>'),
      {},
      { open: (el) => events.push(el), close: (el) => events.push(el) },
    );
    const seen = JSON.stringify(events);
    for (const secret of ["Sintetički", "2026-01-01", "Izmišljeni", "tajno"]) expect(seen).not.toContain(secret);
  });

  it("errors carry only the code, never the input", async () => {
    const canary = "kanarinac7Qx9";
    for (const run of [
      () => scanXml(enc(`<a>&${canary};</a>`), {}, {}),
      () => scanXml(enc(`<${canary}></b>`), {}, {}),
      () => openDocxZip(fixtureZip([{ name: `../${canary}`, data: canary }])),
    ]) {
      try {
        run();
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(DocxRejected);
        expect(JSON.stringify(e) + String(e) + (e as Error).stack).not.toContain(canary);
      }
    }
  });
});

describe("DAN-242 limits: L1 callers may only tighten, L2 is covered at each limit above", () => {
  it.each([[{ maxEntries: 0 }], [{ maxEntries: -1 }], [{ maxEntries: 1.5 }], [{ maxRatio: Number.NaN }], [{ maxPartBytes: Infinity }], [{ maxXmlDepth: "5" }], [{ maxEntrys: 5 }], [null], ["x"]])(
    "L1 %j is refused",
    async (limits) => {
      expect(await codeOf(() => resolveDocxLimits(limits as Partial<DocxLimits>))).toBe("LIMITS_INVALID");
      expect(await codeOf(() => openDocxZip(valid, limits as Partial<DocxLimits>))).toBe("LIMITS_INVALID");
      expect(await codeOf(() => scanXml(enc("<a/>"), limits as Partial<DocxLimits>, {}))).toBe("LIMITS_INVALID");
    },
  );

  it("L1 a looser limit keeps the default, a tighter one wins, and the defaults cannot be changed", () => {
    expect(resolveDocxLimits({})).toEqual(DEFAULT_DOCX_LIMITS);
    expect(resolveDocxLimits(undefined)).toEqual(DEFAULT_DOCX_LIMITS);
    expect(resolveDocxLimits({ maxEntries: 10 ** 9, maxXmlDepth: 4 })).toEqual({ ...DEFAULT_DOCX_LIMITS, maxXmlDepth: 4 });
    expect(Object.isFrozen(DEFAULT_DOCX_LIMITS)).toBe(true);
  });
});

describe("DAN-242 no network and no outside code", () => {
  it.each(["limits.ts", "zip.ts", "xml.ts"])("%s imports only its own folder and names no network API", (file) => {
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    for (const [, from] of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) expect(from).toMatch(/^\.\/[a-z]+$/);
    expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|require|importScripts|navigator|location)\b|\bimport\s*\(/);
  });
});
