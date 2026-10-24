// DAN-274: PR Evidence Pack. Read-only. Usage: node evidence.mjs --pr <n> [--json]
import { checkRollup, prComments, prView, readGate } from "./gh.mjs";
import { buildEvidence, parseEvidenceArgs, renderEvidence } from "./evidence-core.mjs";

try {
  const { pr: number, json } = parseEvidenceArgs(process.argv.slice(2));
  const pr = await prView(number);
  const [comments, rollup, gate] = await Promise.all([
    prComments(number).catch(() => undefined),
    checkRollup(pr.headRefOid).catch(() => undefined),
    readGate(pr.headRefOid),
  ]);
  const evidence = buildEvidence({ pr, comments, rollup, gate });
  console.log(json ? JSON.stringify(evidence, null, 2) : renderEvidence(evidence).join("\n"));
} catch (e) {
  console.error(`evidence failed: ${e.message}`);
  process.exit(2);
}
