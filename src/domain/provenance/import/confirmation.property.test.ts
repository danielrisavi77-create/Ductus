import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decideImportConfirmation, type ImportConfirmContextV1, type ImportConfirmRequestV1, type ImportRecordV1 } from "./confirmation";
import { IMPORT_PENDING_LIFETIME_MS } from "./limits";

// DAN-436 (contract docs/contracts/import-v1.md §5, attack plan #1911 P1 to
// P4, P7 to P9). Every input class from the w436 contract on #1836 is drawn
// here and checked against a reference reading of §5. All identifiers are
// invented.

const PREPARED = Date.UTC(2026, 10, 10, 9, 0, 0);
const IDS = { importId: "0b5c2a7e-3f1d-4c8e-9a6b-1d2e3f4a5b6c", ownerId: "student-izmisljeni-1", documentId: "dokument-izmisljeni-uvoz" };
const HASH_RE = /^[0-9a-f]{64}$/;

const hex64 = fc.stringMatching(HASH_RE);
const badHash = fc.constantFrom("", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), ` ${"a".repeat(63)}`);
const anyHash = fc.oneof(hex64, badHash);
const time = fc.oneof(
  fc.integer({ min: -2 * IMPORT_PENDING_LIFETIME_MS, max: 2 * IMPORT_PENDING_LIFETIME_MS }).map((offset) => PREPARED + offset),
  fc.constantFrom(PREPARED + IMPORT_PENDING_LIFETIME_MS - 1, PREPARED + IMPORT_PENDING_LIFETIME_MS, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);
const revision = fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, 1.5));
const id = (own: string) => fc.constantFrom(own, `${own}-drugi`, "");

const record = fc.record(
  {
    importId: id(IDS.importId),
    ownerId: id(IDS.ownerId),
    documentId: id(IDS.documentId),
    manifestSha256: anyHash,
    baseRevision: revision,
    preparedAtMs: fc.constantFrom(PREPARED, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    state: fc.constantFrom("pending", "confirmed", "cancelled", "nepoznato" as "pending"),
    confirmedEventId: fc.constantFrom("dogadaj-izmisljeni-1", ""),
  },
  { requiredKeys: ["importId", "ownerId", "documentId", "manifestSha256", "baseRevision", "preparedAtMs", "state"] },
);

// The request mostly reuses the record's own values so that matching paths are drawn often.
const caseArb = record.chain((rec) =>
  fc.record({
    record: fc.oneof({ weight: 9, arbitrary: fc.constant<ImportRecordV1 | null>(rec) }, { weight: 1, arbitrary: fc.constant(null) }),
    request: fc.record({
      importId: fc.oneof(fc.constant(rec.importId), id(IDS.importId)),
      actorId: fc.oneof(fc.constant(rec.ownerId), id(IDS.ownerId)),
      documentId: fc.oneof(fc.constant(rec.documentId), id(IDS.documentId)),
      manifestSha256: fc.oneof(fc.constant(rec.manifestSha256), anyHash),
    }),
    context: fc.record({ nowMs: time, currentRevision: fc.oneof(fc.constant(rec.baseRevision), revision), importAllowed: fc.boolean() }),
  }),
);

type Case = { record: ImportRecordV1 | null; request: ImportConfirmRequestV1; context: ImportConfirmContextV1 };

// A random case almost never satisfies every condition at once, so a second
// generator starts from a confirmable case and replaces at most one field with
// a value drawn above. That checks the confirm side and each condition alone.
const confirmable = fc.record({
  hash: hex64,
  rev: fc.integer({ min: 0, max: 3 }),
  offset: fc.oneof(fc.integer({ min: 0, max: IMPORT_PENDING_LIFETIME_MS - 1 }), fc.constantFrom(0, IMPORT_PENDING_LIFETIME_MS - 1)),
}).map(({ hash, rev, offset }): Case => ({
  record: { ...IDS, manifestSha256: hash, baseRevision: rev, preparedAtMs: PREPARED, state: "pending" },
  request: { importId: IDS.importId, actorId: IDS.ownerId, documentId: IDS.documentId, manifestSha256: hash },
  context: { nowMs: PREPARED + offset, currentRevision: rev, importAllowed: true },
}));
type Swap = (base: Case & { record: ImportRecordV1 }, drawn: Case & { record: ImportRecordV1 }) => Case;
const recordField = (key: keyof ImportRecordV1): Swap => (b, d) => {
  const next: Record<string, unknown> = { ...b.record };
  if (key in d.record) next[key] = d.record[key];
  else delete next[key];
  return { ...b, record: next as ImportRecordV1 };
};
const SWAPS: Swap[] = [
  (b) => b,
  (b) => ({ ...b, record: null }),
  ...(["importId", "ownerId", "documentId", "manifestSha256", "baseRevision", "preparedAtMs", "state", "confirmedEventId"] as const).map(recordField),
  ...(["importId", "actorId", "documentId", "manifestSha256"] as const).map((key): Swap => (b, d) => ({ ...b, request: { ...b.request, [key]: d.request[key] } })),
  ...(["nowMs", "currentRevision", "importAllowed"] as const).map((key): Swap => (b, d) => ({ ...b, context: { ...b.context, [key]: d.context[key] } })),
];
const nearArb = fc.tuple(confirmable, caseArb, fc.integer({ min: 0, max: SWAPS.length - 1 }))
  .filter(([, drawn]) => drawn.record !== null)
  .map(([base, drawn, i]) => SWAPS[i]!(base as Case & { record: ImportRecordV1 }, drawn as Case & { record: ImportRecordV1 }));
const anyCase = fc.oneof(caseArb, nearArb);

function sameIdentity(c: Case): c is Case & { record: ImportRecordV1 } {
  const { record: r, request: q } = c;
  return r !== null && r.importId !== "" && r.ownerId !== "" && r.documentId !== "" &&
    r.importId === q.importId && r.ownerId === q.actorId && r.documentId === q.documentId;
}

/** Reference reading of §5 t. 4: the only inputs that may be confirmed. */
function mayConfirm(c: Case): boolean {
  if (!sameIdentity(c)) return false;
  const { record: r, request: q, context: x } = c;
  return r.state === "pending" && r.confirmedEventId === undefined &&
    HASH_RE.test(r.manifestSha256) && r.manifestSha256 === q.manifestSha256 &&
    Number.isFinite(x.nowMs) && Number.isFinite(r.preparedAtMs) &&
    x.nowMs >= r.preparedAtMs && x.nowMs < r.preparedAtMs + IMPORT_PENDING_LIFETIME_MS &&
    x.importAllowed === true && Number.isSafeInteger(r.baseRevision) && x.currentRevision === r.baseRevision;
}

describe("import confirmation: properties over every input class", () => {
  it("confirms exactly when §5 allows it", () => {
    fc.assert(fc.property(anyCase, (c) => {
      expect(decideImportConfirmation(c.record, c.request, c.context).kind === "confirm").toBe(mayConfirm(c));
    }));
  });

  it("P4: any identity difference or empty identity answers NOT_FOUND, whatever else is drawn", () => {
    fc.assert(fc.property(anyCase, (c) => {
      fc.pre(!sameIdentity(c));
      expect(decideImportConfirmation(c.record, c.request, c.context)).toEqual({ kind: "reject", code: "NOT_FOUND" });
    }));
  });

  it("P1/P8: a confirmed import with the same valid hash returns its one event under any context", () => {
    const context = fc.record({ nowMs: time, currentRevision: revision, importAllowed: fc.boolean() });
    fc.assert(fc.property(hex64, revision, fc.constantFrom(PREPARED, Number.NaN), context, (hash, baseRevision, preparedAtMs, x) => {
      const confirmed: ImportRecordV1 = { ...IDS, manifestSha256: hash, baseRevision, preparedAtMs, state: "confirmed", confirmedEventId: "dogadaj-izmisljeni-1" };
      const request = { importId: IDS.importId, actorId: IDS.ownerId, documentId: IDS.documentId, manifestSha256: hash };
      expect(decideImportConfirmation(confirmed, request, x)).toEqual({ kind: "already-confirmed", eventId: "dogadaj-izmisljeni-1" });
    }));
  });

  it("P2: a request hash that is not the stored valid hash is never confirmed or answered with an event", () => {
    fc.assert(fc.property(anyCase, (c) => {
      fc.pre(sameIdentity(c) && c.record.state !== "cancelled" && c.request.manifestSha256 !== c.record.manifestSha256);
      expect(decideImportConfirmation(c.record, c.request, c.context).kind).toBe("reject");
    }));
  });

  it("a decision carries a code or an event id only, and leaves its inputs unchanged", () => {
    fc.assert(fc.property(anyCase, (c) => {
      const before = JSON.stringify(c);
      const result = decideImportConfirmation(c.record, c.request, c.context);
      expect(JSON.stringify(c)).toBe(before);
      const keys = Object.keys(result).sort();
      if (result.kind === "reject") expect(keys).toEqual(["code", "kind"]);
      else if (result.kind === "already-confirmed") expect(keys).toEqual(["eventId", "kind"]);
      else expect(keys).toEqual(["kind"]);
    }));
  });
});
