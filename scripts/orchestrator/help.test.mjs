// `--help` of the orch:* commands: the shared module and every entry script in package.json.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { usageOf, wantsHelp } from "./help.mjs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const ORCH = Object.entries(pkg.scripts).filter(([name]) => name.startsWith("orch:"));

test("usageOf returns the leading comment block without markers", () => {
  assert.equal(usageOf("// one\n//   two\n//\nimport x from 'y';\n// later"), "one\n  two\n");
  assert.equal(usageOf("#!/usr/bin/env node\n// usage\ncode();"), "usage");
  assert.equal(usageOf("import x from 'y';\n// not a header"), "");
});

test("wantsHelp sees only the two exact flags", () => {
  assert.equal(wantsHelp(["12", "--help"]), true);
  assert.equal(wantsHelp(["-h"]), true);
  assert.equal(wantsHelp(["--helpful", "help", "--head"]), false);
  assert.equal(wantsHelp([]), false);
});

test("every orch:* command is a plain node script under scripts/orchestrator", () => {
  assert.ok(ORCH.length >= 15);
  for (const [name, cmd] of ORCH) assert.match(cmd, /^node scripts\/orchestrator\/[a-z-]+\.mjs$/, name);
});

for (const [name, cmd] of ORCH) {
  const script = new URL(`../../${cmd.slice("node ".length)}`, import.meta.url);
  test(`${name} --help prints its usage and exits 0 without gh or git`, () => {
    for (const flag of ["--help", "-h"]) {
      // An empty PATH: any attempt to start gh or git fails instead of reaching GitHub.
      // fileURLToPath, not URL.pathname: the pathname keeps percent-encoding
      // (a space is %20) and, on Windows, a slash before the drive letter
      // (/D:/...), so node would look for a file that does not exist.
      const r = spawnSync(process.execPath, [fileURLToPath(script), "1", flag], { encoding: "utf8", env: { PATH: "" } });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /usage:/i);
      assert.equal(r.stderr, "");
    }
  });
  test(`${name} imports help.mjs before any other module`, () => {
    const lines = readFileSync(script, "utf8").split("\n");
    if (cmd.endsWith("push-verify.mjs")) {
      // loaded on demand there (see the comment in the script): it must be the
      // first statement after the imports, before any git call
      const body = lines.filter((l) => l.trim() && !l.startsWith("//") && !l.startsWith("import "));
      assert.match(body[0], /^if \(process\.argv\.slice\(2\)\.some\(.*\)\) await import\("\.\/help\.mjs"\);$/);
      return;
    }
    const firstImport = lines.find((l) => l.startsWith("import "));
    assert.equal(firstImport, 'import "./help.mjs";');
  });
}

test("without the flag help.mjs prints nothing and does not exit", () => {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e",
    `await import(${JSON.stringify(new URL("./help.mjs", import.meta.url).href)}); console.log("ran");`], { encoding: "utf8" });
  assert.equal(out, "ran\n");
});
