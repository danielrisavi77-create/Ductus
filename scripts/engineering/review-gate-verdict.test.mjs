// Gate verdict handling: a current negative verdict is bound to trusted data
// (the comment's App, association and head), never to what the PR body says.
// All identities are invented.
import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { evaluateGate, field } from "./review-gate-core.mjs";

const head = "a".repeat(40);
const olderHead = "b".repeat(40);
const ownerLogin = "owner-x";

const APPS = { claude: "claude", chatgpt: "chatgpt-codex-connector", codex: "chatgpt-codex-connector", grok: "grok-by-xai" };

const prBody = (agent = "claude:w1:backend", risk = "low", task = "T-1") =>
  `Agent: ${agent}\nRisk: ${risk}\nTask: ${task}\n`;

let counter = 0;
const comment = (body, { login = ownerLogin, association = "OWNER", appSlug = null, type } = {}) => ({
  body,
  user: type ? { login, type } : { login },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_750_000_000_000 + counter++ * 1000).toISOString(),
});

const appFor = (agent) => APPS[agent.split(":")[0].toLowerCase()];

const review = (agent, verdict, { sha = head, ...meta } = {}) =>
  comment(
    `Agent-Review: ${agent}:reviewer\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`,
    { appSlug: appFor(agent), ...meta },
  );

const qa = (agent, verdict, { sha = head, fallback, ...meta } = {}) =>
  comment(
    `QA-Agent: ${agent}:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: negative paths\n` +
      (fallback ? `Provider-Fallback: ${fallback} — quota exhausted\n` : ""),
    { appSlug: appFor(agent), ...meta },
  );

const quotaNotice = () =>
  comment("You have reached your Codex usage limits for code reviews.", {
    login: "chatgpt-codex-connector[bot]",
    type: "Bot",
    association: "NONE",
    appSlug: "chatgpt-codex-connector",
  });

const gate = (body, comments) => evaluateGate({ body, headSha: head, ownerLogin, comments });

const holds = (body, comments, label) => {
  const result = gate(body, comments);
  assert.notEqual(result.state, "success", label ?? body);
  return result;
};

test("negative review verdict holds the gate next to another identity's PASS", () => {
  for (const verdict of ["BLOCK", "FAIL"]) {
    const comments = [review("claude:r1", verdict), review("chatgpt:r2", "PASS")];
    assert.equal(gate(prBody(), comments).state, "pending");
    // The same comments without the negative verdict pass, so the hold above
    // comes from the verdict and from nothing else.
    assert.equal(gate(prBody(), [comments[1]]).state, "success");
  }
});

test("negative review verdict holds whichever author the PR body declares", () => {
  for (const verdict of ["BLOCK", "FAIL"]) {
    const comments = [review("claude:r1", verdict), review("chatgpt:r2", "PASS")];
    for (const role of ["backend", "frontend", "platforma", "reviewer", "qa", "short"]) {
      const result = gate(prBody(`claude:r1:${role}`), comments);
      assert.equal(result.state, "pending", `${verdict} ${role}`);
      assert.match(result.description, new RegExp(`review ${verdict.toLowerCase()} on current head`));
    }
  }
});

test("negative review verdict holds for every placement of the Agent line", () => {
  const comments = [review("claude:r1", "BLOCK"), review("chatgpt:r2", "PASS")];
  const hiddenOnly = "<!--\nAgent: claude:r1:backend\n-->\nRisk: low\nTask: T-1\n";
  const visibleThenHidden =
    "Agent: claude:w1:backend\nRisk: low\nTask: T-1\n<!--\nAgent: claude:r1:backend\n-->\n";
  const hiddenThenVisible =
    "<!--\nAgent: claude:r1:backend\n-->\nAgent: claude:w1:backend\nRisk: low\nTask: T-1\n";
  const duplicateVisible =
    "Agent: claude:w1:backend\nAgent: claude:r1:backend\nRisk: low\nTask: T-1\n";
  const singleLine = "<!-- Agent: claude:r1:backend -->\nRisk: low\nTask: T-1\n";

  // The shared parser takes the first matching line and does not interpret
  // HTML comments; a field wrapped on a single line is not a field at all.
  assert.equal(field(hiddenOnly, "Agent"), "claude:r1:backend");
  assert.equal(field(visibleThenHidden, "Agent"), "claude:w1:backend");
  assert.equal(field(hiddenThenVisible, "Agent"), "claude:r1:backend");
  assert.equal(field(duplicateVisible, "Agent"), "claude:w1:backend");
  assert.equal(field(singleLine, "Agent"), null);

  for (const body of [hiddenOnly, visibleThenHidden, hiddenThenVisible, duplicateVisible]) {
    assert.equal(gate(body, comments).state, "pending", body);
  }
  assert.equal(gate(singleLine, comments).state, "failure");
});

test("negative verdict holds across runtime aliases, letter case and whitespace", () => {
  const openai = [review("codex:r2", "BLOCK"), review("claude:r1", "PASS")];
  for (const agent of ["chatgpt:r2:backend", "codex:r2:backend", "openai:r2:backend", "CHATGPT:r2:backend"]) {
    holds(prBody(agent), openai);
  }

  const mixedCase = [review("claude:R1", "BLOCK"), review("chatgpt:r2", "PASS")];
  for (const agentLine of [
    "Agent: claude:R1:backend",
    "Agent: claude:r1:backend",
    "Agent:    claude:R1:backend   ",
    "  agent:\tclaude:R1:backend",
    "AGENT: claude:R1:backend\r",
    "Agent: claude: R1 :backend",
  ]) {
    holds(`${agentLine}\nRisk: low\nTask: T-1\n`, mixedCase);
  }
});

test("negative QA verdict holds a critical PR whichever author the body declares", () => {
  for (const verdict of ["BLOCK", "FAIL"]) {
    const passing = [review("chatgpt:r2", "PASS"), qa("claude:q2", "PASS")];
    assert.equal(gate(prBody("claude:w1:backend", "critical"), passing).state, "success");

    const comments = [...passing, qa("grok:q1", verdict)];
    for (const agent of ["claude:w1:backend", "grok:q1:backend", "grok:q1:qa"]) {
      const result = gate(prBody(agent, "critical"), comments);
      assert.equal(result.state, "pending", `${verdict} ${agent}`);
      assert.match(result.description, new RegExp(`QA ${verdict.toLowerCase()} on current head`));
    }
  }
});

test("negative QA verdict holds while the quota fallback is active", () => {
  const passing = [
    quotaNotice(),
    review("claude:r1", "PASS"),
    qa("claude:q2", "PASS", { fallback: "chatgpt-codex-connector" }),
  ];
  const viaFallback = gate(prBody("chatgpt:w1:backend", "critical"), passing);
  assert.equal(viaFallback.state, "success");
  assert.match(viaFallback.description, /quota fallback/);

  for (const verdict of ["FAIL", "BLOCK"]) {
    const comments = [...passing, qa("grok:q1", verdict)];
    for (const agent of ["chatgpt:w1:backend", "grok:q1:backend"]) {
      assert.equal(gate(prBody(agent, "critical"), comments).state, "pending", `${verdict} ${agent}`);
    }
  }
});

test("negative QA verdict holds at every declared risk", () => {
  const comments = [review("chatgpt:r2", "PASS"), qa("claude:q2", "PASS"), qa("grok:q1", "BLOCK")];
  for (const risk of ["low", "standard", "critical"]) {
    for (const agent of ["claude:w1:backend", "grok:q1:backend"]) {
      assert.equal(gate(prBody(agent, risk), comments).state, "pending", `${risk} ${agent}`);
    }
  }
});

test("missing, empty or malformed Agent never passes while a negative verdict stands", () => {
  const comments = [review("claude:r1", "BLOCK"), review("chatgpt:r2", "PASS")];
  for (const body of [
    "Risk: low\nTask: T-1\n",
    "Agent:\nRisk: low\nTask: T-1\n",
    "Agent:    \nRisk: low\nTask: T-1\n",
    "Agent: claude\nRisk: low\nTask: T-1\n",
    "Agent: claude:r1\nRisk: low\nTask: T-1\n",
    "Agent: claude::backend\nRisk: low\nTask: T-1\n",
    "Agent: claude:r1:unknown-role\nRisk: low\nTask: T-1\n",
    "Agent: someone:r1:backend\nRisk: low\nTask: T-1\n",
    "",
  ]) {
    assert.equal(gate(body, comments).state, "failure", JSON.stringify(body));
  }
});

test("negative verdict from the declared author's own principal holds the gate", () => {
  assert.equal(
    gate(prBody(), [review("claude:w1", "BLOCK"), review("chatgpt:r2", "PASS")]).state,
    "pending",
  );
  assert.equal(
    gate(prBody("claude:w1:backend", "critical"), [
      review("chatgpt:r2", "PASS"),
      qa("grok:q1", "PASS"),
      qa("claude:w1", "FAIL"),
    ]).state,
    "pending",
  );
});

test("PASS from the declared author's own principal still does not count", () => {
  const ownReview = gate(prBody(), [review("claude:w1", "PASS")]);
  assert.equal(ownReview.state, "pending");
  assert.match(ownReview.description, /Waiting for independently authenticated review/);

  const ownQa = gate(prBody("grok:q1:backend", "critical"), [
    review("chatgpt:r2", "PASS"),
    qa("grok:q1", "PASS"),
  ]);
  assert.equal(ownQa.state, "pending");
  assert.match(ownQa.description, /waiting for separately authenticated QA PASS/);
});

test("only a newer verdict from the same identity on the same head replaces a negative one", () => {
  assert.equal(
    gate(prBody(), [review("claude:r1", "BLOCK"), review("claude:r1", "PASS")]).state,
    "success",
  );
  // Another identity, another App or another head does not replace it.
  assert.equal(
    gate(prBody(), [review("claude:r1", "BLOCK"), review("claude:r3", "PASS")]).state,
    "pending",
  );
  assert.equal(
    gate(prBody(), [review("claude:r1", "BLOCK"), review("chatgpt:r1", "PASS")]).state,
    "pending",
  );
  assert.equal(
    gate(prBody(), [
      review("claude:r1", "BLOCK"),
      review("claude:r1", "PASS", { sha: olderHead }),
      review("chatgpt:r2", "PASS"),
    ]).state,
    "pending",
  );
  assert.equal(
    gate(prBody("claude:w1:backend", "critical"), [
      review("chatgpt:r2", "PASS"),
      qa("grok:q1", "BLOCK"),
      qa("grok:q1", "PASS"),
    ]).state,
    "success",
  );
});

test("negative verdict on an older head does not hold the current head", () => {
  assert.equal(
    gate(prBody(), [review("claude:r1", "BLOCK", { sha: olderHead }), review("chatgpt:r2", "PASS")]).state,
    "success",
  );
  assert.equal(
    gate(prBody(), [review("claude:r1", "BLOCK", { sha: olderHead })]).state,
    "pending",
  );
  assert.equal(
    gate(prBody("claude:w1:backend", "critical"), [
      review("chatgpt:r2", "PASS"),
      qa("claude:q2", "PASS"),
      qa("grok:q1", "BLOCK", { sha: olderHead }),
    ]).state,
    "success",
  );
});

test("negative verdict text from an untrusted source is ignored", () => {
  const pass = review("chatgpt:r2", "PASS");
  for (const untrusted of [
    review("claude:r1", "BLOCK", { association: "NONE", login: "outsider" }),
    review("claude:r1", "BLOCK", { association: "CONTRIBUTOR", login: "outsider" }),
    review("claude:r1", "BLOCK", { appSlug: null }),
    review("claude:r1", "BLOCK", { appSlug: "unregistered-app" }),
    review("claude:r1", "BLOCK", { appSlug: "grok-by-xai" }),
    comment(`Note first.\nAgent-Review: claude:r1:reviewer\nReview-Head: ${head}\nReview-Verdict: BLOCK\n`, { appSlug: "claude" }),
    comment("```\n" + `Agent-Review: claude:r1:reviewer\nReview-Head: ${head}\nReview-Verdict: BLOCK\n` + "```", { appSlug: "claude" }),
  ]) {
    assert.equal(gate(prBody(), [untrusted, pass]).state, "success", untrusted.body);
  }
});

test("property: no PR body yields success while a trusted negative verdict stands", () => {
  const commentSets = [
    [review("claude:r1", "BLOCK"), review("chatgpt:r2", "PASS")],
    [review("codex:r2", "FAIL"), review("claude:r1", "PASS"), review("grok:q1", "PASS")],
    [review("claude:w1", "BLOCK"), review("chatgpt:r2", "PASS"), qa("grok:q1", "PASS")],
    [review("chatgpt:r2", "PASS"), qa("claude:q2", "PASS"), qa("grok:q1", "BLOCK")],
    [review("chatgpt:r2", "PASS"), qa("grok:q1", "PASS"), qa("claude:q2", "FAIL")],
    [
      quotaNotice(),
      review("claude:r1", "PASS"),
      qa("claude:q2", "PASS", { fallback: "chatgpt-codex-connector" }),
      qa("grok:q1", "FAIL"),
    ],
  ];

  const runtime = fc.constantFrom("claude", "codex", "chatgpt", "grok", "openai", "Claude", "GROK");
  const slot = fc.oneof(
    fc.constantFrom("w1", "r1", "r2", "q1", "q2", "R1", "Q1"),
    fc.stringMatching(/^[A-Za-z0-9_-]{1,6}$/),
  );
  const role = fc.constantFrom(
    "orchestrator", "platforma", "backend", "frontend", "reviewer", "qa", "bug-hunter", "product-ux", "short",
  );
  const pad = fc.constantFrom("", " ", "  ", "\t");
  const agent = fc.oneof(
    { weight: 6, arbitrary: fc.tuple(pad, runtime, slot, role, pad).map(([a, r, s, o, b]) => `${a}${r}:${s}:${o}${b}`) },
    { weight: 1, arbitrary: fc.string() },
  );
  const risk = fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom("low", "standard", "critical", "LOW", "Standard", " critical ") },
    { weight: 1, arbitrary: fc.string() },
  );
  const task = fc.oneof(fc.constantFrom("T-1", "DAN-1"), fc.string());
  const layout = fc.constantFrom(
    (a, r, t) => `Agent: ${a}\nRisk: ${r}\nTask: ${t}\n`,
    (a, r, t) => `Task: ${t}\nRisk: ${r}\nAgent: ${a}\n`,
    (a, r, t) => `<!--\nAgent: ${a}\n-->\nRisk: ${r}\nTask: ${t}\n`,
    (a, r, t) => `Agent: ${a}\r\nRisk: ${r}\r\nTask: ${t}\r\nAgent: claude:w1:backend\r\n`,
    (a, r, t) => `Summary.\n\nagent:${a}\nrisk:${r}\ntask:${t}\n`,
  );

  fc.assert(
    fc.property(
      fc.constantFrom(...commentSets), agent, risk, task, layout,
      (comments, a, r, t, build) => gate(build(a, r, t), comments).state !== "success",
    ),
    { numRuns: 3000 },
  );
});
