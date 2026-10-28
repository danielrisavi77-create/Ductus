import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForProvider(child, discoveryUrl, output) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`fake OIDC exited early: ${output.join("")}`);
    try {
      const response = await fetch(discoveryUrl);
      if (response.ok) return response.json();
    } catch {
      // The local provider may need a short moment to initialize its signing key.
    }
    await delay(100);
  }
  throw new Error(`fake OIDC did not become ready: ${output.join("")}`);
}

test("the fake OIDC interaction offers both synthetic students", { timeout: 10_000 }, async () => {
  const port = await unusedPort();
  const issuer = `http://localhost:${port}`;
  const output = [];
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), ISSUER: issuer },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    const metadata = await waitForProvider(child, `${issuer}/.well-known/openid-configuration`, output);
    for (const claim of ["given_name", "family_name"]) assert.ok(metadata.claims_supported.includes(claim), claim);
    const authorize = new URL(metadata.authorization_endpoint);
    authorize.search = new URLSearchParams({
      client_id: "ductus-local",
      redirect_uri: "http://localhost:3000/api/auth/callback",
      response_type: "code",
      scope: "openid profile",
      state: "demo-state",
      nonce: "demo-nonce",
      code_challenge: "cUj0bS4f5rZ4jvKf7SW02Ipk3tC4W8P9O4gKnWwbLWc",
      code_challenge_method: "S256",
    });
    const authorization = await fetch(authorize, { redirect: "manual" });
    assert.ok([302, 303].includes(authorization.status));

    const interactionLocation = authorization.headers.get("location");
    assert.ok(interactionLocation);
    const interactionUrl = new URL(interactionLocation, issuer);
    assert.match(interactionUrl.pathname, /^\/interaction\//);

    const cookies = authorization.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    assert.notEqual(cookies, "");
    const interaction = await fetch(interactionUrl, { headers: { cookie: cookies } });
    assert.equal(interaction.status, 200);
    const html = await interaction.text();
    assert.match(html, /Demo studentica/);
    assert.match(html, /Demo student 2/);
    assert.match(html, /Demo nastavnik/);
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(1_000),
    ]);
  }
});
