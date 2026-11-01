// The merge loop after the owner's "Spoji n" (D-97, D-156). Pure: one step from
// an observation to an action; merge-loop.mjs does the reads and the two writes
// (the Owner-Command comment and "@Mergifyio queue"). Every way out has its own
// exit code and a one-line reason, and the number of rounds is bounded.
import { canonicalBlock, field } from "../engineering/metadata-parser.mjs";

export const EXIT = Object.freeze({ MERGED: 0, FAIL: 4, PATCH: 3, TIMEOUT: 5, BLOK: 6, UNFILLED: 7, HEADS: 8, USAGE: 2 });
const SHA_RE = /^[0-9a-f]{40}$/;

/** Today in Zagreb as the repo writes dates: "1. 11. 2026.". */
export function zagrebDate(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zagreb", day: "numeric", month: "numeric", year: "numeric" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.day)}. ${Number(parts.month)}. ${parts.year}.`;
}

// What a template left unfilled looks like: shell or JS substitution, printf
// conversions, angle-bracket placeholders and stringified missing values.
const UNFILLED_RE = /\$\{|\$\(|\$[A-Z_][A-Z0-9_]*\b|%[sdiq]|<[^<>\n]{1,40}>|\bundefined\b|\bNaN\b|\[object Object\]/;
export function unfilled(text) {
  return UNFILLED_RE.exec(String(text))?.[0] ?? null;
}

/** The Owner-Command comment for one head, in the form the gate reads (review-gate-core validCommandShape). */
export function ownerCommandText({ number, head, commandedHead, quote, date }) {
  const note = head === commandedHead
    ? ""
    : ` Naredba je dana na ${commandedHead.slice(0, 8)}; ovaj head je čisto spajanje maina s istim patch-idom i gateom SUCCESS, D-156.`;
  return `Owner-Command: merge\nCommand-Head: ${head}\nSpoji #${number} na ovom headu (Daniel u sesiji orkestratora, ${date}: "${quote}").${note}\n`;
}

/** null when `text` may be posted for `head`, else why not. */
export function commandProblem(text, head) {
  const left = unfilled(text);
  if (left) return `unfilled variable in the Owner-Command text: ${left}`;
  if (!SHA_RE.test(head ?? "")) return "the head is not a full SHA";
  if (!canonicalBlock(text, "Owner-Command") || field(text, "Owner-Command") !== "merge" || field(text, "Command-Head") !== head) {
    return "the text does not read back as Owner-Command: merge for this head";
  }
  return null;
}

export function newMemory({ commandedHead, commandedPatch, maxRounds = 75, maxHeads = 4 }) {
  return { commandedHead, commandedPatch, maxRounds, maxHeads, rounds: 0, heads: new Set([commandedHead]), posted: new Set(), queued: new Set() };
}

// BLOCKED checks that are a red result rather than something GitHub or a person holds.
const RED = new Set(["ci", "gate", "authorization"]);
const exit = (code, reason) => ({ action: "exit", code, reason });

/**
 * One round. obs = {state: OPEN|MERGED|CLOSED, head, patchId (of head; null when
 * unread, needed only when head differs from the commanded one), readiness
 * (evaluateMergeReady result), commandOnHead (an owner Owner-Command for this
 * head already exists on the PR)}. Returns {action: exit|post-command|queue|wait, code?, reason}.
 * The caller records a done post or queue in memory.posted / memory.queued.
 */
export function step(memory, obs) {
  memory.rounds += 1;
  const head = obs.head;
  if (obs.state === "MERGED") return exit(EXIT.MERGED, `MERGED at ${String(head).slice(0, 8)}`);
  if (obs.state !== "OPEN") return exit(EXIT.FAIL, `FAIL: PR is ${obs.state}, not merged`);
  if (!SHA_RE.test(head ?? "")) return exit(EXIT.FAIL, "FAIL: the PR head could not be read");
  if (head !== memory.commandedHead) {
    if (!obs.patchId) return exit(EXIT.FAIL, `FAIL: patch-id of ${head.slice(0, 8)} could not be computed; the command is not carried blindly`);
    if (obs.patchId !== memory.commandedPatch) {
      return exit(EXIT.PATCH, `PATCH: patch-id changed at ${head.slice(0, 8)} (${obs.patchId.slice(0, 12)} vs ${memory.commandedPatch.slice(0, 12)}); the command is void (D-156)`);
    }
    memory.heads.add(head);
    if (memory.heads.size > memory.maxHeads) return exit(EXIT.HEADS, `HEADS: the head changed ${memory.heads.size - 1} times; stop and look`);
  }
  const r = obs.readiness;
  if (r?.state === "BLOCKED") {
    const failed = r.checks.find((c) => c.level === "FAIL");
    return RED.has(failed?.id) ? exit(EXIT.FAIL, `FAIL: ${r.reason}`) : exit(EXIT.BLOK, `BLOK: ${r.reason}`);
  }
  if (r?.state === "WAITS_OWNER" && !obs.commandOnHead && !memory.posted.has(head)) {
    return { action: "post-command", reason: `gate passes on ${head.slice(0, 8)}; posting the owner command for this head` };
  }
  if (r?.state === "READY" && !memory.queued.has(head)) return { action: "queue", reason: `Merge authorization passes on ${head.slice(0, 8)}; queueing` };
  if (memory.rounds >= memory.maxRounds) return exit(EXIT.TIMEOUT, `TIMEOUT after ${memory.rounds} rounds: ${r?.state ?? "?"}: ${r?.reason ?? "no readiness"}`);
  return { action: "wait", reason: `${r?.state ?? "?"}: ${r?.reason ?? "no readiness"}` };
}
