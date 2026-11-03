import { defineConfig, devices, type ReporterDescription } from "@playwright/test";

import { evidenceServerEnvironment } from "./scripts/demo/login-e2e-evidence.mjs";
import { LOGIN_PORT, loginOrigin } from "./scripts/demo/login-e2e-https.mjs";
import webkitSpecs from "./scripts/engineering/login-webkit-specs.json" with { type: "json" };
import { playwrightConsoleReporter } from "./test-output";

// The fake provider redirects to port 3000 alone (infra/fake-oidc), so the port
// is fixed. Our own dev server runs over https at 127.0.0.1, not localhost: an
// IP address is never kept as an HSTS host, so WebKit does not upgrade the
// redirect to the http-only fake provider on localhost:8090 (see
// scripts/demo/login-e2e-https.mjs); against a server reused with
// E2E_REUSE_SERVER=1 the origin stays http, as `pnpm demo:up` starts it.
const BASE_URL = loginOrigin(process.env);
const SECURE = BASE_URL.startsWith("https:");

/**
 * The full login through "Demo prijava" (B-6). It needs `next dev`: a
 * production build refuses the fake provider (D-09, e2e/auth.spec.ts), and
 * no switch may lift that. Chromium runs every spec. WebKit runs the specs in
 * scripts/engineering/login-webkit-specs.json, and only over https: the session
 * cookie is `Secure` and WebKit does not store it on http://localhost (DAN-232,
 * owner decision on #87). The main suite (playwright.config.ts) keeps the browser
 * policy of docs/TESTING.md 2.
 *
 * Needs the compose stack (database and fake provider on 8090), the migrated
 * and seeded database, and AUTH_DATABASE_URL, which has no default because
 * its password is made per run (CI) or chosen locally (.env.example).
 */
export default defineConfig({
  testDir: "e2e/login",
  retries: 0,
  // The tests share the demo account and the dev server compiles on first
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
    // The certificate of our own https server is made per run and not trusted by the browser.
    ignoreHTTPSErrors: SECURE,
    locale: "hr-HR",
    timezoneId: "Europe/Zagreb",
    screenshot: "only-on-failure",
    video: process.env.CI ? "on" : "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "login-chromium", use: { ...devices["Desktop Chrome"] } },
    ...(SECURE ? [{ name: "login-webkit", testMatch: webkitSpecs.map((spec) => `**/${spec}`), use: { ...devices["Desktop Safari"] } }] : []),
  ],
  webServer: {
    // `next dev` over https with a certificate made for this run. With
    // E2E_REUSE_SERVER=1 the origin is http and, when no server answers, the
    // plain dev server starts as it did before.
    command: SECURE ? "node scripts/demo/login-e2e-https.mjs" : `pnpm dev --port ${LOGIN_PORT}`,
    url: BASE_URL,
    ignoreHTTPSErrors: SECURE,
    // Playwright stops the server group with SIGKILL unless told otherwise, and
    // then the launcher could not delete the private key of this run.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
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
      // The evidence signer and the storage domain `pnpm demo:up` gives the app (Z5).
      ...evidenceServerEnvironment(),
    },
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 240_000,
  },
});
