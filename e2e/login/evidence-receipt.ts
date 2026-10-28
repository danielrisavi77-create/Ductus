import { createHash } from "node:crypto";

import type { Page, Route } from "@playwright/test";
import type pg from "pg";

import type { EvidenceReceiptPayloadV2 } from "../../src/domain/forensics/evidence-receipt";
import {
  verifySignedEvidenceReceiptV2,
  type EvidenceDomainKey,
} from "../../src/domain/forensics/evidence-receipt-verifier";
import type { ActorTransaction } from "../../src/server/db/with-actor";
import { readEvidenceDomainKeys } from "../../src/server/evidence/evidence-domain-keys";

// K-4c-2 (#655, contract c.6386610626): the Node side of the server part of
// F-8 in demo-flow.spec.ts. The step itself waits for 3d-2c2 (LocalDocument
// sends the evidence). A receipt counts here only when it verifies under the
// keys the local stack registered (evidence.signing_key), never under a key an
// answer names, and only for the revision the database holds as the
// document's checkpoint. The route helpers break one answer of the commit
// route the way a network or a forger would.

type Query = Pick<pg.Client, "query">;

export type StackKeys = { evidenceDomainId: string; keys: EvidenceDomainKey[] };
export type StackCheckpoint = { revision: number; contentHash: string; body: string };
export type ReceiptCheck =
  | { ok: true; payload: EvidenceReceiptPayloadV2 }
  | { ok: false; reason: string };

const COMMIT_ROUTE = "**/api/evidence/commit";

/** Every key of one evidence domain as the stack's registry holds it. */
export async function stackKeysOfDomain(client: Query, evidenceDomainId: string): Promise<StackKeys> {
  // The admin login reads past RLS; the rows and their form are the server's own reader's.
  const read = await readEvidenceDomainKeys(client as unknown as ActorTransaction, evidenceDomainId);
  if (read.status !== "ok") throw new Error(`the stack's keys are unreadable: ${read.reason}`);
  if (!read.keys.some((key) => key.purpose === "receipt")) throw new Error("the stack registers no receipt key");
  return { evidenceDomainId, keys: read.keys };
}

/** The keys of the one evidence domain of the document's packages. */
export async function stackReceiptKeys(client: Query, documentId: string): Promise<StackKeys> {
  const { rows } = await client.query<{ domain: string }>(
    "SELECT DISTINCT evidence_domain_id::text AS domain FROM evidence.package WHERE document_id = $1", [documentId]);
  if (rows.length !== 1) throw new Error(`expected one evidence domain for the document, found ${rows.length}`);
  return stackKeysOfDomain(client, rows[0]!.domain);
}

/** The checkpoint of the document's current revision, or null when the database holds none. */
export async function stackCheckpoint(client: Query, documentId: string): Promise<StackCheckpoint | null> {
  const { rows } = await client.query<{ revision: string; content_hash: string; body: string }>(
    `SELECT c.revision::text AS revision, c.content_hash, c.body
       FROM evidence.document d
       JOIN evidence.document_checkpoint c
         ON c.document_id = d.id AND c.institution_id = d.institution_id
        AND c.revision = d.current_revision AND c.content_hash = d.current_content_hash
      WHERE d.id = $1`, [documentId]);
  const row = rows[0];
  if (!row) return null;
  if (createHash("sha256").update(row.body, "utf8").digest("hex") !== row.content_hash) {
    throw new Error("the checkpoint's hash is not the hash of its text");
  }
  return { revision: Number(row.revision), contentHash: row.content_hash, body: row.body };
}

/**
 * The receipt verifies under the stack's keys for this document, transaction
 * and the checkpoint's revision, and names the segment the test sent.
 */
export async function verifyWithStackKeys(
  signedReceipt: unknown,
  sent: { documentId: string; clientTransactionId: string; segmentHash: string },
  checkpoint: StackCheckpoint,
  stack: StackKeys,
): Promise<ReceiptCheck> {
  const verified = await verifySignedEvidenceReceiptV2(signedReceipt, {
    documentId: sent.documentId,
    clientTransactionId: sent.clientTransactionId,
    revision: checkpoint.revision,
    evidenceDomainId: stack.evidenceDomainId,
  }, stack.keys);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  if (verified.payload.segmentHash !== sent.segmentHash) return { ok: false, reason: "segment_mismatch" };
  return { ok: true, payload: verified.payload };
}

/** The signature with exactly one byte changed. */
export function flipSignatureByte(signatureBase64Url: string, index = 0): string {
  const bytes = Buffer.from(signatureBase64Url, "base64url");
  if (index < 0 || index >= bytes.length) throw new Error("no such signature byte");
  bytes[index] = bytes[index]! ^ 0x01;
  return bytes.toString("base64url");
}

type CommitAnswer = { status?: unknown; receipt?: { status?: unknown; signedReceipt?: Record<string, unknown> } };

const signedReceiptOf = (answer: CommitAnswer) =>
  answer.receipt?.status === "signed" ? answer.receipt.signedReceipt : undefined;

async function answerOf(route: Route) {
  const response = await route.fetch();
  return { response, answer: (await response.json()) as CommitAnswer };
}

/** The next commit reaches the server, but its answer is lost on the way back. */
export async function loseNextCommitAnswer(page: Page): Promise<void> {
  await page.route(COMMIT_ROUTE, async (route) => {
    await route.fetch();
    await route.abort("connectionreset");
  }, { times: 1 });
}

/** The next signed receipt arrives with one signature byte changed. */
export async function tamperNextReceipt(page: Page): Promise<void> {
  await page.route(COMMIT_ROUTE, async (route) => {
    const { response, answer } = await answerOf(route);
    const signed = signedReceiptOf(answer);
    const signature = signed?.signature as { signatureBase64Url?: unknown } | undefined;
    if (typeof signature?.signatureBase64Url !== "string") throw new Error("the commit answer carries no signed receipt");
    signature.signatureBase64Url = flipSignatureByte(signature.signatureBase64Url);
    await route.fulfill({ response, json: answer });
  }, { times: 1 });
}

/**
 * Every commit after the first answers with the first one's signed receipt: a
 * receipt the stack did sign, but for another segment and revision.
 */
export async function replayFirstReceipt(page: Page): Promise<void> {
  let first: Record<string, unknown> | undefined;
  await page.route(COMMIT_ROUTE, async (route) => {
    const { response, answer } = await answerOf(route);
    const signed = signedReceiptOf(answer);
    if (first === undefined) first = signed;
    else if (signed !== undefined) answer.receipt = { status: "signed", signedReceipt: first };
    await route.fulfill({ response, json: answer });
  });
}
