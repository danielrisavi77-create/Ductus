import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, evaluatePullRequest } from "./review-gate-core.mjs";

// Plan #537: only synthetic identities, dates and heads.
const H = "a".repeat(40);
const OLD = "b".repeat(40);
const APP = "chatgpt-codex-connector";
const ownerLogin = "owner-fixture";
const body = "Agent: codex:writer:platforma\nRisk: critical\nTask: DAN-39";
let tick = 0;
function verdict(kind, agent, { head = H, value = "PASS", app = APP } = {}) {
  const prefix = kind === "review" ? "Review" : "QA";
  return {
    body: `${kind === "review" ? "Agent-Review" : "QA-Agent"}: ${agent}:${kind === "review" ? "reviewer" : "qa"}\n${prefix}-Head: ${head}\n${prefix}-Verdict: ${value}\n` +
      (kind === "qa" ? "QA-Scope: synthetic identity and head attacks\n" : ""),
    user: { login: ownerLogin, type: "User" },
    author_association: "OWNER",
    performed_via_github_app: app ? { slug: app } : null,
    created_at: new Date(1_750_000_000_000 + tick++ * 1000).toISOString(),
  };
}
const review = (agent = "codex:reviewA", options) => verdict("review", agent, options);
const qa = (agent = "codex:qaA", options) => verdict("qa", agent, options);
const pair = () => [review(), qa()];
const gate = (comments, extra = {}) => evaluateGate({ body, ownerLogin, headSha: H, comments, ...extra });
const pending = (comments, extra) => assert.equal(gate(comments, extra).state, "pending");

test("A01: all codex/chatgpt aliases pass with distinct principals and a named status", () => {
  for (const author of ["codex", "chatgpt"]) {
    for (const reviewer of ["codex", "chatgpt"]) {
      for (const tester of ["codex", "chatgpt"]) {
        const result = gate([review(`${reviewer}:reviewA`), qa(`${tester}:qaA`)], {
          body: body.replace("codex:writer", `${author}:writer`),
        });
        assert.equal(result.state, "success");
        assert.equal(result.description, "Independent Codex review and QA pair valid on exact current head.");
      }
    }
  }
});

test("A02-A03: author, reviewer and QA cannot alias the same principal", () => {
  for (const [r, q] of [
    ["chatgpt:WRITER", "codex:qaA"],
    ["codex:reviewA", "chatgpt:WRITER"],
    ["codex:reviewA", "chatgpt:REVIEWA"],
  ]) {
    const comments = [review(r), qa(q)];
    comments[0].body += "Review-Model: Astra\n";
    comments[1].body += "QA-Model: Luna\n";
    pending(comments);
  }
});

test("A04: QA must differ from every prevailing reviewer PASS, in either input order", () => {
  for (const carried of [false, true]) {
    const comments = [...pair(), review("chatgpt:QAA", { head: carried ? OLD : H })];
    pending(comments, { carriedHeads: new Set([OLD]) });
    pending(comments.toReversed(), { carriedHeads: new Set([OLD]) });
    // A separate QA principal restores the new path.
    assert.equal(gate([...comments, qa("codex:qaB")], { carriedHeads: new Set([OLD]) }).state, "success");
  }
});

test("A05: neither required PASS can spoof App identity, mapping or trusted author", () => {
  for (const index of [0, 1]) {
    for (const mutate of [
      (c) => { c.performed_via_github_app = null; },
      (c) => { c.performed_via_github_app.slug = "unknown-app"; },
      (c) => { c.performed_via_github_app.slug = "claude"; },
      (c) => { c.author_association = "NONE"; },
      (c) => { c.user = { login: `${APP}[bot]`, type: "Bot" }; },
    ]) {
      const comments = pair();
      mutate(comments[index]);
      pending(comments);
    }
  }
});

test("A06: native review, acknowledgment, clean summary and advisory text are not canonical review", () => {
  for (const text of [
    `Reviewed commit: ${H}`,
    `Codex Review: Didn't find any major issues. Reviewed commit: ${H}`,
    "Advisory CLI review: PASS",
  ]) {
    const noncanonical = review();
    noncanonical.body = text;
    pending([noncanonical, qa()], {
      prReviews: [{ user: { login: `${APP}[bot]` }, commit_id: H, state: "APPROVED" }],
    });
  }
  const state = {
    code_review: { commit_sha: H, has_any_findings: false, has_unresolved_findings: false, status: "completed" },
    security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null },
  };
  const summary = review();
  summary.user = { login: `${APP}[bot]`, type: "Bot" };
  summary.body = `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(state)} -->`;
  pending([summary, qa()], { reviewComments: [] });
  // Positive control: this exact clean summary is valid for the existing
  // D-139 path, but cannot replace the new path's canonical review.
  const claudeQa = qa("claude:qaA", { app: "claude" });
  claudeQa.body += `Provider-Fallback: claude-second-session — Codex review na headu ${H}\n`;
  const result = gate([review("claude:reviewA", { app: "claude" }), summary, claudeQa], { reviewComments: [] });
  assert.equal(result.state, "success");
  assert.match(result.description, /D-139/);
});

test("A07: existing canonical parser and scope/role/verdict requirements still apply", () => {
  for (const index of [0, 1]) {
    for (const mutate of [
      (s) => `Preamble\n${s}`,
      (s) => `\`\`\`\n${s}\`\`\``,
      (s) => s.replace(/:(reviewer|qa)\n/, ":backend\n"),
      (s) => s.replace("Verdict: PASS", "Verdict: MAYBE"),
    ]) {
      const comments = pair();
      comments[index].body = mutate(comments[index].body);
      pending(comments);
    }
  }
  const comments = pair();
  comments[1].body = comments[1].body.replace(/QA-Scope:.*\n/, "");
  pending(comments);
});

test("A08-A09,A17: both exact current heads required even with verified carry or a new push", () => {
  for (const stale of [OLD, H.slice(0, 7), "z".repeat(40)]) {
    for (const [rHead, qHead] of [[stale, H], [H, stale], [stale, stale]]) {
      for (const carriedHeads of [new Set(), new Set([OLD])]) {
        pending([review(undefined, { head: rHead }), qa(undefined, { head: qHead })], { carriedHeads });
      }
    }
  }
  pending(pair(), { headSha: OLD, carriedHeads: new Set([H]) });
  assert.equal(gate([review(undefined, { head: H.toUpperCase() }), qa(undefined, { head: H.toUpperCase() })]).state, "success");
});

test("A10-A11: FAIL/BLOCK dominates pairs; only same-principal current PASS resolves it", () => {
  for (const kind of ["review", "qa"]) {
    for (const value of ["FAIL", "BLOCK"]) {
      for (const [agent, app] of [["codex:objector", APP], ["claude:objector", "claude"]]) {
        for (const before of [true, false]) {
          const negative = verdict(kind, agent, { value, app });
          const comments = before ? [negative, ...pair()] : [...pair(), negative];
          pending(comments);
          pending([...comments, verdict(kind, agent, { head: OLD, app })], { carriedHeads: new Set([OLD]) });
          assert.equal(gate([...comments, verdict(kind, agent, { app })]).state, "success");
        }
        const comments = [...pair(), verdict(kind, agent, { value, app, head: OLD })];
        pending(comments, { carriedHeads: new Set([OLD]) });
      }
    }
  }
});

test("A12: other same-App pairs stay pending; cross-App remains valid", () => {
  for (const [runtime, app] of [["claude", "claude"], ["grok", "grok-by-xai"]]) {
    const r = review(`${runtime}:reviewA`, { app });
    pending([r, qa(`${runtime}:qaA`, { app })]);
    const result = gate([r, qa()]);
    assert.equal(result.state, "success");
    assert.doesNotMatch(result.description, /Codex review and QA pair/);
  }
});

test("A13: a Codex pair needs no quota and bogus quota cannot rescue a colliding pair", () => {
  for (const text of [
    "You have reached your Codex usage limits for code reviews.",
    "> You have reached your Codex usage limits for code reviews.",
    "Provider-Fallback: claude — quota exhausted",
  ]) {
    const notice = review();
    notice.body = text;
    assert.equal(gate([notice, ...pair()]).state, "success");
    pending([notice, review(), qa("chatgpt:REVIEWA")]);
  }
});

const files = [{ filename: "scripts/engineering/review-gate-core.mjs", status: "modified" }];
const whole = (patch = {}) => evaluatePullRequest({
  pr: { body, head: { sha: H }, changed_files: 1, user: { login: ownerLogin } },
  files, ownerLogin, comments: pair(), ...patch,
}).result;

test("A14-A15: production entry validates metadata, risk, complete files and D-97 auto-merge", () => {
  assert.equal(whole().state, "success");
  for (const badBody of [
    body.replace("Agent:", "Missing:"),
    body.replace("Task:", "Missing:"),
    body.replace("critical", "nonsense"),
    body.replace("critical", "low"),
  ]) {
    assert.equal(whole({ pr: { body: badBody, head: { sha: H }, changed_files: 1 } }).state, "failure");
  }
  assert.equal(whole({ files: [] }).state, "failure");
  const result = whole({ pr: { body, head: { sha: H }, changed_files: 1, auto_merge: {} } });
  assert.equal(result.state, "pending");
  assert.match(result.description, /D-97/);
  // A body declaration cannot grant the file-derived QA exemption.
  assert.equal(whole({ pr: { body: `${body}\nQA-Exempt: docs`, head: { sha: H }, changed_files: 1 }, comments: [review()] }).state, "pending");
});

test("A16: new pair confers no owner override or command authority", () => {
  const override = review();
  override.body = `Owner-Override: PASS\nOverride-Head: ${H}\nOverride-Reason: synthetic control`;
  override.user.login = "other-fixture";
  override.author_association = "COLLABORATOR";
  pending([override]);
  override.user.login = ownerLogin;
  override.author_association = "OWNER";
  pending([override]); // Even the owner cannot issue an override via an App.
  override.performed_via_github_app = null;
  assert.match(gate([override]).description, /Owner override recorded/);
  const command = review();
  command.body = `Owner-Command: merge\nCommand-Head: ${H}`;
  pending([command]);
});
