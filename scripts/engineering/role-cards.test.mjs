import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { D97_PATHS } from "./protected-paths.mjs";

// Guards the role cards (.claude/uloge/) and path-scoped rules (.claude/rules/)
// against going stale: every glob must still match a tracked file, the D-97
// rule must cover every D97_PATHS entry, cards stay short, and every repo path
// or skill a card or rule names must exist.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const cardsDir = path.join(root, ".claude/uloge");
const rulesDir = path.join(root, ".claude/rules");

const CARD_MAX_LINES = 30;
const RULE_BODY_MAX_LINES = 20;
const ROLE_CARDS = [
  "pisac-backend.md",
  "pisac-frontend.md",
  "pisac-platforma.md",
  "reviewer.md",
  "qa.md",
];

const read = (file) => readFileSync(file, "utf8");
const mdFiles = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

/** Parses the strict frontmatter shape Claude Code needs: a `paths:` list of double-quoted globs. */
function parseRule(text) {
  const m = text.match(/^---\npaths:\n((?: {2}- "[^"\n]+"\n)+)---\n([\s\S]*)$/);
  if (!m) return null;
  const paths = [...m[1].matchAll(/- "([^"]+)"/g)].map((x) => x[1]);
  return { paths, body: m[2] };
}

/** Matches one path segment against a pattern with `*` and `?`. */
function segmentMatches(pattern, segment) {
  if (!pattern) return !segment;
  if (pattern[0] === "*") {
    return (
      segmentMatches(pattern.slice(1), segment) ||
      (segment.length > 0 && segmentMatches(pattern, segment.slice(1)))
    );
  }
  if (!segment) return false;
  return (
    (pattern[0] === "?" || pattern[0] === segment[0]) &&
    segmentMatches(pattern.slice(1), segment.slice(1))
  );
}

/** Matches path segments; a `**` segment spans zero or more segments. */
function partsMatch(pattern, parts) {
  if (!pattern.length) return !parts.length;
  if (pattern[0] === "**") {
    return (
      partsMatch(pattern.slice(1), parts) ||
      (parts.length > 0 && partsMatch(pattern, parts.slice(1)))
    );
  }
  return (
    parts.length > 0 &&
    segmentMatches(pattern[0], parts[0]) &&
    partsMatch(pattern.slice(1), parts.slice(1))
  );
}

/** Glob match for `**`, `*` and `?` without building a RegExp; braces and classes are rejected by the caller. */
const globMatches = (glob, file) =>
  partsMatch(glob.split("/"), file.split("/"));

const rules = mdFiles(rulesDir).map((name) => ({
  name,
  text: read(path.join(rulesDir, name)),
}));

test("every path rule has parseable frontmatter with live globs", () => {
  assert.ok(rules.length > 0, "at least one rule exists");
  for (const { name, text } of rules) {
    const rule = parseRule(text);
    assert.ok(
      rule,
      `${name}: frontmatter must be exactly a paths: list of double-quoted globs`,
    );
    assert.ok(
      rule.body.split("\n").length <= RULE_BODY_MAX_LINES,
      `${name}: body stays short`,
    );
    for (const glob of rule.paths) {
      assert.doesNotMatch(
        glob,
        /[{}[\]]/,
        `${name}: ${glob} must not use braces or classes`,
      );
      assert.doesNotMatch(
        glob,
        /^\.?\//,
        `${name}: ${glob} must be relative to the repo root`,
      );
      assert.ok(
        tracked.some((f) => globMatches(glob, f)),
        `${name}: ${glob} matches no tracked file`,
      );
    }
  }
});

test("the D-97 rule covers every D97_PATHS entry", () => {
  const rule = parseRule(read(path.join(rulesDir, "pravila-i-alati.md")));
  assert.ok(rule);
  for (const p of D97_PATHS) {
    const want = p.endsWith("/") ? `${p}**` : p;
    assert.ok(
      rule.paths.includes(want),
      `pravila-i-alati.md must list "${want}"`,
    );
  }
});

test("role cards exist, are listed in the index and stay short", () => {
  const index = read(path.join(cardsDir, "README.md"));
  for (const card of ROLE_CARDS) {
    assert.ok(existsSync(path.join(cardsDir, card)), `${card} exists`);
    assert.ok(index.includes(`\`${card}\``), `README.md lists ${card}`);
  }
  for (const name of mdFiles(cardsDir)) {
    const lines = read(path.join(cardsDir, name)).trimEnd().split("\n").length;
    assert.ok(
      lines <= CARD_MAX_LINES,
      `${name}: ${lines} lines, limit ${CARD_MAX_LINES}`,
    );
  }
});

test("every repo path and skill named in cards and rules exists", () => {
  const files = [
    ...mdFiles(cardsDir).map((n) => path.join(cardsDir, n)),
    ...rules.map((r) => path.join(rulesDir, r.name)),
  ];
  const hasSkill = (name) =>
    [".claude/skills", ".agents/skills"].every((dir) =>
      existsSync(path.join(root, dir, name, "SKILL.md")),
    );
  for (const file of files) {
    const rel = path.relative(root, file);
    for (const [, token] of read(file).matchAll(/`([^`\n]+)`/g)) {
      if (/^ductus-[a-z-]+$/.test(token)) {
        assert.ok(
          hasSkill(token),
          `${rel}: skill ${token} needs SKILL.md in .claude/skills and .agents/skills`,
        );
        continue;
      }
      if (/[\s<*]/.test(token) || token.startsWith("origin/")) continue;
      if (
        !token.includes("/") &&
        !/\.(?:md|mjs|ts|tsx|ya?ml|json)$/.test(token)
      )
        continue;
      const candidates = [
        path.join(root, token),
        path.join(path.dirname(file), token),
      ];
      assert.ok(
        candidates.some((c) => existsSync(c)),
        `${rel}: ${token} does not exist`,
      );
    }
  }
});

// Cards and rules point at canonical documents (D-106), never at issue
// comments: a comment cannot be amended through review, so a card citing one
// keeps a rule alive that the canonical text may already have changed.
test("cards and rules cite canonical documents, not issue comments", () => {
  const files = [
    ...mdFiles(cardsDir).map((n) => path.join(cardsDir, n)),
    ...rules.map((r) => path.join(rulesDir, r.name)),
  ];
  for (const file of files) {
    const rel = path.relative(root, file);
    const text = read(file);
    assert.doesNotMatch(
      text,
      /issuecomment-/,
      `${rel}: cites an issue comment URL`,
    );
    assert.doesNotMatch(
      text,
      /#\d+ komentar\w* `?\d{6,}/,
      `${rel}: cites an issue comment; point at the canonical section instead`,
    );
  }
});

test("the UI rule covers every live scanner text module", () => {
  const rule = parseRule(read(path.join(rulesDir, "sucelje.md")));
  assert.ok(rule);
  const scanner = read(path.join(root, "scripts/forbidden-terms/scan.ts"));
  const block = scanner.match(
    /UI_TEXT_MODULES: readonly string\[\] = \[([\s\S]*?)\];/,
  );
  assert.ok(block, "scan.ts declares UI_TEXT_MODULES");
  const globs = [...block[1].matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]);
  assert.ok(globs.length > 0);
  for (const glob of globs) {
    if (!tracked.some((f) => globMatches(glob, f))) continue;
    assert.ok(rule.paths.includes(glob), `sucelje.md must list "${glob}"`);
  }
});

test("the glob matcher handles the forms the rules use", () => {
  assert.ok(globMatches("db/**", "db/migrations/0001.sql"));
  assert.ok(globMatches("app/**/*.tsx", "app/page.tsx"));
  assert.ok(globMatches("app/**/*.tsx", "app/rad/page.tsx"));
  assert.ok(!globMatches("app/**/*.tsx", "app/api/auth/login/route.ts"));
  assert.ok(globMatches("**/*.test.ts", "src/domain/json.test.ts"));
  assert.ok(!globMatches("CLAUDE.md", "docs/CLAUDE.md"));
  assert.ok(!globMatches("lefthook.yml", "lefthookxyml"));
  assert.ok(globMatches(".github/**", ".github/workflows/ci.yml"));
  assert.ok(!globMatches("src/editor/**", "src/editorial/x.ts"));
});

// Owner decision of 18 Oct 2026 (DAN-213, #426 after qa426a): a skill with a
// `paths:` key is neither listed nor callable by /name or the Skill tool until
// a matching file is touched, so no project skill carries one.
const frontmatter = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1] ?? "";
const hasPathsKey = (text) => /^paths\s*:/m.test(frontmatter(text));

test("no project skill is path-scoped", () => {
  let skills = 0;
  for (const dir of [".claude/skills", ".agents/skills"]) {
    for (const name of readdirSync(path.join(root, dir)).sort()) {
      const file = path.join(root, dir, name, "SKILL.md");
      if (!existsSync(file)) continue;
      skills += 1;
      assert.ok(!hasPathsKey(read(file)), `${dir}/${name}: paths: hides the skill from /name and the Skill tool`);
    }
  }
  assert.ok(skills > 0);
});

test("the paths: detector reads only the frontmatter", () => {
  assert.ok(hasPathsKey('---\nname: x\npaths:\n  - "db/**"\n---\n'));
  assert.ok(hasPathsKey("---\nname: x\npaths: db/**\n---\n"));
  assert.ok(hasPathsKey('---\r\nname: x\r\npaths:\r\n  - "db/**"\r\n---\r\n'));
  assert.ok(!hasPathsKey("---\nname: x\n---\n\npaths: in the body\n"));
  assert.ok(!hasPathsKey("---\nname: x\ndescription: no paths: here\n---\n"));
});
