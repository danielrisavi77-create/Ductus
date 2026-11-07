// Test helper, loaded with `node --import` before a real orchestrator script:
// replaces child_process.execFile so every `gh api` call answers from the JSON
// file named by FAKE_GH_ROUTES, without a network. The file maps a path (or
// "graphql") to a list of answers given one per call, the last one repeating;
// {"$error": "..."} answers with a failed call whose stderr is that text. A path
// with no route fails, so a script cannot reach a real tool or a real repository.
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const routes = JSON.parse(readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));
const calls = new Map();

function failed(text) {
  const e = new Error(text);
  e.stderr = text;
  return e;
}

function answer(path) {
  const list = routes[path];
  if (!Array.isArray(list) || list.length === 0) throw failed(`fake gh: unexpected path ${path}`);
  const i = calls.get(path) ?? 0;
  calls.set(path, i + 1);
  const a = list[Math.min(i, list.length - 1)];
  if (a && typeof a === "object" && "$error" in a) throw failed(String(a.$error));
  return a;
}

childProcess.execFile = (cmd, args, _opts, cb) => {
  try {
    if (cmd !== "gh" || args[0] !== "api") throw new Error(`fake gh: unexpected call ${cmd} ${args.join(" ")}`);
    cb(null, { stdout: JSON.stringify(answer(args[1] === "graphql" ? "graphql" : args[1])), stderr: "" });
  } catch (e) {
    cb(e);
  }
};
syncBuiltinESMExports();
