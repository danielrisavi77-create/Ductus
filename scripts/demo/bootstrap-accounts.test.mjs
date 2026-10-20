import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { assertLocalUrl, bootstrap, localResponse, verifyLocalCompose } from "./bootstrap-accounts.mjs";

const servers = [];
after(async () => { for (const server of servers) await new Promise((done) => server.close(done)); });
async function serve(handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, "localhost", done));
  servers.push(server);
  return `http://localhost:${server.address().port}`;
}
function redirect(res, location, cookie) {
  res.writeHead(303, { location, ...(cookie ? { "set-cookie": cookie } : {}) });
  res.end();
}
function hash(token) { return createHash("sha256").update(token).digest("hex"); }

test("the HTTP preflight never follows a redirect outside its two local origins", async () => {
  const target = await serve((_req, res) => redirect(res, "https://outside.example/callback"));
  const other = await serve((_req, res) => { res.writeHead(200); res.end("unexpected"); });
  assert.throws(() => assertLocalUrl("http://localhost:3001/"));
  assert.throws(() => assertLocalUrl("http://127.0.0.1:3000/"));
  assert.throws(() => assertLocalUrl("http://localhost:3000@evil.test/"));
  await assert.rejects(localResponse(target, fetch, [target, other]), /two fixed localhost origins/);
});

test("the Docker preflight refuses a remote context and foreign or public containers", () => {
  assert.throws(() => verifyLocalCompose({}, () => '"tcp://remote.example:2375"'), /local engine/);
  const own = `com.docker.compose.project.config_files=${fileURLToPath(new URL("../../", import.meta.url))}compose.yaml`;
  const service = (name, port, target, address = "127.0.0.1", labels = own) => ({
    Service: name, State: "running", Health: "healthy", Project: "ductus", Labels: labels,
    Publishers: [{ URL: address, PublishedPort: port, TargetPort: target }],
  });
  const inspect = (services) => (args, env) => {
    assert.equal(env.DOCKER_HOST, undefined);
    assert.equal(env.COMPOSE_PROJECT_NAME, undefined);
    return args[0] === "context" ? '"npipe:////./pipe/docker_engine"' : services.map(JSON.stringify).join("\n");
  };
  const postgres = service("postgres", 54329, 5432);
  const oidc = service("oidc", 8090, 8080);
  assert.throws(() => verifyLocalCompose({ DOCKER_HOST: "tcp://remote", COMPOSE_PROJECT_NAME: "foreign" }, inspect([postgres, { ...oidc, Publishers: [{ URL: "0.0.0.0", PublishedPort: 8090, TargetPort: 8080 }] }])), /not verified/);
  assert.throws(() => verifyLocalCompose({}, inspect([postgres, { ...oidc, Labels: "com.docker.compose.project.config_files=C:\\other\\compose.yaml" }])), /not verified/);
  assert.doesNotThrow(() => verifyLocalCompose({}, inspect([postgres, oidc])));
});

test("real browser redirects: wrong target and partial failure block grant; retry keeps identities and closes sessions", async () => {
  let app, oidc, attack = "remote", grants = 0;
  const users = new Map();
  const sessions = new Map();
  const loginPage = `<h1>Demo prijava</h1><form method="post" action="/interaction/one/login">
    <button name="account" value="demo-student">Demo studentica</button>
    <button name="account" value="demo-student-2">Demo student 2</button>
    <button name="account" value="demo-teacher">Demo nastavnik</button></form>`;
  oidc = await serve(async (req, res) => {
    if (req.url === "/interaction/one") { res.writeHead(200, { "content-type": "text/html" }); res.end(loginPage); return; }
    if (req.url === "/interaction/one/login" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const id = new URLSearchParams(body).get("account");
      if (attack === "remote") return redirect(res, "https://outside.example/stolen");
      if (attack === "partial" && id === "demo-student-2") { res.writeHead(503); res.end("failure"); return; }
      return redirect(res, `${app}/api/auth/callback?account=${encodeURIComponent(attack === "swap" && id === "demo-teacher" ? "demo-student" : id)}`);
    }
    res.writeHead(404); res.end();
  });
  app = await serve((req, res) => {
    const url = new URL(req.url, app);
    if (url.pathname === "/api/auth/login") return redirect(res, `${oidc}/interaction/one`);
    if (url.pathname === "/api/auth/callback") {
      const id = url.searchParams.get("account");
      if (!users.has(id)) users.set(id, `user-${id}`);
      const token = randomBytes(32).toString("base64url");
      sessions.set(hash(token), { id, closed: false });
      return redirect(res, `${app}/`, `__Host-ductus_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    }
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const token = /__Host-ductus_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      if (token && sessions.has(hash(token))) sessions.get(hash(token)).closed = true;
      return redirect(res, `${app}/`, "__Host-ductus_session=; Path=/; HttpOnly; Secure; Max-Age=0");
    }
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>demo</h1>"); return; }
    res.writeHead(404); res.end();
  });
  const db = {
    async session(digest) {
        const record = sessions.get(digest.toString("hex"));
        return record ? [{
          user_id: users.get(record.id), institution_id: "institution-demo", expires_at: new Date(Date.now() + 60_000), closed_at: record.closed ? new Date() : null,
          close_reason: record.closed ? "logout" : null, oidc_issuer: oidc, oidc_subject: record.id,
          hr_edu_person_unique_id: `${record.id}@demo.ductus.test`, slug: attack === "tenant" && record.id === "demo-teacher" ? "demo-bez-prijave" : "demo-fakultet", aai_home_org: "demo.ductus.test",
        }] : [];
    },
    async institutions() { return [
        { slug: "demo-bez-prijave", aai_home_org: null }, { slug: "demo-fakultet", aai_home_org: "demo.ductus.test" },
      ]; },
    async roles() { return [{ count: grants ? 1 : 0 }]; },
  };
  const browser = await chromium.launch({ headless: true });
  const run = () => bootstrap({ browser, db, origins: [app, oidc], timeoutMs: 5_000, grant: () => { grants++; } });
  try {
    await assert.rejects(run());
    assert.equal(grants, 0);
    attack = "partial";
    await assert.rejects(run());
    assert.equal(grants, 0);
    assert.ok([...sessions.values()].every((session) => session.closed));
    attack = "swap";
    await assert.rejects(run());
    assert.equal(grants, 0);
    assert.ok([...sessions.values()].every((session) => session.closed));
    attack = "tenant";
    await assert.rejects(run());
    assert.equal(grants, 0);
    assert.ok([...sessions.values()].every((session) => session.closed));
    attack = "none";
    await run();
    await run();
    assert.equal(users.size, 3);
    assert.equal(grants, 2); // Existing operator is idempotent; each invocation is explicit.
    assert.ok([...sessions.values()].every((session) => session.closed));
  } finally { await browser.close(); }
});
