import type { PendingReceiptRow } from "@/application/ports/pending-receipt-signing";
import { isPlainObject } from "@/domain/json";

import type { SignPendingReceiptOutcome } from "./sign-pending-receipt";

export const MAX_SIGNATURE_RETRY_ATTEMPTS = 10;
export const MAX_SIGNATURE_RETRY_DELAY_MS = 300_000;

export type SignatureRetryPolicy = {
  /** Attempts in total, the first one included. */
  maxAttempts: number;
  /** Ceiling of the first wait; it doubles after every attempt. */
  baseDelayMs: number;
  /** No wait is longer. */
  maxDelayMs: number;
};

/** Why a receipt is left in `pending_signature` for the reconciler or an operator. */
export type SignatureParkReason =
  | "refused"
  | "held"
  | "signer_rejected"
  | "hash"
  | "exhausted"
  | "interrupted";

export type SignatureRetryDecision =
  | { action: "done" }
  | { action: "retry"; delayMs: number }
  | { action: "park"; reason: SignatureParkReason };

type Signed = Extract<SignPendingReceiptOutcome, { status: "signed" | "already_signed" }>;
type Stage = Extract<SignPendingReceiptOutcome, { status: "unavailable" }>["stage"];

/** Counts and a stage only: no receipt id, text or signature, so it may be logged. */
export type SignatureRetryResult =
  | { status: "done"; outcome: Signed; attempts: number }
  | { status: "parked"; reason: SignatureParkReason; attempts: number; lastStage: Stage | null };

export type SignatureRetryDeps = {
  /** `createSignPendingReceipt`: the only way a receipt is signed here. */
  signPendingReceipt: (row: PendingReceiptRow) => Promise<SignPendingReceiptOutcome>;
  policy: SignatureRetryPolicy;
  /** Waits `ms`; a rejection (shutdown, abort) ends the retries. */
  sleep: (ms: number) => Promise<void>;
  /** A value in [0, 1) for the jitter. */
  random: () => number;
};

const STAGES: ReadonlySet<unknown> = new Set(["hash", "keys", "object", "signing", "verification", "store"]);
const TERMINAL: ReadonlySet<unknown> = new Set(["refused", "held", "signer_rejected"]);

function isSafeIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function assertPolicy(policy: unknown): asserts policy is SignatureRetryPolicy {
  if (
    !isPlainObject(policy) ||
    !isSafeIn(policy.maxAttempts, 1, MAX_SIGNATURE_RETRY_ATTEMPTS) ||
    !isSafeIn(policy.maxDelayMs, 1, MAX_SIGNATURE_RETRY_DELAY_MS) ||
    !isSafeIn(policy.baseDelayMs, 1, policy.maxDelayMs)
  ) {
    throw new RangeError("signatureRetry: invalid policy");
  }
}

/**
 * The wait after attempt `attempt`: a value in [ceiling / 2, ceiling], where
 * the ceiling is `baseDelayMs * 2^(attempt - 1)` capped at `maxDelayMs`. An
 * unusable random value waits the whole ceiling, never less and never 0.
 */
export function signatureRetryDelayMs(attempt: number, policy: SignatureRetryPolicy, random: number): number {
  assertPolicy(policy);
  const step = isSafeIn(attempt, 1, MAX_SIGNATURE_RETRY_ATTEMPTS) ? attempt - 1 : MAX_SIGNATURE_RETRY_ATTEMPTS;
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** step);
  if (typeof random !== "number" || !(random >= 0 && random < 1)) return ceiling;
  const floor = Math.ceil(ceiling / 2);
  return Math.min(ceiling, floor + Math.floor(random * (ceiling - floor + 1)));
}

function isSigned(reply: unknown): reply is Signed {
  return (
    isPlainObject(reply) &&
    (reply.status === "signed" || reply.status === "already_signed") &&
    isPlainObject(reply.signedReceipt)
  );
}

/**
 * What to do with the reply of attempt `attempt` (1-based). Only a signed
 * receipt is done. A refusal, a hold, a signer the registry rejects and a
 * failure of hashing are not fixed by waiting, so they park at once. Every
 * other reply, an unknown one included, is transient until the attempts run
 * out.
 */
export function decideSignatureRetry(
  reply: unknown,
  attempt: number,
  policy: SignatureRetryPolicy,
  random: number,
): SignatureRetryDecision {
  assertPolicy(policy);
  if (isSigned(reply)) return { action: "done" };
  const status = isPlainObject(reply) ? reply.status : undefined;
  if (TERMINAL.has(status)) return { action: "park", reason: status as "refused" | "held" | "signer_rejected" };
  if (status === "unavailable" && isPlainObject(reply) && reply.stage === "hash") {
    return { action: "park", reason: "hash" };
  }
  if (!isSafeIn(attempt, 1, policy.maxAttempts - 1)) return { action: "park", reason: "exhausted" };
  return { action: "retry", delayMs: signatureRetryDelayMs(attempt, policy, random) };
}

function lastStageOf(reply: unknown): Stage | null {
  return isPlainObject(reply) && reply.status === "unavailable" && STAGES.has(reply.stage)
    ? (reply.stage as Stage)
    : null;
}

/**
 * Signs one pending receipt v2 and retries a transient failure with capped
 * exponential backoff and jitter (DAN-594, plan #1021 P-14, plan napada
 * #1778). Every attempt goes through `signPendingReceipt` with the same row,
 * snapshotted at the start, so a retry never makes a new receipt id or
 * `acceptedAt`: Ed25519 gives the same signature for the same bytes, and the
 * store's row lock keeps the first one, answering `already_signed` with it
 * after a lost reply or a second signer. A parked receipt stays pending for
 * the reconciler (DAN-593).
 */
export function createSignPendingReceiptWithRetry(deps: SignatureRetryDeps) {
  const { signPendingReceipt, policy, sleep, random } = deps;
  if (typeof signPendingReceipt !== "function" || typeof sleep !== "function" || typeof random !== "function") {
    throw new TypeError("signatureRetry: signPendingReceipt, sleep and random are required");
  }
  assertPolicy(policy);
  const limits: SignatureRetryPolicy = {
    maxAttempts: policy.maxAttempts,
    baseDelayMs: policy.baseDelayMs,
    maxDelayMs: policy.maxDelayMs,
  };

  return async function signPendingReceiptWithRetry(row: PendingReceiptRow): Promise<SignatureRetryResult> {
    const snapshot = { receiptId: row.receiptId, receiptPayloadText: row.receiptPayloadText };
    for (let attempt = 1; ; attempt += 1) {
      let reply: unknown;
      try {
        reply = await signPendingReceipt({ ...snapshot });
      } catch {
        reply = undefined;
      }
      let jitter: number;
      try {
        jitter = random();
      } catch {
        jitter = Number.NaN;
      }
      const decision = decideSignatureRetry(reply, attempt, limits, jitter);
      if (decision.action === "done") return { status: "done", outcome: reply as Signed, attempts: attempt };
      const lastStage = lastStageOf(reply);
      if (decision.action === "park") {
        return { status: "parked", reason: decision.reason, attempts: attempt, lastStage };
      }
      try {
        await sleep(decision.delayMs);
      } catch {
        return { status: "parked", reason: "interrupted", attempts: attempt, lastStage };
      }
    }
  };
}
