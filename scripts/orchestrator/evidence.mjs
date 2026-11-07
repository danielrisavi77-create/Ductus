// DAN-274: PR Evidence Pack. Read-only. Usage: node evidence.mjs --pr <n> [--json]
import { checkRollup, prComments, prEvents, prReviewComments, prReviews, prView, readGate } from "./gh.mjs";
import { buildEvidence, parseEvidenceArgs, renderEvidence } from "./evidence-core.mjs";

try {
  const { pr: number, json } = parseEvidenceArgs(process.argv.slice(2));
  const pr = await prView(number);
  const unread = () => undefined;
  const [comments, events, reviews, reviewComments, rollup, gate] = await Promise.all([
    prComments(number).catch(unread),
    prEvents(number).catch(unread),
    prReviews(number).catch(unread),
    prReviewComments(number).catch(unread),
    checkRollup(pr.headRefOid).catch(unread),
    readGate(pr.headRefOid),
  ]);
  const evidence = buildEvidence({ pr, comments, events, reviews, reviewComments, rollup, gate });
  console.log(json ? JSON.stringify(evidence, null, 2) : renderEvidence(evidence).join("\n"));
} catch (e) {
  console.error(`evidence failed: ${e.message}`);
  process.exit(2);
}
