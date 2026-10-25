import { expect, test, type Page, type Route } from "@playwright/test";

import type { EvidenceDomainKey } from "../../src/domain/forensics/evidence-receipt-verifier";
import { fromHex, loadGoldenVectors } from "../../src/domain/forensics/golden-vectors/load";
import { admin } from "./comment-seed";
import {
  flipSignatureByte, loseNextCommitAnswer, replayFirstReceipt, stackCheckpoint, stackKeysOfDomain,
  stackReceiptKeys, tamperNextReceipt, verifyWithStackKeys,
} from "./evidence-receipt";

// K-4c-2 (#655): the Node harness for the server part of F-8, checked on its
// own until 3d-2c2 lets demo-flow.spec.ts run that step. No browser starts.
// The receipt is the golden contract vector; its key is invented.

const { receiptV2, chain } = loadGoldenVectors();
const [contract] = receiptV2.accepted;
const RECEIPT = { payload: contract!.payload, payloadDigestSha256: contract!.payloadDigestSha256, signature: contract!.signature };
const GOLDEN: EvidenceDomainKey = {
  algorithm: "Ed25519", keyId: chain.verificationKey.keyId, keyVersion: chain.verificationKey.keyVersion,
  encoding: "spki-der", keyBase64Url: Buffer.from(fromHex(chain.verificationKey.spkiDerHex)).toString("base64url"),
  ...receiptV2.keyEntry,
};
const STACK = { evidenceDomainId: receiptV2.evidenceDomainId, keys: [GOLDEN] };
const SENT = {
  documentId: contract!.payload.documentId,
  clientTransactionId: contract!.payload.clientTransactionId,
  segmentHash: contract!.payload.segmentHash,
};
const CHECKPOINT = { revision: contract!.payload.revision, contentHash: "0".repeat(64), body: "{}" };

test.describe("K-4c-2: a receipt counts only under the stack's key and the database's checkpoint", () => {
  test("the contract receipt passes for its own segment and revision", async () => {
    expect(await verifyWithStackKeys(RECEIPT, SENT, CHECKPOINT, STACK)).toEqual({ ok: true, payload: contract!.payload });
  });

  test("one changed signature byte, another segment or another revision is no receipt", async () => {
    const flipped = flipSignatureByte(RECEIPT.signature.signatureBase64Url, 40);
    const before = Buffer.from(RECEIPT.signature.signatureBase64Url, "base64url");
    const after = Buffer.from(flipped, "base64url");
    expect(after.length).toBe(before.length);
    expect([...after].filter((byte, i) => byte !== before[i])).toHaveLength(1);
    const tampered = { ...RECEIPT, signature: { ...RECEIPT.signature, signatureBase64Url: flipped } };
    expect((await verifyWithStackKeys(tampered, SENT, CHECKPOINT, STACK)).ok).toBe(false);
    expect(await verifyWithStackKeys(RECEIPT, { ...SENT, segmentHash: "f".repeat(64) }, CHECKPOINT, STACK))
      .toEqual({ ok: false, reason: "segment_mismatch" });
    expect((await verifyWithStackKeys(RECEIPT, SENT, { ...CHECKPOINT, revision: CHECKPOINT.revision + 1 }, STACK)).ok).toBe(false);
  });

  test("the local stack's receipt keys come from its registry, and they do not vouch for an invented key's receipt", async () => {
    const stack = await admin(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT d.id::text AS id FROM evidence.domain d JOIN identity.institution i ON i.id = d.institution_id
          WHERE i.slug = 'demo-fakultet'`);
      expect(rows).toHaveLength(1);
      return stackKeysOfDomain(client, rows[0]!.id);
    });
    expect(stack.keys.every((key) => key.evidenceDomainId === stack.evidenceDomainId)).toBe(true);
    expect(stack.keys.some((key) => key.keyId === GOLDEN.keyId)).toBe(false);
    // Signed by a key the stack never registered: the stack's keys do not know it.
    expect(await verifyWithStackKeys(RECEIPT, SENT, CHECKPOINT, stack)).toEqual({ ok: false, reason: "key_unknown" });
  });

  test("a document the database does not hold has no checkpoint and no keys", async () => {
    await admin(async (client) => {
      expect(await stackCheckpoint(client, "k4c2-nepostojeci-dokument")).toBeNull();
      await expect(stackReceiptKeys(client, "k4c2-nepostojeci-dokument")).rejects.toThrow(/one evidence domain/);
    });
  });
});

/** A page whose only route is the one a helper adds; the server gives `answers` in turn. */
function fakePage(...answers: unknown[]) {
  const calls: string[] = [];
  let next = 0;
  let handler: ((route: Route) => Promise<void>) | undefined;
  let times: number | undefined;
  const page = {
    route: async (_url: string, fn: (route: Route) => Promise<void>, options?: { times?: number }) => {
      handler = fn;
      times = options?.times;
    },
  } as unknown as Page;
  const send = async () => {
    let fulfilled: unknown;
    const answer = answers[next++];
    const route = {
      fetch: async () => { calls.push("fetch"); return { json: async () => structuredClone(answer) }; },
      abort: async (code: string) => { calls.push(`abort ${code}`); },
      fulfill: async (options: { json: unknown }) => { calls.push("fulfill"); fulfilled = options.json; },
    } as unknown as Route;
    await handler!(route);
    return fulfilled as { receipt: { signedReceipt: typeof RECEIPT } } | undefined;
  };
  return { page, send, calls, times: () => times };
}

const COMMITTED = (receipt: unknown) => ({ status: "committed", revision: 1, receipt: { status: "signed", signedReceipt: receipt } });

test.describe("K-4c-2: the route helpers break one commit answer", () => {
  test("a lost answer: the commit reaches the server and the browser gets a broken connection, once", async () => {
    const fake = fakePage(COMMITTED(RECEIPT));
    await loseNextCommitAnswer(fake.page);
    await fake.send();
    expect(fake.calls).toEqual(["fetch", "abort connectionreset"]);
    expect(fake.times()).toBe(1);
  });

  test("a tampered receipt changes one signature byte and nothing else, once", async () => {
    const fake = fakePage(COMMITTED(RECEIPT));
    await tamperNextReceipt(fake.page);
    const sent = (await fake.send())!.receipt.signedReceipt;
    expect(fake.times()).toBe(1);
    expect(sent.payload).toEqual(RECEIPT.payload);
    expect(sent.signature.signatureBase64Url).toBe(flipSignatureByte(RECEIPT.signature.signatureBase64Url));
    expect((await verifyWithStackKeys(sent, SENT, CHECKPOINT, STACK)).ok).toBe(false);
  });

  test("a replayed receipt: the second commit answers with the first one's signed receipt", async () => {
    const other = { ...RECEIPT, payload: { ...RECEIPT.payload, revision: RECEIPT.payload.revision + 1 } };
    const fake = fakePage(COMMITTED(RECEIPT), COMMITTED(other), COMMITTED(other));
    await replayFirstReceipt(fake.page);
    expect(fake.times()).toBeUndefined();
    expect((await fake.send())!.receipt.signedReceipt).toEqual(RECEIPT);
    expect((await fake.send())!.receipt.signedReceipt).toEqual(RECEIPT);
    expect((await fake.send())!.receipt.signedReceipt).toEqual(RECEIPT);
  });
});
