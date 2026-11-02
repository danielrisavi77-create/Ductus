// F-027: a FAIL or BLOCK the gate cannot read exactly still blocks; a PASS
// counts only in its exact form. Table over the input classes of the M0.6c
// contract (#1091). All identities and heads are invented.
import test from "node:test";
import assert from "node:assert/strict";

import { MAX_MERGE_STEPS, evaluateGate } from "./review-gate-core.mjs";
import { carriedHeads as walkCarriedHeads, createApi } from "./review-gate-api.mjs";

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
  ["3 value in underscores", ({ H, V }) => [`${H}: ${head}`, `${V}: _FAIL_`]],
  ["3 value in double underscores", ({ H, V }) => [`${H}: ${head}`, `${V}: __BLOCK__`]],
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

// Contract (d) through the real carry-over chain: a negative that names an
// earlier head as a prefix or a decorated SHA is walked for and carried, so it
// holds after a clean merge of main like one with the full SHA.
const mainParent = "9".repeat(40);
const prBase = "8".repeat(40);
const prChange = { files: [{ filename: "a.mjs", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b", sha: "7".repeat(40) }] };
const mergedPr = { head: { sha: head }, base: { sha: prBase, ref: "main" } };
const mergeApi = () =>
  createApi({
    baseUrl: "https://api.test",
    token: "t",
    timeoutMs: 1000,
    fetchImpl: async (url) => {
      const path = url.replace("https://api.test", "");
      let value;
      if (path.endsWith(`/commits/${head}`)) value = { sha: head, parents: [{ sha: carried }, { sha: mainParent }] };
      else if (path.endsWith(`/commits/${carried}`)) value = { sha: carried, parents: [{ sha: "6".repeat(40) }] };
      else if (path.includes(`/compare/main...${mainParent}`)) value = { status: "behind", files: [] };
      else if (path.includes("/compare/")) value = prChange;
      else throw new Error(`unexpected ${path}`);
      return { ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) };
    },
  });
const walk = (comments) => walkCarriedHeads(mergeApi(), "o", "r", mergedPr, comments, { log: () => {} });

for (const [name, named] of [
  ["a seven digit prefix", carried.slice(0, 7)],
  ["a bold full SHA", `**${carried}**`],
  ["a full SHA in code", `\`${carried}\``],
]) {
  for (const kind of ["review", "qa"]) {
    test(`${kind}: a negative naming an earlier head as ${name} is carried after a clean main merge (contract d)`, async () => {
      const negative = block(kind, kind === "review" ? "r2" : "q2", ({ H, V }) => [`${H}: ${named}`, `${V}: BLOCK`]);
      const passes = kind === "review"
        ? [exact("review", "r1", "PASS", carried)]
        : [exact("review", "r1", "PASS", carried), exact("qa", "q1", "PASS", carried)];
      const risk = kind === "review" ? "standard" : "critical";
      assert.equal(gate(passes, { risk, carriedHeads: await walk(passes) }).state, "success");
      const comments = [...passes, negative];
      const heads = await walk(comments);
      assert.deepEqual([...heads], [carried]);
      assert.notEqual(gate(comments, { risk, carriedHeads: heads }).state, "success");
    });
  }
}

test("a negative naming only a prefix of an earlier head is still walked for (contract d)", async () => {
  const negative = block("review", "r2", ({ H, V }) => [`${H}: ${carried.slice(0, 9)}`, `${V}: FAIL`]);
  assert.deepEqual([...(await walk([negative]))], [carried]);
  const pass = block("review", "r2", ({ H, V }) => [`${H}: ${carried.slice(0, 9)}`, `${V}: PASS`]);
  assert.equal((await walk([pass])).size, 0, "a PASS still needs the full SHA");
});

for (const kind of ["review", "qa"]) {
  test(`${kind}: a negative naming only a prefix of an earlier head blocks like one with the full SHA (contract d)`, async () => {
    const risk = kind === "review" ? "standard" : "critical";
    const current = kind === "review" ? [exact("review", "r1")] : [exact("review", "r1"), exact("qa", "q1")];
    const slot = kind === "review" ? "r2" : "q2";
    for (const named of [carried, carried.slice(0, 7), `**${carried}**`]) {
      const comments = [...current, block(kind, slot, ({ H, V }) => [`${H}: ${named}`, `${V}: FAIL`])];
      const heads = await walk(comments);
      assert.deepEqual([...heads], [carried], named);
      assert.notEqual(gate(comments, { risk, carriedHeads: heads }).state, "success", named);
    }
  });
}

// p06e, finding 1 of c.6586075014: a negative verdict line written as a
// markdown heading is still a negative, for review and QA alike.
for (const kind of ["review", "qa"]) {
  test(`${kind}: a negative verdict written as a heading blocks beside a valid PASS (c.6586075014, 1)`, () => {
    const slot = kind === "review" ? "r2" : "q2";
    for (const line of [
      (V) => `# ${V}: FAIL`,
      (V) => `## ${V}: BLOCK`,
      (V) => `###### ${V}: FAIL`,
      (V) => `###${V}: FAIL`,
      (V) => `### ${V}: FAIL ###`,
      (V) => `### ${V} ###: BLOCK`,
      (V) => `> ### ${V}: BLOCK`,
      (V) => `\`### ${V}: FAIL\``,
    ]) {
      const { comments, risk } = withPasses(kind, block(kind, slot, ({ H, V }) => [`${H}: ${head}`, line(V)]));
      assert.notEqual(gate(comments, { risk }).state, "success", line(KINDS[kind].V));
    }
    // A heading inside a code block is a quote (metadataLines), as before.
    const { comments, risk } = withPasses(kind, block(kind, slot, ({ H, V }) => [`${H}: ${head}`, "```", `### ${V}: FAIL`, "```"]));
    assert.equal(gate(comments, { risk }).state, "success");
    // A PASS written as a heading is not a PASS, as before.
    const onlyPass = kind === "review"
      ? [block("review", "r1", ({ H, V }) => [`${H}: ${head}`, `### ${V}: PASS`])]
      : [exact("review", "r1"), block("qa", "q1", ({ H, V }) => [`${H}: ${head}`, `### ${V}: PASS`])];
    assert.notEqual(gate(onlyPass, { risk }).state, "success");
  });
}

// p06e, finding 2 of c.6586075014: the walk ends at a head named by a prefix,
// and an error or an expired budget behind a head already found never drops a
// negative on it. The carried head is itself a merge of main.
const mergeHead = "c0ffee1234560000000000000000000000000000";
const twinA = "abcdef1111111111111111111111111111111111";
const twinB = "abcdef1222222222222222222222222222222222";
const behind = "b".repeat(40);
const mainParent2 = "5".repeat(40);
const walkApi = (parents, { broken = new Set(), hanging = new Set(), asked = [], brokenBase = new Set(), hangingBase = new Set() } = {}) =>
  createApi({
    baseUrl: "https://api.test",
    token: "t",
    timeoutMs: 5000,
    fetchImpl: async (url) => {
      const path = url.replace("https://api.test", "");
      const sha = path.match(/\/commits\/([0-9a-f]{40})$/)?.[1];
      let value;
      if (sha) {
        asked.push(sha);
        if (broken.has(sha)) throw new Error(`broken ${sha}`);
        if (hanging.has(sha)) return new Promise(() => {});
        if (!parents[sha]) throw new Error(`unexpected ${path}`);
        value = { sha, parents: parents[sha].map((p) => ({ sha: p })) };
      } else if (path.startsWith("/repos/o/r/compare/main...")) {
        // p06f: the check that a merge's second parent is in main.
        const second = path.match(/\.\.\.([0-9a-f]{40})/)?.[1];
        if (brokenBase.has(second)) {
          const value503 = { message: "Service Unavailable" };
          return { ok: false, status: 503, json: async () => value503, text: async () => JSON.stringify(value503) };
        }
        if (hangingBase.has(second)) return new Promise(() => {});
        if (!/^(9{40}|5{40})$/.test(second ?? "")) throw new Error(`unexpected ${path}`);
        value = { status: "behind", files: [] };
      } else if (path.includes(`/compare/${prBase}...`)) value = prChange;
      else throw new Error(`unexpected ${path}`);
      return { ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) };
    },
  });
const chain = { [head]: [mergeHead, mainParent], [mergeHead]: [behind, mainParent2] };
const walkWith = (comments, opts, budgetMs) =>
  walkCarriedHeads(walkApi(opts.parents ?? chain, opts), "o", "r", mergedPr, comments, { log: () => {}, budgetMs });
const passesFor = (kind) => (kind === "review" ? [exact("review", "r1")] : [exact("review", "r1"), exact("qa", "q1")]);
const riskFor = (kind) => (kind === "review" ? "standard" : "critical");
const negativeAt = (kind, named, verdict = "FAIL") =>
  block(kind, kind === "review" ? "r2" : "q2", ({ H, V }) => [`${H}: ${named}`, `${V}: ${verdict}`]);

for (const kind of ["review", "qa"]) {
  test(`${kind}: the walk ends at a merge head named by a prefix and an error behind it keeps the negative (c.6586075014, 2)`, async () => {
    for (const named of [mergeHead, mergeHead.slice(0, 7), mergeHead.slice(0, 12)]) {
      const asked = [];
      const comments = [...passesFor(kind), negativeAt(kind, named)];
      const heads = await walkWith(comments, { broken: new Set([behind]), asked });
      assert.deepEqual([...heads], [mergeHead], named);
      assert.ok(!asked.includes(behind), `${named}: no call behind the found head`);
      assert.notEqual(gate(comments, { risk: riskFor(kind), carriedHeads: heads }).state, "success", named);
    }
  });
}

test("an expired budget behind a merge head named by a prefix keeps the negative (c.6586075014, 2)", async () => {
  const comments = [...passesFor("qa"), negativeAt("qa", mergeHead.slice(0, 7), "BLOCK")];
  const heads = await walkWith(comments, { hanging: new Set([behind]) }, 300);
  assert.deepEqual([...heads], [mergeHead]);
  assert.notEqual(gate(comments, { risk: "critical", carriedHeads: heads }).state, "success");
});

test("an error behind a found head while another name is pending keeps only the negative (c.6586075014, 2)", async () => {
  const pending = exact("review", "r3", "PASS", other);
  const negative = negativeAt("review", mergeHead.slice(0, 7));
  const heads = await walkWith([...passesFor("review"), pending, negative], { broken: new Set([behind]) });
  assert.equal(heads.size, 0, "nothing carries a PASS");
  assert.notEqual(gate([...passesFor("review"), pending, negative], { carriedHeads: heads }).state, "success");
  // A PASS on the found head is not carried by the kept head.
  const carriedPass = [exact("review", "r1", "PASS", mergeHead), pending];
  const passHeads = await walkWith(carriedPass, { broken: new Set([behind]) });
  assert.notEqual(gate(carriedPass, { carriedHeads: passHeads }).state, "success");
});

test("an ambiguous prefix ends the walk at its newest match, and a prefix of nothing changes nothing (c.6586075014, 2)", async () => {
  const parents = { [head]: [twinA, mainParent], [twinA]: [twinB, mainParent2], [twinB]: [behind, mainParent2] };
  const asked = [];
  const comments = [...passesFor("review"), negativeAt("review", twinA.slice(0, 7))];
  const heads = await walkWith(comments, { parents, broken: new Set([behind]), asked });
  assert.deepEqual([...heads], [twinA]);
  assert.ok(!asked.includes(twinB) && !asked.includes(behind));
  assert.notEqual(gate(comments, { carriedHeads: heads }).state, "success");
  // A prefix that names nothing on the walk: the walk reaches a non-merge
  // commit as before and the negative names no head of this PR.
  const nothing = [...passesFor("review"), negativeAt("review", "deadbee")];
  const none = await walkWith(nothing, { parents: { ...chain, [behind]: ["4".repeat(40)] } });
  assert.equal(none.size, 0);
  assert.equal(gate(nothing, { carriedHeads: none }).state, "success");
});

// Istodobnost: a new push lands between reading the comments and the walk. A
// negative already names the new head by a prefix; the walk runs from the head
// the comments were read with, never asks for the new one, and the negative on
// the carried head still blocks although the new name keeps the walk going.
test("a push between reading the comments and the walk keeps the carried negative (c.6586075014, 2)", async () => {
  const asked = [];
  const comments = [...passesFor("review"), negativeAt("review", newer.slice(0, 7)), negativeAt("review", mergeHead.slice(0, 7))];
  const parents = { ...chain, [newer]: [head] };
  const heads = await walkWith(comments, { parents, broken: new Set([behind]), asked });
  assert.ok(!asked.includes(newer), "the walk never asks for the new head");
  assert.equal(asked[0], head);
  assert.notEqual(gate(comments, { carriedHeads: heads }).state, "success");
});

// p06f (owner "Suzi 1396", #87 c.6587584491), finding 1 of QA c.6587122242 and
// c.6587129054: a negative verdict line behind a numbered list marker, alone or
// with a heading, quote, bold or code, still blocks; a PASS so written does not
// count.
const NUMBERED = [
  ["numbered list", (V) => `1. ${V}: FAIL`],
  ["numbered list with a parenthesis", (V) => `2) ${V}: BLOCK`],
  ["two digit number", (V) => `10. ${V}: BLOK`],
  ["escaped full stop", (V) => `1\\. ${V}: FAIL`],
  ["heading and number", (V) => `## 1. ${V}: FAIL`],
  ["heading and number with a parenthesis", (V) => `### 2) ${V}: BLOCK`],
  ["number and bold field name", (V) => `1. **${V}:** FAIL`],
  ["number and bold line", (V) => `1. **${V}: BLOCK**`],
  ["quote and number", (V) => `> 1. ${V}: FAIL`],
  ["quote, heading and number", (V) => `> ## 1. ${V}: BLOCK`],
  ["number inside code", (V) => `\`1. ${V}: FAIL\``],
  ["number and field name in code", (V) => `1. \`${V}\`: BLOCK`],
  ["bullet and number", (V) => `- 1. ${V}: FAIL`],
];
for (const kind of ["review", "qa"]) {
  const slot = kind === "review" ? "r2" : "q2";
  for (const [name, line] of NUMBERED) {
    test(`${kind}: a negative verdict as "${name}" blocks beside a valid PASS (p06f, 1)`, () => {
      const { comments, risk } = withPasses(kind, block(kind, slot, ({ H, V }) => [`${H}: ${head}`, line(V)]));
      assert.notEqual(gate(comments, { risk }).state, "success", line(KINDS[kind].V));
    });
  }
  test(`${kind}: a numbered negative names its earlier head and is walked for (p06f, 1)`, async () => {
    const comments = [...passesFor(kind), block(kind, slot, ({ H, V }) => [`${H}: ${mergeHead.slice(0, 7)}`, `1. ${V}: FAIL`])];
    const heads = await walkWith(comments, { broken: new Set([behind]) });
    assert.deepEqual([...heads], [mergeHead]);
    assert.notEqual(gate(comments, { risk: riskFor(kind), carriedHeads: heads }).state, "success");
  });
  test(`${kind}: a numbered negative in a fenced code block is a quote and a numbered PASS is not a PASS (p06f, 1)`, () => {
    const fenced = withPasses(kind, block(kind, slot, ({ H, V }) => [`${H}: ${head}`, "```", `1. ${V}: FAIL`, "```"]));
    assert.equal(gate(fenced.comments, { risk: fenced.risk }).state, "success");
    const onlyPass = kind === "review"
      ? [block("review", "r1", ({ H, V }) => [`${H}: ${head}`, `1. ${V}: PASS`])]
      : [exact("review", "r1"), block("qa", "q1", ({ H, V }) => [`${H}: ${head}`, `1. ${V}: PASS`])];
    assert.notEqual(gate(onlyPass, { risk: riskFor(kind) }).state, "success");
  });
}

// p06f, finding 2 of review c.6587055610 and QA c.6587122242 / c.6587129054: a
// head the walk reached stays in the path when the check of its own second
// parent fails or times out, so a negative on it still blocks. It still
// carries no PASS and no Owner-Override.
const deep = (i) => (i + 0x10).toString(16).padStart(2, "0").repeat(20);
const deepChain = (depth) => {
  const parents = { [head]: [deep(1), mainParent] };
  for (let i = 1; i <= depth; i += 1) parents[deep(i)] = [i === depth ? behind : deep(i + 1), i === depth ? mainParent2 : mainParent];
  return parents;
};
const PATHS = [
  ["head equal to the parent, 503", { parents: chain, named: mergeHead, brokenBase: new Set([mainParent2]) }],
  ["merge commit, timeout", { parents: chain, named: mergeHead, hangingBase: new Set([mainParent2]), budgetMs: 300 }],
  ["depth 2, 503", { parents: deepChain(2), named: deep(2), brokenBase: new Set([mainParent2]) }],
  ["depth MAX_MERGE_STEPS, 503", { parents: deepChain(MAX_MERGE_STEPS), named: deep(MAX_MERGE_STEPS), brokenBase: new Set([mainParent2]) }],
];
for (const kind of ["review", "qa"]) {
  for (const [name, { named, budgetMs, ...opts }] of PATHS) {
    test(`${kind}: ${name} on the check of a reached head's parent keeps its negative (p06f, 2)`, async () => {
      for (const as of [named, named.slice(0, 7)]) {
        const comments = [...passesFor(kind), negativeAt(kind, as)];
        const heads = await walkWith(comments, opts, budgetMs);
        assert.equal(heads.size, 0, `${as}: nothing carries`);
        assert.deepEqual([...heads.heldNegatives], [named], as);
        assert.notEqual(gate(comments, { risk: riskFor(kind), carriedHeads: heads }).state, "success", as);
      }
    });
  }
}

test("a reached head kept after a failed parent check carries no PASS and no Owner-Override (p06f, 2)", async () => {
  const opts = { brokenBase: new Set([mainParent2]) };
  const pass = [exact("review", "r1", "PASS", mergeHead)];
  assert.notEqual(gate(pass, { carriedHeads: await walkWith(pass, opts) }).state, "success");
  const owner = [override(mergeHead)];
  assert.notEqual(gate(owner, { carriedHeads: await walkWith(owner, opts) }).state, "success");
});

test("a failed parent check before the named head still keeps nothing, as before (p06f, 2)", async () => {
  const comments = [...passesFor("review"), negativeAt("review", mergeHead.slice(0, 7))];
  const heads = await walkWith(comments, { brokenBase: new Set([mainParent]) });
  assert.equal(heads.size, 0);
  assert.equal(heads.heldNegatives?.size ?? 0, 0);
});

// p06g (owner, #87, 2. 11. 2026.), finding of review c.6588309821: a negative
// verdict line written as a markdown task list item, with or without an
// indent, still blocks, read by the same pattern as a numbered list; a PASS so
// written does not count.
const TASK_LIST = [
  ["dash, open box", (V) => `- [ ] ${V}: FAIL`],
  ["dash, ticked box", (V) => `- [x] ${V}: BLOCK`],
  ["dash, capital tick", (V) => `- [X] ${V}: BLOK`],
  ["star, open box", (V) => `* [ ] ${V}: FAIL`],
  ["plus, open box", (V) => `+ [ ] ${V}: BLOCK`],
  ["plus, capital tick", (V) => `+ [X] ${V}: FAIL`],
  ["indent 2, dash, open box", (V) => `  - [ ] ${V}: FAIL`],
  ["indent 2, star, ticked box", (V) => `  * [x] ${V}: BLOCK`],
  ["indent 3, plus, capital tick", (V) => `   + [X] ${V}: BLOK`],
  ["indent 2, plus, open box", (V) => `  + [ ] ${V}: FAIL`],
  ["indent 3, dash, capital tick", (V) => `   - [X] ${V}: BLOCK`],
  ["box and bold field name", (V) => `- [ ] **${V}:** FAIL`],
  ["quote and box", (V) => `> - [x] ${V}: FAIL`],
  ["box without a bullet", (V) => `[ ] ${V}: BLOCK`],
];
for (const kind of ["review", "qa"]) {
  const slot = kind === "review" ? "r2" : "q2";
  for (const [name, line] of TASK_LIST) {
    test(`${kind}: a negative verdict as a task list item "${name}" blocks beside a valid PASS (p06g)`, () => {
      const { comments, risk } = withPasses(kind, block(kind, slot, ({ H, V }) => [`${H}: ${head}`, line(V)]));
      assert.notEqual(gate(comments, { risk }).state, "success", line(KINDS[kind].V));
    });
  }
  test(`${kind}: a task list negative names its earlier head and is walked for (p06g)`, async () => {
    const comments = [...passesFor(kind), block(kind, slot, ({ H, V }) => [`${H}: ${mergeHead.slice(0, 7)}`, `- [ ] ${V}: FAIL`])];
    const heads = await walkWith(comments, { broken: new Set([behind]) });
    assert.deepEqual([...heads], [mergeHead]);
    assert.notEqual(gate(comments, { risk: riskFor(kind), carriedHeads: heads }).state, "success");
  });
  test(`${kind}: a task list PASS is not a PASS and a fenced task list negative is a quote (p06g)`, () => {
    for (const box of ["- [ ]", "- [x]", "* [X]", "+ [ ]"]) {
      const onlyPass = kind === "review"
        ? [block("review", "r1", ({ H, V }) => [`${H}: ${head}`, `${box} ${V}: PASS`])]
        : [exact("review", "r1"), block("qa", "q1", ({ H, V }) => [`${H}: ${head}`, `${box} ${V}: PASS`])];
      assert.notEqual(gate(onlyPass, { risk: riskFor(kind) }).state, "success", box);
    }
    const fenced = withPasses(kind, block(kind, slot, ({ H, V }) => [`${H}: ${head}`, "```", `- [ ] ${V}: FAIL`, "```"]));
    assert.equal(gate(fenced.comments, { risk: fenced.risk }).state, "success");
  });
}
