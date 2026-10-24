import assert from "node:assert/strict";
import { isAbsolute, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDemoEnvironment, parseStorageDomainsLine, pnpmInvocation, runDemoLifecycle } from "./up.mjs";

const DOMAINS_LINE = `EVIDENCE_STORAGE_DOMAINS=${JSON.stringify({ requestTimeoutMs: 10000, domains: [{ label: "local-demo-fakultet" }] })}`;
/** Fake node runner: records the script, answers like the storage script. */
const fakeNode = (calls, overrides = {}) => async (script) => {
  calls.push(script);
  if (overrides[script]) return overrides[script];
  return { code: 0, stdout: script.endsWith("evidence-storage-domain.mjs") ? `${DOMAINS_LINE}\n` : "{}\n" };
};

test("demo starts the active pnpm CLI through Node without a shell", () => {
  assert.deepEqual(
    pnpmInvocation(
      { npm_execpath: "C:\\Program Files\\pnpm\\pnpm.cjs" },
      "stack:up",
      "win32",
      "C:\\Program Files\\nodejs\\node.exe",
    ),
    {
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Program Files\\pnpm\\pnpm.cjs", "stack:up"],
    },
  );
});

test("demo requires pnpm lifecycle context for a safe Windows launch", () => {
  assert.throws(
    () => pnpmInvocation({}, "stack:up", "win32"),
    /Run the demo through pnpm/,
  );
});

test("demo uses the pnpm executable directly outside Windows", () => {
  assert.deepEqual(pnpmInvocation({}, "stack:up", "linux"), {
    command: "pnpm",
    args: ["stack:up"],
  });
});

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

test("demo environment rejects a host override in the database URL query", () => {
  assert.throws(
    () => createDemoEnvironment({
      APP_DATABASE_URL: "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus?host=db.example.com",
    }),
    /APP_DATABASE_URL must use the local ductus database/,
  );
  assert.throws(
    () => createDemoEnvironment({
      AUTH_DATABASE_URL: "postgres://ductus_auth_local@127.0.0.1:54329/ductus?host=db.example.com",
    }),
    /AUTH_DATABASE_URL must use the local ductus database/,
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

test("auth password with a percent sign is rejected before setup", () => {
  const url = "postgres://ductus_auth_local@127.0.0.1:54329/ductus";
  const message = /must not contain a percent sign/;
  assert.throws(() => createDemoEnvironment({ AUTH_DATABASE_URL: url, DUCTUS_AUTH_LOCAL_PASSWORD: "%41%41%41%41%41%41%41%41" }), message);
  assert.throws(() => createDemoEnvironment({ AUTH_DATABASE_URL: url, DUCTUS_AUTH_LOCAL_PASSWORD: "p@ss:w/rd#?%20 0123456789" }), message);
  assert.throws(
    () => createDemoEnvironment({ AUTH_DATABASE_URL: `postgres://ductus_auth_local:${"abc%2541def" + "0123456789"}@127.0.0.1:54329/ductus` }),
    message,
  );
  // The rejection never repeats the password.
  try {
    createDemoEnvironment({ AUTH_DATABASE_URL: url, DUCTUS_AUTH_LOCAL_PASSWORD: "aaaaaaaa%41aaaaaaaa" });
    assert.fail("expected a rejection");
  } catch (error) {
    assert.doesNotMatch(error.message, /aaaaaaaa/);
  }
});

test("auth password with URL-special characters round-trips through the URL", () => {
  const password = "p@ss:w/rd#?& 0123456789";
  const env = createDemoEnvironment({ DUCTUS_AUTH_LOCAL_PASSWORD: password });
  assert.equal(decodeURIComponent(new URL(env.AUTH_DATABASE_URL).password), password);
});

test("one-command demo registers the evidence key and storage before the app, in order", async () => {
  const calls = [];
  const env = { marker: "same-environment" };
  let appEnv;
  const code = await runDemoLifecycle(env, async (script, receivedEnv) => {
    calls.push(script);
    if (script === "dev") appEnv = receivedEnv;
    else assert.equal(receivedEnv, env);
    return 0;
  }, true, fakeNode(calls));

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "stack:up", "db:migrate", "db:seed",
    "db/local/evidence-signing-key.mjs", "db/local/evidence-storage-domain.mjs",
    "dev",
  ]);
  // The storage configuration reaches the app through its environment only.
  assert.equal(appEnv.EVIDENCE_STORAGE_DOMAINS, DOMAINS_LINE.slice("EVIDENCE_STORAGE_DOMAINS=".length));
  assert.equal(appEnv.marker, "same-environment");
  assert.equal(env.EVIDENCE_STORAGE_DOMAINS, undefined);
});

test("CI preparation runs the same steps including evidence setup and omits only the app server", async () => {
  const calls = [];
  const code = await runDemoLifecycle({}, async (script) => {
    calls.push(script);
    return 0;
  }, false, fakeNode(calls));

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "stack:up", "db:migrate", "db:seed",
    "db/local/evidence-signing-key.mjs", "db/local/evidence-storage-domain.mjs",
  ]);
});

test("a second preparation run repeats the same steps and yields the same app environment", async () => {
  const seen = [];
  for (let run = 0; run < 2; run += 1) {
    await runDemoLifecycle({}, async (script, receivedEnv) => {
      if (script === "dev") seen.push(receivedEnv.EVIDENCE_STORAGE_DOMAINS);
      return 0;
    }, true, fakeNode([]));
  }
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
});

test("demo preparation stops at the first failed step", async () => {
  const calls = [];
  const code = await runDemoLifecycle({}, async (script) => {
    calls.push(script);
    return script === "db:migrate" ? 1 : 0;
  }, true, fakeNode(calls));

  assert.equal(code, 1);
  assert.deepEqual(calls, ["stack:up", "db:migrate"]);
});

test("a failed evidence key or storage step stops before the app and returns its code", async () => {
  for (const [failing, code] of [["db/local/evidence-signing-key.mjs", 3], ["db/local/evidence-storage-domain.mjs", 4]]) {
    const calls = [];
    const result = await runDemoLifecycle({}, async (script) => {
      calls.push(script);
      return 0;
    }, true, fakeNode(calls, { [failing]: { code, stdout: "" } }));
    assert.equal(result, code);
    assert.ok(!calls.includes("dev"));
  }
});

test("an unusable storage configuration line stops the demo instead of starting without storage", async () => {
  const calls = [];
  const result = await runDemoLifecycle({}, async (script) => {
    calls.push(script);
    return 0;
  }, true, fakeNode(calls, { "db/local/evidence-storage-domain.mjs": { code: 0, stdout: "something else\n" } }));
  assert.equal(result, 1);
  assert.ok(!calls.includes("dev"));
});

test("storage line parser accepts only one EVIDENCE_STORAGE_DOMAINS line with a domain", () => {
  assert.ok(parseStorageDomainsLine(`${DOMAINS_LINE}\r\n`));
  assert.equal(parseStorageDomainsLine(""), undefined);
  assert.equal(parseStorageDomainsLine(`${DOMAINS_LINE}\nextra`), undefined);
  assert.equal(parseStorageDomainsLine("EVIDENCE_STORAGE_DOMAINS={not json"), undefined);
  assert.equal(parseStorageDomainsLine('EVIDENCE_STORAGE_DOMAINS={"domains":[]}'), undefined);
});

test("demo environment gives the evidence scripts local credentials and a seed outside the repository", () => {
  const env = createDemoEnvironment({});
  assert.equal(env.EVIDENCE_S3_LOCAL_KEY_ID, "ductus-local");
  assert.equal(env.EVIDENCE_S3_LOCAL_SECRET, "ductus-local-only");
  assert.ok(isAbsolute(env.DUCTUS_DEV_SIGNING_KEY_FILE));
  const root = fileURLToPath(new URL("../../", import.meta.url));
  assert.ok(!resolve(env.DUCTUS_DEV_SIGNING_KEY_FILE).startsWith(resolve(root)));
  // Stable across runs, so a second run finds the same seed (same key).
  assert.equal(createDemoEnvironment({}).DUCTUS_DEV_SIGNING_KEY_FILE, env.DUCTUS_DEV_SIGNING_KEY_FILE);
  // An absolute operator path wins; a relative one is refused, never replaced.
  const own = resolve("/somewhere/own.seed");
  assert.equal(createDemoEnvironment({ DUCTUS_DEV_SIGNING_KEY_FILE: own }).DUCTUS_DEV_SIGNING_KEY_FILE, own);
  assert.throws(() => createDemoEnvironment({ DUCTUS_DEV_SIGNING_KEY_FILE: "rel.seed" }), /absolute path/);
});

test("demo environment refuses a docker target that the database URL check cannot see (F-100)", () => {
  for (const name of ["DUCTUS_PSQL_CONTAINER", "DOCKER_HOST", "DOCKER_CONTEXT"]) {
    assert.throws(() => createDemoEnvironment({ [name]: "remote" }), new RegExp(name), name);
  }
  assert.doesNotThrow(() => createDemoEnvironment({ DOCKER_HOST: "" }));
});
test("demo children never receive a docker or compose steering variable (F-101)", () => {
  const env = createDemoEnvironment({
    COMPOSE_FILE: "elsewhere.yaml", COMPOSE_PROJECT_NAME: "x", COMPOSE_PROFILES: "p", COMPOSE_ENV_FILES: "e",
    DOCKER_CONFIG: "d", DOCKER_TLS_VERIFY: "1", DOCKER_CERT_PATH: "c", docker_buildkit: "1",
    PATH: "p", npm_execpath: "n",
  });
  assert.deepEqual(Object.keys(env).filter((name) => /^(?:DOCKER_|COMPOSE_)/i.test(name)), []);
  assert.equal(env.PATH, "p");
  assert.equal(env.npm_execpath, "n");
});
