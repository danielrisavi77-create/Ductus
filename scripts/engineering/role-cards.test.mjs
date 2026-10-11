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

/** Glob to RegExp for `**`, `*` and `?`; braces and classes are rejected by the caller. */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

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
      const re = globToRegExp(glob);
      assert.ok(
        tracked.some((f) => re.test(f)),
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
  const skills = new Set(readdirSync(path.join(root, ".claude/skills")));
  for (const file of files) {
    const rel = path.relative(root, file);
    for (const [, token] of read(file).matchAll(/`([^`\n]+)`/g)) {
      if (/^ductus-[a-z-]+$/.test(token)) {
        assert.ok(skills.has(token), `${rel}: skill ${token} does not exist`);
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

test("the glob matcher handles the forms the rules use", () => {
  assert.ok(globToRegExp("db/**").test("db/migrations/0001.sql"));
  assert.ok(globToRegExp("app/**/*.tsx").test("app/page.tsx"));
  assert.ok(globToRegExp("app/**/*.tsx").test("app/rad/page.tsx"));
  assert.ok(!globToRegExp("app/**/*.tsx").test("app/api/auth/login/route.ts"));
  assert.ok(globToRegExp("**/*.test.ts").test("src/domain/json.test.ts"));
  assert.ok(!globToRegExp("CLAUDE.md").test("docs/CLAUDE.md"));
  assert.ok(!globToRegExp("lefthook.yml").test("lefthookxyml"));
});
