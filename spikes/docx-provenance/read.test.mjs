// M8.8-P02 (DAN-435), attack plan #1597: the DOCX reader against every input class of contract
// c.6678564918 on #1091. Every name, date and sentence is invented (CLAUDE.md).
// Run in this directory: npm ci --ignore-scripts && node --test
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { FIXTURES, buildDocx } from "./gen.mjs";
import { DocxError, LIMITS, readDocx } from "./read.mjs";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const xml = (body, head = DECL) => `${head}<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
const para = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const docx = (doc, extra = {}, level = 6) =>
  zipSync({ "word/document.xml": typeof doc === "string" ? strToU8(doc) : doc, ...extra }, { level, mtime: new Date(2026, 0, 1) });
const OK = docx(xml(para("izmišljeni odlomak")));

// Edits the central directory record of every entry whose name passes `pick`.
function patchCentral(zip, edit, pick = (n) => n === "word/document.xml") {
  const out = Uint8Array.from(zip);
  const v = new DataView(out.buffer);
  let hits = 0;
  for (let p = out.length - 22; p >= 0; p--) {
    if (v.getUint32(p, true) !== 0x02014b50) continue;
    const name = new TextDecoder().decode(out.subarray(p + 46, p + 46 + v.getUint16(p + 28, true)));
    if (pick(name)) { edit(v, p, out); hits++; }
  }
  assert.ok(hits > 0, "patch found no entry");
  return out;
}
const setSize = (zip, size) => patchCentral(zip, (v, p) => v.setUint32(p + 24, size, true));
const rejects = (bytes, code, limits) =>
  assert.throws(() => readDocx(bytes, limits), (e) => e instanceof DocxError && e.code === code && e.message === code);

describe("ZIP classes", () => {
  it("Z1 the generated fixtures pass", () => {
    assert.deepEqual(readDocx(buildDocx(FIXTURES["plain.docx"])), {
      paragraphs: ["Ovo je izmišljeni ulomak za provjeru podrijetla dokumenta.", "Drugi odlomak, također izmišljen."], revisions: [],
    });
    assert.deepEqual(readDocx(docx(xml(para("a")), {}, 0)).paragraphs, ["a"]);
  });
  it("Z2 not a ZIP, empty, truncated or corrupt", () => {
    for (const b of [new Uint8Array(), strToU8("nije zip"), OK.subarray(0, OK.length - 1), OK.subarray(0, 40), OK.subarray(30)]) rejects(b, "ZIP_INVALID");
    rejects(patchCentral(OK, (v, p) => v.setUint32(p + 42, 7, true)), "ZIP_INVALID");
    const corrupt = Uint8Array.from(OK);
    corrupt.fill(0xff, 60, 70);
    rejects(corrupt, "ZIP_INVALID");
    // A stored part with one changed letter inflates cleanly; only the CRC catches it.
    const stored = docx(xml(para("abc")), {}, 0);
    const at = new TextDecoder("latin1").decode(stored).indexOf("<w:t>abc<") + 6;
    const flipped = Uint8Array.from(stored);
    flipped[at] = "x".charCodeAt(0);
    assert.ok(new TextDecoder().decode(flipped).includes("<w:t>axc<"));
    rejects(flipped, "ZIP_INVALID");
  });
  it("Z3 too many entries", () => {
    const many = Object.fromEntries(Array.from({ length: LIMITS.maxEntries }, (_, i) => [`x/${i}`, new Uint8Array()]));
    rejects(docx(xml(""), many), "ZIP_TOO_MANY_ENTRIES");
    rejects(docx(xml(""), { a: new Uint8Array() }), "ZIP_TOO_MANY_ENTRIES", { maxEntries: 1 });
    assert.deepEqual(readDocx(docx(xml(""), { a: new Uint8Array() }), { maxEntries: 2 }).paragraphs, []);
  });
  it("Z4 declared part size above the limit, before any inflate", () => {
    rejects(setSize(OK, LIMITS.maxPartBytes + 1), "ZIP_PART_TOO_LARGE");
    rejects(OK, "ZIP_PART_TOO_LARGE", { maxPartBytes: 10 });
  });
  it("Z5 an honest header with a compression ratio above the limit", () => {
    rejects(docx(xml(" ".repeat(1 << 20))), "ZIP_RATIO");
    rejects(docx(xml(" ".repeat(4000))), "ZIP_RATIO", { maxRatio: 5 });
  });
  it("Z6 a header that lies about the size fails, it never truncates or overruns", () => {
    const real = strToU8(xml(para("a"))).length;
    const small = docx(xml(para("a")));
    assert.deepEqual(readDocx(setSize(small, real)).paragraphs, ["a"]);
    rejects(setSize(small, real - 1), "ZIP_SIZE_MISMATCH");
    rejects(setSize(small, real + 1), "ZIP_SIZE_MISMATCH");
    rejects(setSize(docx(xml(para("a")), {}, 0), real - 1), "ZIP_SIZE_MISMATCH");
    // 8 MiB of real output behind a 400 byte declaration stops at the declaration.
    rejects(setSize(docx(xml(" ".repeat(8 << 20)), {}, 9), 400), "ZIP_SIZE_MISMATCH");
  });
  it("Z7 no word/document.xml", () => {
    rejects(zipSync({ "[Content_Types].xml": strToU8("<Types/>") }), "DOCX_NO_DOCUMENT");
    rejects(zipSync({ "word/document.xml.bak": strToU8(xml("")), "document.xml": strToU8(xml("")) }), "DOCX_NO_DOCUMENT");
  });
  it("Z8 a duplicate main part, also one that differs only in case", () => {
    rejects(docx(xml(para("a")), { "WORD/Document.xml": strToU8(xml(para("b"))) }), "ZIP_DUPLICATE");
    const twin = docx(xml(para("a")), { "word/documenX.xml": strToU8(xml(para("b"))) });
    rejects(patchCentral(twin, (v, p, out) => { out[p + 46 + 12] = "t".charCodeAt(0); }, (n) => n === "word/documenX.xml"), "ZIP_DUPLICATE");
  });
  it("Z9 an unknown compression method or encryption", () => {
    rejects(patchCentral(OK, (v, p) => v.setUint16(p + 10, 12, true)), "ZIP_METHOD");
    rejects(patchCentral(OK, (v, p) => v.setUint16(p + 8, v.getUint16(p + 8, true) | 1, true)), "ZIP_METHOD");
  });
  it("Z10 input above the size limit or not bytes", () => {
    rejects(new Uint8Array(LIMITS.maxInputBytes + 1), "INPUT_TOO_LARGE");
    rejects(OK, "INPUT_TOO_LARGE", { maxInputBytes: OK.length - 1 });
    for (const x of [undefined, "PK", [80, 75], OK.buffer]) rejects(x, "INPUT_INVALID");
  });
  it("limits can only be tightened", () => {
    rejects(new Uint8Array(LIMITS.maxInputBytes + 1), "INPUT_TOO_LARGE", { maxInputBytes: Infinity });
    rejects(docx(xml(" ".repeat(1 << 20))), "ZIP_RATIO", { maxRatio: 1e9, maxPartBytes: 1e12 });
    assert.ok(Object.isFrozen(LIMITS));
  });
});

const BILLION = '<!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>';
describe("XML classes", () => {
  const cases = [
    ["X1 any DOCTYPE", xml("", `${DECL}<!DOCTYPE w:document>`), "XML_DOCTYPE"],
    ["X2 internal entities (billion laughs)", xml(para("&c;"), DECL + BILLION), "XML_DOCTYPE"],
    ["X3 external SYSTEM entity (XXE)", xml(para("&x;"), `${DECL}<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/hostname">]>`), "XML_DOCTYPE"],
    ["X4 parameter entity", xml("", `${DECL}<!DOCTYPE d [<!ENTITY % p SYSTEM "https://example.invalid/p.dtd"> %p;]>`), "XML_DOCTYPE"],
    ["X5 undefined entity without a DTD", xml(para("&nepoznato;")), "XML_INVALID"],
    ["X6 processing instruction", xml(`<?izmisljeno x?>${para("a")}`), "XML_PI"],
    ["X7 depth above the limit", xml("<w:x>".repeat(LIMITS.maxDepth) + "</w:x>".repeat(LIMITS.maxDepth)), "XML_DEPTH"],
    ["X9 unclosed element", xml("<w:p>"), "XML_INVALID"],
    ["X9 mismatched tag", xml("<w:p></w:r>"), "XML_INVALID"],
    ["X9 undeclared prefix", xml("<x:p/>"), "XML_INVALID"],
    ["X9 empty part", "", "XML_INVALID"],
    ["X9 two roots", `${xml("")}<w:document xmlns:w="${W}"/>`, "XML_INVALID"],
    ["X10 another encoding declared", xml(para("a"), '<?xml version="1.0" encoding="ISO-8859-1"?>'), "XML_ENCODING"],
  ];
  for (const [name, doc, code] of cases) it(name, () => rejects(docx(doc), code));
  it("X7 and X8 at the limit pass, one above fails", () => {
    const nest = (n) => xml("<w:x>".repeat(n) + "</w:x>".repeat(n));
    assert.deepEqual(readDocx(docx(nest(3)), { maxDepth: 5 }).paragraphs, []);
    rejects(docx(nest(4)), "XML_DEPTH", { maxDepth: 5 });
    assert.deepEqual(readDocx(docx(xml(para("0123456789"))), { maxTextChars: 10 }).paragraphs, ["0123456789"]);
    rejects(docx(xml(para("01234") + para("567890"))), "XML_TEXT", { maxTextChars: 10 });
  });
  it("X11 an element of another namespace is not a paragraph, text or revision; CDATA is text", () => {
    const other = '<x:p xmlns:x="urn:izmisljeno"><x:t>tuđe</x:t></x:p><x:del xmlns:x="urn:izmisljeno"/>';
    assert.deepEqual(readDocx(docx(xml(other + para("a")))), { paragraphs: ["a"], revisions: [] });
    const cdata = '<w:p><w:r><w:t><![CDATA[a<b]]></w:t></w:r><w:del><w:r><w:t><![CDATA[skriveno]]></w:t></w:r></w:del></w:p>';
    assert.deepEqual(readDocx(docx(xml(cdata))), { paragraphs: ["a<b"], revisions: [{ kind: "del", paragraph: 0 }] });
  });
  it("X12 Strict OOXML is refused, not read as empty; nothing inside mc:Fallback is counted twice", () => {
    const strict = `${DECL}<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body>${para("a")}</w:body></w:document>`;
    rejects(docx(strict), "DOCX_STRICT");
    const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
    const box = (t) => `<w:txbxContent>${para(t)}</w:txbxContent>`;
    const alt = `<w:p><w:r><mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="wps">${box("okvir")}</mc:Choice>`
      + `<mc:Fallback>${box("okvir")}<w:ins w:id="1"/></mc:Fallback></mc:AlternateContent><w:t>iza</w:t></w:r></w:p>`;
    assert.deepEqual(readDocx(docx(xml(alt))), { paragraphs: ["iza", "okvir"], revisions: [] });
    const inside = `<w:p><w:r><w:t>a<mc:Fallback xmlns:mc="${MC}">b</mc:Fallback>c</w:t></w:r></w:p>`;
    assert.deepEqual(readDocx(docx(xml(inside))).paragraphs, ["ac"]);
  });
  it("X10 bytes that are not UTF-8, UTF-16 included", () => {
    rejects(docx(Uint8Array.of(...strToU8(xml(para("a"))).subarray(0, 60), 0xff, 0xfe)), "XML_ENCODING");
    const utf16 = new Uint8Array(Buffer.from(`﻿${xml(para("a"), '<?xml version="1.0" encoding="UTF-16"?>')}`, "utf16le"));
    rejects(docx(utf16), "XML_ENCODING");
  });
});

// Deterministic PRNG so a failing run names its seed (fast-check is not a reviewed spike dependency).
function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
}
const KEPT = "abcdefghijklmnoprstuvz šđčćž";
describe("data boundary (D-198 t. 5)", () => {
  it("D1 tracked.docx keeps today's text and counts revisions, nothing more", () => {
    const out = readDocx(buildDocx(FIXTURES["tracked.docx"]));
    assert.deepEqual(out, {
      paragraphs: ["Izmišljena rečenica s umetnutim dijelom.", "Treća rečenica ostaje."],
      revisions: [{ kind: "ins", paragraph: 0 }, { kind: "del", paragraph: 1 }],
    });
    const json = JSON.stringify(out);
    for (const s of ["Sintetički", "Autor", "2026", "obrisanog", "author", "date", "rsid", "id"]) assert.ok(!json.includes(s), s);
  });
  it("D2 random authors, dates, RSIDs, ids and removed text never reach the output or an error", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = prng(seed);
      const pick = (alphabet, n) => Array.from({ length: n }, () => alphabet[Math.floor(r() * alphabet.length)]).join("");
      const secret = () => `QZ${pick("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 6 + Math.floor(r() * 10))}`;
      const kept = pick(KEPT, 1 + Math.floor(r() * 20));
      const s = { author: secret(), date: `QZ${2000 + Math.floor(r() * 30)}-0${1 + Math.floor(r() * 9)}`, rsid: secret(), id: secret(),
        del: secret(), moved: secret(), inDel: secret(), instr: secret() };
      const attrs = `w:id="${s.id}" w:author="${s.author}" w:date="${s.date}"`;
      const body = `<w:p w:rsidR="${s.rsid}" w:rsidRDefault="${s.rsid}"><w:pPr><w:rPr><w:del ${attrs}/></w:rPr></w:pPr>`
        + `<w:r w:rsidRPr="${s.rsid}"><w:rPr><w:rPrChange ${attrs}><w:rPr/></w:rPrChange></w:rPr><w:t>${kept}</w:t></w:r>`
        + `<w:ins ${attrs}><w:r><w:t xml:space="preserve"> ${kept}</w:t></w:r></w:ins>`
        + `<w:del ${attrs}><w:r><w:delText>${s.del}</w:delText><w:delInstrText>${s.instr}</w:delInstrText><w:t>${s.inDel}</w:t></w:r></w:del>`
        + `<w:moveFrom ${attrs}><w:r><w:t>${s.moved}</w:t></w:r></w:moveFrom><w:moveTo ${attrs}><w:r><w:t>${kept}</w:t></w:r></w:moveTo></w:p>`;
      const where = `seed ${seed}`;
      let out;
      try {
        out = readDocx(docx(xml(body)));
      } catch (err) {
        assert.fail(`${where}: ${err?.code ?? err}`);
      }
      assert.deepEqual(out.paragraphs, [`${kept} ${kept}${kept}`], where);
      assert.deepEqual(out.revisions.map((x) => x.kind), ["del", "ins", "del", "moveFrom", "moveTo"], where);
      assert.ok(out.revisions.every((x) => x.paragraph === 0), where);
      const json = JSON.stringify(out);
      for (const [k, v] of Object.entries(s)) assert.ok(!json.includes(v), `${where}: ${k}`);
      // An error carries only its code, never input text.
      for (const bad of [xml(body + `&${s.author};`), xml(body + "<w:p>"), xml(body, `${DECL}<!DOCTYPE ${s.author}>`)]) {
        assert.throws(() => readDocx(docx(bad)), (e) => e instanceof DocxError && Object.values(s).every((v) => !`${e.message}${e.stack}`.includes(v)), where);
      }
    }
  });
  it("a revision outside a paragraph has no paragraph index", () => {
    const row = `<w:tbl><w:tr><w:trPr><w:ins w:id="1" w:author="QZ" w:date="QZ"/></w:trPr><w:tc>${para("a")}</w:tc></w:tr></w:tbl>`;
    assert.deepEqual(readDocx(docx(xml(row))), { paragraphs: ["a"], revisions: [{ kind: "ins", paragraph: null }] });
  });
});

// Pinned fixture bytes (A16): a change to gen.mjs, fflate or the clock handling shows up here.
const PINS = {
  "plain.docx": "264e4209d0ccd68786df0a539bb66348851bfeb9d9407e6ccd401482d888a59e",
  "tracked.docx": "5e11dfc14ccd432d7d6efded2f8d4d0a99960e36d6b5bc0674ddff1c70312b61",
};
const hashes = (fixtures, build) => Object.fromEntries(Object.entries(fixtures).map(([n, p]) => [n, createHash("sha256").update(build(p)).digest("hex")]));
describe("fixtures", () => {
  it("F1 the generated fixtures have the pinned SHA-256", () => assert.deepEqual(hashes(FIXTURES, buildDocx), PINS));
  it("F2 the same bytes in every time zone", () => {
    const gen = JSON.stringify(new URL("./gen.mjs", import.meta.url).href);
    const script = `import { createHash } from "node:crypto"; import { FIXTURES, buildDocx } from ${gen};
      console.log(JSON.stringify(Object.fromEntries(Object.entries(FIXTURES).map(([n, p]) => [n, createHash("sha256").update(buildDocx(p)).digest("hex")]))));`;
    for (const TZ of ["UTC", "Europe/Zagreb", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kathmandu"]) {
      const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" });
      assert.deepEqual(JSON.parse(out), PINS, TZ);
    }
  });
});
