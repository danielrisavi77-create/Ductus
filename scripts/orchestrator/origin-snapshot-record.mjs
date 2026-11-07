// Records the S outcomes of T1-T3 (plan #1671 §5 P3) by running the real CLIs
// under the routes fake. Recorded once on main d54b88b9, before the F-010 change
// to the tools; origin-tools.test.mjs compares the changed tools against it.
// Usage: node scripts/orchestrator/origin-snapshot-record.mjs > origin-snapshot.json
import { AUTHORS, NUMBER, rawPull, routesFor, runTool, SCENARIOS } from "./origin-cases.mjs";

const out = { recordedOn: process.env.SNAPSHOT_COMMIT ?? "unknown", t1: {}, t2: {}, t3: {} };
const lines = (s) => s.split(/\r?\n/).filter(Boolean);
const rec = (r) => ({ exit: r.code, lines: lines(r.stdout), stderr: lines(r.stderr) });
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
