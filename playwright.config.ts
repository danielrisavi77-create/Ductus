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
  // Wide and mobile layouts; every spec runs in both.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: webServerCommand,
    url: BASE_URL,
    // A server already on the port may be `next dev` or an older build, so it
    // is reused only on explicit request.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 240_000,
  },
});
