// DAN-263: recognize a CI carrier, never a source PR approval. A carrier gets no governance
// status (F-115); the result is used only to skip checks that need a PR description. Mergify owns
// admission/revalidation of the source PRs through all six queue_conditions.
// Call only with GitHub-authenticated PR data, not a label, body or branch alone.
export function isMergifyQueuePr(pr, repository) {
  const headRepo = pr?.head?.repo;
  const baseRepo = pr?.base?.repo;
  return Boolean(
    typeof repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(repository) &&
    pr?.user?.login === "mergify[bot]" && pr.user.id === 37929162 && pr.user.type === "Bot" &&
    pr.state === "open" && pr.draft === true && pr.base?.ref === "main" &&
    headRepo?.full_name === repository && baseRepo?.full_name === repository &&
    Number.isSafeInteger(baseRepo.id) && baseRepo.id > 0 && headRepo.id === baseRepo.id &&
    /^mergify\/merge-queue\/[a-f0-9]{10}$/.test(pr.head?.ref ?? "") &&
    /^[a-f0-9]{40}$/.test(pr.head?.sha ?? "") &&
    typeof pr.title === "string" && pr.title.startsWith("merge queue: ")
  );
}
