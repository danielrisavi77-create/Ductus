// M8.1-P01 (DAN-242): the committed DOCX corpus matches its manifest byte for
// byte, every declared trace and text is really in the bytes, and the generator
// is deterministic. The reader and counters below are written independently of
// the generator: only buildCorpus and the directory constants are imported.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildCorpus, CORPUS_DIR, INVENTED_NAMES, MANIFEST_FILE } from "../fixtures/docx-corpus/generate";

interface Fixture {
  file: string;
  sha256: string;
  size: number;
  parts: string[];
  text: string[];
  traces: { ins: number; del: number; comments: number; rsidAttributes: number; coreProperties: string[] };
  sameTextAs?: string;
}
interface Manifest {
  fixtures: Fixture[];
}

/** Parts of a ZIP of stored entries, in file order; throws on anything else. */
function readStoredZip(bytes: Uint8Array): [string, string][] {
  const buf = Buffer.from(bytes);
  const out: [string, string][] = [];
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const crc = buf.readUInt32LE(at + 14);
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const extraLength = buf.readUInt16LE(at + 28);
    if (method !== 0 || buf.readUInt32LE(at + 22) !== size) throw new Error("not a stored entry");
    const start = at + 30 + nameLength + extraLength;
    const data = buf.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error("CRC mismatch");
    out.push([buf.toString("utf8", at + 30, at + 30 + nameLength), data.toString("utf8")]);
    at = start + size;
  }
  return out;
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const count = (xml: string | undefined, re: RegExp) => (xml ?? "").match(re)?.length ?? 0;

/** Visible paragraph text of word/document.xml: w:t only, so deleted text (w:delText) is left out. */
const visibleText = (documentXml: string) =>
  [...documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((p) =>
    [...p[1].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => unescapeXml(t[1])).join(""),
  );

function observe(bytes: Uint8Array) {
  const parts = readStoredZip(bytes);
  const part = new Map(parts);
  const document = part.get("word/document.xml") ?? "";
  const core = part.get("docProps/core.xml") ?? "";
  return {
    parts,
    text: visibleText(document),
    traces: {
      ins: count(document, /<w:ins\s/g),
      del: count(document, /<w:del\s/g),
      comments: count(part.get("word/comments.xml"), /<w:comment\s/g),
      rsidAttributes: count(document, /\sw:rsid[A-Za-z]*="/g),
      coreProperties: [...new Set([...core.matchAll(/<([a-z]+:[A-Za-z]+)[\s>]/g)].map((m) => m[1]))]
        .filter((n) => n !== "cp:coreProperties")
        .sort(),
    },
  };
}

/** Every way the files differ from the manifest; empty when they match. */
function verifyCorpus(files: Record<string, Uint8Array>, manifest: Manifest): string[] {
  const errors: string[] = [];
  const declared = new Set(manifest.fixtures.map((f) => f.file));
  for (const name of Object.keys(files)) if (!declared.has(name)) errors.push(`${name}: not in the manifest`);
  for (const f of manifest.fixtures) {
    const bytes = files[f.file];
    if (!bytes) {
      errors.push(`${f.file}: missing`);
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== f.sha256) errors.push(`${f.file}: sha256`);
    if (bytes.length !== f.size) errors.push(`${f.file}: size`);
    let seen: ReturnType<typeof observe>;
    try {
      seen = observe(bytes);
    } catch (error) {
      errors.push(`${f.file}: unreadable (${(error as Error).message})`);
      continue;
    }
    const check = (what: string, actual: unknown, expected: unknown) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`${f.file}: ${what}`);
    };
    check("parts", seen.parts.map(([n]) => n), f.parts);
    check("text", seen.text, f.text);
    check("traces", seen.traces, f.traces);
  }
  return errors;
}

const manifestText = readFileSync(join(CORPUS_DIR, MANIFEST_FILE), "utf8");
const manifest = JSON.parse(manifestText) as Manifest;
const committed = Object.fromEntries(
  manifest.fixtures.map((f) => [f.file, new Uint8Array(readFileSync(join(CORPUS_DIR, f.file)))]),
);
const byName = new Map(manifest.fixtures.map((f) => [f.file, f]));

describe("DOCX corpus (DAN-242)", () => {
  it("the committed files match the manifest", () => {
    expect(verifyCorpus(committed, manifest)).toEqual([]);
  });

  it("covers every required kind with at least seven fixtures", () => {
    const t = manifest.fixtures.map((f) => f.traces);
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(7);
    expect(t.some((x) => x.ins > 0)).toBe(true);
    expect(t.some((x) => x.del > 0)).toBe(true);
    expect(t.some((x) => x.comments > 0)).toBe(true);
    expect(t.some((x) => x.rsidAttributes > 0)).toBe(true);
    expect(t.some((x) => x.coreProperties.length > 0)).toBe(true);
    expect(
      manifest.fixtures.some(
        (f) => !f.sameTextAs && f.traces.ins + f.traces.del + f.traces.comments + f.traces.rsidAttributes === 0 && f.traces.coreProperties.length === 0,
      ),
    ).toBe(true);
    expect(new Set(manifest.fixtures.map((f) => f.sha256)).size).toBe(manifest.fixtures.length);
  });

  it("a same-text fixture has the text of its pair and other bytes", () => {
    const pairs = manifest.fixtures.filter((f) => f.sameTextAs);
    expect(pairs.length).toBeGreaterThan(0);
    for (const f of pairs) {
      const other = byName.get(f.sameTextAs ?? "");
      expect(other).toBeDefined();
      expect(observe(committed[f.file]).text).toEqual(observe(committed[other!.file]).text);
      expect(f.sha256).not.toBe(other!.sha256);
    }
  });

  it("the directory holds the corpus, the manifest and the generator only", () => {
    const expected = [...manifest.fixtures.map((f) => f.file), MANIFEST_FILE, "generate.ts"].sort();
    expect(readdirSync(CORPUS_DIR).sort()).toEqual(expected);
  });

  it("only invented names, no addresses, and the manifest keeps no author or date values", () => {
    const names = new Set<string>(INVENTED_NAMES);
    for (const bytes of Object.values(committed)) {
      for (const [, xml] of readStoredZip(bytes)) {
        expect(xml).not.toContain("@");
        const people = [...xml.matchAll(/w:author="([^"]*)"|<dc:creator>([^<]*)<|<cp:lastModifiedBy>([^<]*)</g)];
        for (const m of people) expect(names.has(unescapeXml(m[1] ?? m[2] ?? m[3]))).toBe(true);
      }
    }
    for (const name of INVENTED_NAMES) expect(manifestText).not.toContain(name);
    expect(manifestText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  describe("verifyCorpus rejects", () => {
    const first = manifest.fixtures[0].file;
    const clone = () => ({ ...committed });
    const fixtureClone = () => JSON.parse(manifestText) as Manifest;

    it("a changed byte", () => {
      fc.assert(
        fc.property(fc.constantFrom(...manifest.fixtures.map((f) => f.file)), fc.nat(), fc.integer({ min: 1, max: 255 }), (file, at, xor) => {
          const bytes = new Uint8Array(committed[file]);
          bytes[at % bytes.length] ^= xor;
          return verifyCorpus({ ...committed, [file]: bytes }, manifest).length > 0;
        }),
      );
    });

    it("an extra or a missing file", () => {
      expect(verifyCorpus({ ...clone(), "09-extra.docx": committed[first] }, manifest)).toEqual(["09-extra.docx: not in the manifest"]);
      const missing = clone();
      delete missing[first];
      expect(verifyCorpus(missing, manifest)).toEqual([`${first}: missing`]);
    });

    it("a wrong trace count, text or part order", () => {
      const m = fixtureClone();
      m.fixtures[1].traces.ins += 1;
      m.fixtures[2].text = ["Druga rečenica."];
      m.fixtures[3].parts.reverse();
      expect(verifyCorpus(committed, m)).toEqual([
        `${m.fixtures[1].file}: traces`,
        `${m.fixtures[2].file}: text`,
        `${m.fixtures[3].file}: parts`,
      ]);
    });
  });

  describe("the generator", () => {
    it("gives the same bytes on every call, equal to the committed corpus", () => {
      const a = buildCorpus();
      const b = buildCorpus();
      expect(b).toEqual(a);
      expect(a.manifest).toBe(manifestText);
      expect(Object.keys(a.files).sort()).toEqual(Object.keys(committed).sort());
      for (const [name, bytes] of Object.entries(a.files)) expect(Buffer.from(bytes).equals(Buffer.from(committed[name]))).toBe(true);
    });

    it("--check passes in another time zone and process", () => {
      const run = spawnSync(process.execPath, [join(CORPUS_DIR, "generate.ts"), "--check"], {
        env: { ...process.env, TZ: "Pacific/Kiritimati", LANG: "C" },
        encoding: "utf8",
      });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
    });
  });
});
