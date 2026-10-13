import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function isProjectRoot(candidate) {
  try {
    return fs.statSync(path.join(candidate, "scripts", "orchestrator")).isDirectory() &&
      fs.statSync(path.join(candidate, "package.json")).isFile();
  } catch {
    return false;
  }
}

/** Walk from Claude's event cwd so worktree sessions use their own checkout. */
export function findProjectRoot(cwd, isRoot = isProjectRoot) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return null;
  let current = path.resolve(cwd);
  while (true) {
    if (isRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function isOrchestratorEdit(input, root) {
  if (!root || !["Edit", "Write"].includes(input?.tool_name)) return false;
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
  const relative = path.relative(root, filePath);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return false;
  const [first, second, ...rest] = relative.split(path.sep);
  return first === "scripts" && second === "orchestrator" && rest.length > 0;
}

export function orchestratorTestFiles(root) {
  return fs.readdirSync(path.join(root, "scripts", "orchestrator"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.join("scripts", "orchestrator", entry.name))
    .sort();
}

export const hookExitCode = (testExitCode) => testExitCode === 0 ? 0 : 2;

async function readStdin(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function runTests(root) {
  const testFiles = orchestratorTestFiles(root);
  if (testFiles.length === 0) {
    return Promise.resolve({ code: 2, stdout: "", stderr: "No orchestrator test files were found.\n" });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", ...testFiles], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ code: 2, stdout, stderr: `${stderr}${error.message}\n` }));
    child.once("close", (code) => resolve({ code: hookExitCode(code), stdout, stderr }));
  });
}

function tail(text, max = 12000) {
  return text.length <= max ? text : `[earlier output omitted]\n${text.slice(-max)}`;
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin(process.stdin));
  } catch (error) {
    process.stderr.write(`Cannot read Claude hook input: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  const root = findProjectRoot(input.cwd);
  if (!isOrchestratorEdit(input, root)) return;

  const result = await runTests(root);
  if (result.code === 0) return;
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  process.stderr.write(`Orchestrator tests failed in ${root}. Claude should inspect and repair the failure.\n${tail(output)}\n`);
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
