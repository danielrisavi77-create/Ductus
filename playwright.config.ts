import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The E2E suite runs against a production build, never `next dev`. CI builds
 * once in its own step and sets E2E_NO_BUILD=1 so the build is not repeated.
 */
const webServerCommand =
  process.env.E2E_NO_BUILD === "1" ? "pnpm start" : "pnpm build && pnpm start";

/**
 * `next start` on a port with the login configured as "Demo prijava", and
 * NODE_ENV set at start when given.
 */
function server(port: number, command: string, nodeEnv?: "test" | "development") {
  const baseUrl = `http://localhost:${port}`;
  return {
    command: `${command} -p ${port}`,
    url: baseUrl,
    // The server under test reaches the compose database as the local
    // application login (.env.example); the application has no default.
    env: {
      APP_DATABASE_URL:
        process.env.APP_DATABASE_URL ??
        "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus",
      // "Demo prijava" configured on purpose: the production build must refuse
      // it (D-09, e2e/auth.spec.ts). Local-only values from .env.example.
      DUCTUS_AUTH_PROVIDER: "fake-oidc",
      OIDC_ISSUER: "http://localhost:8090",
      OIDC_REDIRECT_URI: `${baseUrl}/api/auth/callback`,
      OIDC_CLIENT_ID: "ductus-local",
      OIDC_CLIENT_SECRET: "ductus-local-only",
      ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
    },
    // A server already on the port may be `next dev` or an older build, so it
    // is reused only on explicit request.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 240_000,
  };
}

export default defineConfig({
  testDir: "e2e",
  // The full login needs `next dev` and runs on its own config
  // (playwright.login.config.ts, `pnpm test:e2e:login`).
  testIgnore: "login/**",
  // Evidence must be reproducible: a flaky pass is not a pass.
  retries: 0,
  // The HTML report carries screenshots, videos and traces; CI uploads it as
  // the `playwright-report` artifact of the run (docs/SESSIONS.md 6).
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "hr-HR",
    timezoneId: "Europe/Zagreb",
    screenshot: "only-on-failure",
    video: process.env.CI ? "on" : "retain-on-failure",
    trace: "retain-on-failure",
  },
  // Browser policy (docs/TESTING.md 2). Chromium is required on every PR;
  // Firefox and WebKit are required for editor, sync, offline, clipboard, auth
  // and submission changes. CI runs all three engines on every PR, which
  // covers each of those classes without a path filter that could miss one.
  // `mobile` is a Chromium viewport: an addition, never a stand-in for WebKit.
  // Every spec runs in every project; locally, `--project desktop` runs one.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  // The first server is the build as deployed. The other two run the same
  // build with NODE_ENV=test and development given at start: D-09 must hold
  // for every NODE_ENV, because the build fixes it (e2e/auth.spec.ts). Servers
  // start in order, so the build runs once.
  webServer: [
    server(PORT, webServerCommand),
    server(PORT + 1, "pnpm start", "test"),
    server(PORT + 2, "pnpm start", "development"),
  ],
});
