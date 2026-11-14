// Test helper, loaded through NODE_OPTIONS `--import` so child scripts get it too:
// `gh api <path>` answers from the JSON file named by FAKE_GH_ROUTES (path -> body,
// no route = failed call), every other command (git) runs for real. Each process that
// loads it appends its own arguments as one JSON line to FAKE_GH_ARGV_LOG, when set.
// A route may be { "$run": [cmd, ...args], "$body": body }: the command runs in the
// working directory first (a change made while orch:sync waits), then body answers.
// FAKE_PREFLIGHT_EXIT: preflight.mjs exits with that code before reading anything.
import childProcess from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

if (process.env.FAKE_GH_ARGV_LOG) appendFileSync(process.env.FAKE_GH_ARGV_LOG, `${JSON.stringify(process.argv.slice(1))}\n`);
if (basename(process.argv[1] ?? "") === "preflight.mjs" && process.env.FAKE_PREFLIGHT_EXIT) {
  process.exit(Number(process.env.FAKE_PREFLIGHT_EXIT));
}

const routes = JSON.parse(readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));
const real = childProcess.execFile;

childProcess.execFile = (cmd, args, opts, cb) => {
  if (cmd !== "gh") return real(cmd, args, opts, (e, stdout, stderr) => cb(e, { stdout, stderr }));
  let body = args[0] === "api" ? routes[args[1]] : undefined;
  if (body === undefined) return cb(Object.assign(new Error(`fake gh: unexpected call ${args.join(" ")}`), { stderr: "fake gh" }));
  if (body && Array.isArray(body.$run)) {
    childProcess.execFileSync(body.$run[0], body.$run.slice(1), { stdio: "ignore" });
    body = body.$body;
  }
  return cb(null, { stdout: JSON.stringify(body), stderr: "" });
};
syncBuiltinESMExports();
