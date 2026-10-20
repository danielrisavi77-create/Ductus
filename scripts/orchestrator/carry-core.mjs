// F-105: the owner merge command ("Spoji <n>", D-156) survives a branch refresh only when
// (a) the new head was made by refreshing the old head with main only, (b) git proves that
// every refresh commit is a clean merge of main into its predecessor (its tree equals
// `git merge-tree --write-tree`), (c) the PR diff has the same `git patch-id --stable`
// before and after (D-156), and (d) the gate accepted the new head.
// The tree proof is what makes the patch-id safe: patch-id ignores whitespace and line
// numbers, but no manual edit can hide in a tree that git itself recomputes.

// Inherited variables that would point git or gh at another repository, host or index, or
// that would let git substitute objects or run another diff program.
const REPO_ENV = /^(GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|EXTERNAL_DIFF|NO_REPLACE_OBJECTS|REPLACE_REF_BASE|CONFIG\w*)|GH_REPO|GH_HOST|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)$/i;

export const carryEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !REPO_ENV.test(key)));

/** Environment of every git child: cleaned, and replacement objects never used. */
export const gitEnv = (env) => ({ ...carryEnv(env), GIT_NO_REPLACE_OBJECTS: "1" });

/** Fixed arguments of the PR diff fed to patch-id: no external diff, no textconv, no renames. */
export const DIFF_ARGS = ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color"];

/** True only when a remote URL names exactly `repo` ("owner/name") on github.com, https or ssh. */
export function remoteIs(url, repo) {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url ?? "").trim());
  return Boolean(m) && `${m[1]}/${m[2]}`.toLowerCase() === String(repo).toLowerCase();
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

/**
 * Tree proof: `actual` is the tree of each chain commit and `merged` is what
 * `git merge-tree --write-tree <first parent> <second parent>` produced for it (null when
 * the merge was not clean). Every pair must be present, equal and a full object id.
 */
export function treesProven(pairs) {
  return (
    Array.isArray(pairs) &&
    pairs.length > 0 &&
    pairs.every((p) => SHA.test(p?.actual ?? "") && SHA.test(p?.merged ?? "") && p.actual === p.merged)
  );
}

/** First field of `git patch-id --stable` output, or null when the diff had no patch. */
export function patchIdOf(output) {
  const id = /^([0-9a-f]{40})\s/m.exec(String(output ?? ""))?.[1];
  return id ?? null;
}

export function carryVerdict({ refreshed, treeProven, oldPatchId, newPatchId, gate }) {
  if (refreshed !== true) {
    return { carry: false, reason: "the new head is not the old head refreshed with main only: the command is void" };
  }
  if (treeProven !== true) {
    return { carry: false, reason: "a refresh commit is not a clean merge of main (tree differs or merge conflicts): the command is void" };
  }
  if (!oldPatchId || !newPatchId) return { carry: false, reason: "patch-id unreadable or empty diff" };
  if (oldPatchId !== newPatchId) return { carry: false, reason: "diff changed: the command is void" };
  if (gate?.state !== "success") {
    return { carry: false, reason: `gate ${gate?.state ?? "missing"} on the new head` };
  }
  return { carry: true, reason: "refresh with main only (clean merge proven), same patch-id and gate success" };
}
