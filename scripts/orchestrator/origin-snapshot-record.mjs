// Records the S outcomes of the orchestrator tools (plan #1671 §5 P3) by running
// the real CLIs under the routes fake, before their F-010 change. T1-T3 were
// recorded on main d54b88b9 (B1), T4-T5 on main 58d5e338 (B2); the origin tests
// compare the changed tools against it.
// Usage: node scripts/orchestrator/origin-snapshot-record.mjs > origin-snapshot.json   (t1-t3)
//        node scripts/orchestrator/origin-snapshot-record.mjs t4 t5   (adds t4, t5 to the file in place)
import { readFileSync, writeFileSync } from "node:fs";
import {
  AUTHORS, contractFor, NUMBER, PLAN_SCENARIOS, planPulls, PREFLIGHT_SCENARIOS, rawPull, routesFor, runTool, SCENARIOS,
} from "./origin-cases.mjs";

const lines = (s) => s.split(/\r?\n/).filter(Boolean);
const rec = (r) => ({ exit: r.code, lines: lines(r.stdout), stderr: lines(r.stderr) });
const tools = process.argv.slice(2);

if (!tools.length) {
  const out = { recordedOn: process.env.SNAPSHOT_COMMIT ?? "unknown", t1: {}, t2: {}, t3: {} };
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    for (const cls of Object.keys(AUTHORS)) {
      const routes = routesFor({ pulls: [{ n: NUMBER, raw: rawPull(cls, sc.pull) }], scenario: sc });
      const t1 = await runTool("pr-ready.mjs", [String(NUMBER)], routes);
      const t2 = await runTool("merge-ready.mjs", [String(NUMBER)], routes);
      out.t1[`${cls}/${name}`] = rec(t1);
      out.t2[`${cls}/${name}`] = rec(t2);
    }
    const pulls = Object.keys(AUTHORS).map((cls, i) => ({ n: NUMBER + i, raw: rawPull(cls, { ...sc.pull, number: NUMBER + i }) }));
    const t3 = await runTool("merge-ready.mjs", ["--all"], routesFor({ pulls, scenario: sc }));
    out.t3[name] = rec(t3);
  }
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
} else {
  const file = new URL("./origin-snapshot.json", import.meta.url);
  const out = JSON.parse(readFileSync(file, "utf8"));
  if (tools.includes("t4") || tools.includes("t5")) out.recordedOnB2 = process.env.SNAPSHOT_COMMIT ?? "unknown";
  const s = Object.keys(AUTHORS).filter((cls) => cls.startsWith("S"));
  if (tools.includes("t4")) {
    out.t4 = {};
    for (const [name, sc] of Object.entries(PREFLIGHT_SCENARIOS)) {
      for (const cls of s) {
        const routes = routesFor({ pulls: [{ n: NUMBER, raw: rawPull(cls, sc.pull) }], scenario: sc });
        out.t4[`${cls}/${name}`] = rec(await runTool("preflight.mjs", [String(NUMBER), ...(sc.args ?? [])], routes));
      }
    }
  }
  if (tools.includes("t5")) {
    out.t5 = {};
    for (const [name, sc] of Object.entries(PLAN_SCENARIOS)) {
      for (const cls of s) {
        const pulls = planPulls(cls, sc);
        const contract = sc.contract === false ? undefined : contractFor(pulls.map((p) => p.n));
        out.t5[`${cls}/${name}`] = rec(await runTool("pr-overlap.mjs", ["--plan"], routesFor({ pulls, scenario: sc }), { contract }));
      }
    }
  }
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
}
