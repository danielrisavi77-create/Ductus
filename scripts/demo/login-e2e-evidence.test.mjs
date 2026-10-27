import assert from "node:assert/strict";
import test from "node:test";

import { evidenceServerEnvironment } from "./login-e2e-evidence.mjs";

const DOMAINS = `EVIDENCE_STORAGE_DOMAINS=${JSON.stringify({ requestTimeoutMs: 10000, domains: [{ label: "local-demo-fakultet" }] })}`;
const LOCAL = { DUCTUS_AUTH_LOCAL_PASSWORD: "p".repeat(24), AUTH_DATABASE_URL: `postgres://ductus_auth_local:${"p".repeat(24)}@127.0.0.1:54329/ductus` };
const quiet = (work) => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return work();
  } finally {
    console.warn = warn;
  }
};

test("the login E2E server gets the signer, the store credentials and the storage domain, and nothing of the demo auth setup", () => {
  const seen = [];
  const env = evidenceServerEnvironment({ ...LOCAL, DUCTUS_DEV_SIGNING_KEY_FILE: "/seed/demo.seed" }, (child) => {
    seen.push(child);
    return { status: 0, stdout: `${DOMAINS}\n` };
  });
  assert.deepEqual(Object.keys(env).sort(), [
    "DUCTUS_DEV_SIGNING_KEY_FILE", "EVIDENCE_S3_LOCAL_KEY_ID", "EVIDENCE_S3_LOCAL_SECRET",
    "EVIDENCE_STORAGE_DOMAINS", "S3_ACCESS_KEY_ID", "S3_ENDPOINT", "S3_SECRET_ACCESS_KEY",
  ]);
  assert.equal(env.DUCTUS_DEV_SIGNING_KEY_FILE, "/seed/demo.seed");
  assert.equal(env.S3_ENDPOINT, "http://127.0.0.1:9100");
  assert.equal(env.EVIDENCE_STORAGE_DOMAINS, DOMAINS.slice("EVIDENCE_STORAGE_DOMAINS=".length));
  assert.equal(seen.length, 1);
});

// F-156: whatever the source environment holds, only the evidence variables leave. A
// database login or an auth password in the result would reach the E2E reports.
test("no database login, password or other source value reaches the E2E server environment", () => {
  const CANARY = "canary-f156-not-for-the-report";
  // The demo environment accepts these forms (scripts/demo/up.mjs), so the canary reaches
  // the merged environment the allowlist filters; the app login there is the fixed local one.
  const source = {
    DUCTUS_DEV_SIGNING_KEY_FILE: "/seed/demo.seed",
    AUTH_DATABASE_URL: `postgres://ductus_auth_local:${CANARY}@127.0.0.1:54329/ductus`,
    DUCTUS_AUTH_LOCAL_PASSWORD: CANARY,
    DATABASE_URL: `postgres://admin:${CANARY}@127.0.0.1:54329/ductus`,
    OIDC_CLIENT_SECRET: CANARY,
    UNRELATED_TOKEN: CANARY,
  };
  const env = evidenceServerEnvironment(source, () => ({ status: 0, stdout: `${DOMAINS}\n` }));
  assert.ok(Object.keys(env).length > 0, "the stubbed stack must give the evidence variables");
  for (const [key, value] of Object.entries(env)) {
    assert.doesNotMatch(key, /DATABASE_URL|PASSWORD/, key);
    assert.ok(!String(value).includes(CANARY), key);
  }
});

test("without a usable local stack the E2E server gets no evidence variables", () => {
  const down = () => ({ status: 1, stdout: "" });
  const junk = () => ({ status: 0, stdout: "EVIDENCE_STORAGE_DOMAINS={}\n" });
  assert.deepEqual(quiet(() => evidenceServerEnvironment(LOCAL, down)), {});
  assert.deepEqual(quiet(() => evidenceServerEnvironment(LOCAL, junk)), {});
  // A docker target override is refused by the demo environment (F-100): no variables, no child run.
  assert.deepEqual(quiet(() => evidenceServerEnvironment({ ...LOCAL, DOCKER_HOST: "tcp://elsewhere:2375" }, () => assert.fail("must not run"))), {});
});