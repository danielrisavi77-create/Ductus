import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
