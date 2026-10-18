import { describe, expect, it } from "vitest";

import { isAgentRun, playwrightConsoleReporter } from "../../test-output";
import { vitestAgentOutput } from "../../vitest.config";

// DAN-213 (#420): only a Claude Code shell outside CI gets the quiet output.
describe("test output in agent sessions", () => {
  it.each([
    [{ CLAUDECODE: "1" }, true],
    [{ CLAUDECODE: "1", CI: "" }, true],
    [{ CLAUDECODE: "1", CI: "false" }, true],
    [{ CLAUDECODE: "1", CI: "true" }, false],
    [{ CLAUDECODE: "1", CI: "1" }, false],
    [{ CLAUDECODE: "0" }, false],
    [{}, false],
    [{ CI: "true" }, false],
  ])("%j is an agent run: %s, for vitest and Playwright alike", (env, expected) => {
    expect(isAgentRun(env)).toBe(expected);
    expect(vitestAgentOutput(env)).toEqual(expected ? { reporters: ["dot"], silent: "passed-only" } : {});
    expect(playwrightConsoleReporter(env)).toBe(expected ? "line" : "list");
  });
});
