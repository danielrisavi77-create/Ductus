// M8.8-P02 (DAN-435, D-198 t. 5): reads today's text and revision kinds from a DOCX, nothing else.
// The output never holds an author, date, RSID, revision id, deleted or moved-from text, or a comment;
// an error carries only its code. This is a spike, not a sandbox (ARCHITECTURE §5c): the reader is
// synchronous and has no time limit, and it finds the main part by name, not through _rels.
// It loads only fflate and saxes and no Node API (A13, pinned in policy.ts).
import { Inflate } from "fflate";
import { SaxesParser } from "saxes";

export const LIMITS = Object.freeze({
  maxInputBytes: 64 << 20,
  maxEntries: 2000,
  maxPartBytes: 16 << 20,
  maxRatio: 200,
  maxDepth: 128,
  maxTextChars: 4 << 20,
});

export class DocxError extends Error {
  constructor(code) {
    super(code);
    this.name = "DocxError";
    this.code = code;
  }
}
const fail = (code) => { throw new DocxError(code); };

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MAIN = "word/document.xml";
const REVISIONS = new Set(["ins", "del", "moveFrom", "moveTo"]);
const REMOVED = new Set(["del", "moveFrom"]);
const CHUNK = 1024;

// A caller may only tighten a limit; a larger, infinite or non-numeric value is ignored.
function limitsFrom(overrides = {}) {
  const out = { ...LIMITS };
  for (const k of Object.keys(LIMITS)) {
    const v = overrides[k];
    if (typeof v === "number" && v < LIMITS[k]) out[k] = v;
  }
  return out;
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Parses the ZIP central directory itself: the declared size is checked before any inflate, and the
// inflate stops as soon as the output passes the declaration (fflate's unzipSync truncates silently).
function mainPart(bytes, lim) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p) => v.getUint16(p, true);
  const u32 = (p) => v.getUint32(p, true);
  let e = -1;
  for (let p = bytes.length - 22; p >= 0 && p >= bytes.length - 22 - 0xffff; p--) {
    if (u32(p) === 0x06054b50) { e = p; break; }
  }
  if (e < 0) fail("ZIP_INVALID");
  const count = u16(e + 10);
  const cdSize = u32(e + 12);
  const cdOff = u32(e + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff || cdOff + cdSize > e) fail("ZIP_INVALID");
  if (count > lim.maxEntries) fail("ZIP_TOO_MANY_ENTRIES");
  let found = null;
  for (let i = 0, p = cdOff; i < count; i++) {
    if (p + 46 > cdOff + cdSize || u32(p) !== 0x02014b50) fail("ZIP_INVALID");
    const next = p + 46 + u16(p + 28) + u16(p + 30) + u16(p + 32);
    if (next > cdOff + cdSize) fail("ZIP_INVALID");
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + u16(p + 28)));
    if (name.toLowerCase() === MAIN) {
      if (found) fail("ZIP_DUPLICATE");
      found = { flags: u16(p + 8), method: u16(p + 10), crc: u32(p + 16), csize: u32(p + 20), usize: u32(p + 24), lho: u32(p + 42) };
    }
    p = next;
  }
  if (!found) fail("DOCX_NO_DOCUMENT");
  const { flags, method, crc, csize, usize, lho } = found;
  if (flags & 1 || (method !== 0 && method !== 8)) fail("ZIP_METHOD");
  if (usize > lim.maxPartBytes) fail("ZIP_PART_TOO_LARGE");
  if (usize > lim.maxRatio * Math.max(csize, 1)) fail("ZIP_RATIO");
  if (lho + 30 > cdOff || u32(lho) !== 0x04034b50) fail("ZIP_INVALID");
  const start = lho + 30 + u16(lho + 26) + u16(lho + 28);
  if (start + csize > cdOff) fail("ZIP_INVALID");
  const data = bytes.subarray(start, start + csize);
  let out;
  if (method === 0) {
    if (csize !== usize) fail("ZIP_SIZE_MISMATCH");
    out = data;
  } else {
    out = new Uint8Array(usize);
    let total = 0;
    const inflate = new Inflate((chunk) => {
      if (total + chunk.length > usize) fail("ZIP_SIZE_MISMATCH");
      out.set(chunk, total);
      total += chunk.length;
    });
    try {
      for (let i = 0; i < data.length || i === 0; i += CHUNK) inflate.push(data.subarray(i, i + CHUNK), i + CHUNK >= data.length);
    } catch (err) {
      if (err instanceof DocxError) throw err;
      fail("ZIP_INVALID");
    }
    if (total !== usize) fail("ZIP_SIZE_MISMATCH");
  }
  if (crc32(out) !== crc) fail("ZIP_INVALID");
  return out;
}

function parse(bytes, lim) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("XML_ENCODING");
  }
  const paragraphs = [];
  const revisions = [];
  const open = [];
  let depth = 0;
  let inText = 0;
  let removed = 0;
  let chars = 0;
  const keep = (t) => {
    if (!inText || removed || !open.length) return;
    chars += t.length;
    if (chars > lim.maxTextChars) fail("XML_TEXT");
    paragraphs[open.at(-1)] += t;
  };
  const sax = new SaxesParser({ xmlns: true });
  sax.on("error", () => fail("XML_INVALID"));
  sax.on("xmldecl", (d) => { if (d.encoding !== undefined && d.encoding.toLowerCase() !== "utf-8") fail("XML_ENCODING"); });
  sax.on("doctype", () => fail("XML_DOCTYPE"));
  sax.on("processinginstruction", () => fail("XML_PI"));
  sax.on("opentag", (node) => {
    if (++depth > lim.maxDepth) fail("XML_DEPTH");
    if (node.uri !== W) return;
    const name = node.local;
    if (name === "p") { open.push(paragraphs.length); paragraphs.push(""); }
    else if (name === "t") inText++;
    else if (REVISIONS.has(name)) {
      revisions.push({ kind: name, paragraph: open.length ? open.at(-1) : null });
      if (REMOVED.has(name)) removed++;
    }
  });
  sax.on("closetag", (node) => {
    depth--;
    if (node.uri !== W) return;
    const name = node.local;
    if (name === "p") open.pop();
    else if (name === "t") inText--;
    else if (REMOVED.has(name)) removed--;
  });
  sax.on("text", keep);
  sax.on("cdata", keep);
  sax.write(text).close();
  return { paragraphs, revisions };
}

export function readDocx(bytes, overrides) {
  const lim = limitsFrom(overrides);
  if (!(bytes instanceof Uint8Array)) fail("INPUT_INVALID");
  if (bytes.length > lim.maxInputBytes) fail("INPUT_TOO_LARGE");
  return parse(mainPart(bytes, lim), lim);
}
