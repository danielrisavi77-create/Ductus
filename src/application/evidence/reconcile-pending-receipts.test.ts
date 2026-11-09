import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  AttachReceiptSignatureCommand,
  AttachReceiptSignatureOutcome,
  PendingBacklogRead,
  PendingReceiptQueue,
  PendingReceiptRow,
  PendingReceiptsRead,
} from "@/application/ports/pending-receipt-signing";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import type { EvidenceReceiptPayloadV2 } from "@/domain/forensics/evidence-receipt";
import {
  verifySignedEvidenceReceiptV2,
  type EvidenceDomainKey,
} from "@/domain/forensics/evidence-receipt-verifier";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { SignatureEnvelope } from "@/domain/forensics/signature";

import {
  createReconcilePendingReceipts,
  type ReconcileDeps,
  type ReconcileSummary,
} from "./reconcile-pending-receipts";
import { createSignPendingReceipt, type SignPendingReceiptOutcome } from "./sign-pending-receipt";

// Every value here is invented for the test.
const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const GRACE = 60_000;
const OLD = "2026-11-09T11:00:00.000Z";
const OLDER = "2026-11-09T10:00:00.000Z";
const FRESH = "2026-11-09T11:59:30.000Z";
const FUTURE = "2026-11-09T12:10:00.000Z";
const D1 = "00000000-0000-4000-8000-0000000000d1";
const D2 = "00000000-0000-4000-8000-0000000000d2";
const D3 = "00000000-0000-4000-8000-0000000000d3";
const rid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const row = (n: number): PendingReceiptRow => ({ receiptId: rid(n), receiptPayloadText: `text-${n}` });
const backlogRow = (evidenceDomainId: string, oldestCreatedAt = OLD, pendingCount = 1) => ({
  evidenceDomainId,
  pendingCount,
  oldestCreatedAt,
});

type Outcome = SignPendingReceiptOutcome | unknown;

function harness(opts: {
  backlog: () => Promise<PendingBacklogRead> | PendingBacklogRead;
  receipts?: Record<string, PendingReceiptRow[] | (() => unknown)>;
  sign?: (row: PendingReceiptRow) => Outcome | Promise<Outcome>;
  deps?: Partial<ReconcileDeps>;
}) {
  const queue = {
    backlog: vi.fn(async () => opts.backlog()),
    pendingReceipts: vi.fn(async (domain: string, limit: number) => {
      const entry = opts.receipts?.[domain] ?? [];
      if (typeof entry === "function") return entry() as PendingReceiptsRead;
      return { status: "ok" as const, rows: entry.slice(0, Math.max(limit, entry.length)) };
    }),
  } satisfies PendingReceiptQueue;
  const signPendingReceipt = vi.fn(async (r: PendingReceiptRow) =>
    (await (opts.sign ?? (() => ({ status: "signed", signedReceipt: {} })))(r)) as SignPendingReceiptOutcome,
  );
  const run = createReconcilePendingReceipts({
    queue,
    signPendingReceipt,
    now: () => NOW,
    graceMs: GRACE,
    batchLimit: 3,
    maxDomains: 10,
    ...opts.deps,
  });
  const signedIds = () => signPendingReceipt.mock.calls.map(([r]) => r.receiptId);
  const queried = () => queue.pendingReceipts.mock.calls.map(([d]) => d);
  return { queue, signPendingReceipt, run, signedIds, queried };
}

const ok = (rows: unknown[]) => () => ({ status: "ok", rows }) as PendingBacklogRead;

describe("reconcilePendingReceipts: backlog input classes", () => {
  const unreadable: [string, () => unknown][] = [
    ["unavailable", () => ({ status: "unavailable", reason: "db_down" })],
    ["throws", () => { throw new Error("connection reset"); }],
    ["null", () => null],
    ["a number", () => 7],
    ["rows not an array", () => ({ status: "ok", rows: { length: 1, 0: backlogRow(D1) } })],
    ["status not ok", () => ({ status: "OK", rows: [backlogRow(D1)] })],
  ];
  it.each(unreadable)("an unreadable backlog (%s) signs nothing and queries no domain", async (_, read) => {
    const h = harness({ backlog: read as () => PendingBacklogRead, receipts: { [D1]: [row(1)] } });
    const out = await h.run();
    expect(out.status).toBe("unavailable");
    expect(h.queue.pendingReceipts).not.toHaveBeenCalled();
    expect(h.signPendingReceipt).not.toHaveBeenCalled();
  });

  const malformed: [string, unknown][] = [
    ["null", null],
    ["a string", D2],
    ["an array", [D2, 1, OLD]],
    ["missing domain", { pendingCount: 1, oldestCreatedAt: OLD }],
    ["domain not a uuid", backlogRow("domain-2")],
    ["domain in upper case", backlogRow(D2.toUpperCase())],
    ["domain with spaces", backlogRow(` ${D2}`)],
    ["count zero", backlogRow(D2, OLD, 0)],
    ["count negative", backlogRow(D2, OLD, -1)],
    ["count fractional", backlogRow(D2, OLD, 1.5)],
    ["count as text", { ...backlogRow(D2), pendingCount: "3" }],
    ["count NaN", backlogRow(D2, OLD, Number.NaN)],
    ["count unsafe", backlogRow(D2, OLD, 2 ** 53)],
    ["time not a string", { ...backlogRow(D2), oldestCreatedAt: Date.parse(OLD) }],
    ["time as words", backlogRow(D2, "yesterday")],
    ["time date only", backlogRow(D2, "2026-11-09")],
    ["time without zone", backlogRow(D2, "2026-11-09T11:00:00")],
    ["time impossible", backlogRow(D2, "2026-13-45T11:00:00.000Z")],
    ["time empty", backlogRow(D2, "")],
  ];
  it.each(malformed)("a malformed row (%s) is skipped and the valid domain is still swept", async (_, bad) => {
    const h = harness({ backlog: ok([bad, backlogRow(D1)]), receipts: { [D1]: [row(1)], [D2]: [row(2)] } });
    const out = await h.run();
    expect(out.status).toBe("completed");
    expect(out.domains.malformed).toBe(1);
    expect(h.queried()).toEqual([D1]);
    expect(h.signedIds()).toEqual([rid(1)]);
  });

  it("a domain listed twice is swept once", async () => {
    const h = harness({ backlog: ok([backlogRow(D1), backlogRow(D1, OLDER)]), receipts: { [D1]: [row(1)] } });
    const out = await h.run();
    expect(h.queried()).toEqual([D1]);
    expect(h.signedIds()).toEqual([rid(1)]);
    expect(out.domains.swept).toBe(1);
  });

  it("skips a domain whose oldest pending receipt is inside the grace period, at the exact boundary too", async () => {
    const atBoundary = new Date(NOW - GRACE).toISOString();
    const justInside = new Date(NOW - GRACE + 1).toISOString();
    const h = harness({
      backlog: ok([backlogRow(D1, FRESH), backlogRow(D2, atBoundary), backlogRow(D3, justInside)]),
      receipts: { [D1]: [row(1)], [D2]: [row(2)], [D3]: [row(3)] },
    });
    const out = await h.run();
    expect(h.queried()).toEqual([D2]);
    expect(out.domains).toMatchObject({ swept: 1, fresh: 2 });
  });

  it("sweeps a domain whose oldest time lies in the future, so a skewed clock never hides it for good", async () => {
    const h = harness({ backlog: ok([backlogRow(D1, FUTURE)]), receipts: { [D1]: [row(1)] } });
    expect((await h.run()).domains.swept).toBe(1);
    expect(h.signedIds()).toEqual([rid(1)]);
  });

  const badClocks: [string, () => number][] = [
    ["NaN", () => Number.NaN],
    ["Infinity", () => Number.POSITIVE_INFINITY],
    ["a string", () => "1" as unknown as number],
    ["a throw", () => { throw new Error("clock"); }],
  ];
  it.each(badClocks)("applies no grace when the clock gives %s", async (_, now) => {
    const h = harness({
      backlog: ok([backlogRow(D1, FRESH)]),
      receipts: { [D1]: [row(1)] },
      deps: { now },
    });
    const out = await h.run();
    expect(h.signedIds()).toEqual([rid(1)]);
    expect(out.oldestPendingAgeMs).toBeNull();
  });

  it("sweeps the oldest domains first and defers the rest past maxDomains", async () => {
    const h = harness({
      backlog: ok([backlogRow(D1, OLD), backlogRow(D2, OLDER), backlogRow(D3, "2026-11-09T09:00:00.000Z")]),
      receipts: { [D1]: [row(1)], [D2]: [row(2)], [D3]: [row(3)] },
      deps: { maxDomains: 2 },
    });
    const out = await h.run();
    expect(h.queried()).toEqual([D3, D2]);
    expect(out.domains).toMatchObject({ swept: 2, deferred: 1 });
  });

  it("reports the total and the oldest age over valid rows for the alarm, and no id at all", async () => {
    const h = harness({
      backlog: ok([backlogRow(D1, OLD, 4), backlogRow(D2, FRESH, 2), null]),
      receipts: { [D1]: [row(1)] },
    });
    const out = await h.run();
    expect(out.pendingTotal).toBe(6);
    expect(out.oldestPendingAgeMs).toBe(NOW - Date.parse(OLD));
    const text = JSON.stringify(out);
    for (const id of [D1, D2, rid(1), "text-1"]) expect(text).not.toContain(id);
  });
});

describe("reconcilePendingReceipts: pending receipt input classes", () => {
  const unreadable: [string, () => unknown][] = [
    ["unavailable", () => ({ status: "unavailable", reason: "timeout" })],
    ["throws", () => { throw new Error("boom"); }],
    ["null", () => null],
    ["rows not an array", () => ({ status: "ok", rows: "row" })],
  ];
  it.each(unreadable)("an unreadable domain (%s) is counted and the next domain is still swept", async (_, read) => {
    const h = harness({
      backlog: ok([backlogRow(D1, OLDER), backlogRow(D2, OLD)]),
      receipts: { [D1]: read, [D2]: [row(2)] },
    });
    const out = await h.run();
    expect(out.status).toBe("completed");
    expect(out.domains).toMatchObject({ swept: 1, unavailable: 1 });
    expect(h.signedIds()).toEqual([rid(2)]);
  });

  const malformed: [string, unknown][] = [
    ["null", null],
    ["a string", rid(9)],
    ["missing id", { receiptPayloadText: "text-9" }],
    ["id not a uuid", { receiptId: "receipt-9", receiptPayloadText: "text-9" }],
    ["id in upper case", { receiptId: rid(0xab).toUpperCase(), receiptPayloadText: "text-9" }],
    ["id a number", { receiptId: 9, receiptPayloadText: "text-9" }],
  ];
  it.each(malformed)("a malformed receipt row (%s) is never signed and the rest are", async (_, bad) => {
    const h = harness({ backlog: ok([backlogRow(D1)]), receipts: { [D1]: [bad as PendingReceiptRow, row(1)] } });
    const out = await h.run();
    expect(out.receipts.malformed).toBe(1);
    expect(h.signedIds()).toEqual([rid(1)]);
  });

  it("asks for batchLimit rows, signs a duplicate once and never more than batchLimit", async () => {
    const h = harness({
      backlog: ok([backlogRow(D1)]),
      receipts: { [D1]: [row(1), row(1), row(2), row(3), row(4)] },
    });
    await h.run();
    expect(h.queue.pendingReceipts).toHaveBeenCalledWith(D1, 3);
    expect(h.signedIds()).toEqual([rid(1), rid(2)]);
  });
});

describe("reconcilePendingReceipts: signing outcomes", () => {
  const go = (status: string, extra: Record<string, unknown> = {}) => ({ status, ...extra });
  const continuing: [string, unknown, keyof ReconcileSummary["receipts"]][] = [
    ["signed", go("signed", { signedReceipt: {} }), "signed"],
    ["already_signed", go("already_signed", { signedReceipt: {} }), "alreadySigned"],
    ["refused", go("refused", { reason: "not_canonical" }), "refused"],
    ["held", go("held", { reason: "object_absent" }), "held"],
  ];
  it.each(continuing)("%s is counted and the sweep goes on", async (_, outcome, key) => {
    const h = harness({ backlog: ok([backlogRow(D1)]), receipts: { [D1]: [row(1), row(2)] }, sign: () => outcome });
    const out = await h.run();
    expect(out.status).toBe("completed");
    expect(out.receipts[key]).toBe(2);
    expect(h.signedIds()).toEqual([rid(1), rid(2)]);
  });

  const domainStops: [string, () => unknown][] = [
    ["store", () => go("unavailable", { stage: "store", reason: "store_unavailable" })],
    ["object", () => go("unavailable", { stage: "object", reason: "presence_unavailable" })],
    ["keys", () => go("unavailable", { stage: "keys", reason: "keys_unavailable" })],
    ["an unknown stage", () => go("unavailable", { stage: "elsewhere" })],
    ["a throw", () => { throw new Error("bug"); }],
    ["junk", () => "signed"],
    ["an unknown status", () => go("done")],
  ];
  it.each(domainStops)("%s stops the domain and the next domain is swept", async (_, outcome) => {
    const h = harness({
      backlog: ok([backlogRow(D1, OLDER), backlogRow(D2, OLD)]),
      receipts: { [D1]: [row(1), row(2)], [D2]: [row(3)] },
      sign: (r) => (r.receiptId === rid(3) ? go("signed", { signedReceipt: {} }) : outcome()),
    });
    const out = await h.run();
    expect(out.status).toBe("completed");
    expect(h.signedIds()).toEqual([rid(1), rid(3)]);
    expect(out.receipts).toMatchObject({ unavailable: 1, signed: 1 });
    expect(out.domains).toMatchObject({ swept: 1, unavailable: 1 });
  });

  const sweepStops: [string, unknown][] = [
    ["signing", go("unavailable", { stage: "signing", reason: "sign_timeout" })],
    ["hash", go("unavailable", { stage: "hash", reason: "hash_unavailable" })],
    ["verification", go("unavailable", { stage: "verification", reason: "verification_unavailable" })],
    ["signer_rejected", go("signer_rejected", { reason: "key_unknown" })],
  ];
  it.each(sweepStops)("%s stops the whole sweep, so a broken signer is called once", async (stop, outcome) => {
    const h = harness({
      backlog: ok([backlogRow(D1, OLDER), backlogRow(D2, OLD)]),
      receipts: { [D1]: [row(1), row(2)], [D2]: [row(3)] },
      sign: () => outcome,
    });
    const out = await h.run();
    expect(out.status).toBe("stopped");
    expect(out.stoppedAt).toBe(stop);
    expect(h.signedIds()).toEqual([rid(1)]);
    expect(h.queried()).toEqual([D1]);
  });
});

describe("reconcilePendingReceipts: domains past maxDomains are not starved", () => {
  const go = (status: string, extra: Record<string, unknown> = {}) => ({ status, ...extra });
  const stuck: [string, PendingReceiptRow[], (r: PendingReceiptRow) => unknown][] = [
    ["only v1 receipts (no v2 rows)", [], () => go("signed", { signedReceipt: {} })],
    ["always held", [row(1)], (r) => (r.receiptId === rid(1) ? go("held", { reason: "object_absent" }) : go("signed", { signedReceipt: {} }))],
    ["always unavailable at the store", [row(1)], (r) =>
      r.receiptId === rid(1) ? go("unavailable", { stage: "store" }) : go("signed", { signedReceipt: {} })],
  ];
  it.each(stuck)("an older domain with %s does not hold the only slot", async (_, stuckRows, sign) => {
    const h = harness({
      backlog: ok([backlogRow(D1, OLDER), backlogRow(D2, OLD)]),
      receipts: { [D1]: stuckRows, [D2]: [row(2)] },
      sign,
      deps: { maxDomains: 1 },
    });
    await h.run();
    expect(h.queried()).toEqual([D1]);
    await h.run();
    expect(h.queried()).toEqual([D1, D2]);
    expect(h.signedIds()).toContain(rid(2));
  });

  it("reaches every due domain within ceil(due / maxDomains) passes after the first", async () => {
    const h = harness({
      backlog: ok([backlogRow(D1, OLD), backlogRow(D2, OLDER), backlogRow(D3, "2026-11-09T09:00:00.000Z")]),
      deps: { maxDomains: 2 },
    });
    await h.run();
    expect(h.queried()).toEqual([D3, D2]);
    await h.run();
    // The second window wraps past D3 to D1 and D2, still oldest first.
    expect(h.queried().slice(2)).toEqual([D2, D1]);
    expect(new Set(h.queried())).toEqual(new Set([D1, D2, D3]));
  });

  it("a stopped sweep keeps the window, so the next pass retries the same domain", async () => {
    let calls = 0;
    const h = harness({
      backlog: ok([backlogRow(D1, OLDER), backlogRow(D2, OLD)]),
      receipts: { [D1]: [row(1)], [D2]: [row(2)] },
      sign: () => (++calls === 1 ? go("unavailable", { stage: "signing" }) : go("signed", { signedReceipt: {} })),
      deps: { maxDomains: 1 },
    });
    expect((await h.run()).status).toBe("stopped");
    expect((await h.run()).status).toBe("completed");
    expect(h.queried()).toEqual([D1, D1]);
    await h.run();
    expect(h.queried()).toEqual([D1, D1, D2]);
  });

  it("forgets the cursor once every due domain fits, so the oldest go first again", async () => {
    let backlog = [backlogRow(D1, OLDER), backlogRow(D2, OLD)];
    const h = harness({ backlog: () => ({ status: "ok", rows: backlog }) as PendingBacklogRead, deps: { maxDomains: 1 } });
    await h.run();
    backlog = [backlogRow(D1, OLDER)];
    await h.run();
    backlog = [backlogRow(D1, OLDER), backlogRow(D2, OLD)];
    await h.run();
    expect(h.queried()).toEqual([D1, D1, D1]);
  });
});

describe("createReconcilePendingReceipts: configuration", () => {
  const base = (): ReconcileDeps => ({
    queue: { backlog: async () => ({ status: "ok", rows: [] }), pendingReceipts: async () => ({ status: "ok", rows: [] }) },
    signPendingReceipt: async () => ({ status: "refused", reason: "invalid" }),
    now: () => NOW,
    graceMs: GRACE,
    batchLimit: 3,
    maxDomains: 10,
  });
  const bad: [string, Partial<Record<keyof ReconcileDeps, unknown>>][] = [
    ["graceMs negative", { graceMs: -1 }],
    ["graceMs fractional", { graceMs: 1.5 }],
    ["graceMs over a day", { graceMs: 86_400_001 }],
    ["batchLimit zero", { batchLimit: 0 }],
    ["batchLimit over 100", { batchLimit: 101 }],
    ["maxDomains zero", { maxDomains: 0 }],
    ["maxDomains over 1000", { maxDomains: 1001 }],
    ["no signer", { signPendingReceipt: undefined }],
    ["no queue", { queue: undefined }],
    ["no clock", { now: undefined }],
  ];
  it.each(bad)("refuses %s", (_, patch) => {
    expect(() => createReconcilePendingReceipts({ ...base(), ...patch } as ReconcileDeps)).toThrow();
  });
});

// Istodobnost (DAN-593): the worker's job and the reconciler sign the same
// receipt at once, each with its own key. The store mirrors
// `app.worker_attach_receipt_signature`: the row is locked FOR UPDATE, so the
// second attach waits for the first and then finds the receipt signed.
describe("reconciler and worker sign the same receipt at once", () => {
  const DOMAIN = D1;
  const RECEIPT = rid(0xc1);
  const PAYLOAD: EvidenceReceiptPayloadV2 = {
    receiptSchema: "ductus-evidence-receipt-v2",
    receiptId: RECEIPT,
    evidenceDomainId: DOMAIN,
    evidencePackageId: "pkg-1",
    documentId: "doc-1",
    revision: 1,
    clientTransactionId: "tx-1",
    principalId: "00000000-0000-4000-8000-0000000000e1",
    sessionId: "session-1",
    segmentId: "segment-1",
    segmentHash: "b".repeat(64),
    predecessorSegmentHash: null,
    previousReceiptId: null,
    evidenceSchema: "ductus-evidence-segment-v2",
    evidenceProfileId: "standard-v1",
    sequenceFrom: 1,
    sequenceTo: 1,
    eventCount: 1,
    payloadBytes: 123,
    acceptedAt: "2026-10-19T06:00:00.000Z",
  };
  const TEXT = canonicalizeJcs(PAYLOAD);
  const ROW = { receiptId: RECEIPT, receiptPayloadText: TEXT };

  function keySigner(keyId: string) {
    const pair = generateKeyPairSync("ed25519");
    const provider = {
      sign: vi.fn(async (input: Uint8Array): Promise<SignatureEnvelope> => ({
        algorithm: "Ed25519", keyId, keyVersion: "1", signatureEncoding: "raw",
        signatureBase64Url: nodeSign(null, input, pair.privateKey).toString("base64url"),
      })),
      verify: async () => false,
      publicVerificationKey: async () => { throw new Error("not used"); },
    } as unknown as SigningKeyProvider & { sign: ReturnType<typeof vi.fn> };
    const key: EvidenceDomainKey = {
      algorithm: "Ed25519", keyId, keyVersion: "1", encoding: "spki-der",
      keyBase64Url: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      evidenceDomainId: DOMAIN, purpose: "receipt",
      validFrom: "2026-01-01T00:00:00.000Z", validTo: null, revokedAt: null,
    };
    return { provider, key };
  }

  function lockedStore(keys: readonly EvidenceDomainKey[]) {
    const stored = new Map<string, unknown>();
    const writes: unknown[] = [];
    let lock: Promise<void> = Promise.resolve();
    let holdFirst: Promise<void> | undefined;
    let entered = 0;
    const waiters: Array<[number, () => void]> = [];
    const store = {
      receiptKeys: vi.fn(async () => ({ status: "ok" as const, keys })),
      attachSignature: vi.fn(async (c: AttachReceiptSignatureCommand): Promise<AttachReceiptSignatureOutcome> => {
        const order = ++entered;
        for (const [n, wake] of waiters) if (n === order) wake();
        const before = lock;
        let release!: () => void;
        lock = new Promise<void>((resolve) => { release = resolve; });
        await before; // FOR UPDATE
        try {
          if (order === 1 && holdFirst) await holdFirst;
          if (stored.has(c.receiptId)) return { outcome: "already_signed", signature: stored.get(c.receiptId) };
          const digest = createHash("sha256").update(TEXT, "utf8").digest("hex");
          if (digest !== c.payloadDigestSha256) return { outcome: "digest_mismatch" };
          stored.set(c.receiptId, c.signature);
          writes.push(c.signature);
          return { outcome: "signed", signature: c.signature };
        } finally {
          release();
        }
      }),
    };
    return {
      store,
      stored,
      writes,
      hold: (until: Promise<void>) => { holdFirst = until; },
      entered: (n: number) => new Promise<void>((resolve) => { waiters.push([n, resolve]); }),
    };
  }

  function setup() {
    const worker = keySigner("worker-key");
    const reconcilerKey = keySigner("reconciler-key");
    const db = lockedStore([worker.key, reconcilerKey.key]);
    const common = { store: db.store, checkObject: async () => ({ status: "present" as const }), signTimeoutMs: 1000 };
    const workerSign = createSignPendingReceipt({ ...common, signer: worker.provider });
    const reconcilerSign = vi.fn(createSignPendingReceipt({ ...common, signer: reconcilerKey.provider }));
    const reconcile = createReconcilePendingReceipts({
      queue: {
        backlog: async () => ({ status: "ok", rows: [backlogRow(DOMAIN, OLD)] }),
        pendingReceipts: async () => ({ status: "ok", rows: [ROW] }),
      },
      signPendingReceipt: reconcilerSign,
      now: () => NOW,
      graceMs: GRACE,
      batchLimit: 10,
      maxDomains: 10,
    });
    return { worker, reconcilerKey, db, workerSign, reconcilerSign, reconcile };
  }

  it("stores exactly one signature, the worker's, while the reconciler waits on the row lock", async () => {
    const { worker, reconcilerKey, db, workerSign, reconcilerSign, reconcile } = setup();
    let releaseWorker!: () => void;
    db.hold(new Promise<void>((resolve) => { releaseWorker = resolve; }));

    const workerDone = workerSign(ROW);
    const reconcilerAtLock = db.entered(2);
    const sweep = reconcile();
    await reconcilerAtLock;
    // Both signers have signed with their own key; only the worker holds the row.
    expect(worker.provider.sign).toHaveBeenCalledTimes(1);
    expect(reconcilerKey.provider.sign).toHaveBeenCalledTimes(1);
    expect(db.writes).toHaveLength(0);
    releaseWorker();

    const [workerOut, summary] = await Promise.all([workerDone, sweep]);
    expect(workerOut.status).toBe("signed");
    expect(db.writes).toHaveLength(1);
    const kept = db.stored.get(RECEIPT) as SignatureEnvelope;
    expect(kept.keyId).toBe("worker-key");
    expect(summary.receipts).toMatchObject({ signed: 0, alreadySigned: 1, unavailable: 0 });
    expect(db.store.attachSignature).toHaveBeenCalledTimes(2);
    const reconcilerOut = await reconcilerSign.mock.results[0]!.value;
    expect(reconcilerOut.status).toBe("already_signed");
    expect(reconcilerOut.signedReceipt.signature).toEqual(kept);
    const check = await verifySignedEvidenceReceiptV2(
      reconcilerOut.signedReceipt,
      { documentId: "doc-1", clientTransactionId: "tx-1", revision: 1, evidenceDomainId: DOMAIN },
      [worker.key],
    );
    expect(check.ok).toBe(true);
  });

  it("finds a receipt the worker signed after the list was read already signed and never attaches again", async () => {
    const { db, workerSign, reconcile } = setup();
    expect((await workerSign(ROW)).status).toBe("signed");
    const summary = await reconcile();
    expect(summary.receipts).toMatchObject({ signed: 0, alreadySigned: 1 });
    expect(db.writes).toHaveLength(1);
    expect((db.stored.get(RECEIPT) as SignatureEnvelope).keyId).toBe("worker-key");
    expect(db.store.attachSignature).toHaveBeenCalledTimes(2);
  });

  it("of two reconcilers sweeping at once, one signs and the other finds it signed", async () => {
    const a = setup();
    const b = createReconcilePendingReceipts({
      queue: {
        backlog: async () => ({ status: "ok", rows: [backlogRow(DOMAIN, OLD)] }),
        pendingReceipts: async () => ({ status: "ok", rows: [ROW] }),
      },
      signPendingReceipt: a.workerSign,
      now: () => NOW,
      graceMs: GRACE,
      batchLimit: 10,
      maxDomains: 10,
    });
    const [x, y] = await Promise.all([a.reconcile(), b()]);
    expect(x.receipts.signed + y.receipts.signed).toBe(1);
    expect(x.receipts.alreadySigned + y.receipts.alreadySigned).toBe(1);
    expect(a.db.writes).toHaveLength(1);
  });
});
