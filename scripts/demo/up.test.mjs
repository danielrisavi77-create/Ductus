import assert from "node:assert/strict";
import test from "node:test";

import { createDemoEnvironment, runDemoLifecycle } from "./up.mjs";

test("demo environment uses only local Compose services and creates an auth password", () => {
  const env = createDemoEnvironment({
    S3_ENDPOINT: "https://storage.example.test",
    SMTP_URL: "smtp://mail.example.test:587",
    DUCTUS_AUTH_PROVIDER: "external-provider",
  });
  const app = new URL(env.APP_DATABASE_URL);
  const auth = new URL(env.AUTH_DATABASE_URL);

  assert.equal(env.DATABASE_URL, "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus");
  assert.equal(app.hostname, "127.0.0.1");
  assert.equal(app.port, "54329");
  assert.equal(app.pathname, "/ductus");
  assert.equal(decodeURIComponent(app.username), "ductus_app_local");
  assert.equal(auth.hostname, "127.0.0.1");
  assert.equal(auth.port, "54329");
  assert.equal(auth.pathname, "/ductus");
  assert.equal(decodeURIComponent(auth.username), "ductus_auth_local");
  assert.equal(decodeURIComponent(auth.password), env.DUCTUS_AUTH_LOCAL_PASSWORD);
  assert.ok(env.DUCTUS_AUTH_LOCAL_PASSWORD.length >= 16);
  assert.equal(env.S3_ENDPOINT, "http://127.0.0.1:9100");
  assert.equal(env.S3_ACCESS_KEY_ID, "ductus-local");
  assert.equal(env.S3_SECRET_ACCESS_KEY, "ductus-local-only");
  assert.equal(env.MAILPIT_URL, "http://127.0.0.1:8025");
  assert.equal(env.SMTP_URL, "smtp://127.0.0.1:1025");
  assert.equal(env.DUCTUS_AUTH_PROVIDER, "fake-oidc");
  assert.equal(env.OIDC_ISSUER, "http://localhost:8090");
  assert.equal(env.NODE_ENV, "development");
});

test("demo environment replaces the auth password placeholder from .env.example", () => {
  const env = createDemoEnvironment({
    AUTH_DATABASE_URL: "postgres://ductus_auth_local:%3CDUCTUS_AUTH_LOCAL_PASSWORD%3E@127.0.0.1:54329/ductus",
  });

  assert.notEqual(env.DUCTUS_AUTH_LOCAL_PASSWORD, "<DUCTUS_AUTH_LOCAL_PASSWORD>");
  assert.equal(new URL(env.AUTH_DATABASE_URL).password, encodeURIComponent(env.DUCTUS_AUTH_LOCAL_PASSWORD));
});

test("demo environment rejects non-local database URLs", () => {
  assert.throws(
    () => createDemoEnvironment({ APP_DATABASE_URL: "postgres://ductus_app_local:secret@db.example.test:5432/ductus" }),
    /APP_DATABASE_URL must use the local ductus database/,
  );
  assert.throws(
    () => createDemoEnvironment({ AUTH_DATABASE_URL: "postgres://ductus_auth_local:secret@db.example.test:5432/ductus" }),
    /AUTH_DATABASE_URL must use the local ductus database/,
  );
  assert.throws(
    () => createDemoEnvironment({ APP_DATABASE_URL: "postgres://ductus_app_local:wrong-password@127.0.0.1:54329/ductus" }),
    /APP_DATABASE_URL must use the local Compose app credentials/,
  );
});

test("configured auth password must match the local auth URL", () => {
  assert.throws(
    () => createDemoEnvironment({
      AUTH_DATABASE_URL: "postgres://ductus_auth_local:first-password@127.0.0.1:54329/ductus",
      DUCTUS_AUTH_LOCAL_PASSWORD: "second-password",
    }),
    /AUTH_DATABASE_URL and DUCTUS_AUTH_LOCAL_PASSWORD do not match/,
  );
});

test("one-command demo runs the stack, migrations, seed, and app in order", async () => {
  const calls = [];
  const env = { marker: "same-environment" };
  const code = await runDemoLifecycle(env, async (script, receivedEnv) => {
    calls.push([script, receivedEnv]);
    return 0;
  });

  assert.equal(code, 0);
  assert.deepEqual(calls.map(([script]) => script), ["stack:up", "db:migrate", "db:seed", "dev"]);
  assert.ok(calls.every(([, receivedEnv]) => receivedEnv === env));
});

test("CI preparation uses the same steps and omits only the app server", async () => {
  const calls = [];
  const code = await runDemoLifecycle({}, async (script) => {
    calls.push(script);
    return 0;
  }, false);

  assert.equal(code, 0);
  assert.deepEqual(calls, ["stack:up", "db:migrate", "db:seed"]);
});

test("demo preparation stops at the first failed step", async () => {
  const calls = [];
  const code = await runDemoLifecycle({}, async (script) => {
    calls.push(script);
    return script === "db:migrate" ? 1 : 0;
  });

  assert.equal(code, 1);
  assert.deepEqual(calls, ["stack:up", "db:migrate"]);
});
