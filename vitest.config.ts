import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export const WORKERS_VARIABLE = "DUCTUS_TEST_WORKERS";

/**
 * How many test files run at the same time. It changes speed only: which files
 * and tests run is decided by the projects below.
 *
 * On a developer machine several suites often run at once (worktrees, agents,
 * the pre-push hook). Vitest alone takes every processor but one for each of
 * them, and tests then run out of their time limit although nothing is wrong.
 * So a suite takes a quarter of the processors here, and never less than one.
 * GitHub Actions gives a job a machine of its own, so there vitest decides
 * (`undefined`). Only GITHUB_ACTIONS is looked at: the pre-push hook sets
 * CI=true on the developer machine, where the limit has to hold.
 *
 * DUCTUS_TEST_WORKERS names the number outright, anywhere. It has to be a
 * whole number of at least 1, written with digits only; a larger number than
 * there are processors means all of them. Any other value, the empty one
 * included, stops the run with an error instead of being guessed at.
 */
export function testWorkers(
  processors: number,
  env: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const available = Number.isInteger(processors) && processors > 0 ? processors : 1;
  const asked = env[WORKERS_VARIABLE];
  if (asked !== undefined) {
    if (!/^[1-9][0-9]*$/.test(asked)) {
      throw new Error(
        `${WORKERS_VARIABLE} must be a whole number of at least 1, written with digits only; it is ${JSON.stringify(asked)}. Unset it to use the default.`,
      );
    }
    return Math.min(Number(asked), available);
  }
  if (env.GITHUB_ACTIONS === "true") return undefined;
  return Math.max(1, Math.floor(available / 4));
}

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path mapping in tsconfig.json. The regex with a
    // forward-slash replacement keeps `@/` imports working on Windows.
    alias: [
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./src/", import.meta.url)).replaceAll("\\", "/")}/`,
      },
    ],
  },
  test: {
    environment: "node",
    // Set here and in no project: the projects inherit it (`extends: true`).
    maxWorkers: testWorkers(availableParallelism(), process.env),
    // Two projects so that property tests run exactly once and can be scaled
    // separately (FC_NUM_RUNS) without slowing the unit suite.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          exclude: ["**/*.property.test.ts", "**/*.integration.test.ts", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "property",
          include: ["src/**/*.property.test.ts", "tests/property/**/*.property.test.ts"],
          setupFiles: ["tests/property/setup.ts"],
          testTimeout: 60_000,
        },
      },
      {
        // Needs the local stack: pnpm stack:up (compose.yaml).
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.integration.test.ts"],
          testTimeout: 30_000,
          // The application login of the local stack (.env.example); the
          // application itself has no default for it.
          env: {
            APP_DATABASE_URL:
              process.env.APP_DATABASE_URL ??
              "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus",
          },
        },
      },
    ],
  },
});
