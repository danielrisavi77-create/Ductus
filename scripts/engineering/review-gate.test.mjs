import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, field } from "./review-gate-core.mjs";

const head = "a".repeat(40);
const author = "claude:a:backend";
const ownerLogin = "danielrisavi77-create";

const prBody = (risk = "standard", agent = author) =>
  `Agent: ${agent}\nRisk: ${risk}\nTask: B-1\n`;

let counter = 0;
const entry = (body, {
  login = ownerLogin,
  association = "OWNER",
  createdAt,
  appSlug = null,
} = {}) => ({
  body,
  user: { login },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: createdAt ?? new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});

const review = ({
  agent = "claude:b:reviewer",
  sha = head,
  verdict = "PASS",
  appSlug = "claude",
  ...meta
} = {}) =>
  entry(
    `Agent-Review: ${agent}\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`,
    { appSlug, ...meta },
  );

const qa = ({
  agent = "chatgpt:c:qa",
  sha = head,
  verdict = "PASS",
  scope = "offline + wrong actor",
  appSlug = "chatgpt-codex-connector",
  ...meta
} = {}) =>
  entry(
    `QA-Agent: ${agent}\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: ${scope}\n`,
    { appSlug, ...meta },
  );

const evaluate = (input) =>
  evaluateGate({ ownerLogin, comments: [], ...input });

test("field reads metadata outside code fences only", () => {
  assert.equal(field("Risk: critical\nTask: B-8", "Risk"), "critical");
  assert.equal(field("Risky: low", "Risk"), null);
  assert.equal(
    field("```\nRisk: low\n```\nRisk: critical", "Risk"),
    "critical",
  );
});

test("missing metadata fails closed", () => {
  assert.equal(evaluate({ body: "Risk: low", headSha: head }).state, "failure");
});

test("missing task fails closed", () => {
  assert.equal(
    evaluate({ body: `Agent: ${author}\nRisk: standard\n`, headSha: head }).state,
    "failure",
  );
});

test("missing owner identity fails closed", () => {
  assert.equal(
    evaluateGate({ body: prBody(), headSha: head }).state,
    "failure",
  );
});

test("unknown agent role fails closed", () => {
  assert.equal(
    evaluate({
      body: "Agent: claude:a:whatever\nRisk: low\nTask: X-1\n",
      headSha: head,
    }).state,
    "failure",
  );
});

test("ChatGPT is a valid runtime identity", () => {
  const result = evaluate({
    body: prBody("standard", "chatgpt:a:platforma"),
    headSha: head,
    comments: [review()],
  });
  assert.equal(result.state, "success");
});

test("standard waits for review", () => {
  assert.equal(evaluate({ body: prBody(), headSha: head }).state, "pending");
});

test("formal GitHub reviews are not agent verdict inputs, including dismissed PASS", () => {
  const result = evaluateGate({
    ownerLogin,
    body: prBody(),
    headSha: head,
    comments: [],
    reviews: [{
      body: `Agent-Review: codex:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`,
      state: "DISMISSED",
      author_association: "OWNER",
      user: { login: ownerLogin },
    }],
  });
  assert.equal(result.state, "pending");
});

test("author runtime slot cannot self-review under another role", () => {
  const result = evaluate({
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [review({
      agent: "claude:a:reviewer",
      appSlug: "claude",
    })],
  });
  assert.equal(result.state, "pending");
});

test("Codex and ChatGPT same slot normalize to one OpenAI author principal", () => {
  const result = evaluate({
    body: prBody("standard", "codex:a:platforma"),
    headSha: head,
    comments: [review({
      agent: "chatgpt:a:reviewer",
      appSlug: "chatgpt-codex-connector",
    })],
  });
  assert.equal(result.state, "pending");
});

test("author runtime slot cannot provide QA under another role", () => {
  const result = evaluate({
    body: prBody("critical", "chatgpt:a:backend"),
    headSha: head,
    comments: [
      review({ agent: "claude:b:reviewer", appSlug: "claude" }),
      qa({
        agent: "chatgpt:a:qa",
        appSlug: "chatgpt-codex-connector",
      }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("review verdict must come from a matching authenticated GitHub App", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review({
      agent: "claude:b:reviewer",
      appSlug: "chatgpt-codex-connector",
    })],
  });
  assert.equal(result.state, "pending");
});

test("review is bound to the current head", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review({ sha: "b".repeat(40) })],
  });
  assert.equal(result.state, "pending");
});

test("untrusted outsider cannot spoof a review PASS", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review({ login: "outsider", association: "NONE", appSlug: "claude" })],
  });
  assert.equal(result.state, "pending");
});

test("trusted collaborator review can satisfy the gate", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review({ login: "trusted-reviewer", association: "COLLABORATOR", appSlug: "claude" })],
  });
  assert.equal(result.state, "success");
});

test("four-character tilde fence remains fenced until equally long close", () => {
  const body =
    "Agent-Review: claude:b:reviewer\n~~~~text\n" +
    "~~~\n" +
    `Review-Head: ${head}\nReview-Verdict: PASS\n` +
    "~~~~";
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [entry(body, { appSlug: "claude" })],
  });
  assert.equal(result.state, "pending");
});

test("four-character backtick fence remains fenced until equally long close", () => {
  const body =
    "Agent-Review: claude:b:reviewer\n````text\n" +
    "```\n" +
    `Review-Head: ${head}\nReview-Verdict: PASS\n` +
    "````";
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [entry(body, { appSlug: "claude" })],
  });
  assert.equal(result.state, "pending");
});

test("indented Markdown code block metadata is ignored", () => {
  const body =
    "Agent-Review: claude:b:reviewer\n" +
    `    Review-Head: ${head}\n` +
    "    Review-Verdict: PASS";
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [entry(body, { appSlug: "claude" })],
  });
  assert.equal(result.state, "pending");
});

test("tilde fenced metadata does not satisfy the gate", () => {
  const body =
    "Agent-Review: claude:b:reviewer\n~~~text\n" +
    `Review-Head: ${head}\nReview-Verdict: PASS\n` +
    "~~~";
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [entry(body, { appSlug: "claude" })],
  });
  assert.equal(result.state, "pending");
});

test("one ChatGPT GitHub App cannot spoof reviewer and QA by changing declared runtime", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review({
        agent: "codex:x:reviewer",
        appSlug: "chatgpt-codex-connector",
      }),
      qa({
        agent: "chatgpt:y:qa",
        appSlug: "chatgpt-codex-connector",
      }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("review example inside a code fence does not satisfy the gate", () => {
  const body =
    "Use this when done:\n```\n" +
    `Agent-Review: codex:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n` +
    "```";
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [entry(body, { appSlug: "claude" })],
  });
  assert.equal(result.state, "pending");
});

test("review block must start the comment", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [entry(
      `Review complete.\nAgent-Review: claude:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`,
      { appSlug: "claude" },
    )],
  });
  assert.equal(result.state, "pending");
});

test("FAIL from one session is not erased by PASS from another session of same App", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [
      review({
        agent: "claude:c:reviewer",
        verdict: "FAIL",
        appSlug: "claude",
      }),
      review({
        agent: "claude:b:reviewer",
        verdict: "PASS",
        appSlug: "claude",
      }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("PASS from one session is not erased by FAIL from another session of same App", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [
      review({
        agent: "claude:b:reviewer",
        verdict: "PASS",
        appSlug: "claude",
      }),
      review({
        agent: "claude:c:reviewer",
        verdict: "FAIL",
        appSlug: "claude",
      }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("latest verdict from one reviewer replaces its earlier PASS", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [
      review({ verdict: "PASS" }),
      review({ verdict: "FAIL" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("later PASS can resolve an earlier FAIL from the same reviewer", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [
      review({ verdict: "FAIL" }),
      review({ verdict: "PASS" }),
    ],
  });
  assert.equal(result.state, "success");
});

test("any current independent reviewer BLOCK holds the gate", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [
      review({ agent: "claude:b:reviewer", verdict: "PASS", appSlug: "claude" }),
      review({
        agent: "chatgpt:c:reviewer",
        verdict: "BLOCK",
        appSlug: "chatgpt-codex-connector",
      }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("critical also requires independent QA", () => {
  const waiting = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [review()],
  });
  assert.equal(waiting.state, "pending");

  const passing = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [review(), qa()],
  });
  assert.equal(passing.state, "success");
});

test("same authenticated GitHub App cannot satisfy both reviewer and QA", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review({
        agent: "codex:b:reviewer",
        appSlug: "chatgpt-codex-connector",
      }),
      qa({
        agent: "chatgpt:c:qa",
        appSlug: "chatgpt-codex-connector",
      }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("Claude GitHub App cannot claim a ChatGPT QA runtime", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review(),
      qa({ agent: "chatgpt:c:qa", appSlug: "claude" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("QA FAIL from reviewer App still blocks even when another App QA passes", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review({
        agent: "claude:b:reviewer",
        verdict: "PASS",
        appSlug: "claude",
      }),
      qa({
        agent: "claude:c:qa",
        verdict: "FAIL",
        appSlug: "claude",
      }),
      qa({
        agent: "chatgpt:d:qa",
        verdict: "PASS",
        appSlug: "chatgpt-codex-connector",
      }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("latest QA FAIL revokes an earlier QA PASS", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review(),
      qa({ verdict: "PASS" }),
      qa({ verdict: "FAIL" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("outsider cannot spoof critical QA", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review(),
      qa({ login: "outsider", association: "NONE" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("owner override must be canonical, current-head and reasoned", () => {
  const valid = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [entry(
      `Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: emergency governance decision\n`,
      { appSlug: null },
    )],
  });
  assert.equal(valid.state, "success");

  const prefixed = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [entry(
      `Example only:\nOwner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: bypass\n`,
    )],
  });
  assert.equal(prefixed.state, "pending");
});

test("collaborator cannot spoof owner override", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [entry(
      `Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: bypass\n`,
      { login: "trusted-reviewer", association: "COLLABORATOR" },
    )],
  });
  assert.equal(result.state, "pending");
});


test("Grok reviewer is accepted only from verified Grok GitHub App", () => {
  const valid = evaluate({
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [review({
      agent: "grok:b:reviewer",
      appSlug: "grok-by-xai",
    })],
  });
  assert.equal(valid.state, "success");

  const guessed = evaluate({
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [review({
      agent: "grok:b:reviewer",
      appSlug: "grok",
    })],
  });
  assert.equal(guessed.state, "pending");
});

test("Grok runtime cannot borrow Claude or OpenAI App identity", () => {
  for (const appSlug of ["claude", "chatgpt-codex-connector"]) {
    const result = evaluate({
      body: prBody("standard", "grok:a:backend"),
      headSha: head,
      comments: [review({
        agent: "grok:b:reviewer",
        appSlug,
      })],
    });
    assert.equal(result.state, "pending");
  }
});


test("Grok QA can satisfy critical gate when reviewer is OpenAI", () => {
  const result = evaluate({
    body: prBody("critical", "claude:a:backend"),
    headSha: head,
    comments: [
      review({
        agent: "chatgpt:b:reviewer",
        appSlug: "chatgpt-codex-connector",
      }),
      qa({
        agent: "grok:c:qa",
        appSlug: "grok-by-xai",
      }),
    ],
  });
  assert.equal(result.state, "success");
});

test("Grok reviewer and Grok QA cannot satisfy both sides of critical gate", () => {
  const result = evaluate({
    body: prBody("critical", "claude:a:backend"),
    headSha: head,
    comments: [
      review({
        agent: "grok:b:reviewer",
        appSlug: "grok-by-xai",
      }),
      qa({
        agent: "grok:c:qa",
        appSlug: "grok-by-xai",
      }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("Grok App cannot claim Claude or OpenAI runtime", () => {
  for (const agent of ["claude:b:reviewer", "chatgpt:b:reviewer", "codex:b:reviewer"]) {
    const result = evaluate({
      body: prBody("standard", "grok:a:backend"),
      headSha: head,
      comments: [review({
        agent,
        appSlug: "grok-by-xai",
      })],
    });
    assert.equal(result.state, "pending");
  }
});


const nativeCodexPass = ({
  sha = head,
  association = "NONE",
  appSlug = "chatgpt-codex-connector",
  login = "chatgpt-codex-connector[bot]",
} = {}) => ({
  body: `Codex Review: Didn't find any major issues. Keep it up! Reviewed commit: \`${sha.slice(0, 10)}\``,
  user: { login },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_800_000_000_000 + counter++ * 1000).toISOString(),
});

test("native Codex no-major-issues review satisfies standard gate for Claude author", () => {
  const result = evaluate({
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [nativeCodexPass()],
  });
  assert.equal(result.state, "success");
});

test("native Codex review is bound to the current head", () => {
  const result = evaluate({
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [nativeCodexPass({ sha: "b".repeat(40) })],
  });
  assert.equal(result.state, "pending");
});

test("plain user comment cannot spoof a native Codex PASS", () => {
  const result = evaluate({
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [nativeCodexPass({
      login: ownerLogin,
      association: "OWNER",
      appSlug: null,
    })],
  });
  assert.equal(result.state, "pending");
});

test("native Codex current-head findings keep the gate pending", () => {
  const result = evaluate({
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [{
      body: `### 💡 Codex Review\nHere are some automated review suggestions. Reviewed commit: \`${head.slice(0, 10)}\``,
      user: { login: "chatgpt-codex-connector[bot]" },
      author_association: "NONE",
      performed_via_github_app: { slug: "chatgpt-codex-connector" },
      created_at: new Date(1_800_000_100_000).toISOString(),
    }],
  });
  assert.equal(result.state, "pending");
  assert.match(result.description, /Codex review has current-head findings/);
});

test("native Codex formal review can supply PASS when bound by commit_id", () => {
  const result = evaluateGate({
    ownerLogin,
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [],
    reviews: [{
      body: "Codex Review: Didn't find any major issues. Keep it up!",
      state: "COMMENTED",
      commit_id: head,
      author_association: "NONE",
      user: { login: "chatgpt-codex-connector[bot]" },
    }],
  });
  assert.equal(result.state, "success");
});

test("native Codex inline finding blocks a no-major summary on the same head", () => {
  const result = evaluateGate({
    ownerLogin,
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [nativeCodexPass()],
    reviewComments: [{
      body: "P1: unsafe migration behavior",
      commit_id: head,
      author_association: "NONE",
      user: { login: "chatgpt-codex-connector[bot]" },
    }],
  });
  assert.equal(result.state, "pending");
  assert.match(result.description, /Codex review has current-head findings/);
});

test("native Codex cannot self-review an OpenAI-authored PR", () => {
  const result = evaluate({
    body: prBody("standard", "chatgpt:a:platforma"),
    headSha: head,
    comments: [nativeCodexPass()],
  });
  assert.equal(result.state, "pending");
});

test("critical Claude PR can use native Codex review plus Grok QA", () => {
  const result = evaluate({
    body: prBody("critical", "claude:a:backend"),
    headSha: head,
    comments: [
      nativeCodexPass(),
      qa({ agent: "grok:c:qa", appSlug: "grok-by-xai" }),
    ],
  });
  assert.equal(result.state, "success");
});

test("critical native Codex review still rejects QA from the same OpenAI App", () => {
  const result = evaluate({
    body: prBody("critical", "claude:a:backend"),
    headSha: head,
    comments: [
      nativeCodexPass(),
      qa({ agent: "chatgpt:c:qa", appSlug: "chatgpt-codex-connector" }),
    ],
  });
  assert.equal(result.state, "pending");
});
