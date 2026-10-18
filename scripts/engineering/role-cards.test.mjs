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

// Area skills may carry a `paths:` list so Claude Code offers them only on
// matching files (DAN-213). The same live-glob rules apply as for path rules;
// the app map stays unscoped because it is read before the area is known.
const skillsDir = path.join(root, ".claude/skills");
const skillPaths = (text) => {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  if (!/^paths:/m.test(fm)) return null;
  const m = fm.match(/^paths:\n((?: {2}- "[^"\n]+"(?:\n|$))+)/m);
  return m ? [...m[1].matchAll(/- "([^"]+)"/g)].map((x) => x[1]) : [];
};

test("skill paths: lists are quoted globs that match tracked files", () => {
  let scoped = 0;
  for (const name of readdirSync(skillsDir).sort()) {
    const file = path.join(skillsDir, name, "SKILL.md");
    if (!existsSync(file)) continue;
    const globs = skillPaths(read(file));
    if (globs === null) continue;
    scoped += 1;
    assert.ok(globs.length > 0, `${name}: paths: must be a list of double-quoted globs`);
    for (const glob of globs) {
      assert.doesNotMatch(glob, /[{}[\]]/, `${name}: ${glob} must not use braces or classes`);
      assert.doesNotMatch(glob, /^\.?\//, `${name}: ${glob} must be relative to the repo root`);
      assert.ok(
        tracked.some((f) => globMatches(glob, f)),
        `${name}: ${glob} matches no tracked file`,
      );
    }
  }
  assert.ok(scoped > 0, "at least one area skill is path-scoped");
  assert.equal(
    skillPaths(read(path.join(skillsDir, "ductus-app-map", "SKILL.md"))),
    null,
    "ductus-app-map must not be path-scoped",
  );
});

test("the skill paths: parser rejects unquoted and inline lists", () => {
  assert.deepEqual(skillPaths('---\nname: x\npaths:\n  - "db/**"\n---\n'), ["db/**"]);
  assert.deepEqual(skillPaths("---\nname: x\npaths:\n  - db/**\n---\n"), []);
  assert.deepEqual(skillPaths("---\nname: x\npaths: db/**\n---\n"), []);
  assert.equal(skillPaths("---\nname: x\n---\n"), null);
});
