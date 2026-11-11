// Test helper, loaded through NODE_OPTIONS `--import` so child scripts get it too:
// `gh api <path>` answers from the JSON file named by FAKE_GH_ROUTES (path -> body,
// no route = failed call), every other command (git) runs for real.
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const routes = JSON.parse(readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));
const real = childProcess.execFile;

childProcess.execFile = (cmd, args, opts, cb) => {
  if (cmd !== "gh") return real(cmd, args, opts, (e, stdout, stderr) => cb(e, { stdout, stderr }));
  const body = args[0] === "api" ? routes[args[1]] : undefined;
  if (body === undefined) return cb(Object.assign(new Error(`fake gh: unexpected call ${args.join(" ")}`), { stderr: "fake gh" }));
  return cb(null, { stdout: JSON.stringify(body), stderr: "" });
};
syncBuiltinESMExports();
