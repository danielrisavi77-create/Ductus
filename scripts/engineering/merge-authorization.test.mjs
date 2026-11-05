import test from "node:test";
import assert from "node:assert/strict";

import { carriedHeadCandidates, evaluateMergeAuthorization, evaluatePullRequest } from "./review-gate-core.mjs";
import { CRITICAL_PATHS, evaluateMetadata } from "./pr-metadata-core.mjs";
import { changedPaths, CRITICAL_DOC_PATHS, CRITICAL_TEST_PATHS, D97_MANUAL_PATHS, D97_PATHS, isOwnerFreePath, qaExemption } from "./protected-paths.mjs";

// D-161 (h): the merge queue reads one status, "Merge authorization", computed
// by the gate with the same parser that checks the declared risk.
const head = "a".repeat(40);
const earlier = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
// The strongest green: the gate counted a separate QA PASS (D-196 reads `qaPass`).
const GREEN = { state: "success", description: "ok", qaPass: true };

let counter = 0;
const comment = (text, { login = ownerLogin, association = "OWNER", appSlug = null, type = "User" } = {}) => ({
  body: text,
  user: { login, type },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const command = (sha, opts) => comment(`Owner-Command: merge\nCommand-Head: ${sha}\nDatum: 2026-10-22\n`, opts);

function authorize({ body, filenames = ["src/a.ts"], comments = [], gate = GREEN, carriedHeads = new Set(), sameRepository = true }) {
  const paths = changedPaths(filenames.map((filename) => ({ filename })));
  return evaluateMergeAuthorization({
    gate,
    metadata: evaluateMetadata({ body, files: paths }),
    paths,
    comments,
    headSha: head,
    ownerLogin,
    carriedHeads,
    sameRepository,
  });
}
const bodyWith = (risk) => `Agent: claude:a:platforma\nRisk: ${risk}\nTask: B-1\n`;

test("Risk low or standard without a D-97 path is authorized without a command", () => {
  assert.equal(authorize({ body: bodyWith("low"), filenames: ["docs/a.md"] }).state, "success");
  assert.equal(authorize({ body: bodyWith("Standard") }).state, "success");
});

// D-196: the owner's command is kept for D-97 paths and for a critical PR whose
// gate passed by an Owner Override; a critical PR without D-97 paths whose gate
// counted review and QA, or review alone on a QA-exempt list (#87 c.6549357009
// t. 2), needs none.
const D97 = ["scripts/engineering/x.mjs"];
// Only tests, so QA-exempt; its risk floor is below critical, so the parsed
// risk decides the result.
const QA_EXEMPT = ["e2e/a.spec.ts"];
const qaExemptOf = (file) => qaExemption([file]) !== null;

test("Risk critical with QA required and no D-97 path is authorized without a command (D-196)", () => {
  const out = authorize({ body: bodyWith("critical"), filenames: ["src/a.ts", "db/migrations/1.sql"] });
  assert.equal(out.state, "success");
  assert.match(out.description, /D-196/);
});

test("Risk critical on a D-97 path still needs the owner's command (D-196)", () => {
  for (const filenames of [D97, ["src/a.ts", ...D97], ["src/a.ts", "docs/DECISIONS.md"], ["src/a.ts", ".github/workflows/ci.yml"]]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames }).state, "pending", filenames.join(","));
    assert.equal(authorize({ body: bodyWith("critical"), filenames, comments: [command(head)] }).state, "success");
  }
});

test("a QA-exempt critical PR (only tests or only documents) without D-97 paths needs no command (D-196, c.6549357009 t. 2)", () => {
  const exemptGate = { state: "success", description: "ok", qaExemptPass: true };
  for (const filenames of [QA_EXEMPT, ["tests/unit/a.test.ts"], ["db/tests/a.sql"], ["docs/x.md"]]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames, gate: exemptGate }).state, "success", filenames.join(","));
    // A gate whose shape does not match the file list (qaPass on an exempt list, or
    // no flag at all) is not a verdict pass for it.
    assert.equal(authorize({ body: bodyWith("critical"), filenames }).state, "pending", filenames.join(","));
    assert.equal(authorize({ body: bodyWith("critical"), filenames, gate: { state: "success", description: "x" } }).state, "pending");
  }
  // qaExemptPass on a list that needs QA is not enough.
  assert.equal(authorize({ body: bodyWith("critical"), filenames: ["src/a.ts"], gate: exemptGate }).state, "pending");
});

test("a critical PR from a fork keeps the owner's command, with QA or QA-exempt (D-196, ENGINEERING_SYSTEM §5, #971)", () => {
  for (const [filenames, gate] of [[["src/a.ts"], GREEN], [QA_EXEMPT, { state: "success", description: "ok", qaExemptPass: true }]]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames, gate, sameRepository: false }).state, "pending", filenames.join(","));
    assert.equal(authorize({ body: bodyWith("critical"), filenames, gate, sameRepository: false, comments: [command(head)] }).state, "success");
  }
});

test("a QA-exempt critical PR on a D-97 path still needs the owner's command (D-196)", () => {
  const exemptGate = { state: "success", description: "ok", qaExemptPass: true };
  for (const filenames of [["scripts/engineering/x.test.mjs"], ["docs/ORKESTRATOR.md"], ["docs/DECISIONS.md"], [".claude/skills/x/SKILL.md"]]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames, gate: exemptGate }).state, "pending", filenames.join(","));
    assert.equal(authorize({ body: bodyWith("critical"), filenames, gate: exemptGate, comments: [command(head)] }).state, "success");
  }
});

test("a critical gate green without a counted QA PASS keeps the owner's command (D-196, Codex P2 on #1079)", () => {
  const filenames = ["src/a.ts", "db/migrations/1.sql"];
  for (const gate of [{ state: "success", description: "Owner override recorded for critical risk." }, { state: "success", description: "x", qaPass: false }]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames, gate }).state, "pending");
    assert.equal(authorize({ body: bodyWith("critical"), filenames, gate, comments: [command(head)] }).state, "success");
  }
});

test("end to end: an Owner Override alone does not authorize a critical PR, review and QA PASS do (D-196)", () => {
  const files = [{ filename: "db/migrations/1.sql" }];
  const repo = { full_name: "danielrisavi77-create/Ductus" };
  const pr = { body: bodyWith("critical"), head: { sha: head, repo }, base: { repo }, changed_files: 1, user: { login: "writer" } };
  const run = (comments) =>
    evaluatePullRequest({ pr, files, comments, prReviews: [], reviewComments: [], ownerLogin, carriedHeads: new Set() });
  const override = comment(`Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: test\n`);
  const overridden = run([override]);
  assert.equal(overridden.result.state, "success");
  assert.equal(overridden.mergeAuthorization.state, "pending");
  const review = comment(`Agent-Review: claude:r1:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, { appSlug: "claude" });
  const qa = comment(`QA-Agent: codex:q1:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: x\n`, { appSlug: "chatgpt-codex-connector" });
  const verdicts = run([review, qa]);
  assert.equal(verdicts.result.state, "success", verdicts.result.description);
  assert.equal(verdicts.mergeAuthorization.state, "success");
});

test("end to end: a QA-exempt critical PR merges on review alone, but not on an Owner Override (D-196, c.6549357009)", () => {
  const files = [{ filename: "db/tests/a.sql" }];
  const repo = { full_name: "danielrisavi77-create/Ductus" };
  const pr = { body: bodyWith("critical"), head: { sha: head, repo }, base: { repo }, changed_files: 1, user: { login: "writer" } };
  const run = (comments) =>
    evaluatePullRequest({ pr, files, comments, prReviews: [], reviewComments: [], ownerLogin, carriedHeads: new Set() });
  const overridden = run([comment(`Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: test\n`)]);
  assert.equal(overridden.result.state, "success");
  assert.equal(overridden.mergeAuthorization.state, "pending");
  // The author runs on Claude, so the review comes from another App (F-180).
  const reviewed = run([comment(`Agent-Review: codex:r1:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, { appSlug: "chatgpt-codex-connector" })]);
  assert.equal(reviewed.result.state, "success", reviewed.result.description);
  assert.equal(reviewed.mergeAuthorization.state, "success");
  assert.equal(run([]).mergeAuthorization.state, "pending");
});

// F-180: on the QA-exempt path the review is the only independent look, so it
// must come from an App other than the author's runtime, as F-173 asks of QA.
test("D-196: a QA-exempt critical PR reviewed only through the author's own App keeps the command (F-180)", () => {
  const repo = { full_name: "danielrisavi77-create/Ductus" };
  const run = (author, files, comments) => {
    const pr = { body: `Agent: ${author}\nRisk: critical\nTask: B-1\n`, head: { sha: head, repo }, base: { repo }, changed_files: files.length, user: { login: "writer" } };
    return evaluatePullRequest({ pr, files, comments, prReviews: [], reviewComments: [], ownerLogin, carriedHeads: new Set() });
  };
  const review = (agent, appSlug) => comment(`Agent-Review: ${agent}\nReview-Head: ${head}\nReview-Verdict: PASS\n`, { appSlug });
  const claudeReview = review("claude:r1:reviewer", "claude");
  const codexReview = review("codex:r1:reviewer", "chatgpt-codex-connector");
  const grokReview = review("grok:r1:reviewer", "grok-by-xai");
  for (const files of [
    [{ filename: "db/tests/000-a.sql", status: "added" }],
    [{ filename: "tests/property/setup.ts", status: "modified" }],
    [{ filename: "db/tests/020-a.sql", status: "removed" }],
    [{ filename: "docs/x.md", status: "modified" }],
  ]) {
    const label = files[0].filename;
    const same = run("claude:a:backend", files, [claudeReview]);
    assert.equal(same.result.state, "success", `${label}: ${same.result.description}`);
    assert.equal(same.mergeAuthorization.state, "pending", label);
    assert.equal(run("claude:a:backend", files, [claudeReview, command(head)]).mergeAuthorization.state, "success", label);
    // Another App's review opens the path; so does it alongside a same-App one.
    assert.equal(run("claude:a:backend", files, [codexReview]).mergeAuthorization.state, "success", label);
    assert.equal(run("claude:a:backend", files, [claudeReview, grokReview]).mergeAuthorization.state, "success", label);
    // Both OpenAI runtimes run on the Codex App, and either side may be the author.
    for (const author of ["codex:a:backend", "chatgpt:a:backend"]) {
      assert.equal(run(author, files, [codexReview]).mergeAuthorization.state, "pending", `${author} ${label}`);
      assert.equal(run(author, files, [claudeReview]).mergeAuthorization.state, "success", `${author} ${label}`);
    }
  }
});

// F-173: the D-196 path takes only an allowlist of files and only verdicts
// posted through Apps from two different Apps.
test("D-196 allowlist: a critical PR touching any file outside application code keeps the command (F-173)", () => {
  for (const extra of [
    ".tooling/x.json", "x.config.ts", "db/x/seed.sql", "scripts/x/run.mjs", "package.json", "infra/x.yaml",
    "src/.env.example", "src/node_modules/x/index.js", "src/CLAUDE.md", "config/x.json", "public/x.js", "docs/engineering/x.md",
  ]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames: ["src/a.ts", extra] }).state, "pending", extra);
    assert.equal(authorize({ body: bodyWith("critical"), filenames: ["src/a.ts", extra], comments: [command(head)] }).state, "success", extra);
  }
  for (const ok of ["src/server/auth/x.ts", "app/rad/page.tsx", "db/migrations/1.sql", "db/tests/a.sql", "tests/unit/a.test.ts", "e2e/a.spec.ts"]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames: [ok] }).state, qaExemptOf(ok) ? "pending" : "success", ok);
  }
});

const cli = (text, channel) => comment(`${text}Review-Channel: ${channel}\n`);
const prRun = (filename, comments) => {
  const repo = { full_name: "danielrisavi77-create/Ductus" };
  const pr = { body: bodyWith("critical"), head: { sha: head, repo }, base: { repo }, changed_files: 1, user: { login: "writer" } };
  return evaluatePullRequest({ pr, files: [{ filename }], comments, prReviews: [], reviewComments: [], ownerLogin, carriedHeads: new Set() });
};

test("D-196: owner-account CLI verdicts never open the path, as a pair or with one App (F-173)", () => {
  const cliReview = cli(`Agent-Review: codex:cxr1:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, "codex-cli");
  const cliQa = cli(`QA-Agent: codex:cxq1:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: x\n`, "codex-cli");
  const grokQa = cli(`QA-Agent: grok:gq1:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: x\n`, "grok-cli");
  const appReview = comment(`Agent-Review: claude:r1:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, { appSlug: "claude" });
  const appQa = comment(`QA-Agent: codex:q1:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: x\n`, { appSlug: "chatgpt-codex-connector" });
  for (const [label, comments] of [["CLI pair", [cliReview, cliQa]], ["App review, CLI QA", [appReview, grokQa]], ["CLI review, App QA", [cliReview, appQa]]]) {
    const out = prRun("db/migrations/1.sql", comments);
    assert.equal(out.result.state, "success", `${label}: ${out.result.description}`);
    assert.equal(out.mergeAuthorization.state, "pending", label);
  }
  // A QA-exempt critical PR reviewed only through a CLI comment keeps the command.
  assert.equal(prRun("db/tests/a.sql", [cli(`Agent-Review: codex:cxr1:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, "codex-cli")]).mergeAuthorization.state, "pending");
  // Control: App review and QA from two Apps open it.
  assert.equal(prRun("db/migrations/1.sql", [appReview, appQa]).mergeAuthorization.state, "success");
});

test("D-196: a QA PASS from the reviewer's own App never opens the path (Codex pair, quota fallback, D-139) (F-173)", () => {
  const review = comment(`Agent-Review: codex:r1:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, { appSlug: "chatgpt-codex-connector" });
  const qa = comment(`QA-Agent: codex:q1:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: x\n`, { appSlug: "chatgpt-codex-connector" });
  const out = prRun("db/migrations/1.sql", [review, qa]);
  assert.equal(out.result.state, "success", out.result.description);
  assert.equal(out.mergeAuthorization.state, "pending");
});
test("an undeclared or failing metadata never authorizes a critical PR without a command", () => {
  assert.equal(authorize({ body: "Agent: claude:a:platforma\nTask: B-1\n" }).state, "pending");
});

test("a description that fools a regex does not fool the parser (review of #565, finding 1)", () => {
  const body = "Agent: claude:a:platforma\nrisk: critical\nTask: B-1\n\n```\nRisk: standard\n```\n";
  // With a gate that counted QA, a QA-exempt path keeps the command for critical
  // but not for standard, so the result shows which risk the parser read.
  assert.equal(authorize({ body, filenames: QA_EXEMPT }).state, "pending");
  assert.equal(authorize({ body: `${bodyWith("critical")}\nRisk: standard\n`, filenames: QA_EXEMPT }).state, "pending");
  assert.equal(authorize({ body: bodyWith("standard"), filenames: QA_EXEMPT }).state, "success");
});

test("a critical-floor path declared as standard is not authorized (metadata fails)", () => {
  assert.equal(authorize({ body: bodyWith("standard"), filenames: ["db/migrations/1.sql"] }).state, "pending");
});

test("a D-97 path needs the command even when declared low, and a rename counts under both names", () => {
  assert.equal(authorize({ body: bodyWith("critical"), filenames: [".github/mergify.yml"] }).state, "pending");
  const paths = changedPaths([{ filename: "docs/x.md", previous_filename: "docs/DECISIONS.md" }]);
  const result = evaluateMergeAuthorization({
    gate: GREEN,
    metadata: { ok: true, risk: "low", minimumRisk: "low" },
    paths,
    comments: [],
    headSha: head,
    ownerLogin,
    carriedHeads: new Set(),
  });
  assert.equal(result.state, "pending");
});

test("a label or a body edit cannot authorize a critical PR; only the owner's command does (finding 2)", () => {
  const body = `${bodyWith("critical")}\nLabel: spoji-me\n`;
  assert.equal(authorize({ body, filenames: D97 }).state, "pending");
  assert.equal(authorize({ body, filenames: QA_EXEMPT }).state, "pending");
});

test("the command binds to the head: another head, another login, an App or a bot do not count", () => {
  const critical = bodyWith("critical");
  const filenames = D97;
  assert.equal(authorize({ body: critical, filenames, comments: [command(earlier)] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames, comments: [command(head, { login: "someone", association: "MEMBER" })] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames, comments: [command(head, { appSlug: "some-app" })] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames, comments: [command(head, { type: "Bot" })] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames, comments: [comment(`Owner-Command: reject\nCommand-Head: ${head}\n`)] }).state, "pending");
});

test("the command on an earlier head counts only once that head is carried through a clean base merge (D-101)", () => {
  const critical = bodyWith("critical");
  const comments = [command(earlier)];
  assert.equal(authorize({ body: critical, filenames: D97, comments }).state, "pending");
  assert.equal(authorize({ body: critical, filenames: D97, comments, carriedHeads: new Set([earlier]) }).state, "success");
  const merge = (sha) => ({ sha, parents: [{}, {}], mergesBase: true });
  assert.deepEqual(carriedHeadCandidates(comments, head, [merge(head), { sha: earlier, parents: [{}] }]).heads, [earlier]);
  const app = [command(earlier, { appSlug: "some-app" })];
  assert.deepEqual(carriedHeadCandidates(app, head, [merge(head), { sha: earlier, parents: [{}] }]).heads, []);
});

test("nothing is authorized while the gate is not green", () => {
  assert.equal(authorize({ body: bodyWith("low"), gate: { state: "pending", description: "x" } }).state, "pending");
  assert.equal(authorize({ body: bodyWith("critical"), comments: [command(head)], gate: { state: "failure", description: "x" } }).state, "pending");
});

test("evaluatePullRequest returns the authorization beside the gate result", () => {
  const pr = { body: bodyWith("standard"), head: { sha: head }, changed_files: 1, user: { login: "x" } };
  const out = evaluatePullRequest({
    pr,
    files: [{ filename: "src/a.ts" }],
    comments: [],
    prReviews: [],
    reviewComments: [],
    ownerLogin,
    carriedHeads: new Set(),
  });
  assert.notEqual(out.result.state, "success");
  assert.equal(out.mergeAuthorization.state, "pending");
});

// F-173 (review c.6550166650): a file on the critical floor stays under the
// owner's command unless the floor is the app code itself (migrations, the
// actor boundary and tests are what D-196 lets merge without it).
const APP_FLOOR = new Set(["db/migrations/", "db/tests/", "src/server/db/", "tests/"]);
test("no critical-floor control file is owner-free, only the app floor is (F-173)", () => {
  for (const entry of CRITICAL_PATHS) {
    const sample = entry.endsWith("/") ? `${entry}x.ts` : entry;
    assert.equal(isOwnerFreePath(sample), APP_FLOOR.has(entry), entry);
  }
  assert.equal(isOwnerFreePath("docs/PRODUCT.md"), false);
  assert.equal(isOwnerFreePath("docs/FEATURES.md"), true);
  const control = authorize({ body: bodyWith("critical"), filenames: ["src/server/auth/session.ts", "docs/FEATURES.md"] });
  assert.equal(control.state, "success");
  const product = authorize({ body: bodyWith("critical"), filenames: ["src/server/auth/session.ts", "docs/PRODUCT.md"] });
  assert.equal(product.state, "pending");
});
// QA-1079-01: every exclusion holds in any letter case and with either path
// separator, and the allowlist matches exact case only.
test("D-196 exclusions ignore letter case and separators; the allowlist is exact case (QA-1079-01)", () => {
  const excluded = [
    ...[...D97_PATHS, ...D97_MANUAL_PATHS, ...CRITICAL_DOC_PATHS, ...CRITICAL_TEST_PATHS].map((p) => (p.endsWith("/") ? `${p}x.md` : p)),
    "src/node_modules/x/index.js", "tests/node_modules/x.test.ts", "src/.hidden/x.ts", "src/AGENTS.override.md",
    "src/CLAUDE.local.md", "src/x.instructions.md", "src/.codex/config.toml",
  ];
  for (const p of excluded) {
    for (const variant of [p, p.toUpperCase(), p.replace(/node_modules/, "Node_Modules"), p.replaceAll("/", "\\")]) {
      assert.equal(isOwnerFreePath(variant), false, variant);
    }
  }
  for (const p of ["SRC/x.ts", "Tests/x.test.ts", "APP/page.tsx", "E2E/x.spec.ts", "DB/MIGRATIONS/x.sql"]) {
    assert.equal(isOwnerFreePath(p), false, p);
  }
  assert.equal(isOwnerFreePath("src\\server\\auth\\x.ts"), true);
  const critical = bodyWith("critical");
  assert.equal(authorize({ body: critical, filenames: ["src/server/auth/x.ts", "SRC/NODE_MODULES/X/INDEX.JS"] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames: ["src/server/auth/x.ts", "src/Node_Modules/x/index.js"] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames: ["src/server/auth/x.ts"] }).state, "success");
});