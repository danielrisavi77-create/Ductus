// F-105: the owner merge command ("Spoji <n>", D-156) survives a branch refresh only when
// the PR diff is literally identical and the gate accepted the new head. `git patch-id`
// ignores whitespace and binary content, so it never decides.

/** Verdict for one refresh: oldDiff/newDiff are exact `git diff --binary --full-index` texts. */
export function carryVerdict({ oldDiff, newDiff, gate }) {
  if (typeof oldDiff !== "string" || typeof newDiff !== "string") {
    return { carry: false, reason: "diff unreadable" };
  }
  if (oldDiff === "" || newDiff === "") return { carry: false, reason: "empty diff" };
  if (oldDiff !== newDiff) return { carry: false, reason: "diff changed: the command is void" };
  if (gate?.state !== "success") {
    return { carry: false, reason: `gate ${gate?.state ?? "missing"} on the new head` };
  }
  return { carry: true, reason: "literally identical diff and gate success" };
}