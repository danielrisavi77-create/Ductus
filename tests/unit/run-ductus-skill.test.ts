import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// The run-ductus skill keeps its port and command guard in a node:test file
// next to the script, outside the vitest include. Run both runtime copies
// here so CI covers them.
test.each([".claude", ".agents"])("%s run-ductus process-command tests pass", (runtime) => {
  const file = fileURLToPath(new URL(`../../${runtime}/skills/run-ductus/process-command.test.mjs`, import.meta.url));
  expect(() => execFileSync(process.execPath, ["--test", file], { stdio: "pipe" })).not.toThrow();
});
