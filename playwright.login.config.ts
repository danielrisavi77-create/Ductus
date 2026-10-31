import { defineConfig, devices, type ReporterDescription } from "@playwright/test";

import { evidenceServerEnvironment } from "./scripts/local/login-e2e-evidence.mjs";
import { playwrightConsoleReporter } from "./test-output";

// The fake provider redirects to http://localhost:3000/api/auth/callback
// alone (infra/fake-oidc), so the port and the host name are fixed.
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The full login through "Demo prijava" (B-6). It needs `next dev`: a
 * production build refuses the fake provider (D-09, e2e/auth.spec.ts), and
 * no switch may lift that. Chromium only, by owner decision; the main suite
 * (playwright.config.ts) keeps the browser policy of docs/TESTING.md 2.
 *
 * Needs the compose stack (database and fake provider on 8090), the migrated
 * and seeded database, and AUTH_DATABASE_URL, which has no default because
 * its password is made per run (CI) or chosen locally (.env.example).
 */
export default defineConfig({
  testDir: "e2e/login",
  retries: 0,
  // The tests share the test account and the dev server compiles on first
  // request; one worker keeps the sessions of one test out of another.
  workers: 1,
  timeout: 90_000,
  reporter: [
    [playwrightConsoleReporter(process.env)],
    ["html", { open: "never", outputFolder: "playwright-report-login" }],
    // CI shards: the results each runner reconciles against the full list.
    ...(process.env.LOGIN_E2E_JSON ? [["json", { outputFile: process.env.LOGIN_E2E_JSON }] as ReporterDescription] : []),
  ],
  outputDir: "test-results-login",
  use: {
    baseURL: BASE_URL,
    locale: "hr-HR",
    timezoneId: "Europe/Zagreb",
    screenshot: "only-on-failure",
    video: process.env.CI ? "on" : "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "login-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    // F-152: only fixed local values here. A database URL set in the
    // environment reaches the server through the environment it inherits.
    env: {
      ...(process.env.APP_DATABASE_URL === undefined
        ? { APP_DATABASE_URL: "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus" }
        : {}),
      DUCTUS_AUTH_PROVIDER: "fake-oidc",
      OIDC_ISSUER: "http://localhost:8090",
      OIDC_REDIRECT_URI: `${BASE_URL}/api/auth/callback`,
      OIDC_CLIENT_ID: "ductus-local",
      OIDC_CLIENT_SECRET: "ductus-local-only",
      // The evidence signer and the storage domain `pnpm local:up` gives the app (Z5).
      ...evidenceServerEnvironment(),
    },
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 240_000,
  },
});
