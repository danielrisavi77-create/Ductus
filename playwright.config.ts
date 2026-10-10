import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The E2E suite runs against a production build, never `next dev`. CI builds
 * once in its own step and sets E2E_NO_BUILD=1 so the build is not repeated.
 */
const webServerCommand =
  process.env.E2E_NO_BUILD === "1" ? "pnpm start" : "pnpm build && pnpm start";

export default defineConfig({
  testDir: "e2e",
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
  webServer: {
    command: webServerCommand,
    url: BASE_URL,
    // The server under test reaches the compose database as the local
    // application login (.env.example); the application has no default.
    env: {
      APP_DATABASE_URL:
        process.env.APP_DATABASE_URL ??
        "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus",
      // The local demo journal (F-3 step 1b): read by /rad at request time,
      // so the same build runs with it here and without it elsewhere.
      DUCTUS_LOCAL_DEMO_JOURNAL: "1",
      DUCTUS_DEPLOYMENT: "ci",
    },
    // A server already on the port may be `next dev` or an older build, so it
    // is reused only on explicit request.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 240_000,
  },
});
