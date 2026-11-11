import { describe, expect, it } from "vitest";

import { decideImportConfirmation, type ImportConfirmContextV1, type ImportConfirmRequestV1, type ImportRecordV1 } from "./confirmation";
import { IMPORT_PENDING_LIFETIME_MS } from "./limits";

// DAN-436 (contract docs/contracts/import-v1.md §5, attack plan #1911 P1 to
// P9). P5 (two tabs at once) and P6 (logout between prepare and confirm) need
// the row lock and the session fence of the M8.2 RPC; this pure decision is
// what that RPC calls under the lock. All identifiers are invented.

const PREPARED = Date.UTC(2026, 10, 10, 9, 0, 0);
const MANIFEST = "a".repeat(64);
const OTHER_MANIFEST = "b".repeat(64);

const pending: ImportRecordV1 = Object.freeze({
  importId: "0b5c2a7e-3f1d-4c8e-9a6b-1d2e3f4a5b6c",
  ownerId: "student-izmisljeni-1",
  documentId: "dokument-izmisljeni-uvoz",
  manifestSha256: MANIFEST,
  baseRevision: 7,
  preparedAtMs: PREPARED,
  state: "pending",
});
const confirmed: ImportRecordV1 = Object.freeze({ ...pending, state: "confirmed", confirmedEventId: "dogadaj-izmisljeni-1" });
const request: ImportConfirmRequestV1 = Object.freeze({
  importId: pending.importId,
  actorId: pending.ownerId,
  documentId: pending.documentId,
  manifestSha256: MANIFEST,
});
const context: ImportConfirmContextV1 = Object.freeze({ nowMs: PREPARED + 60_000, currentRevision: 7, importAllowed: true });

describe("import confirmation: idempotent decision", () => {
  it("confirms a pending import once", () => {
    expect(decideImportConfirmation(pending, request, context)).toEqual({ kind: "confirm" });
  });

  it("P1/P8: a repeated confirmation returns the stored event, never a second one", () => {
    const first = decideImportConfirmation(confirmed, request, context);
    const again = decideImportConfirmation(confirmed, request, context);
    expect(first).toEqual({ kind: "already-confirmed", eventId: "dogadaj-izmisljeni-1" });
    expect(again).toEqual(first);
  });

  it("P1: a retry after success holds even after expiry, a revision change or a closed import", () => {
    const late = { nowMs: PREPARED + 10 * IMPORT_PENDING_LIFETIME_MS, currentRevision: 9, importAllowed: false };
    expect(decideImportConfirmation(confirmed, request, late)).toEqual({ kind: "already-confirmed", eventId: "dogadaj-izmisljeni-1" });
  });

  it("P2: another manifestSha256 for the same importId is a conflict, pending or confirmed", () => {
    const other = { ...request, manifestSha256: OTHER_MANIFEST };
    expect(decideImportConfirmation(pending, other, context)).toEqual({ kind: "reject", code: "MANIFEST_MISMATCH" });
    expect(decideImportConfirmation(confirmed, other, context)).toEqual({ kind: "reject", code: "MANIFEST_MISMATCH" });
  });

  it("P3: a cancelled or expired import is refused", () => {
    expect(decideImportConfirmation({ ...pending, state: "cancelled" }, request, context)).toEqual({ kind: "reject", code: "CANCELLED" });
    const at = (nowMs: number) => decideImportConfirmation(pending, request, { ...context, nowMs });
    expect(at(PREPARED + IMPORT_PENDING_LIFETIME_MS - 1)).toEqual({ kind: "confirm" });
    expect(at(PREPARED + IMPORT_PENDING_LIFETIME_MS)).toEqual({ kind: "reject", code: "EXPIRED" });
    expect(at(Number.NaN)).toEqual({ kind: "reject", code: "EXPIRED" });
    expect(decideImportConfirmation({ ...pending, preparedAtMs: Number.NaN }, request, context)).toEqual({ kind: "reject", code: "EXPIRED" });
  });

  it("P4: another owner, another document or another import looks like a missing import", () => {
    const missing = { kind: "reject", code: "NOT_FOUND" };
    expect(decideImportConfirmation(null, request, context)).toEqual(missing);
    for (const change of [{ actorId: "student-izmisljeni-2" }, { documentId: "dokument-izmisljeni-drugi" }, { importId: "7e1f0c3a-9b2d-4e5f-8a1b-2c3d4e5f6a7b" }]) {
      const stranger = { ...request, ...change };
      expect(decideImportConfirmation(pending, stranger, context)).toEqual(missing);
      expect(decideImportConfirmation(confirmed, stranger, context)).toEqual(missing);
      expect(decideImportConfirmation({ ...pending, state: "cancelled" }, stranger, context)).toEqual(missing);
      expect(decideImportConfirmation(pending, { ...stranger, manifestSha256: OTHER_MANIFEST }, context)).toEqual(missing);
    }
  });

  it("P7: import switched off between prepare and confirm is refused", () => {
    expect(decideImportConfirmation(pending, request, { ...context, importAllowed: false })).toEqual({ kind: "reject", code: "IMPORT_NOT_ALLOWED" });
  });

  it("P9: a changed document revision is refused; the student reviews again", () => {
    expect(decideImportConfirmation(pending, request, { ...context, currentRevision: 8 })).toEqual({ kind: "reject", code: "REVISION_CHANGED" });
  });

  it("refuses an inconsistent record instead of confirming it", () => {
    expect(decideImportConfirmation({ ...pending, state: "confirmed" }, request, context)).toEqual({ kind: "reject", code: "NOT_FOUND" });
    expect(decideImportConfirmation({ ...confirmed, confirmedEventId: "" }, request, context)).toEqual({ kind: "reject", code: "NOT_FOUND" });
    expect(decideImportConfirmation({ ...pending, state: "unknown" as "pending" }, request, context)).toEqual({ kind: "reject", code: "NOT_FOUND" });
  });

  it("a rejection carries a code only", () => {
    const result = decideImportConfirmation(pending, { ...request, manifestSha256: OTHER_MANIFEST }, context);
    expect(Object.keys(result).sort()).toEqual(["code", "kind"]);
  });
});
