// DAN-274: PR Evidence Pack. Pure logic; gh is never called here.
// Facts about one PR at its current head. It gives no PASS, no advice and no gate.
// Review and QA verdicts are shown as agent, head and PASS/FAIL only, never their text, so the
// output is safe to hand to a QA session (QA must not have seen review findings).
import { field } from "../engineering/metadata-parser.mjs";
import { evaluateChecks, latestVerdict, parseAgentRisk } from "./orchestrator-core.mjs";
import { contractText } from "./preflight-core.mjs";

const SHA_RE = /^[0-9a-f]{40}$/i;
const SAFE_NAME = /^[\w .,()/:=@+-]{1,100}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const MAX_TEXT = 300;

export const CONTRACT_LABELS = [
  "Invarijanta",
  "Mjesta",
  "Stvarni pozivatelj",
  "Poznate granice",
  "Što bi ovaj PR moglo oboriti na QA-i?",
];
export const OPEN_LABELS = ["Neizvedeno", "Otvoreno ili blokira", "Treba Daniel"];

/** `--pr <n> [--json]`; anything else is an error. */
export function parseEvidenceArgs(args) {
  let pr = null;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--pr" && /^[1-9]\d{0,8}$/.test(args[i + 1] ?? "")) pr = Number(args[++i]);
    else throw new Error(`unknown or invalid argument: ${args[i]}`);
  }
  if (pr === null) throw new Error("usage: orch:evidence --pr <n> [--json]");
  return { pr, json };
}

// Free text written by the PR author: one line, no control or direction characters, cut short.
function prose(value) {
  const text = String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

const shown = (s) => (SAFE_NAME.test(String(s ?? "")) ? String(s) : "<not printed>");

function verdictOf(comments, kind, head) {
  if (!comments) return null;
  const v = latestVerdict(comments, kind, head);
  if (!v) return { verdict: "none" };
  return { verdict: v.verdict, head: String(v.head ?? "").slice(0, 8), agent: shown(v.agent), current: v.current };
}

function checksOf(rollup) {
  if (!rollup) return null;
  const { total, bad } = evaluateChecks(rollup);
  return { total, bad: bad.map((b) => ({ name: shown(b.name), state: shown(b.state) })) };
}

function gateOf(gate) {
  if (gate === undefined || gate?.error) return null;
  return gate ? { state: shown(gate.state), description: prose(gate.description) } : { state: "none", description: "" };
}

/**
 * Evidence for one PR. `pr` is toPr() shaped; `comments`, `rollup` and `gate` are what gh.mjs
 * returns for its head, or undefined when they could not be read (shown as unread, never as ok).
 */
export function buildEvidence({ pr, comments, rollup, gate }) {
  const head = String(pr?.headRefOid ?? "");
  if (!SHA_RE.test(head)) throw new Error("PR head is not a 40-character SHA");
  const { agent, risk } = parseAgentRisk(pr.body);
  const lines = (labels) =>
    labels.map((label) => {
      const text = contractText(pr.body, label);
      return { label, text: text === null ? null : prose(text) };
    });
  return {
    pr: pr.number,
    state: shown(pr.state),
    draft: Boolean(pr.isDraft),
    head,
    agent: agent ? shown(agent) : null,
    risk: risk ? shown(risk) : null,
    task: field(pr.body, "Task") ? prose(field(pr.body, "Task")).slice(0, 80) : null,
    contract: lines(CONTRACT_LABELS),
    open: lines(OPEN_LABELS),
    checks: checksOf(rollup),
    gate: gateOf(gate),
    review: verdictOf(comments, "review", head),
    qa: verdictOf(comments, "qa", head),
  };
}

function verdictText(v) {
  if (v === null) return "unread";
  if (v.verdict === "none") return "none";
  return `${v.verdict} by ${v.agent ?? "?"} on ${v.head}${v.current ? "" : " (not this head)"}`;
}

/** Text lines of the pack. Same facts as the JSON. */
export function renderEvidence(e) {
  const out = [`PR #${e.pr} ${e.state}${e.draft ? " DRAFT" : ""} head ${e.head}`];
  out.push(`Agent: ${e.agent ?? "-"} | Risk: ${e.risk ?? "-"} | Task: ${e.task ?? "-"}`);
  if (e.checks === null) out.push("CI checks: unread");
  else if (e.checks.total === 0) out.push("CI checks: none reported on this head");
  else if (e.checks.bad.length === 0) out.push(`CI checks: ${e.checks.total} reported, none failing or pending`);
  else out.push(`CI checks: ${e.checks.bad.length}/${e.checks.total} not green: ${e.checks.bad.map((b) => `${b.name}=${b.state}`).join(", ")}`);
  if (e.gate === null) out.push("Gate status: unread");
  else out.push(`Gate status: ${e.gate.state}${e.gate.description ? ` - ${e.gate.description}` : ""}`);
  out.push(`Review verdict on this head: ${verdictText(e.review)}`);
  out.push(`QA verdict on this head: ${verdictText(e.qa)}`);
  out.push("", "From the PR description:");
  for (const { label, text } of [...e.contract, ...e.open]) {
    out.push(`- ${label}: ${text === null ? "(missing)" : text === "" ? "(empty)" : text}`);
  }
  out.push("", "Facts only: no PASS, no advice, no review text.");
  return out;
}
