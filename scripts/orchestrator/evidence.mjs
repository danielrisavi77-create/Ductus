// DAN-274: PR Evidence Pack. Read-only. Usage: node evidence.mjs --pr <n> [--json]
import { checkRollup, prComments, prView, readGate, repoId } from "./gh.mjs";
import { buildEvidence, parseEvidenceArgs, renderEvidence } from "./evidence-core.mjs";

try {
  const { pr: number, json } = parseEvidenceArgs(process.argv.slice(2));
  const pr = await prView(number);
  // F-010: a failed read is no repository, so the head is shown as not proven to be in it.
  const repository = await repoId().then(({ owner, repo }) => `${owner}/${repo}`, () => null);
  const [comments, rollup, gate] = await Promise.all([
    prComments(number).catch(() => undefined),
    checkRollup(pr.headRefOid).catch(() => undefined),
    readGate(pr.headRefOid),
  ]);
  const evidence = buildEvidence({ pr, comments, rollup, gate, repository });
  console.log(json ? JSON.stringify(evidence, null, 2) : renderEvidence(evidence).join("\n"));
} catch (e) {
  console.error(`evidence failed: ${e.message}`);
  process.exit(2);
}
