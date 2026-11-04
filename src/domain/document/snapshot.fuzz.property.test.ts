import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";

import { REVISION_ZERO_JCS, REVISION_ZERO_SHA256 } from "./revision-zero";
import { MAX_DOCUMENT_SNAPSHOT_BYTES, verifyDocumentSnapshot } from "./snapshot";

/**
 * DAN-320, plan #1504 (PR A): fuzz of the document snapshot parser (P3) over
 * the input classes K1 to K12. Generated content only, never a real text.
 */

const enc = (text: string) => new TextEncoder().encode(text);
const hex = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const MARKS = [[], ["bold"], ["italic"], ["bold", "italic"]] as const;
const awkward = fc.constantFrom("\u{1F600}", "​", "‮", "﻿", "č", "č", " ");
const text = fc
  .array(fc.oneof(fc.string({ unit: "binary", minLength: 1, maxLength: 4 }), awkward), { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join(""));

// Adjacent texts with the same marks are merged (a map, not a filter), so every
// generated document is valid by construction.
const children = fc.array(fc.tuple(text, fc.nat(3)), { maxLength: 4 }).map((runs) => {
  const out: { type: "text"; text: string; marks: string[] }[] = [];
  for (const [t, m] of runs) {
    const last = out.at(-1);
    if (last && last.marks.join() === MARKS[m].join()) last.text += t;
    else out.push({ type: "text", text: t, marks: [...MARKS[m]] });
  }
  return out;
});
const block = fc.oneof(
  fc.record({ type: fc.constantFrom("paragraph", "bulletItem", "quote"), children }),
  fc.record({ type: fc.constant("heading"), level: fc.integer({ min: 1, max: 3 }), children }),
);
const documentText = fc
  .uniqueArray(fc.uuid({ version: 4 }), { minLength: 1, maxLength: 4, selector: (id) => id.toLowerCase() })
  .chain((ids) => fc.tuple(...ids.map((id) => block.map((b) => ({ ...b, id: id.toLowerCase() })))))
  .map((nodes) => canonicalizeJcs({ schemaVersion: 1, nodes }));
const documentBytes = documentText.map(enc);

/** Closed outcome; acceptance means canonical bytes hashed as received. */
async function verified(input: Uint8Array, original?: Uint8Array) {
  const result = await verifyDocumentSnapshot(input);
  if (!result.ok) {
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/^(invalid|too_large)$/) });
    return result;
  }
  const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  expect(result.text).toBe(decoded);
  expect(canonicalizeJcs(JSON.parse(decoded))).toBe(decoded);
  expect(result.sha256).toBe(await hex(input));
  if (original) expect(result.sha256).not.toBe(await hex(original));
  return result;
}

const splice = (bytes: Uint8Array, at: number, remove: number, insert: readonly number[] = []) =>
  Uint8Array.from([...bytes.subarray(0, at), ...insert, ...bytes.subarray(at + remove)]);

describe("P3 verifyDocumentSnapshot fuzz", () => {
  it("accepts revision 0 with its known hash", async () => {
    expect(await verifyDocumentSnapshot(enc(REVISION_ZERO_JCS))).toMatchObject({ ok: true, sha256: REVISION_ZERO_SHA256 });
  });

  test.prop([documentBytes])("N-03: a valid canonical document is accepted, also as a Buffer or offset view", async (bytes) => {
    const result = await verified(bytes);
    expect(result.ok).toBe(true);
    const wide = new Uint8Array(bytes.length + 2);
    wide.set(bytes, 1);
    expect(await verifyDocumentSnapshot(wide.subarray(1, -1))).toEqual(result);
    expect(await verifyDocumentSnapshot(Buffer.from(bytes))).toEqual(result);
  });

  test.prop([fc.uint8Array({ maxLength: 256 })])("K1: random bytes never throw and are not accepted", async (bytes) => {
    expect((await verified(bytes)).ok).toBe(false);
  });

  test.prop([fc.jsonValue()])("K4: any JSON value that is not a document is invalid", async (value) => {
    expect(await verifyDocumentSnapshot(enc(JSON.stringify(value) ?? "null"))).toEqual({ ok: false, reason: "invalid" });
  });

  test.prop([documentText, fc.constantFrom("indent", "reorder", "duplicate", "escape")])(
    "K5: a non-canonical spelling of a valid document is invalid",
    async (canonical, kind) => {
      const doc = JSON.parse(canonical) as { nodes: unknown[] };
      const variant = {
        indent: () => JSON.stringify(doc, null, 2),
        reorder: () => `{"schemaVersion":1,"nodes":${JSON.stringify(doc.nodes)}}`,
        duplicate: () => canonical.replace('{"nodes":', '{"nodes":[],"nodes":'),
        escape: () => canonical.replace('"schemaVersion"', '"schemaVersio\\u006e"'),
      }[kind]();
      expect(await verifyDocumentSnapshot(enc(variant))).toEqual({ ok: false, reason: "invalid" });
    },
  );

  test.prop([documentBytes, fc.nat(), fc.integer({ min: 0, max: 255 }), fc.constantFrom("replace", "delete", "insert", "truncate")])(
    "K6: a mutated document is refused or is another canonical document with its own hash",
    async (bytes, pick, byte, kind) => {
      const at = pick % bytes.length;
      const mutant = {
        replace: () => splice(bytes, at, 1, [byte]),
        delete: () => splice(bytes, at, 1),
        insert: () => splice(bytes, at, 0, [byte]),
        truncate: () => bytes.slice(0, at),
      }[kind]();
      await verified(mutant, bytes);
    },
  );

  test.prop([documentBytes, fc.nat(), fc.constantFrom([0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82])])(
    "K2/K3: invalid UTF-8 anywhere, or a leading BOM, is invalid",
    async (bytes, pick, bad) => {
      const broken = splice(bytes, pick % bytes.length, 0, bad);
      expect(await verifyDocumentSnapshot(broken)).toEqual({ ok: false, reason: "invalid" });
      expect(await verifyDocumentSnapshot(splice(bytes, 0, 0, [0xef, 0xbb, 0xbf]))).toEqual({ ok: false, reason: "invalid" });
    },
  );

  it("K8: input that is not a Uint8Array is invalid, including a string", async () => {
    for (const input of [REVISION_ZERO_JCS, null, undefined, 3, {}, [1], new ArrayBuffer(4), new DataView(new ArrayBuffer(4))]) {
      expect(await verifyDocumentSnapshot(input as Uint8Array)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("K9: exactly the limit is parsed, one byte more is too_large", async () => {
    const padded = (n: number) => enc(REVISION_ZERO_JCS.replace('"children":[]', `"children":[${" ".repeat(n)}]`));
    const atLimit = padded(MAX_DOCUMENT_SNAPSHOT_BYTES - REVISION_ZERO_JCS.length);
    expect(atLimit.byteLength).toBe(MAX_DOCUMENT_SNAPSHOT_BYTES);
    expect(await verifyDocumentSnapshot(atLimit)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyDocumentSnapshot(padded(MAX_DOCUMENT_SNAPSHOT_BYTES - REVISION_ZERO_JCS.length + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("K10/K11: deep nesting and a lone surrogate escape are invalid without throwing", async () => {
    const deep = REVISION_ZERO_JCS.replace('"children":[]', `"children":${"[".repeat(10_000)}${"]".repeat(10_000)}`);
    expect(await verifyDocumentSnapshot(enc(deep))).toEqual({ ok: false, reason: "invalid" });
    const surrogate = REVISION_ZERO_JCS.replace('"children":[]', '"children":[{"marks":[],"text":"\\ud800","type":"text"}]');
    expect(await verifyDocumentSnapshot(enc(surrogate))).toEqual({ ok: false, reason: "invalid" });
  });

  test.prop([documentText, fc.constantFrom("blockType", "duplicateId", "duplicateIdCase", "mark", "field")])(
    "N-17: a wrong block type, a duplicate id (also in another case), an unknown mark or field is invalid",
    async (canonical, kind) => {
      const doc = JSON.parse(canonical) as { nodes: { id: string; type: string; children: { marks: string[] }[] }[] };
      const first = doc.nodes[0]!;
      ({
        blockType: () => (first.type = "table"),
        duplicateId: () => doc.nodes.push({ ...first }),
        duplicateIdCase: () => doc.nodes.push({ ...first, id: first.id.toUpperCase() }),
        mark: () => first.children.push({ type: "text", text: "x", marks: ["underline"] } as never),
        field: () => Object.assign(first, { style: "x" }),
      })[kind]();
      expect(await verifyDocumentSnapshot(enc(canonicalizeJcs(doc)))).toEqual({ ok: false, reason: "invalid" });
    },
  );

  test.prop([documentBytes])("N-34: the bytes are copied before the first await", async (bytes) => {
    const buffer = new Uint8Array(bytes);
    const pending = verifyDocumentSnapshot(buffer);
    buffer.fill(0x20);
    expect(await pending).toMatchObject({ ok: true, sha256: await hex(bytes) });
    const broken = splice(bytes, 0, 1);
    const repaired = verifyDocumentSnapshot(broken);
    broken.set(bytes.subarray(0, broken.length));
    expect(await repaired).toEqual({ ok: false, reason: "invalid" });
  });

  test.prop([fc.array(fc.oneof(documentBytes, fc.uint8Array({ maxLength: 64 })), { minLength: 1, maxLength: 6 })])(
    "N-35: concurrent calls give the same outcomes as serial calls",
    async (inputs) => {
      const serial = [];
      for (const input of inputs) serial.push(await verifyDocumentSnapshot(input));
      expect(await Promise.all(inputs.map((input) => verifyDocumentSnapshot(input)))).toEqual(serial);
    },
  );
});
