// DAN-270: Failure Capsule. Names what is needed to reproduce a failed CI run.
// Read-only. Usage: node failure-capsule.mjs --run <run id> [--json]
import { ghJson, ghList } from "./gh.mjs";
import { buildCapsule, parseCapsuleArgs, renderCapsule } from "./failure-capsule-core.mjs";

try {
  const { run: runId, json } = parseCapsuleArgs(process.argv.slice(2));
  const run = await ghJson(["api", `repos/{owner}/{repo}/actions/runs/${runId}`]);
  const jobs = await ghList(`repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`, undefined, { key: "jobs" });
  const artifacts = (await ghJson(["api", `repos/{owner}/{repo}/actions/runs/${runId}/artifacts?per_page=100`])).artifacts ?? [];
  let packageJsonText = "";
  try {
    const file = await ghJson(["api", `repos/{owner}/{repo}/contents/package.json?ref=${run.head_sha}`]);
    packageJsonText = Buffer.from(file.content ?? "", "base64").toString("utf8");
  } catch {
    // The toolchain is optional context; a missing file leaves the pins empty.
  }
  const capsule = buildCapsule({ run, jobs, artifacts, packageJsonText });
  if (json) console.log(JSON.stringify(capsule, null, 2));
  else console.log(renderCapsule(capsule).join("\n"));
} catch (e) {
  console.error(`failure-capsule failed: ${e.message}`);
  process.exit(2);
}
