// Test helper, loaded with `node --import` before a real orchestrator script:
// replaces child_process.execFile so every `gh api <path>` call answers from
// the JSON file named by FAKE_GH_PULLS (the open PR list) without a network.
// Any command other than `gh api` fails, so a script cannot reach a real tool.
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const pulls = JSON.parse(readFileSync(process.env.FAKE_GH_PULLS, "utf8"));

function answer(path) {
  if (path === "repos/{owner}/{repo}") return { owner: { login: "owner1" }, name: "repo1" };
  if (/^repos\/\{owner\}\/\{repo\}\/pulls\?state=open&per_page=100&page=1$/.test(path)) return pulls;
  if (/\/check-runs\?/.test(path)) return { check_runs: [] };
  if (/\/pulls\/\d+\/files\?|\/issues\/\d+\/comments\?|\/statuses\?/.test(path)) return [];
  throw new Error(`fake gh: unexpected path ${path}`);
}

childProcess.execFile = (cmd, args, _opts, cb) => {
  try {
    if (cmd !== "gh" || args[0] !== "api" || args.length !== 2) throw new Error(`fake gh: unexpected call ${cmd} ${args.join(" ")}`);
    cb(null, { stdout: JSON.stringify(answer(args[1])), stderr: "" });
  } catch (e) {
    cb(e);
  }
};
syncBuiltinESMExports();
