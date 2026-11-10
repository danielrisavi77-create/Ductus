// DAN-242 (M8.1-P02): properties of the bounded DOCX reader over the
// synthetic corpus (#1845) and invented XML. Whatever bytes come in, the
// reader either succeeds within its limits or throws DocxRejected with a known
// code; it never throws anything else and never hands back more than it
// declared.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CORPUS_DIR, MANIFEST_FILE } from "../../../../tests/fixtures/docx-corpus/generate";
import { DEFAULT_DOCX_LIMITS, DocxRejected } from "./limits";
import { scanXml } from "./xml";
import { openDocxZip } from "./zip";
import { fixtureZip } from "./zip.fixture";

const manifest = JSON.parse(readFileSync(join(CORPUS_DIR, MANIFEST_FILE), "utf8")) as { fixtures: { file: string }[] };
const corpus = manifest.fixtures.map((f) => new Uint8Array(readFileSync(join(CORPUS_DIR, f.file))));

async function outcome(run: () => unknown | Promise<unknown>): Promise<string> {
  try {
    await run();
    return "OK";
  } catch (e) {
    if (!(e instanceof DocxRejected)) throw e;
    expect(e.message).toBe(e.code);
    return e.code;
  }
}

async function readEvery(bytes: Uint8Array): Promise<void> {
  const zip = openDocxZip(bytes, { maxEntries: 64 });
  for (const name of zip.names) {
    const part = await zip.read(name);
    expect(part.length).toBeLessThanOrEqual(DEFAULT_DOCX_LIMITS.maxPartBytes);
    scanXml(part, { maxXmlDepth: 32 }, {});
  }
}

const mutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({ kind: fc.constant("flip" as const), at: fc.nat(), value: fc.integer({ min: 0, max: 255 }) }),
  fc.record({ kind: fc.constant("cut" as const), at: fc.nat() }),
  fc.record({ kind: fc.constant("splice" as const), at: fc.nat(), bytes: fc.uint8Array({ maxLength: 40 }) }),
);

interface Mutation {
  kind: "flip" | "cut" | "splice";
  at: number;
  value?: number;
  bytes?: Uint8Array;
}

function mutate(source: Uint8Array, m: Mutation): Uint8Array {
  const at = m.at % (source.length + 1);
  if (m.kind === "cut") return source.slice(0, at);
  if (m.kind === "splice") {
    const out = new Uint8Array(source.length + (m.bytes?.length ?? 0));
    out.set(source.subarray(0, at));
    out.set(m.bytes ?? [], at);
    out.set(source.subarray(at), at + (m.bytes?.length ?? 0));
    return out;
  }
  const out = source.slice();
  if (at < out.length) out[at] = m.value ?? 0;
  return out;
}

/** Independent statement of the path rule from the contract (Z5), written without the reader. */
function pathIsSafe(name: string): boolean {
  if (name.length === 0 || name.startsWith("/")) return false;
  for (let k = 0; k < name.length; k++) {
    const c = name.charCodeAt(k);
    if (c < 0x20 || c === 0x7f || c === 0xfeff || name[k] === "\\" || name[k] === ":") return false;
  }
  const segments = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  return segments.every((s) => s !== "" && s !== "." && s !== "..");
}

describe("DAN-242 reader properties", () => {
  it("a mutated corpus file is read in full or rejected with a reader code, never anything else", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: corpus.length - 1 }), fc.array(mutation, { minLength: 1, maxLength: 4 }), async (pick, steps) => {
        const bytes = steps.reduce<Uint8Array>((b, m) => mutate(b, m), corpus[pick]);
        await outcome(() => readEvery(bytes));
      }),
    );
  });

  it("an entry name is accepted exactly when the independent path rule accepts it", async () => {
    const piece = fc.constantFrom("a", "word", ".", "..", "", "\\", ":", "\u0000", "\u007f", "\ufeff", "č", "b.xml", "C:", "%2e");
    await fc.assert(
      fc.asyncProperty(fc.array(piece, { minLength: 1, maxLength: 5 }), fc.boolean(), async (pieces, lead) => {
        const name = (lead ? "/" : "") + pieces.join("/");
        const code = await outcome(() => openDocxZip(fixtureZip([{ name, data: name.endsWith("/") ? "" : "<a/>" }])));
        expect(code === "OK").toBe(pathIsSafe(name));
        if (code !== "OK") expect(code).toBe("ZIP_PATH");
      }),
    );
  });

  it("any text is either scanned or rejected with an XML code", async () => {
    const token = fc.constantFrom("<a", ">", "</a>", "/>", "<b:c", ' xmlns:b="urn:b"', ' x="1"', "&amp;", "&#0;", "&e;", "<!DOCTYPE a>", "<?p?>", "<!--c-->", "<![CDATA[x]]>", "]]>", "\u0001", "č", " ");
    await fc.assert(
      fc.asyncProperty(fc.array(token, { maxLength: 24 }), fc.string({ maxLength: 8 }), async (tokens, tail) => {
        const code = await outcome(() => scanXml(new TextEncoder().encode(tokens.join("") + tail), { maxXmlDepth: 8 }, {}));
        expect(code === "OK" || code.startsWith("XML_")).toBe(true);
      }),
    );
  });
});
