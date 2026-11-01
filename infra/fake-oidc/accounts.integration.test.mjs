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

// DAN-212: RP-initiated logout at the provider level. A cookie jar stands in
// for the browser; the only account is the invented "demo-student".
function jarOf() {
  const jar = new Map();
  return {
    take(response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(";", 1);
        const at = pair.indexOf("=");
        const name = pair.slice(0, at);
        const value = pair.slice(at + 1);
        if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
        else jar.set(name, value);
      }
      return response;
    },
    header() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
  };
}

test("end_session is published, takes only the registered address, and ends the provider session", { timeout: 15_000 }, async () => {
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
    // F1
    assert.equal(typeof metadata.end_session_endpoint, "string");
    const jar = jarOf();
    const get = async (url) =>
      jar.take(await fetch(new URL(url, issuer), { redirect: "manual", headers: { cookie: jar.header() } }));
    const post = async (url, body) =>
      jar.take(
        await fetch(new URL(url, issuer), {
          method: "POST",
          redirect: "manual",
          headers: { cookie: jar.header(), "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body),
        }),
      );
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
    const asksForAccount = (response) => /^\/interaction\//.test(new URL(response.headers.get("location"), issuer).pathname);

    const first = await get(authorize);
    assert.ok(asksForAccount(first));
    const login = await post(first.headers.get("location") + "/login", { account: "demo-student" });
    const resumed = await get(login.headers.get("location"));
    assert.match(resumed.headers.get("location"), /^http:\/\/localhost:3000\/api\/auth\/callback\?code=/);
    // Without a logout the provider signs the same account in again silently.
    assert.equal(asksForAccount(await get(authorize)), false);

    // F2: an address that is not registered is refused.
    const endSession = (redirect) => {
      const url = new URL(metadata.end_session_endpoint);
      url.search = new URLSearchParams({ client_id: "ductus-local", post_logout_redirect_uri: redirect });
      return get(url);
    };
    const foreign = await endSession("https://napadac.test/");
    assert.equal(foreign.status, 400);
    assert.doesNotMatch(await foreign.text(), /op\.logoutForm/);

    // F3: the "Demo odjava" page, in Croatian, with the provider's own form.
    const page = await endSession("http://localhost:3000/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<title>Demo odjava<\/title>/);
    assert.match(html, /Ovo nije AAI@EduHr/);
    assert.match(html, /name="logout" value="yes">Odjavi se</);
    const action = /id="op\.logoutForm" method="post" action="([^"]+)"/.exec(html)?.[1];
    const xsrf = /name="xsrf" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(action && xsrf);

    const done = await post(action, { xsrf, logout: "yes" });
    assert.equal(done.headers.get("location"), "http://localhost:3000/");
    // The provider session has ended: the next sign-in asks for an account again.
    assert.ok(asksForAccount(await get(authorize)));
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(1_000),
    ]);
  }
});
