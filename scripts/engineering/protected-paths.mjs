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

/** Files that put a PR under the owner's merge command, by path or by content. */
export function ownerCommandPaths(files) {
  return (files ?? []).map(normalizePath).filter((f) => matchesPath(f, [...D97_PATHS, ...D97_MANUAL_PATHS]));
}
