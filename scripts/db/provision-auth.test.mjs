import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { authProvisionInvocation } from "./provision-auth.mjs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

test("auth provisioning script does not rely on shell variable expansion (cmd.exe does not expand $VAR)", () => {
  const script = pkg.scripts["db:provision:auth"];
  assert.doesNotMatch(script, /\$/);
  assert.equal(script, "node scripts/db/provision-auth.mjs");
});

test("auth password reaches psql as a literal argv element, whatever characters it holds", () => {
  const password = "pa ss$DUCTUS\"%PATH%&|word-0123456789";
  const { command, args, stdinFile } = authProvisionInvocation({ DUCTUS_AUTH_LOCAL_PASSWORD: password });
  assert.equal(command, "docker");
  assert.ok(args.includes(`auth_password=${password}`));
  assert.match(stdinFile, /auth-login\.sql$/);
});

test("auth provisioning refuses a missing or short password instead of setting a literal one", () => {
  assert.throws(() => authProvisionInvocation({}), /at least 16/);
  assert.throws(() => authProvisionInvocation({ DUCTUS_AUTH_LOCAL_PASSWORD: "short" }), /at least 16/);
});
