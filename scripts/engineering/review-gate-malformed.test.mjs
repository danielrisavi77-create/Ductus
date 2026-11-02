// F-027: a FAIL or BLOCK the gate cannot read exactly still blocks; a PASS
// counts only in its exact form. Table over the input classes of the M0.6c
// contract (#1091). All identities and heads are invented.
import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate } from "./review-gate-core.mjs";

const head = "1234567890abcdef1234567890abcdef12345678";
const newer = "2468ace02468ace02468ace02468ace02468ace0";
const other = "fedcba0987654321fedcba0987654321fedcba09";
const otherPr = "13579bdf13579bdf13579bdf13579bdf13579bdf";
const carried = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
const ownerLogin = "owner-x";

let clock = 0;
const comment = (body, { app = "claude", edited = false, association = "OWNER" } = {}) => {
  const created = 1_800_000_000_000 + clock++ * 1000;
  return {
    body,
    user: { login: ownerLogin },
    author_association: association,
    performed_via_github_app: app ? { slug: app } : null,
    created_at: new Date(created).toISOString(),
    ...(edited ? { updated_at: new Date(created + 500).toISOString() } : {}),
  };
};

const KINDS = {
  review: { agent: (slot) => `Agent-Review: claude:${slot}:reviewer`, H: "Review-Head", V: "Review-Verdict", app: "claude" },
  qa: { agent: (slot) => `QA-Agent: chatgpt:${slot}:qa`, H: "QA-Head", V: "QA-Verdict", app: "chatgpt-codex-connector",
    extra: "QA-Scope: negative paths" },
};
// `lines` gets the field names and returns the lines after the agent line.
const block = (kind, slot, lines, opts = {}) => {
  const k = KINDS[kind];
  const rest = lines(k);
  if (k.extra && !opts.noExtra) rest.push(k.extra);
  return comment(`${k.agent(slot)}\n${rest.join("\n")}\n`, { app: k.app, ...opts });
};
const exact = (kind, slot, verdict = "PASS", sha = head, opts = {}) =>
  block(kind, slot, ({ H, V }) => [`${H}: ${sha}`, `${V}: ${verdict}`], opts);

const body = (risk) => `Agent: claude:w1:platforma\nRisk: ${risk}\nTask: DAN-0\n`;
const gate = (comments, { risk = "standard", headSha = head, carriedHeads } = {}) =>
  evaluateGate({ body: body(risk), headSha, ownerLogin, comments, carriedHeads });

// A malformed verdict beside a valid PASS from another slot of the same kind.
const withPasses = (kind, malformed) =>
  kind === "review"
    ? { comments: [exact("review", "r1"), malformed], risk: "standard" }
    : { comments: [exact("review", "r1"), exact("qa", "q1"), malformed], risk: "critical" };

// Classes 1-11: each must block the current head, for review and QA alike.
const NEGATIVES = [
  ["1 lower case value", ({ H, V }) => [`${H}: ${head}`, `${V}: block`]],
  ["1 mixed case field names and value", ({ H, V }) => [`${H.toLowerCase()}: ${head}`, `${V.toUpperCase()}: Fail`]],
  ["2 spaces around the value", ({ H, V }) => [`${H}: ${head}`, `${V}:    BLOCK   `]],
  ["2 space before the colon", ({ H, V }) => [`${H}: ${head}`, `${V} : BLOCK`]],
  ["3 bold value", ({ H, V }) => [`${H}: ${head}`, `${V}: **BLOCK**`]],
  ["3 code value", ({ H, V }) => [`${H}: ${head}`, `${V}: \`FAIL\``]],
  ["3 value with words", ({ H, V }) => [`${H}: ${head}`, `${V}: BLOCK - see below`]],
  ["3 value with a full stop", ({ H, V }) => [`${H}: ${head}`, `${V}: FAIL.`]],
  ["4 bold field name", ({ H, V }) => [`${H}: ${head}`, `**${V}:** BLOCK`]],
  ["4 list item line", ({ H, V }) => [`${H}: ${head}`, `- ${V}: FAIL`]],
  ["4 emphasised field name", ({ H, V }) => [`${H}: ${head}`, `_${V}_: BLOCK`]],
  ["5 FAILED", ({ H, V }) => [`${H}: ${head}`, `${V}: FAILED`]],
  ["5 BLOCKED", ({ H, V }) => [`${H}: ${head}`, `${V}: BLOCKED`]],
  ["5 BLOK", ({ H, V }) => [`${H}: ${head}`, `${V}: BLOK`]],
  ["5 PASS line naming BLOCK", ({ H, V }) => [`${H}: ${head}`, `${V}: PASS, no BLOCK left`]],
  ["6 PASS line then BLOCK line", ({ H, V }) => [`${H}: ${head}`, `${V}: PASS`, `${V}: BLOCK`]],
  ["7 head line missing", ({ V }) => [`${V}: BLOCK`]],
  ["7 head in words", ({ H, V }) => [`${H}: see above`, `${V}: FAIL`]],
  ["7 head placeholder", ({ H, V }) => [`${H}: <40-znamenkasti SHA>`, `${V}: BLOCK`]],
  ["7 head line empty", ({ H, V }) => [`${H}:`, `${V}: BLOCK`]],
  ["8 short prefix of the current head", ({ H, V }) => [`${H}: ${head.slice(0, 7)}`, `${V}: BLOCK`]],
  ["8 hex shorter than seven", ({ H, V }) => [`${H}: ${other.slice(0, 4)}`, `${V}: FAIL`]],
  ["9 current head and one more hex digit (r4434690343)", ({ H, V }) => [`${H}: ${head}0`, `${V}: BLOCK`]],
  ["9 another head and one more hex digit", ({ H, V }) => [`${H}: ${other}f`, `${V}: FAIL`]],
  ["10 current head in code", ({ H, V }) => [`${H}: \`${head}\``, `${V}: BLOCK`]],
  ["10 current head in bold", ({ H, V }) => [`${H}: **${head}**`, `${V}: FAIL`]],
  ["10 current head with a note", ({ H, V }) => [`${H}: ${head} (after the fix)`, `${V}: BLOCK`]],
];

for (const kind of ["review", "qa"]) {
  for (const [name, lines] of NEGATIVES) {
    test(`${kind}: a negative written as "${name}" blocks beside a valid PASS (criterion 1)`, () => {
      const { comments, risk } = withPasses(kind, block(kind, kind === "review" ? "r2" : "q2", lines));
      assert.notEqual(gate(comments, { risk }).state, "success");
    });
  }
}

test("qa: 11 a FAIL or BLOCK without QA-Scope still blocks (criterion 1)", () => {
  for (const verdict of ["FAIL", "BLOCK", "block - see below"]) {
    const { comments, risk } = withPasses("qa", exact("qa", "q2", verdict, head, { noExtra: true }));
    assert.notEqual(gate(comments, { risk }).state, "success", verdict);
  }
});

test("criterion 4: the case of r4434690343 blocks for review and QA", () => {
  for (const kind of ["review", "qa"]) {
    const { comments, risk } = withPasses(kind, exact(kind, kind === "review" ? "r2" : "q2", "BLOCK", `${head}0`));
    assert.notEqual(gate(comments, { risk }).state, "success", kind);
  }
});

// Criterion 2: the only PASS, written in any form but the exact one, gives nothing.
const MALFORMED_PASSES = [
  ["value with words", ({ H, V }) => [`${H}: ${head}`, `${V}: PASS - with notes`]],
  ["bold value", ({ H, V }) => [`${H}: ${head}`, `${V}: **PASS**`]],
  ["value with a full stop", ({ H, V }) => [`${H}: ${head}`, `${V}: PASS.`]],
  ["bold field name", ({ H, V }) => [`${H}: ${head}`, `**${V}:** PASS`]],
  ["space before the colon", ({ H, V }) => [`${H}: ${head}`, `${V} : PASS`]],
  ["short head", ({ H, V }) => [`${H}: ${head.slice(0, 7)}`, `${V}: PASS`]],
  ["missing head", ({ V }) => [`${V}: PASS`]],
  ["head and one more hex digit", ({ H, V }) => [`${H}: ${head}0`, `${V}: PASS`]],
  ["head in code", ({ H, V }) => [`${H}: \`${head}\``, `${V}: PASS`]],
];

for (const [name, lines] of MALFORMED_PASSES) {
  test(`review: the only PASS written as "${name}" gives nothing (criterion 2)`, () => {
    assert.notEqual(gate([block("review", "r1", lines)]).state, "success");
  });
  test(`qa: the only QA PASS written as "${name}" gives nothing on a critical PR (criterion 2)`, () => {
    assert.notEqual(gate([exact("review", "r1"), block("qa", "q1", lines)], { risk: "critical" }).state, "success");
  });
}

test("qa: the only QA PASS without QA-Scope gives nothing (criterion 2)", () => {
  const comments = [exact("review", "r1"), exact("qa", "q1", "PASS", head, { noExtra: true })];
  assert.notEqual(gate(comments, { risk: "critical" }).state, "success");
});

// The exact form stays what the gate counted before F-027 (contract (a)).
const EXACT_PASSES = [
  ["PASS", ({ H, V }) => [`${H}: ${head}`, `${V}: PASS`]],
  ["lower case pass", ({ H, V }) => [`${H}: ${head}`, `${V}: pass`]],
  ["spaces around PASS", ({ H, V }) => [`${H}: ${head}`, `${V}:   PASS  `]],
  ["lower case field names", ({ H, V }) => [`${H.toLowerCase()}: ${head}`, `${V.toLowerCase()}: PASS`]],
  ["upper case head", ({ H, V }) => [`${H}: ${head.toUpperCase()}`, `${V}: PASS`]],
];

for (const [name, lines] of EXACT_PASSES) {
  test(`pass case 1: an exact PASS ("${name}") with no negative passes`, () => {
    assert.equal(gate([block("review", "r1", lines)]).state, "success");
    assert.equal(gate([exact("review", "r1"), block("qa", "q1", lines)], { risk: "critical" }).state, "success");
  });
}

// Pass case 2: a negative that readably names another head stays there.
const ELSEWHERE = [
  ["full SHA of an earlier head", other],
  ["short SHA of an earlier head", other.slice(0, 7)],
  ["earlier head in code", `\`${other}\``],
  ["head of another PR", otherPr],
  ["short head of another PR", otherPr.slice(0, 10)],
];

for (const [name, sha] of ELSEWHERE) {
  test(`pass case 2: a malformed negative on the ${name} leaves an exact PASS on the current head`, () => {
    for (const kind of ["review", "qa"]) {
      const slot = kind === "review" ? "r2" : "q2";
      const malformed = block(kind, slot, ({ H, V }) => [`${H}: ${sha}`, `${V}: BLOCK - see below`]);
      const { comments, risk } = withPasses(kind, malformed);
      assert.equal(gate(comments, { risk }).state, "success", kind);
    }
  });
}

test("pass case 2: after a new push the same principal's exact PASS lifts its malformed negative on the old head", () => {
  const comments = [
    block("review", "r1", ({ H, V }) => [`${H}: ${head}`, `${V}: **BLOCK**`]),
    exact("review", "r1", "PASS", newer),
  ];
  assert.notEqual(gate(comments.slice(0, 1)).state, "success");
  assert.equal(gate(comments, { headSha: newer }).state, "success");
});

test("contract (c): a negative with no readable head blocks again after a new push", () => {
  const comments = [block("review", "r2", ({ V }) => [`${V}: BLOCK`]), exact("review", "r1", "PASS", newer)];
  assert.notEqual(gate(comments, { headSha: newer }).state, "success");
});

// Pass case 3: a comment without a verified identity changes nothing either way.
const UNVERIFIED = [
  ["no App", { app: null }],
  ["the wrong App for its runtime", { app: "grok-by-xai" }],
  ["an author that may not record verdicts", { association: "CONTRIBUTOR" }],
];

for (const [name, opts] of UNVERIFIED) {
  test(`pass case 3: a malformed negative from ${name} leaves the gate as it was`, () => {
    const malformed = block("review", "r2", ({ V }) => [`${V}: BLOCK`], opts);
    assert.equal(gate([exact("review", "r1"), malformed]).state, "success");
    assert.notEqual(gate([exact("review", "r1", "PASS", head, opts)]).state, "success");
  });
}

// Criterion 3 and F-023: a later exact PASS of the same principal on the same
// head does not clear its malformed negative.
for (const kind of ["review", "qa"]) {
  for (const [name, lines] of NEGATIVES) {
    test(`${kind}: a later exact PASS of the same slot does not clear "${name}" (criterion 3, F-023)`, () => {
      const slot = kind === "review" ? "r1" : "q1";
      const comments = kind === "review"
        ? [block(kind, slot, lines), exact(kind, slot)]
        : [exact("review", "r1"), block(kind, slot, lines), exact(kind, slot)];
      assert.notEqual(gate(comments, { risk: kind === "review" ? "standard" : "critical" }).state, "success");
    });
  }
}

test("contract (d): a short SHA of a carried head holds a carried PASS like the full SHA", () => {
  const carry = { carriedHeads: new Set([carried]) };
  const pass = exact("review", "r1", "PASS", carried);
  assert.equal(gate([pass], carry).state, "success");
  const malformed = block("review", "r2", ({ H, V }) => [`${H}: ${carried.slice(0, 8)}`, `${V}: BLOCK`]);
  assert.notEqual(gate([pass, malformed], carry).state, "success");
  const own = block("review", "r1", ({ H, V }) => [`${H}: ${carried.slice(0, 8)}`, `${V}: FAIL - see below`]);
  assert.notEqual(gate([own, exact("review", "r1", "PASS", carried)], carry).state, "success");
});

// Criterion 5 and F-012: an edit never gives a PASS; it never removes a negative.
test("criterion 5: an edited comment as the only PASS gives nothing", () => {
  assert.notEqual(gate([exact("review", "r1", "PASS", head, { edited: true })]).state, "success");
  const qa = exact("qa", "q1", "PASS", head, { edited: true });
  assert.notEqual(gate([exact("review", "r1"), qa], { risk: "critical" }).state, "success");
});

test("12 an edited comment with a malformed negative still blocks", () => {
  for (const kind of ["review", "qa"]) {
    const slot = kind === "review" ? "r2" : "q2";
    for (const lines of [({ H, V }) => [`${H}: ${head}`, `${V}: BLOCK - see below`], ({ V }) => [`${V}: FAIL`]]) {
      const { comments, risk } = withPasses(kind, block(kind, slot, lines, { edited: true }));
      assert.notEqual(gate(comments, { risk }).state, "success", kind);
    }
  }
});

// Criterion 6: a carried Owner-Override is voided through latestVerdicts.
const override = (sha) =>
  comment(`Owner-Override: PASS\nOverride-Head: ${sha}\nOverride-Reason: invented reason\n`, { app: null });

test("criterion 6: a malformed negative on the current head voids a carried Owner-Override", () => {
  const carry = { carriedHeads: new Set([carried]) };
  assert.equal(gate([override(carried)], carry).state, "success");
  for (const kind of ["review", "qa"]) {
    const slot = kind === "review" ? "r2" : "q2";
    for (const lines of [
      ({ V }) => [`${V}: BLOCK`],
      ({ H, V }) => [`${H}: ${head.slice(0, 7)}`, `${V}: FAIL`],
      ({ H, V }) => [`${H}: ${head}`, `**${V}:** BLOCK`],
    ]) {
      assert.notEqual(gate([override(carried), block(kind, slot, lines)], carry).state, "success", kind);
    }
  }
});

test("criterion 6: a later malformed negative on a carried head voids a carried Owner-Override", () => {
  const carry = { carriedHeads: new Set([carried]) };
  const earlier = block("review", "r3", ({ H, V }) => [`${H}: ${carried.slice(0, 9)}`, `${V}: BLOCK - see below`]);
  const ownerPass = override(carried);
  // An older negative on a carried head does not void a later override (as before F-027).
  assert.equal(gate([earlier, ownerPass], carry).state, "success");
  const later = block("review", "r2", ({ H, V }) => [`${H}: ${carried.slice(0, 9)}`, `${V}: BLOCK - see below`]);
  assert.notEqual(gate([earlier, ownerPass, later], carry).state, "success");
});

test("an exact Owner-Override for the current head still decides, as before F-027", () => {
  const malformed = block("review", "r2", ({ V }) => [`${V}: BLOCK`]);
  assert.equal(gate([malformed, override(head)]).state, "success");
});

test("a negative quoted inside a code block is a quote and does not block", () => {
  const quoted = comment(
    `Agent-Review: claude:r2:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n\n\`\`\`\nReview-Verdict: BLOCK\n\`\`\`\n`,
  );
  assert.equal(gate([quoted]).state, "success");
});
