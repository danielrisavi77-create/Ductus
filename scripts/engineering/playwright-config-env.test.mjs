import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// F-152: the web server's `env` in the Playwright configs holds only fixed
// local values; a database URL from the environment is inherited, not copied.
// The URLs below are invented canaries; each config is listed with them set
// and its JSON report is searched for them.
const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = fileURLToPath(new URL("../../node_modules/@playwright/test/cli.js", import.meta.url));
const CANARY = {
  APP_DATABASE_URL: "postgres://ductus_app_local:f152-app-canary@127.0.0.1:54329/ductus",
  AUTH_DATABASE_URL: "postgres://ductus_auth_local:f152-auth-canary@127.0.0.1:54329/ductus",
};

function listedConfig(config) {
  const env = { ...process.env, ...CANARY };
  for (const name of ["LOGIN_E2E_JSON", "PLAYWRIGHT_JSON_OUTPUT_FILE", "PLAYWRIGHT_JSON_OUTPUT_NAME", "DUCTUS_AUTH_LOCAL_PASSWORD"]) delete env[name];
  const run = spawnSync(process.execPath, [cli, "test", "-c", config, "--list", "--reporter=json"], {
    cwd: root, env, encoding: "utf8", timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `${config} --list failed: ${run.stderr}`);
  return run.stdout;
}

// The login config has one web server, whose env the report carries. The main
// config has a list of servers, which Playwright 1.63 leaves out of the
// report; it is checked too, so that a change to one server stays covered.
for (const [config, serialised] of [["playwright.login.config.ts", true], ["playwright.config.ts", false]]) {
  test(`${config}: the JSON report holds no database URL from the environment`, { timeout: 150_000 }, () => {
    const out = listedConfig(config);
    // Not vacuous where the report carries the web server's env.
    if (serialised) assert.match(out, /"DUCTUS_AUTH_PROVIDER"/);
    for (const [name, value] of Object.entries(CANARY)) {
      assert.ok(!out.includes(value.split(":")[2].split("@")[0]), `${name} from the environment is in the ${config} report`);
    }
  });
}
