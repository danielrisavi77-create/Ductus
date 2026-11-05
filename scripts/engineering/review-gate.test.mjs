import test from "node:test";
import assert from "node:assert/strict";

import { TRUSTED_VERDICT_LOGINS, evaluateGate, field, trustedAuthor } from "./review-gate-core.mjs";

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

test("write access alone does not make a collaborator or member a verdict author", () => {
  for (const association of ["COLLABORATOR", "MEMBER"]) {
    const result = evaluate({
      body: prBody(),
      headSha: head,
      comments: [review({ login: "trusted-reviewer", association, appSlug: "claude" })],
    });
    assert.equal(result.state, "pending");
  }
  assert.deepEqual(TRUSTED_VERDICT_LOGINS, []);
  assert.ok(Object.isFrozen(TRUSTED_VERDICT_LOGINS));
});

test("listed collaborator review can satisfy the gate", () => {
  for (const association of ["COLLABORATOR", "MEMBER"]) {
    const result = evaluateGate({
      body: prBody(),
      headSha: head,
      ownerLogin,
      trustedLogins: ["trusted-reviewer"],
      comments: [review({ login: "trusted-reviewer", association, appSlug: "claude" })],
    });
    assert.equal(result.state, "success");
  }
});

test("a listed login counts only as a person with write access", () => {
  const listed = { user: { login: "trusted-reviewer", type: "User" }, author_association: "COLLABORATOR" };
  assert.equal(trustedAuthor(listed, ["trusted-reviewer"]), true);
  assert.equal(trustedAuthor({ ...listed, user: { login: "trusted-reviewer", type: "Bot" } }, ["trusted-reviewer"]), false);
  for (const association of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", undefined]) {
    assert.equal(trustedAuthor({ ...listed, author_association: association }, ["trusted-reviewer"]), false);
  }
  assert.equal(trustedAuthor({ ...listed, user: { type: "User" } }, ["trusted-reviewer"]), false);
  assert.equal(trustedAuthor({ ...listed, user: { login: "Trusted-Reviewer", type: "User" } }, ["trusted-reviewer"]), false);
  assert.equal(trustedAuthor({ user: { login: "x", type: "User" }, author_association: "OWNER" }), true);
  assert.equal(trustedAuthor({ user: { login: "x[bot]", type: "Bot" }, author_association: "OWNER" }), false);
});

// Shape of a recorded App bot comment (issue comment 6111258117 on #267); GitHub
// reported it as NONE, but the gate must not lean on that alone.
const botComment = (body, association) => ({
  body,
  user: { login: "chatgpt-codex-connector[bot]", type: "Bot" },
  author_association: association,
  performed_via_github_app: { slug: "chatgpt-codex-connector" },
  created_at: "2026-10-11T16:39:31Z",
});

test("an App bot comment is never a review or QA verdict, whatever its association", () => {
  for (const association of ["NONE", "OWNER", "MEMBER", "COLLABORATOR"]) {
    const reviewOnly = evaluate({
      body: prBody(),
      headSha: head,
      comments: [botComment(review({ agent: "codex:b:reviewer" }).body, association)],
    });
    assert.equal(reviewOnly.state, "pending");

    const withBotQa = evaluate({
      body: prBody("critical"),
      headSha: head,
      comments: [review(), botComment(qa().body, association)],
    });
    assert.equal(withBotQa.state, "pending");
  }
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

test("one OpenAI principal cannot spoof reviewer and QA by changing declared runtime", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review({
        agent: "codex:x:reviewer",
        appSlug: "chatgpt-codex-connector",
      }),
      qa({
        agent: "chatgpt:x:qa",
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

// F-023 (owner decision 31. 10. 2026.): a later PASS on the same head does not
// resolve an earlier FAIL or BLOCK of the same reviewer; a PASS on a new head does.
test("a later PASS on the same head does not resolve an earlier FAIL from the same reviewer (F-023)", () => {
  for (const negative of ["FAIL", "BLOCK"]) {
    const same = evaluate({
      body: prBody(),
      headSha: head,
      comments: [review({ verdict: negative }), review({ verdict: "PASS" })],
    });
    assert.equal(same.state, "pending", negative);
    const newHead = "c".repeat(40);
    const pushed = evaluate({
      body: prBody(),
      headSha: newHead,
      comments: [review({ verdict: negative }), review({ verdict: "PASS", sha: newHead })],
    });
    assert.equal(pushed.state, "success", negative);
  }
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

test("independent current-head Codex pair satisfies critical QA (DAN-39)", () => {
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
  assert.equal(result.state, "success");
  assert.match(result.description, /Codex review and QA pair/);
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

const codexQuota = ({
  body = "You have reached your Codex usage limits for code reviews.",
  login = "chatgpt-codex-connector[bot]",
  type = "Bot",
  appSlug = "chatgpt-codex-connector",
  createdAt,
} = {}) => ({
  body,
  user: { login, type },
  author_association: "NONE",
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: createdAt ?? new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});

const claudeFallbackQa = (meta = {}) =>
  entry(
    `QA-Agent: claude:c:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\nProvider-Fallback: chatgpt-codex-connector — kvota iscrpljena\n`,
    { appSlug: "claude", ...meta },
  );

test("quota fallback lets an independent same-App QA satisfy critical gate", () => {
  const result = evaluate({
    body: prBody("critical", "chatgpt:a:backend"),
    headSha: head,
    comments: [codexQuota(), review(), claudeFallbackQa()],
  });
  assert.equal(result.state, "success");
  assert.match(result.description, /quota fallback: chatgpt-codex-connector/);
});

test("quota fallback requires authenticated quota evidence from the named App", () => {
  for (const evidence of [
    [],
    [codexQuota({ appSlug: null })],
    [codexQuota({ login: ownerLogin, type: "User" })],
    [codexQuota({ body: "Didn't find any major issues." })],
    [{ ...codexQuota(), performed_via_github_app: { slug: "claude" } }],
  ]) {
    const result = evaluate({
      body: prBody("critical", "chatgpt:a:backend"),
      headSha: head,
      comments: [...evidence, review(), claudeFallbackQa()],
    });
    assert.equal(result.state, "pending");
  }
});

test("quota fallback requires the QA comment to declare the exhausted App", () => {
  const result = evaluate({
    body: prBody("critical", "chatgpt:a:backend"),
    headSha: head,
    comments: [codexQuota(), review(), qa({ agent: "claude:c:qa", appSlug: "claude" })],
  });
  assert.equal(result.state, "pending");
});

test("quota fallback evidence must precede QA and be at most 24 hours old", () => {
  const base = 1_800_000_000_000;
  const late = evaluate({
    body: prBody("critical", "chatgpt:a:backend"),
    headSha: head,
    comments: [
      review(),
      claudeFallbackQa({ createdAt: new Date(base).toISOString() }),
      codexQuota({ createdAt: new Date(base + 1000).toISOString() }),
    ],
  });
  assert.equal(late.state, "pending");

  const stale = evaluate({
    body: prBody("critical", "chatgpt:a:backend"),
    headSha: head,
    comments: [
      codexQuota({ createdAt: new Date(base).toISOString() }),
      review(),
      claudeFallbackQa({ createdAt: new Date(base + 25 * 3600 * 1000).toISOString() }),
    ],
  });
  assert.equal(stale.state, "pending");
});

test("quota fallback QA cannot be the passing reviewer or the author principal", () => {
  const asReviewer = evaluate({
    body: prBody("critical", "chatgpt:a:backend"),
    headSha: head,
    comments: [
      codexQuota(),
      review({ agent: "claude:c:reviewer" }),
      claudeFallbackQa(),
    ],
  });
  assert.equal(asReviewer.state, "pending");

  const asAuthor = evaluate({
    body: prBody("critical", "claude:c:backend"),
    headSha: head,
    comments: [codexQuota(), review(), claudeFallbackQa()],
  });
  assert.equal(asAuthor.state, "pending");
});

test("quota fallback does not override a current QA FAIL", () => {
  const result = evaluate({
    body: prBody("critical", "chatgpt:a:backend"),
    headSha: head,
    comments: [
      codexQuota(),
      review(),
      claudeFallbackQa(),
      qa({ agent: "claude:d:qa", appSlug: "claude", verdict: "FAIL" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("a declared fallback naming the QA's own App is ignored", () => {
  const result = evaluate({
    body: prBody("critical", "chatgpt:a:backend"),
    headSha: head,
    comments: [
      codexQuota(),
      review(),
      entry(
        `QA-Agent: claude:c:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: x\nProvider-Fallback: claude\n`,
        { appSlug: "claude" },
      ),
    ],
  });
  assert.equal(result.state, "pending");
});
