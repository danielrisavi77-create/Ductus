import { fc, test } from "@fast-check/vitest";
import { describe, expect, it, vi } from "vitest";

import { verifyDocumentSnapshot } from "@/domain/document/snapshot";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import type { WithActor } from "@/server/db/with-actor";

import { parseCommitEnvelope } from "./commit-route";
import { commitEvidenceRequest, type EvidenceCommitRequest } from "./evidence-commit-request";

/**
 * DAN-320, plan #1504 (PR A): fuzz of the commit envelope (P4): the closed
 * key set, strict base64 and the form checks of BACKEND 4.13 t. 3.1, which
 * run before any state is read. Generated content only.
 *
 * Excluded on purpose: N-19 (a duplicate key in the envelope is accepted by
 * JSON.parse, last value wins). It is tracked in issue #1507 and stays out of
 * the generators until that issue decides the expected behaviour.
 */

const enc = (text: string) => new TextEncoder().encode(text);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const KEYS = ["documentId", "clientTransactionId", "baseRevision", "segments", "document"] as const;

// A client transaction id the receipt accepts: 1 to 128 units, no control or surrogate code unit.
const txId = fc.string({ unit: "grapheme", minLength: 1, maxLength: 16 }).map((s) => s.replace(/[\p{Cc}\p{Cs}]/gu, "x"));
const envelope = fc.record({
  documentId: fc.string({ maxLength: 40 }),
  clientTransactionId: txId,
  baseRevision: fc.nat(),
  segment: fc.uint8Array({ maxLength: 64 }),
  document: fc.uint8Array({ maxLength: 64 }),
});
type Fields = { documentId: string; clientTransactionId: string; baseRevision: number; segment: Uint8Array; document: Uint8Array };
const body = (e: Fields): Record<string, unknown> => ({
  documentId: e.documentId,
  clientTransactionId: e.clientTransactionId,
  baseRevision: e.baseRevision,
  segments: [b64(e.segment)],
  document: b64(e.document),
});
const parse = (value: unknown) => parseCommitEnvelope(enc(typeof value === "string" ? value : JSON.stringify(value)));

/** t. 3.1 must answer before the context is read, so `withActor` is never called. */
async function formOutcome(request: EvidenceCommitRequest) {
  const withActor = vi.fn<WithActor>(async () => {
    throw new Error("context must not be read");
  });
  const payloads = { putImmutable: vi.fn(), storageRefFor: vi.fn() };
  const outcome = await commitEvidenceRequest({ withActor, payloads } as never, "t", request);
  expect(withActor).not.toHaveBeenCalled();
  return outcome;
}

describe("P4 parseCommitEnvelope fuzz", () => {
  test.prop([envelope])("a valid envelope round-trips to the same fields and bytes", (e) => {
    const parsed = parseCommitEnvelope(enc(JSON.stringify(body(e))));
    expect(parsed).toEqual({ ...e, segment: new Uint8Array(e.segment), document: new Uint8Array(e.document) });
    expect(parsed?.segment.buffer).not.toBe(parsed?.document.buffer);
  });

  test.prop([envelope, fc.constantFrom(...KEYS), fc.constantFrom("extra", "missing", "case")])(
    "N-18: an extra, missing or case-changed key is refused",
    (e, key, kind) => {
      const value = body(e);
      if (kind === "extra") value.segmentsExtra = [];
      else {
        const kept = value[key];
        delete value[key];
        if (kind === "case") value[key.toUpperCase()] = kept;
      }
      expect(parse(value)).toBeNull();
    },
  );

  test.prop([
    envelope.filter((e) => e.segment.length > 0),
    fc.constantFrom("unpadded", "overpadded", "urlsafe", "space", "newline", "trailingBits"),
  ])("N-20: base64 that does not encode back to the same text is refused", (e, kind) => {
    const canonical = b64(e.segment);
    const variant = {
      unpadded: () => (canonical.endsWith("=") ? canonical.replace(/=+$/, "") : `${canonical}=`),
      overpadded: () => `${canonical}==`,
      urlsafe: () => `${canonical.slice(0, -1)}_`,
      space: () => ` ${canonical}`,
      newline: () => `${canonical.slice(0, 2)}\n${canonical.slice(2)}`,
      trailingBits: () => `${canonical}QR==`,
    }[kind]();
    expect(parse({ ...body(e), segments: [variant] })).toBeNull();
    expect(parse({ ...body(e), document: variant })).toBeNull();
  });

  it("N-20: QR== has non-zero trailing bits; the empty string is empty bytes, refused by P1 and P3", async () => {
    const one = { documentId: "d", clientTransactionId: "t", baseRevision: 0, segment: enc("x"), document: enc("x") };
    expect(parse({ ...body(one), document: "QR==" })).toBeNull();
    const empty = parse({ ...body(one), segments: [""], document: "" });
    expect(empty?.segment.byteLength).toBe(0);
    expect(empty?.document.byteLength).toBe(0);
    // t. 3.3 and t. 3.4 refuse these bytes after the context is read.
    expect(await verifyCanonicalEvidencePayloadV2(empty!.segment)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyDocumentSnapshot(empty!.document)).toEqual({ ok: false, reason: "invalid" });
  });

  test.prop([envelope, fc.constantFrom<unknown>([], ["", ""], "AA==", { 0: "AA==" }, null)])(
    "N-21: segments that are not an array of exactly one is refused",
    (e, segments) => {
      expect(parse({ ...body(e), segments })).toBeNull();
    },
  );

  test.prop([envelope, fc.constantFrom<unknown>("1", null, true, [1], { n: 1 })])(
    "N-21: a baseRevision that is not a number is refused at parse",
    (e, baseRevision) => {
      expect(parse({ ...body(e), baseRevision })).toBeNull();
    },
  );

  test.prop([envelope, fc.constantFrom("1.5", "-1", "1e400", "9007199254740993", "-0.5")])(
    "N-21: a number that is not a valid revision passes the parse and is invalid at t. 3.1",
    async (e, literal) => {
      const parsed = parse(JSON.stringify(body(e)).replace(/"baseRevision":\d+/, `"baseRevision":${literal}`));
      expect(parsed).not.toBeNull();
      expect(await formOutcome(parsed!)).toEqual({ status: "invalid" });
    },
  );

  test.prop([envelope, fc.constantFrom("a\u0000b", "a\u001fb", "a\u007fb", "a\ud800b", "\udc00", "x".repeat(129), "")])(
    "N-21: a client transaction id with a control unit, a lone surrogate, over 128 units or empty is invalid at t. 3.1",
    async (e, clientTransactionId) => {
      const parsed = parse({ ...body(e), clientTransactionId });
      expect(parsed).not.toBeNull();
      expect(await formOutcome(parsed!)).toEqual({ status: "invalid" });
    },
  );

  test.prop([envelope, fc.constantFrom([0xff], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80])])(
    "N-22: a BOM before the object or broken UTF-8 inside documentId is refused",
    (e, bad) => {
      const text = enc(JSON.stringify(body({ ...e, documentId: "doc-fuzz" })));
      expect(parseCommitEnvelope(Uint8Array.from([0xef, 0xbb, 0xbf, ...text]))).toBeNull();
      const at = new TextDecoder().decode(text).indexOf("doc-fuzz") + 3;
      expect(parseCommitEnvelope(Uint8Array.from([...text.subarray(0, at), ...bad, ...text.subarray(at)]))).toBeNull();
    },
  );

  test.prop([fc.uint8Array({ maxLength: 256 })])("K1: random bytes never throw and are refused", (bytes) => {
    expect(() => parseCommitEnvelope(bytes)).not.toThrow();
    expect(parseCommitEnvelope(bytes)).toBeNull();
  });

  test.prop([fc.jsonValue()])("K4: any JSON value without the closed key set is refused", (value) => {
    expect(parse(JSON.stringify(value) ?? "null")).toBeNull();
  });
});
