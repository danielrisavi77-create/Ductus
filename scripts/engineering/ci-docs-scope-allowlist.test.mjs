import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { ORDINARY_DOCS, classifyDiff, ciProfile } from "./ci-docs-scope.mjs";
import { isD97Path } from "./protected-paths.mjs";

// DAN-710 (owner, #87 c.6807060821; attack plan #1958). A docs-only PR skips
// the stack, browser, property and build steps, so every listed document must
// have no reader there. This guard runs with the always-on engineering tests,
// so a PR that adds a reader fails in that same PR.
const root = fileURLToPath(new URL("../../", import.meta.url));
const record = (path, modes = "100644 100644", status = "M") =>
  `:${modes} ${"a".repeat(40)} ${"b".repeat(40)} ${status}\0${path}\0`;
const doc = ORDINARY_DOCS.find((path) => path.includes("/"));
const other = ORDINARY_DOCS.find((path) => path !== doc);
const pr = { eventName: "pull_request", baseRef: "main", headRef: "claude/dan-1-docs", author: "writer" };

test("A1 to A11: only listed regular documents of an ordinary PR use docs mode", () => {
  assert.ok(ORDINARY_DOCS.length > 2 && Object.isFrozen(ORDINARY_DOCS));
  const table = [
    ["A1 modify, add, delete", record(doc) + record(other, "000000 100644", "A") + record(doc, "100644 000000", "D"), "docs"],
    ["A2 docs and code", record(doc) + record("src/x.ts"), "full"],
    ["A3 docs and .github", record(doc) + record(".github/workflows/ci.yml"), "full"],
    ["A4 doc renamed to code", record(doc, "100644 000000", "D") + record("src/pilot.ts", "000000 100644", "A"), "full"],
    ["A4 code renamed to doc", record("src/pilot.ts", "100644 000000", "D") + record(doc, "000000 100644", "A"), "full"],
    ["A5 deletion with an unlisted file", record(doc, "100644 000000", "D") + record("package.json"), "full"],
    ["A6 empty diff", "", "full"],
    ["A9 document read by a tool", record(doc) + record("STATE.md"), "full"],
    ["A9 decisions", record("docs/DECISIONS.md"), "full"],
    ["A10 new unlisted doc", record("docs/novo.md", "000000 100644", "A"), "full"],
    ["A10 new subdirectory", record(`${dirname(doc)}/novi/${posix.basename(doc)}`, "000000 100644", "A"), "full"],
    ["A11 executable", record(doc, "100644 100755"), "full"],
    ["A11 symlink", record(doc, "120000 120000"), "full"],
  ];
  for (const path of [doc.toLowerCase(), doc.toUpperCase(), doc.replaceAll("/", "\\"), `./${doc}`,
    `docs/../${doc}`, `${doc} `, `${doc}\nREADME.md`, `${doc}x`, `${doc}.bak`]) {
    if (!ORDINARY_DOCS.includes(path)) table.push([`attack 5 ${JSON.stringify(path)}`, record(path), "full"]);
  }
  for (const [label, raw, expected] of table) assert.equal(classifyDiff(raw), expected, label);
});

test("A7 and A8: main, nightly, other bases and every Mergify carrier signal run full", () => {
  for (const eventName of ["push", "schedule", "merge_group", undefined]) {
    assert.equal(ciProfile({ ...pr, eventName }), "full", String(eventName));
  }
  assert.equal(ciProfile({ ...pr, baseRef: "mergify/merge-queue/0123456789" }), "full");
  // Either signal alone suffices; a missing signal (an old workflow) is full.
  // None of these reach git: the bad SHAs below would otherwise throw.
  for (const signal of [{ headRef: "mergify/merge-queue/0123456789" }, { headRef: "Mergify/merge-queue/x" },
    { author: "mergify[bot]" }, { author: "Mergify[bot]" }, { headRef: "" }, { headRef: undefined },
    { author: "" }, { author: undefined }, { headRef: ["main"] }]) {
    assert.equal(ciProfile({ ...pr, ...signal, baseSha: "bad", headSha: "bad" }), "full", JSON.stringify(signal));
  }
  assert.throws(() => ciProfile({ ...pr, baseSha: "bad", headSha: "bad" }), /immutable full commit SHAs/);
});

const tracked = execFileSync("git", ["ls-files", "-s", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0").filter(Boolean).map((line) => /^(\d{6}) [a-f0-9]+ \d\t(.+)$/s.exec(line)).map(([, mode, path]) => ({ mode, path }));
// Classification fixtures that spell listed paths, not readers of them.
const FIXTURES = new Set([
  "scripts/engineering/ci-docs-scope.mjs", "scripts/engineering/ci-docs-scope.test.mjs",
  "scripts/engineering/ci-docs-scope-allowlist.test.mjs", "scripts/engineering/ci-docs-scope-tests-profile.test.mjs",
  "scripts/engineering/pre-push-tests.mjs", "scripts/engineering/pre-push-tooling.test.mjs",
  "scripts/engineering/risk-floor.test.mjs",
]);
const sources = tracked.filter(({ mode, path }) => mode !== "160000" && !path.endsWith(".md") && !FIXTURES.has(path))
  .flatMap(({ path }) => {
    const text = readFileSync(`${root}${path}`, "latin1");
    // `join("docs", "adr")` and `"docs/" + "adr"` read as the joined path.
    return text.includes("\0") ? [] : [{ path, text: text.replace(/["'`]\s*[,+]\s*["'`]/g, "/") }];
  });
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("listed documents are tracked plain docs outside D-97 and the agent rules", () => {
  assert.equal(new Set(ORDINARY_DOCS).size, ORDINARY_DOCS.length);
  const modes = new Map(tracked.map(({ mode, path }) => [path, mode]));
  for (const path of ORDINARY_DOCS) {
    assert.equal(modes.get(path), "100644", `${path} is a tracked regular file`);
    assert.match(path, /^(?:README\.md|docs\/(?:[a-z0-9-]+\/)?[A-Za-z0-9.-]+\.md)$/, path);
    assert.ok(!isD97Path(path) && !/^(?:STATE|AGENTS|CLAUDE)\.md$|^\.(?:claude|agents)\//.test(path), path);
  }
});

// Files of the steps a docs profile skips: stack, browser, database, property,
// local launcher and fake OIDC tests, the Next build and the production image.
const SKIPPED = /^(?:e2e|tests\/(?:property|integration)|infra|db|scripts\/(?:local|db)|config|public)\/|^scripts\/engineering\/production-image|\.(?:property|integration)\.test\.ts$|^(?:next\.config|middleware|instrumentation|playwright[\w.]*config|compose)\.|^(?:src|app)\/(?!.*\.test\.tsx?$)/;

test("no tracked file outside Markdown names a listed document, its directory or a sibling list", () => {
  for (const path of ORDINARY_DOCS) {
    // A root name such as README.md is also every directory's README, so only
    // the skipped steps are searched for it; their tests read nothing at the root.
    const readers = path.includes("/") ? sources : sources.filter(({ path: file }) => SKIPPED.test(file));
    // `docs/x/README.md` is another file, so a root name preceded by "/" is not it.
    const direct = new RegExp(`(?<![\\w.${path.includes("/") ? "" : "/"}-])${escape(path)}(?![\\w.-])`);
    const dirs = [];
    for (let dir = dirname(path); dir !== "." && dir !== "docs"; dir = dirname(dir)) dirs.push(dir);
    // The bare docs root is walked only by always-on engineering tests (below).
    const directory = dirs.map((dir) => new RegExp(`(?<![\\w.-])${escape(dir)}/?(?=["'\`*)$]|$)`, "m"));
    const sibling = new RegExp(`(?<![\\w.-])${escape(posix.basename(path))}(?![\\w.-])`);
    for (const { path: file, text } of readers) {
      assert.doesNotMatch(text, direct, `${file} names ${path}`);
      for (const pattern of directory) assert.doesNotMatch(text, pattern, `${file} reads the directory of ${path}`);
      if (dirname(file) === dirname(path)) assert.doesNotMatch(text, sibling, `${file} lists ${path}`);
    }
  }
});

test("no file of a step the docs profile skips reads the whole docs directory", () => {
  for (const { path, text } of sources) {
    if (SKIPPED.test(path)) assert.doesNotMatch(text, /["'`](?:\.\/)?docs\/?["'`]/, path);
  }
});
