// Path lists shared by the risk floor (pr-metadata-core), the review gate and
// the orchestrator tools, so the three cannot drift apart. Entries ending with
// "/" are directories.

// docs/DECISIONS.md D-97 (2): a PR touching these merges only on the owner's
// explicit command. tests/unit/codeowners.test.ts compares the list with
// .github/CODEOWNERS in both directions.
export const D97_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  "docs/ENGINEERING_SYSTEM.md",
  "docs/ENGINEERING_SYSTEM-SAZETAK.md",
  "docs/ORKESTRATOR.md",
  "docs/ORKESTRATOR-SAZETAK.md",
  "docs/SESSIONS.md",
  "docs/MULTI-ACCOUNT.md",
  "docs/AGENT_SYSTEM_V2.md",
  "lefthook.yml",
  ".github/",
  "scripts/engineering/",
  "scripts/hooks/",
  "scripts/orchestrator/",
  ".claude/",
  ".agents/",
  "plugins/ductura-engineering/",
];
// D-97 also covers DECISIONS entries about who may merge/review; not decidable by path alone.
export const D97_MANUAL_PATHS = ["docs/DECISIONS.md"];

export const normalizePath = (p) =>
  String(p).replaceAll("\\", "/").replace(/\/{2,}/g, "/").replace(/^(?:\.?\/)+/, "");

/** True when `file` is one of `list` or lies under one of its directories; letter case is ignored. */
export function matchesPath(file, list) {
  const f = normalizePath(file).toLowerCase();
  return list.some((entry) => {
    const p = entry.toLowerCase();
    return p.endsWith("/") ? f.startsWith(p) : f === p;
  });
}

// Files an agent loads as instructions: Claude Code CLAUDE.md and CLAUDE.local.md,
// Codex AGENTS.md and AGENTS.override.md, Gemini CLI GEMINI.md, and GitHub
// Copilot's copilot-instructions.md and *.instructions.md.
const AGENT_INSTRUCTIONS_RE =
  /(?:^|\/)(?:(?:claude|agents|gemini)[^/]*|copilot-instructions|[^/]*\.instructions)\.md$/i;
// F-039: agent runtime configuration directories and the MCP server list.
const AGENT_CONTROL_SEGMENTS = new Set([".claude", ".agents", ".codex"]);

/**
 * True for a file an agent runtime loads as instructions or configuration, at
 * any depth: an instruction file name, .mcp.json, or a path with a .claude,
 * .agents or .codex segment. Such a file decides how agents work, so it carries
 * the critical floor and the owner's merge command like the D-97 paths.
 */
export function isAgentControlPath(file) {
  const segments = normalizePath(file).toLowerCase().split("/");
  const name = segments.at(-1) ?? "";
  return (
    segments.some((segment) => AGENT_CONTROL_SEGMENTS.has(segment)) ||
    name === ".mcp.json" ||
    AGENT_INSTRUCTIONS_RE.test(name)
  );
}

// F-174: pnpm runs the root pnpmfile as code on every install (CI and every
// agent worktree), so adding or changing one decides what runs everywhere.
export const INSTALL_HOOK_PATHS = [".pnpmfile.cjs", ".pnpmfile.mjs"];

/** A D-97 path by path: one of D97_PATHS, an agent control path or a pnpm install hook. */
export const isD97Path = (file) =>
  matchesPath(file, D97_PATHS) || isAgentControlPath(file) || matchesPath(file, INSTALL_HOOK_PATHS);

/** Paths of a REST pull-request files list; a rename counts under both names. */
export function changedPaths(files) {
  const out = new Set();
  for (const f of files ?? []) {
    for (const p of [f?.filename, f?.previous_filename]) if (p) out.add(normalizePath(p));
  }
  return [...out].sort();
}

// ENGINEERING_SYSTEM §5, QA exemption: test directories and test file names.
// A helper or fixture under these directories counts as a test; anything a
// test loads from elsewhere (configs, src/, infra/) does not.
export const TEST_DIRS = ["tests/", "e2e/", "db/tests/"];
const TEST_NAME_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const DOC_NAME_RE = /\.md$/i;

export const isTestPath = (file) => matchesPath(file, TEST_DIRS) || TEST_NAME_RE.test(normalizePath(file));
export const isDocPath = (file) => DOC_NAME_RE.test(normalizePath(file));

/**
 * "tests" or "docs" when every path (a rename counts under both names, see
 * changedPaths) is a test, or every path is a document; otherwise null. A
 * mix of tests and documents is not exempt: the rule says only tests or only
 * documents, and any other file ends the exemption.
 */
export function qaExemption(files) {
  const paths = (files ?? []).map(normalizePath);
  if (paths.length === 0) return null;
  if (paths.every(isTestPath)) return "tests";
  if (paths.every(isDocPath)) return "docs";
  return null;
}

// D-189 as narrowed for #971 (owner option A, contract issuecomment-6506868494):
// both review exemptions are allowlists, and the gate, "Merge authorization",
// "Auto-merge eligible" and the CI profile "tests" read them from here, so the
// lists cannot drift apart. A path with a segment that starts with a dot
// (.claude/, .agents/, .github/ at any depth) is never exempt, and neither is a
// D-97 path.
const hasDotSegment = (p) => p.split("/").some((segment) => segment.startsWith("."));
const LOW_DOC_RE = /^(?:docs\/[^/]+\.md|README\.md)$/;

/** Risk low without review: a Markdown file directly in docs/, or the root README.md. */
export function isLowDocExemptPath(file) {
  const p = normalizePath(file);
  return (
    LOW_DOC_RE.test(p) &&
    !hasDotSegment(p) &&
    !AGENT_INSTRUCTIONS_RE.test(p) &&
    ownerCommandPaths([p]).length === 0
  );
}

export function lowReviewExempt(files) {
  const paths = files ?? [];
  return paths.length > 0 && paths.every(isLowDocExemptPath);
}

// Tests only: a *.test.ts or *.spec.ts file under src/ or tests/unit/, where only
// the test runner reads it. Next.js builds a page or route from a test name too
// (src/pages/api/x.test.ts answers at /api/x.test, #971 QA), so src/app/ and
// src/pages/ stay under review, as do e2e/, tests/e2e/, tests/integration/,
// db/tests/, helpers, fixtures and every other directory.
const NEW_TEST_RE = /^(?:src|tests\/unit)\/.+\.(?:test|spec)\.ts$/;
const ROUTE_DIRS = ["src/app/", "src/pages/"];
export const isNewTestExempt = (file) => {
  const p = normalizePath(file);
  return (
    NEW_TEST_RE.test(p) &&
    !matchesPath(p, ROUTE_DIRS) &&
    !hasDotSegment(p) &&
    !p.split("/").includes("node_modules") &&
    ownerCommandPaths([p]).length === 0
  );
};

/** Files that put a PR under the owner's merge command, by path or by content. */
export function ownerCommandPaths(files) {
  return (files ?? []).map(normalizePath).filter((f) => isD97Path(f) || matchesPath(f, D97_MANUAL_PATHS));
}
