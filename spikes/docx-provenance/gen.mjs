// M8.8-P01 (DAN-435): offline, deterministic generator of synthetic DOCX
// fixtures for the provenance spike. Every name and sentence is invented
// (CLAUDE.md); no network, no clock. Usage: node gen.mjs [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

// Built from local components so the DOS time in every ZIP header is the same in any time zone.
const FIXED_MTIME = new Date(2026, 0, 1, 12, 0, 0);
const AUTHOR = "Sintetički Autor";
const REVISION_DATE = "2026-01-01T12:00:00Z";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const run = (text) => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const rev = (tag, id, inner) => `<w:${tag} w:id="${id}" w:author="${esc(AUTHOR)}" w:date="${REVISION_DATE}">${inner}</w:${tag}>`;
const delRun = (text) => `<w:r><w:delText xml:space="preserve">${esc(text)}</w:delText></w:r>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const documentXml = (paragraphs) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${paragraphs.map((p) => `<w:p>${p}</w:p>`).join("")}</w:body></w:document>`;

// Fixed synthetic content: a plain document and one with a tracked insertion and deletion.
export const FIXTURES = {
  "plain.docx": [run("Ovo je izmišljeni ulomak za provjeru podrijetla dokumenta."), run("Drugi odlomak, također izmišljen.")],
  "tracked.docx": [
    run("Izmišljena rečenica ") + rev("ins", 1, run("s umetnutim dijelom")) + run("."),
    run("Treća rečenica ") + rev("del", 2, delRun("bez obrisanog dijela ")) + run("ostaje."),
  ],
};

/** The DOCX bytes for one fixture; the same input always gives the same bytes. */
export function buildDocx(paragraphs) {
  const parts = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "word/document.xml": strToU8(documentXml(paragraphs)),
  };
  return zipSync(parts, { level: 6, mtime: FIXED_MTIME });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ?? "out";
  mkdirSync(outDir, { recursive: true });
  for (const [name, paragraphs] of Object.entries(FIXTURES)) writeFileSync(join(outDir, name), buildDocx(paragraphs));
}
