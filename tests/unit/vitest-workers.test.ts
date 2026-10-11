import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import config, { WORKERS_VARIABLE, testWorkers } from "../../vitest.config";

// The number of workers may change how fast the tests run and nothing else.
// These tests hold the two things that must not move with it: which test
// files run, and that a wrong value of the variable stops the run.

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VITEST = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
const STARTS_VITEST = 120_000;

describe("testWorkers", () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [7, 1],
    [8, 2],
    [12, 3],
    [16, 4],
    [64, 16],
    // Not a count of processors at all: still one worker, never none.
    [0, 1],
    [-4, 1],
    [2.5, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])("%s processors give %s workers away from GitHub Actions", (processors, workers) => {
    expect(testWorkers(processors, {})).toBe(workers);
  });

  it("is a whole number from 1 to the number of processors for every machine size", () => {
    for (let processors = 1; processors <= 512; processors += 1) {
      for (const env of [{}, { [WORKERS_VARIABLE]: "1" }, { [WORKERS_VARIABLE]: "5" }, { [WORKERS_VARIABLE]: "999999" }]) {
        const workers = testWorkers(processors, env);
        expect(Number.isInteger(workers)).toBe(true);
        expect(workers).toBeGreaterThanOrEqual(1);
        expect(workers).toBeLessThanOrEqual(processors);
      }
    }
  });

  it("leaves the number to vitest on GitHub Actions only", () => {
    expect(testWorkers(12, { GITHUB_ACTIONS: "true" })).toBeUndefined();
    expect(testWorkers(1, { GITHUB_ACTIONS: "true" })).toBeUndefined();
    expect(testWorkers(12, { GITHUB_ACTIONS: "true", CI: "true" })).toBeUndefined();
  });

  it.each([
    [{ CI: "true" }],
    [{ CI: "1" }],
    [{ CI: "true", GITHUB_ACTIONS: "false" }],
    [{ GITHUB_ACTIONS: "" }],
    [{ GITHUB_ACTIONS: "1" }],
    [{ GITHUB_ACTIONS: "TRUE" }],
    [{ GITHUB_ACTIONS: " true" }],
    [{ GITLAB_CI: "true", CI: "true" }],
  ])("keeps the limit for %j", (env) => {
    expect(testWorkers(12, env)).toBe(3);
  });

  it.each([
    ["1", 12, 1],
    ["2", 12, 2],
    ["12", 12, 12],
    // More than there are processors: all of them, not more.
    ["13", 12, 12],
    ["999999", 12, 12],
    ["99999999999999999999999999", 12, 12],
    ["4", 1, 1],
  ])("takes %s workers asked for on %s processors as %s", (asked, processors, workers) => {
    expect(testWorkers(processors, { [WORKERS_VARIABLE]: asked })).toBe(workers);
    // The same on GitHub Actions and in the pre-push hook.
    expect(testWorkers(processors, { [WORKERS_VARIABLE]: asked, GITHUB_ACTIONS: "true" })).toBe(workers);
    expect(testWorkers(processors, { [WORKERS_VARIABLE]: asked, CI: "true" })).toBe(workers);
  });

  it.each([
    "0",
    "00",
    "-1",
    "-0",
    "+3",
    "03",
    "2.5",
    "3.0",
    "abc",
    "",
    " ",
    " 3",
    "3 ",
    "3\n",
    "1e9",
    "0x10",
    "50%",
    "true",
    "NaN",
    "Infinity",
    "３",
    "3,0",
  ])("refuses %j and names the variable", (asked) => {
    for (const env of [{}, { GITHUB_ACTIONS: "true" }, { CI: "true" }]) {
      expect(() => testWorkers(12, { ...env, [WORKERS_VARIABLE]: asked })).toThrow(WORKERS_VARIABLE);
      expect(() => testWorkers(12, { ...env, [WORKERS_VARIABLE]: asked })).toThrow(JSON.stringify(asked));
    }
  });
});

describe("the configuration", () => {
  const options = config as {
    test: { maxWorkers?: unknown; testTimeout?: unknown; projects: { extends?: unknown; test: Record<string, unknown> }[] };
  };

  it("sets the number once, for all projects", () => {
    expect(options.test.maxWorkers).toBe(testWorkers(availableParallelism(), process.env));
    expect(options.test.projects.map((project) => project.test.name)).toEqual(["unit", "property", "integration"]);
    for (const project of options.test.projects) {
      expect(project.extends).toBe(true);
      for (const key of ["maxWorkers", "minWorkers", "fileParallelism", "pool", "isolate", "passWithNoTests"]) {
        expect(project.test).not.toHaveProperty(key);
      }
    }
    for (const key of ["fileParallelism", "pool", "isolate", "passWithNoTests", "include", "exclude"]) {
      expect(options.test).not.toHaveProperty(key);
    }
  });

  it("keeps the time limits of the projects", () => {
    expect(options.test.testTimeout).toBeUndefined();
    expect(options.test.projects.map((project) => project.test.testTimeout)).toEqual([undefined, 60_000, 30_000]);
  });
});

describe("the test files of a run", () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  /** Starts vitest the way `pnpm test` does, with only the named variables changed. */
  function vitest(args: string[], changed: Record<string, string>) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      // What the vitest running this test has set for its own workers, and
      // everything the number of workers is read from.
      if (/^(VITEST|TEST$|CI$|GITHUB_ACTIONS$|DUCTUS_TEST_WORKERS$)/i.test(key)) delete env[key];
    }
    directory = mkdtempSync(path.join(tmpdir(), "ductus-vitest-"));
    const report = path.join(directory, "report.json");
    const run = spawnSync(process.execPath, [VITEST, ...args, report], {
      cwd: REPO_ROOT,
      env: { ...env, ...changed },
      encoding: "utf8",
      timeout: STARTS_VITEST - 10_000,
    });
    return { status: run.status, output: `${run.stdout}\n${run.stderr}`, report };
  }

  function onDisk(patterns: string[], keep: (file: string) => boolean = () => true): string[] {
    return patterns
      .flatMap((pattern) => globSync(pattern, { cwd: REPO_ROOT }))
      .map((file) => file.replaceAll("\\", "/"))
      .filter(keep)
      .sort();
  }

  // Written out here a second time on purpose: a change of what a project
  // includes has to be made in two places, and one of them is a test.
  const unit = onDisk(
    ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    (file) => !file.endsWith(".property.test.ts") && !file.endsWith(".integration.test.ts"),
  );
  const property = onDisk(["src/**/*.property.test.ts", "tests/property/**/*.property.test.ts"]);

  it("finds test files on disk to compare with", () => {
    expect(unit).toContain("tests/unit/vitest-workers.test.ts");
    expect(unit).toContain("src/domain/json.test.ts");
    expect(property.length).toBeGreaterThan(0);
    expect(unit.filter((file) => property.includes(file))).toEqual([]);
  });

  it.each([
    [{}],
    [{ CI: "true" }],
    [{ GITHUB_ACTIONS: "true" }],
    [{ GITHUB_ACTIONS: "true", CI: "true" }],
    [{ [WORKERS_VARIABLE]: "1" }],
    [{ [WORKERS_VARIABLE]: "999999", CI: "true" }],
  ])(
    "are every test file on disk, with %j",
    (changed) => {
      const run = vitest(["list", "--filesOnly", "--project", "unit", "--project", "property", "--json"], changed);
      expect(run.output).not.toContain(WORKERS_VARIABLE);
      expect(run.status).toBe(0);
      const listed = JSON.parse(readFileSync(run.report, "utf8")) as { file: string; projectName: string }[];
      const of = (project: string) =>
        listed
          .filter((entry) => entry.projectName === project)
          .map((entry) => path.relative(REPO_ROOT, entry.file).replaceAll("\\", "/"))
          .sort();
      expect(of("unit")).toEqual(unit);
      expect(of("property")).toEqual(property);
      expect(listed).toHaveLength(unit.length + property.length);
    },
    STARTS_VITEST,
  );

  it.each([["0"], ["abc"], [""], ["2.5"]])(
    "are not listed with the variable set to %j: the run stops and says why",
    (asked) => {
      const run = vitest(["list", "--filesOnly", "--project", "unit", "--project", "property", "--json"], {
        [WORKERS_VARIABLE]: asked,
      });
      expect(run.status).not.toBe(0);
      expect(run.status).not.toBeNull();
      expect(run.output).toContain(WORKERS_VARIABLE);
      expect(existsSync(run.report)).toBe(false);
    },
    STARTS_VITEST,
  );

  // One small file is named, so that a run which wrongly starts stays small
  // and cannot start this file again.
  it.each([
    ["0", {}],
    ["abc", { GITHUB_ACTIONS: "true" }],
    ["-1", { CI: "true" }],
  ])(
    "are not run with the variable set to %j and %j: no tests and no success",
    (asked, changed) => {
      const run = vitest(["run", "--project", "unit", "src/domain/json.test.ts", "--reporter=json", "--outputFile"], {
        ...changed,
        [WORKERS_VARIABLE]: asked,
      });
      expect(run.status).not.toBe(0);
      expect(run.status).not.toBeNull();
      expect(run.output).toContain(WORKERS_VARIABLE);
      expect(existsSync(run.report)).toBe(false);
    },
    STARTS_VITEST,
  );

  it("are run when the variable is right, and a failing run is not what the refusals above look like", () => {
    const run = vitest(["run", "--project", "unit", "src/domain/json.test.ts", "--reporter=json", "--outputFile"], {
      [WORKERS_VARIABLE]: "1",
    });
    expect(run.status).toBe(0);
    const report = JSON.parse(readFileSync(run.report, "utf8")) as { numTotalTests: number; numPassedTests: number };
    expect(report.numTotalTests).toBeGreaterThan(0);
    expect(report.numPassedTests).toBe(report.numTotalTests);
  }, STARTS_VITEST);
});
