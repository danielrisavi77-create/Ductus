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
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("listed documents are plain docs outside D-97 and the agent rules", () => {
  assert.equal(new Set(ORDINARY_DOCS).size, ORDINARY_DOCS.length);
  const modes = new Map(tracked.map(({ mode, path }) => [path, mode]));
  for (const path of ORDINARY_DOCS) {
    // A docs-only PR may delete a listed document, so only a present one is checked.
    assert.ok([undefined, "100644"].includes(modes.get(path)), `${path} is a regular file`);
    assert.match(path, /^(?:README\.md|docs\/(?:[a-z0-9-]+\/)?[A-Za-z0-9.-]+\.md)$/, path);
    assert.ok(!isD97Path(path) && !/^(?:STATE|AGENTS|CLAUDE)\.md$|^\.(?:claude|agents)\//.test(path), path);
  }
});

// Files of the steps a docs profile skips: stack, browser, database, property,
// local launcher and fake OIDC tests, the Next build and the production image.
const SKIPPED = /^(?:e2e|tests\/(?:property|integration)|infra|db|scripts\/(?:local|db)|config|public)\/|^scripts\/engineering\/(?:production-image|ui-test-pilot|e2e-shards|login-shard|db-schema|playwright-(?:version|install))(?![\w.-]*\.test\.)|\.(?:property|integration)\.test\.ts$|^(?:next\.config|middleware|instrumentation|playwright[\w.]*config|compose|vitest\.config)\.|^(?:src|app)\/(?!.*\.test\.tsx?$)|^package\.json$/;
// The jobs and steps of ci.yml that run only on the full profile.
const workflow = readFileSync(`${root}.github/workflows/ci.yml`, "utf8");
const skippedBlocks = workflow.split(/^(?= {2}[\w-]+:$)/m).flatMap((job) => (/^ {4}if:.*profile == 'full'/m.test(job)
  ? [job] : job.split(/^(?= {6}- )/m).filter((step) => step.includes("profile == 'full'"))));
// Both the raw text and a joined form are searched: `"docs/" + "adr"` and
// `join("docs/", "adr")` read as `docs/adr`, while the raw text keeps array items apart.
const forms = (text) => [text, text.replace(/["'`]\s*\+\s*["'`]/g, "").replace(/["'`]\s*,\s*["'`]/g, "/").replace(/\/{2,}/g, "/")];
// In doubt a file is shell: only code whose identifiers may be named `docs` is exempt.
const shellLike = (path) => !/\.(?:[cm]?[jt]sx?|json)$/.test(path);
const sources = [...tracked.filter(({ mode, path }) => !["160000", "120000"].includes(mode) && !path.endsWith(".md") && !FIXTURES.has(path))
  .flatMap(({ path }) => {
    const text = readFileSync(`${root}${path}`, "latin1");
    return text.includes("\0") ? [] : [{ path, skipped: SKIPPED.test(path), shell: shellLike(path), forms: forms(text) }];
  }), { path: ".github/workflows/ci.yml (skipped steps)", skipped: true, shell: true, forms: forms(skippedBlocks.join("\n")) }];

const PATTERNS = new Map();
for (const path of ORDINARY_DOCS) {
  const directory = [];
  // The bare docs root is checked separately (WHOLE_DOCS).
  for (let dir = dirname(path); dir !== "." && dir !== "docs"; dir = dirname(dir)) {
    directory.push(new RegExp(`(?<![\\w.-])${escape(dir)}/?(?=[\\s"'\`*{)$:;,|\\]]|\\$\\{|$)`, "m"));
  }
  PATTERNS.set(path, {
    // `docs/x/README.md` is another file, so a root name after `name/` is not it; `${root}/` and `../` are.
    direct: new RegExp(`(?<![\\w.-]${path.includes("/") ? "" : "|[\\w-]/"})${escape(path)}(?![\\w.-])`),
    directory,
    sibling: new RegExp(`(?<![\\w.-])${escape(posix.basename(path))}(?![\\w.-])`),
  });
}
// A bare `docs` counts only in a string, a path, a glob or a shell word, so the
// identifier `docs` in code is not a read.
const WHOLE_DOCS = /(?<![\w.-])docs(?:\/?(?=["'`*{]|\$\{)|\/(?![\w.-])|\/[\w.-]*\*)|(?<=\.\.?\/)docs(?!\/?[\w.-])|(?<=\s)docs(?=[ \t]+(?:[./~]|\|(?!\|))|[ \t]*$)/m;
// Any `docs` token bounded by non-path characters (`tar -cf x docs;`, `{docs,src}`, `DIR=docs`):
// everywhere in a shell-like file, and inside a closed string literal elsewhere.
const TOKEN = String.raw`(?<![\w.\/$~-])docs\/?(?![\w.\/-])`;
const SHELL_WORD = new RegExp(TOKEN);
const STRING_WORD = new RegExp(String.raw`(["'\`])(?:(?!\1)[^\n])*?${TOKEN}(?:(?!\1)[^\n])*\1`);
const wholeDocs = (text, shell) => WHOLE_DOCS.test(text) || STRING_WORD.test(text) || (shell && SHELL_WORD.test(text));

// How `file` reads the listed document `path`, or "" when it does not.
function reads(path, file, texts) {
  const { direct, directory, sibling } = PATTERNS.get(path);
  for (const text of texts) {
    if (direct.test(text)) return "names";
    if (directory.some((pattern) => pattern.test(text))) return "reads the directory of";
    if (dirname(file) === dirname(path) && sibling.test(text)) return "lists";
  }
  return "";
}

test("every script a skipped ci.yml step runs is a skipped-step file", () => {
  assert.ok(skippedBlocks.length >= 8 && ["pnpm build", "production-image.mjs", "login-shards.mjs"]
    .every((word) => skippedBlocks.some((block) => block.includes(word))));
  for (const block of skippedBlocks) {
    for (const [script] of block.matchAll(/scripts\/[\w./-]+\.(?:[cm]?js|ts|sh)\b/g)) assert.match(script, SKIPPED, script);
  }
});

test("the reader matcher catches joined, concatenated and listed paths", () => {
  const nested = ORDINARY_DOCS.find((path) => path.split("/").length > 2);
  const dir = dirname(nested);
  const [top, name] = [doc.split("/")[0], doc.slice(doc.indexOf("/") + 1)];
  const at = "scripts/engineering/x.mjs";
  for (const text of [`"${doc}"`, `"${top}/" + "${name}"`, `"${top}" + "/${name}"`, `join("${top}/", "${name}")`,
    `join("${top}", "${name}")`, `"${top}/" + '${name}'`]) {
    assert.equal(reads(doc, at, forms(text)), "names", text);
  }
  assert.equal(reads(nested, at, forms(`"${top}/" + "${dir.slice(5)}/" + "${posix.basename(nested)}"`)), "names");
  for (const text of [`"${dir}"`, `"${dir}/" + f`, `"${dir}" + "/" + f`, `join("${top}/", "${dir.slice(5)}")`,
    `new URL("../../${dir}/", import.meta.url)`, `[\n  "${dir}",\n  "src/app",\n]`, `\`${dir}/\${f}\``]) {
    assert.equal(reads(nested, at, forms(text)), "reads the directory of", text);
  }
  assert.equal(reads(nested, `${dir}/x.mjs`, forms(`"${posix.basename(nested)}"`)), "lists");
  assert.deepEqual(["`${root}/README.md`", '"../README.md"', '"docs/README.md"'].map((text) => reads("README.md", at, forms(text))),
    ["names", "names", ""]);
  for (const text of [`"${doc}x"`, `"x${doc}"`, `"${dir}-old"`, `"x${dir}"`, `"${dir}.md"`]) {
    assert.equal(reads(doc, at, forms(text)) + reads(nested, at, forms(text)), "", text);
  }
  for (const text of ['"docs"', '"./docs/"', "`docs/${f}`", '"docs/**/*.md"', "`${root}/docs`", '["app", "docs"]',
    'new URL("../../docs/", import.meta.url)', '"docs/{adr,x}/*.md"', "COPY docs /srv/docs", "grep -rl x docs",
    "ls docs | wc -l", "- ./docs:/srv/docs:ro", "cp docs/ out", '"docs/PIL*.md"', "./docs", "execSync(\"cp -R docs out\")",
    "'tar -cf x docs'"]) {
    assert.ok(forms(text).some((form) => wholeDocs(form, false)), text);
  }
  // One row per boundary of a whole `docs` token: `;`, `|`, `&`, `)`, `>`, `,`, `=`, a quote, the end of a line, a final slash.
  for (const [text, inCode] of [['tar -cf "$work/m.tar" docs;', false], ["cp -R docs artifacts", false], ["(cd docs && ls)", false],
    ["run: zip -r x.zip docs;", false], ["ls docs;", false], ["ls docs|wc -l", false], ["ls docs&", false], ["(ls docs)", false],
    ["ls docs>out", false], ["cp -R {docs,src} out", false], ["DIR=docs", false], ["ls docs", true], ["ls docs/", true],
    ["ls docs/;", true], ['ls "docs"', true], ["ls 'docs'", true]]) {
    assert.deepEqual([wholeDocs(text, true), wholeDocs(text, false)], [true, inCode], text);
  }
  for (const text of ['"ls docs;"', '"ls docs|wc -l"', "'ls docs&'", '"(ls docs)"', '"ls docs>out"', "`cp -R {docs,src} out`",
    '"DIR=docs ls"', "`tar -cf x docs;`"]) {
    assert.ok(wholeDocs(text, false), text);
  }
  for (const text of ['"docsx"', '"my-docs"', "docs.length", "docs: readonly PmNode[]", "const docs = []",
    "{ steps, docs, after }", "x = docs || []", '"../../docs/x.md"', "return docs;", "// don't read docs here"]) {
    assert.ok(!forms(text).some((form) => wholeDocs(form, false)), text);
  }
});

test("a file is searched as shell unless it is known JavaScript, TypeScript or JSON", () => {
  assert.deepEqual(["x.sh", "x.yml", "Dockerfile.ci", "Makefile", "tools/run", "db/x.sql", "x.toml"].filter((path) => !shellLike(path)), []);
  assert.deepEqual(["x.mjs", "x.cjs", "x.ts", "x.tsx", "x.json"].filter(shellLike), []);
});

test("no tracked file outside Markdown names a listed document, its directory or a sibling list", () => {
  for (const path of ORDINARY_DOCS) {
    // A root name such as README.md is also every directory's README, so only
    // the skipped steps are searched for it; their tests read nothing at the root.
    for (const { path: file, forms: texts } of path.includes("/") ? sources : sources.filter(({ skipped }) => skipped)) {
      const how = reads(path, file, texts);
      assert.equal(how, "", `${file} ${how} ${path}`);
    }
  }
});

test("no file of a step the docs profile skips reads the whole docs directory", () => {
  for (const { path, skipped, shell, forms: texts } of sources) {
    // The production image names docs only in the list it keeps out of the image.
    const kept = path === "scripts/engineering/production-image.mjs"
      ? texts.map((text) => text.replace(/^const NEVER_INCLUDED = new Set\(\[.*\]\);$/m, "")) : texts;
    if (skipped) assert.ok(!kept.some((text) => wholeDocs(text, shell)), path);
  }
});
