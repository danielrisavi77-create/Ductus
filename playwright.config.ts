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
  reporter: "list",
  use: {
    baseURL: BASE_URL,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: webServerCommand,
    url: BASE_URL,
    // A server already on the port may be `next dev` or an older build, so it
    // is reused only on explicit request.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 240_000,
  },
});
