// M8.1-P01 (DAN-242): deterministic generator of the synthetic DOCX corpus and
// its manifest. Every name and sentence is invented (skill ductus-synthetic-data).
// No network, no clock, no compression library: entries are stored, so the bytes
// depend only on this file and not on the zlib build or the time zone.
// Write the corpus: node tests/fixtures/docx-corpus/generate.ts
// Compare only:     node tests/fixtures/docx-corpus/generate.ts --check
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CORPUS_DIR = dirname(fileURLToPath(import.meta.url));
export const MANIFEST_FILE = "MANIFEST.json";
export const INVENTED_NAMES = ["Sintetički Autor", "Izmišljena Mentorica"] as const;

/** Expected traces, declared by hand per fixture and never computed from the XML. */
export interface Traces {
  ins: number;
  del: number;
  comments: number;
  rsidAttributes: number;
  coreProperties: string[];
}
interface Spec {
  file: string;
  parts: [name: string, xml: string][];
  text: string[];
  traces: Traces;
  sameTextAs?: string;
}

const [AUTHOR, MENTOR] = INVENTED_NAMES;
const DATE = "2026-01-01T12:00:00Z";
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const PKG = "http://schemas.openxmlformats.org/package/2006";
const OFF = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.wordprocessingml";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const run = (text: string, attrs = "") => `<w:r${attrs}><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const p = (inner: string, attrs = "") => `<w:p${attrs}>${inner}</w:p>`;
const mark = (tag: string, id: number) => `<w:${tag} w:id="${id}" w:author="${esc(AUTHOR)}" w:date="${DATE}">`;
const ins = (id: number, text: string) => `${mark("ins", id)}${run(text)}</w:ins>`;
const del = (id: number, text: string) =>
  `${mark("del", id)}<w:r><w:delText xml:space="preserve">${esc(text)}</w:delText></w:r></w:del>`;
const commented = (id: number, text: string) =>
  `<w:commentRangeStart w:id="${id}"/>${run(text)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;

const documentXml = (paragraphs: string[], decl = DECL) => `${decl}<w:document ${W}><w:body>${paragraphs.join("")}</w:body></w:document>`;
const commentsXml = (texts: string[]) =>
  `${DECL}<w:comments ${W}>${texts
    .map((t, id) => `<w:comment w:id="${id}" w:author="${esc(MENTOR)}" w:date="${DATE}" w:initials="IM">${p(run(t))}</w:comment>`)
    .join("")}</w:comments>`;
const SETTINGS_RSID = `${DECL}<w:settings ${W}><w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00A1B2C3"/><w:rsid w:val="00D4E5F6"/></w:rsids></w:settings>`;
const CORE = `${DECL}<cp:coreProperties xmlns:cp="${PKG}/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Izmišljeni naslov rada</dc:title><dc:creator>${esc(AUTHOR)}</dc:creator><cp:lastModifiedBy>${esc(MENTOR)}</cp:lastModifiedBy><cp:revision>3</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${DATE}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-02T09:30:00Z</dcterms:modified></cp:coreProperties>`;

/** [Content_Types].xml, _rels/.rels and, when needed, word/_rels/document.xml.rels for the listed extra parts. */
function packageParts(extra: { comments?: boolean; settings?: boolean; core?: boolean }): [string, string][] {
  const overrides = [`<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>`];
  const docRels: string[] = [];
  if (extra.comments) {
    overrides.push(`<Override PartName="/word/comments.xml" ContentType="${CT}.comments+xml"/>`);
    docRels.push(`<Relationship Id="rId${docRels.length + 1}" Type="${OFF}/comments" Target="comments.xml"/>`);
  }
  if (extra.settings) {
    overrides.push(`<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>`);
    docRels.push(`<Relationship Id="rId${docRels.length + 1}" Type="${OFF}/settings" Target="settings.xml"/>`);
  }
  if (extra.core) overrides.push(`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`);
  const rootRels = [`<Relationship Id="rId1" Type="${OFF}/officeDocument" Target="word/document.xml"/>`];
  if (extra.core) rootRels.push(`<Relationship Id="rId2" Type="${PKG}/relationships/metadata/core-properties" Target="docProps/core.xml"/>`);
  const rels = (r: string[]) => `${DECL}<Relationships xmlns="${PKG}/relationships">${r.join("")}</Relationships>`;
  const out: [string, string][] = [
    ["[Content_Types].xml", `${DECL}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`],
    ["_rels/.rels", rels(rootRels)],
  ];
  if (docRels.length > 0) out.push(["word/_rels/document.xml.rels", rels(docRels)]);
  return out;
}

const CLEAN = ["Ovo je izmišljeni ulomak o sintetičkom istraživanju.", "Drugi odlomak, također izmišljen, bez stvarnih podataka."];
const none: Traces = { ins: 0, del: 0, comments: 0, rsidAttributes: 0, coreProperties: [] };
const doc = (paragraphs: string[]): [string, string] => ["word/document.xml", documentXml(paragraphs)];

export const SPECS: Spec[] = [
  { file: "01-clean.docx", parts: [...packageParts({}), doc(CLEAN.map((t) => p(run(t))))], text: CLEAN, traces: none },
  {
    file: "02-ins.docx",
    parts: [...packageParts({}), doc([p(run("Izmišljena rečenica ") + ins(1, "s umetnutim dijelom") + run(".")), p(ins(2, "Cijeli umetnuti odlomak."))])],
    text: ["Izmišljena rečenica s umetnutim dijelom.", "Cijeli umetnuti odlomak."],
    traces: { ...none, ins: 2 },
  },
  {
    file: "03-del.docx",
    parts: [...packageParts({}), doc([p(run("Rečenica ") + del(1, "bez obrisanog dijela ") + run("ostaje kratka."))])],
    text: ["Rečenica ostaje kratka."],
    traces: { ...none, del: 1 },
  },
  {
    file: "04-comment.docx",
    parts: [...packageParts({ comments: true }), doc([p(commented(0, "Odlomak s izmišljenim komentarom."))]), ["word/comments.xml", commentsXml(["Izmišljeni komentar uz odlomak."])]],
    text: ["Odlomak s izmišljenim komentarom."],
    traces: { ...none, comments: 1 },
  },
  {
    file: "05-rsid.docx",
    parts: [
      ...packageParts({ settings: true }),
      doc([p(run("Odlomak s oznakama uređivanja.", ' w:rsidRPr="00D4E5F6"'), ' w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3"'), p(run("Drugi odlomak iz druge sesije."), ' w:rsidR="00D4E5F6"')]),
      ["word/settings.xml", SETTINGS_RSID],
    ],
    text: ["Odlomak s oznakama uređivanja.", "Drugi odlomak iz druge sesije."],
    traces: { ...none, rsidAttributes: 4 },
  },
  {
    file: "06-core.docx",
    parts: [...packageParts({ core: true }), doc([p(run("Odlomak uz izmišljena svojstva datoteke."))]), ["docProps/core.xml", CORE]],
    text: ["Odlomak uz izmišljena svojstva datoteke."],
    traces: { ...none, coreProperties: ["cp:lastModifiedBy", "cp:revision", "dc:creator", "dc:title", "dcterms:created", "dcterms:modified"] },
  },
  {
    // Same visible text as 01: split runs, no standalone declaration, parts in another order.
    file: "07-same-text-other-bytes.docx",
    parts: [
      ["word/document.xml", documentXml([p(run("Ovo je izmišljeni ") + run("ulomak o sintetičkom istraživanju.")), p(run("Drugi odlomak, ") + run("također izmišljen, bez stvarnih podataka."))], DECL.replace(' standalone="yes"', ""))],
      ...packageParts({}).reverse(),
    ],
    text: CLEAN,
    traces: none,
    sameTextAs: "01-clean.docx",
  },
  {
    file: "08-mixed.docx",
    parts: [
      ...packageParts({ comments: true }),
      doc([p(run("Mješoviti ") + ins(1, "i dopunjeni ") + run("odlomak.")), p(del(2, "Uklonjeni uvod. ") + commented(0, "Odlomak s komentarom."))]),
      ["word/comments.xml", commentsXml(["Izmišljena napomena."])],
    ],
    text: ["Mješoviti i dopunjeni odlomak.", "Odlomak s komentarom."],
    traces: { ...none, ins: 1, del: 1, comments: 1 },
  },
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 1 January 2026, 12:00:00 as MS-DOS date and time; fixed, so no clock or time zone is read.
const DOS_TIME = 12 << 11;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** A ZIP of stored (uncompressed) entries in the given order. */
export function storedZip(entries: [string, string][]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0, 6);
    h.writeUInt16LE(0, 8);
    h.writeUInt16LE(DOS_TIME, 10);
    h.writeUInt16LE(DOS_DATE, 12);
    h.writeUInt32LE(crc32(data), 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    h.copy(c, 6, 4, 30); // version needed .. extra length are the same fields
    c.writeUInt32LE(offset, 42);
    local.push(h, n, data);
    central.push(c, n);
    offset += h.length + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dir, end]));
}

/** The corpus bytes by file name and the manifest text; the same call always gives the same result. */
export function buildCorpus(): { files: Record<string, Uint8Array>; manifest: string } {
  const files: Record<string, Uint8Array> = {};
  const fixtures = SPECS.map((s) => {
    const bytes = storedZip(s.parts);
    files[s.file] = bytes;
    return {
      file: s.file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      parts: s.parts.map(([name]) => name),
      text: s.text,
      traces: s.traces,
      ...(s.sameTextAs ? { sameTextAs: s.sameTextAs } : {}),
    };
  });
  const head = {
    corpus: "ductus-docx-corpus-v1",
    task: "DAN-242",
    generator: "tests/fixtures/docx-corpus/generate.ts",
    note: "Synthetic, invented content only. Generated; never edit by hand.",
  };
  // One fixture per line keeps the manifest short and its diff readable.
  const rows = fixtures.map((f) => `    ${JSON.stringify(f)}`).join(",\n");
  return { files, manifest: `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "fixtures": [\n${rows}\n  ]\n}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { files, manifest } = buildCorpus();
  const all: Record<string, Uint8Array> = { ...files, [MANIFEST_FILE]: new TextEncoder().encode(manifest) };
  let differs = 0;
  for (const [name, bytes] of Object.entries(all)) {
    const path = join(CORPUS_DIR, name);
    if (!check) writeFileSync(path, bytes);
    else if (!readFileSync(path, { flag: "r" }).equals(Buffer.from(bytes))) {
      console.error(`differs from the generator: ${name}`);
      differs += 1;
    }
  }
  if (differs > 0) process.exitCode = 1;
}
