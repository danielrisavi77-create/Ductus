import assert from "node:assert/strict";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LOGIN_PORT, createLoginCertificate, loginOrigin, nextDevArgs, opensslArgs } from "./login-e2e-https.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "ductus-https-test-"));

// Input classes of E2E_REUSE_SERVER: unset, "1", and every other value (the
// config reuses a server only for exactly "1").
const ORIGINS = [
  ["unset: the server is ours, over https at 127.0.0.1 (never noted as an HSTS host)", {}, "https://127.0.0.1:3000"],
  ["1: a server started elsewhere (pnpm demo:up), over http", { E2E_REUSE_SERVER: "1" }, "http://localhost:3000"],
  ["0 is not a reuse", { E2E_REUSE_SERVER: "0" }, "https://127.0.0.1:3000"],
  ["empty is not a reuse", { E2E_REUSE_SERVER: "" }, "https://127.0.0.1:3000"],
  ["true is not a reuse", { E2E_REUSE_SERVER: "true" }, "https://127.0.0.1:3000"],
  [" 1 with padding is not a reuse", { E2E_REUSE_SERVER: " 1 " }, "https://127.0.0.1:3000"],
];
for (const [name, env, expected] of ORIGINS) test(`login origin, ${name}`, () => assert.equal(loginOrigin(env), expected));

test("the login stack has the fixed port", () => assert.equal(LOGIN_PORT, 3000));

test("openssl is asked for a short lived certificate for localhost and 127.0.0.1 only", () => {
  const args = opensslArgs({ key: "/d/key.pem", cert: "/d/cert.pem" });
  assert.deepEqual(args.slice(0, 2), ["req", "-x509"]);
  assert.ok(args.includes("-nodes"));
  assert.equal(args[args.indexOf("-keyout") + 1], "/d/key.pem");
  assert.equal(args[args.indexOf("-out") + 1], "/d/cert.pem");
  assert.ok(Number(args[args.indexOf("-days") + 1]) <= 7);
  assert.equal(args[args.indexOf("-addext") + 1], "subjectAltName=DNS:localhost,IP:127.0.0.1");
});

test("next dev gets the https flags with our own key and certificate and the fixed port", () => {
  const args = nextDevArgs({ key: "/d/key.pem", cert: "/d/cert.pem" });
  assert.deepEqual(args, ["dev", "--port", "3000", "--experimental-https", "--experimental-https-key", "/d/key.pem", "--experimental-https-cert", "/d/cert.pem"]);
});

test("a real certificate is made: localhost only, short lived, key private and matching", () => {
  const dir = scratch();
  try {
    const { key, cert } = createLoginCertificate(dir);
    assert.equal(statSync(key).mode & 0o077, 0, "the private key is readable by its owner alone");
    const x509 = new X509Certificate(readFileSync(cert));
    assert.ok(x509.checkHost("localhost"));
    assert.ok(x509.checkIP("127.0.0.1"));
    assert.equal(x509.checkHost("example.test"), undefined);
    assert.ok(new Date(x509.validTo) - Date.now() <= 7 * 24 * 3600 * 1000, "valid for days, not years");
    assert.ok(x509.checkPrivateKey(createPrivateKey(readFileSync(key))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("when openssl fails nothing is left behind and the error says so", () => {
  const dir = scratch();
  try {
    const failing = () => ({ status: 1, error: undefined, stderr: "boom" });
    assert.throws(() => createLoginCertificate(dir, failing), /openssl/);
    assert.equal(existsSync(join(dir, "key.pem")), false);
    const missing = () => ({ status: null, error: new Error("ENOENT"), stderr: "" });
    assert.throws(() => createLoginCertificate(dir, missing), /openssl/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
