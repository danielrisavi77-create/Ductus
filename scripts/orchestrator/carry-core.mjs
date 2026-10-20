// F-105: the owner merge command ("Spoji <n>", D-156) survives a branch refresh only when
// the new head was made by refreshing the old head with main, the PR diff is the same and
// the gate accepted the new head. The diff comparison is stricter than `git patch-id
// --stable` (which ignores whitespace and hides a whitespace-only change): it compares the
// exact `git diff --binary` text, minus only what a base merge moves by itself.

// Inherited variables that would point git or gh at another repository, host or index.
const REPO_ENV = /^(GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|EXTERNAL_DIFF|CONFIG\w*)|GH_REPO|GH_HOST|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)$/i;

export const carryEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !REPO_ENV.test(key)));

/** Fixed arguments of the exact diff: no external diff, no textconv, no renames, no colour. */
export const DIFF_ARGS = ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color"];

// Structural lines start with a letter or "@"; content lines start with " ", "+" or "-".
// A base merge moves the "index" blob ids and the hunk start numbers and section heading
// (the "@@ -a,b +c,d @@ heading" header); nothing else of the PR change.
export function normalizeDiff(text) {
  if (typeof text !== "string") return text;
  return text
    .split("\n")
    .filter((line) => !line.startsWith("index "))
    .map((line) => line.replace(/^@@ -\d+((?:,\d+)?) \+\d+((?:,\d+)?) @@.*$/, "@@ -N$1 +N$2 @@"))
    .join("\n");
}

const SHA = /^[0-9a-f]{40}$/;
export const MAX_REFRESH_COMMITS = 10;

/**
 * `chain` is `git rev-list --first-parent --parents <old>..<new>` parsed to
 * [{ sha, parents: [sha...] }] newest first, `mainContains(sha)` is true only for a commit
 * contained in origin/main. The new head came from refreshing the old head with main only
 * when the first-parent walk ends at the old head and every step is a two-parent merge of
 * main (no octopus, no ordinary commit, no merge of another branch).
 */
export function refreshOnly({ oldHead, chain, mainContains }) {
  if (!SHA.test(oldHead ?? "") || !Array.isArray(chain)) return false;
  if (chain.length === 0 || chain.length > MAX_REFRESH_COMMITS) return false;
  return chain.every((step, index) => {
    const parents = step?.parents;
    if (!Array.isArray(parents) || parents.length !== 2 || !parents.every((p) => SHA.test(p ?? ""))) return false;
    const expectedFirst = index === chain.length - 1 ? oldHead : chain[index + 1]?.sha;
    return parents[0] === expectedFirst && mainContains(parents[1]) === true;
  });
}

/** Verdict for one refresh: oldDiff/newDiff are exact `git diff --binary --full-index` texts. */
export function carryVerdict({ oldDiff, newDiff, gate, refreshed }) {
  if (typeof oldDiff !== "string" || typeof newDiff !== "string") {
    return { carry: false, reason: "diff unreadable" };
  }
  if (refreshed !== true) {
    return { carry: false, reason: "the new head is not the old head refreshed with main only: the command is void" };
  }
  if (oldDiff === "" || newDiff === "") return { carry: false, reason: "empty diff" };
  if (normalizeDiff(oldDiff) !== normalizeDiff(newDiff)) return { carry: false, reason: "diff changed: the command is void" };
  if (gate?.state !== "success") {
    return { carry: false, reason: `gate ${gate?.state ?? "missing"} on the new head` };
  }
  return { carry: true, reason: "refresh with main only, same diff and gate success" };
}
