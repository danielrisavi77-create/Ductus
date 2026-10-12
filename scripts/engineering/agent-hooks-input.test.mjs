// Plan napada #211, 9: malformed hook input in every mode gives no notice,
// exit 0 and no output, so an advisory hook never blocks a prompt
// (docs/SESSIONS.md §4a: these hooks fail open on purpose).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { MODE_NAMES } from "./agent-hooks.mjs";

const script = fileURLToPath(new URL("./agent-hooks.mjs", import.meta.url));

const inputs = ["", "   \n", "not json", "{", "null", "[]", "7", '"text"', "{}"];
const events = [{ transcript_path: 7 }, { transcript_path: null }, { transcript_path: "" }, { cwd: 7 }, { tool_input: null }];

test("every mode stays silent with exit 0 on empty, blank or malformed stdin", () => {
  assert.ok(MODE_NAMES.includes("budget"), "the budget hook is among the probed modes");
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  for (const mode of MODE_NAMES) {
    for (const input of [...inputs, ...events.map((event) => JSON.stringify(event))]) {
      const result = spawnSync(process.execPath, [script, mode], { input, encoding: "utf8", cwd: os.tmpdir(), env });
      assert.equal(result.status, 0, `${mode} ${JSON.stringify(input)}`);
      assert.equal(result.stdout, "", `${mode} ${JSON.stringify(input)}`);
    }
  }
});
