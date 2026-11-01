// DAN-88 K-3b1: explicit local/CI operator command after demo:prepare and app startup.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const APP = "http://localhost:3000";
const OIDC = "http://localhost:8090";
const ISSUER = OIDC;
const HOME_ORG = "demo.ductus.test";
const INSTITUTION = "demo-fakultet";
const ACCOUNTS = [
  { id: "demo-student", name: "Demo studentica" },
  { id: "demo-student-2", name: "Demo student 2" },
  { id: "demo-teacher", name: "Demo nastavnik" },
  { id: "demo-teacher-2", name: "Demo nastavnica" },
];
// Both teachers get the explicit operator grant; the students never do.
const TEACHERS = ["demo-teacher", "demo-teacher-2"];
const SESSION_COOKIE = "__Host-ductus_session";
const root = fileURLToPath(new URL("../../", import.meta.url));
const SESSION_SQL = `SELECT s.user_id, s.institution_id, s.closed_at, s.close_reason, s.expires_at,
  u.oidc_issuer, u.oidc_subject, u.hr_edu_person_unique_id,
  i.slug, i.aai_home_org
  FROM identity.session s
  JOIN identity.user_account u ON u.id = s.user_id AND u.institution_id = s.institution_id
  JOIN identity.institution i ON i.id = s.institution_id
  WHERE s.token_hash = decode('%HASH%', 'hex')`;

function fail(message) { throw new Error(message); }

export function assertLocalUrl(value, origins = [APP, OIDC]) {
  let url;
  try { url = new URL(value); } catch { fail("Unexpected demo URL."); }
  if (url.protocol !== "http:" || url.hostname !== "localhost" || !origins.includes(url.origin) ||
      url.username || url.password || url.hash) {
    fail("Demo request left the two fixed localhost origins.");
  }
  return url;
}

export async function localResponse(url, fetcher = fetch, origins = [APP, OIDC]) {
  assertLocalUrl(url, origins);
  const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (response.status >= 300 && response.status < 400) {
    // No fetch redirect is followed implicitly, including a local open redirect.
    const location = response.headers.get("location");
    if (!location) fail("Demo redirect has no destination.");
    assertLocalUrl(new URL(location, url).href, origins);
  }
  return response;
}

function cleanDockerEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^(?:DOCKER_|COMPOSE_)/i.test(key)));
}

function dockerRead(args, env, input) {
  const result = spawnSync("docker", ["--context", "default", ...args], {
    cwd: root, env, input, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("Local Compose prerequisite unavailable.");
  return result.stdout.trim();
}

function localDatabase(env) {
  const query = (sql) => {
    const output = dockerRead([
      "compose", "-f", "compose.yaml", "-p", "ductus", "exec", "-T", "postgres",
      "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "ductus", "-d", "ductus",
    ], env, `SELECT coalesce(json_agg(row_to_json(q)), '[]'::json) FROM (${sql}) q;\n`);
    return JSON.parse(output);
  };
  return {
    session(digest) {
      if (!Buffer.isBuffer(digest) || digest.length !== 32) fail("Invalid session digest.");
      return query(SESSION_SQL.replace("%HASH%", digest.toString("hex")));
    },
    institutions() {
      return query("SELECT slug, aai_home_org FROM identity.institution WHERE slug IN ('demo-fakultet', 'demo-bez-prijave') ORDER BY slug");
    },
    roles(userId, institutionId) {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuid.test(userId) || !uuid.test(institutionId)) fail("Invalid local identity identifier.");
      return query(`SELECT count(*)::int AS count FROM institution.institution_role
        WHERE user_id = '${userId}' AND institution_id = '${institutionId}'
          AND role = 'teacher' AND confirmed_at IS NOT NULL AND revoked_at IS NULL`);
    },
  };
}

export function verifyLocalCompose(source = process.env, read = dockerRead) {
  if (source.NODE_ENV === "production") fail("Demo bootstrap is unavailable in production.");
  const env = cleanDockerEnvironment(source);
  const endpoint = JSON.parse(read(["context", "inspect", "default", "--format", "{{json .Endpoints.docker.Host}}"], env));
  if (!["npipe:////./pipe/docker_engine", "unix:///var/run/docker.sock"].includes(endpoint)) {
    fail("Docker default context is not the local engine.");
  }
  const lines = read(["compose", "-f", "compose.yaml", "-p", "ductus", "ps", "--format", "json"], env);
  const services = lines.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  for (const [name, published, target] of [["postgres", 54329, 5432], ["oidc", 8090, 8080]]) {
    const service = services.find((entry) => entry.Service === name);
    const binding = service?.Publishers?.find((entry) => entry.PublishedPort === published && entry.TargetPort === target && entry.URL === "127.0.0.1");
    const labels = String(service?.Labels ?? "").toLowerCase();
    const ownCompose = `com.docker.compose.project.config_files=${root}compose.yaml`.toLowerCase();
    if (service?.Project !== "ductus" || service.State !== "running" || service.Health !== "healthy" ||
        !binding || !labels.includes(ownCompose)) {
      fail("The local demo Compose services are not verified.");
    }
  }
  return env;
}

function verifySession(row, account, issuer = ISSUER) {
  if (!row || row.closed_at || !row.expires_at || new Date(row.expires_at) <= new Date() ||
      row.oidc_issuer !== issuer || row.oidc_subject !== account.id ||
      row.hr_edu_person_unique_id !== `${account.id}@${HOME_ORG}` ||
      row.slug !== INSTITUTION || row.aai_home_org !== HOME_ORG || !row.user_id || !row.institution_id) {
    fail("Demo session identity or institution did not match the fixed account.");
  }
}

export async function signInAccount(browser, db, account, origins = [APP, OIDC], timeoutMs = 60_000) {
  let stage = "context";
  const context = await browser.newContext({ serviceWorkers: "block" });
  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(timeoutMs);
  const state = { context, tokenHash: null, account, closed: false, blocked: false };
  try {
    const page = await context.newPage();
    await context.route("**/*", (route) => {
      try {
        assertLocalUrl(route.request().url(), origins);
        // Only this frame has the per-hop guard; do not start unguarded targets.
        if (route.request().frame() !== page.mainFrame()) fail("Unexpected demo frame.");
      } catch { state.blocked = true; return route.abort(); }
      return route.continue();
    });
    // Playwright routes only the first URL of a redirect chain. Chromium Fetch
    // pauses every hop before HTTP is sent, including redirects back to the app.
    const network = await context.newCDPSession(page);
    network.on("Fetch.requestPaused", ({ requestId, request }) => {
      let allowed = true;
      try { assertLocalUrl(request.url, origins); }
      catch { state.blocked = true; allowed = false; }
      void network.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
        requestId, ...(allowed ? {} : { errorReason: "BlockedByClient" }),
      }).catch(() => { state.blocked = true; });
    });
    await network.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    let callbacks = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/auth/callback" && new URL(request.url()).origin === origins[0]) callbacks++;
    });
    stage = "OIDC navigation";
    await page.goto(`${origins[0]}/api/auth/login?returnTo=%2F`, { waitUntil: "domcontentloaded" });
    const interaction = assertLocalUrl(page.url(), origins);
    if (interaction.origin !== origins[1] || !/^\/interaction\/[^/]+$/.test(interaction.pathname)) fail("Unexpected OIDC interaction.");
    const names = await page.locator('button[name="account"]').allTextContents();
    if (names.length !== ACCOUNTS.length || ACCOUNTS.some((entry) => !names.includes(entry.name))) fail("Unexpected fake-OIDC account chooser.");
    stage = "OIDC callback";
    await page.getByRole("button", { name: account.name, exact: true }).click();
    await page.waitForURL(`${origins[0]}/`);
    if (state.blocked || callbacks !== 1) fail("Login did not complete one local OIDC callback.");
    stage = "session cookie";
    const cookies = await context.cookies(origins[0]);
    const token = cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail("Missing valid demo session cookie.");
    state.tokenHash = createHash("sha256").update(token).digest();
    stage = "session database check";
    const rows = await db.session(state.tokenHash);
    if (rows.length !== 1) fail("Demo session was not found in the local database.");
    verifySession(rows[0], account, origins[1]);
    state.userId = rows[0].user_id;
    state.institutionId = rows[0].institution_id;
    return state;
  } catch (error) {
    try { await closeSession(state, db, origins); }
    catch { throw new Error(`Demo login failed at ${stage}; session logout also failed.`, { cause: error }); }
    throw new Error(`Demo login failed at ${stage}.`, { cause: error });
  }
}

/**
 * Where a demo logout may send the browser: home, or the fake provider's
 * end_session with exactly the client and the home page as the way back
 * (DAN-212, RP-initiated logout).
 */
export function isLogoutLocation(location, origins = [APP, OIDC]) {
  if (location === `${origins[0]}/`) return true;
  let url;
  try { url = new URL(location ?? ""); } catch { return false; }
  const params = [...url.searchParams];
  return url.origin === origins[1] && url.pathname === "/session/end" && !url.hash && params.length === 2 &&
    url.searchParams.get("post_logout_redirect_uri") === `${origins[0]}/` && url.searchParams.get("client_id") === "ductus-local";
}

export async function closeSession(state, db, origins = [APP, OIDC]) {
  if (state.closed) return;
  try {
    // A callback can issue a session just before navigation or DB validation fails.
    // Recover it from this isolated context so partial failures still log out.
    if (!state.tokenHash) {
      const token = (await state.context.cookies(origins[0])).find((cookie) => cookie.name === SESSION_COOKIE)?.value;
      if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) state.tokenHash = createHash("sha256").update(token).digest();
    }
    if (state.tokenHash) {
      const response = await state.context.request.post(`${origins[0]}/api/auth/logout`, {
        headers: { origin: origins[0] }, maxRedirects: 0, timeout: 10_000,
      });
      if (response.status() !== 303 || !isLogoutLocation(response.headers().location, origins)) fail("Demo logout failed.");
      const rows = await db.session(state.tokenHash);
      if (rows.length !== 1 || !rows[0].closed_at || rows[0].close_reason !== "logout") fail("Demo session remains open after logout.");
    }
    state.closed = true;
  } finally {
    await state.context.close();
  }
}

export async function bootstrap({ browser, db, grant, origins = [APP, OIDC], timeoutMs = 60_000 }) {
  const sessions = [];
  let failure;
  try {
    for (const account of ACCOUNTS) sessions.push(await signInAccount(browser, db, account, origins, timeoutMs));
    if (new Set(sessions.map((s) => s.userId)).size !== ACCOUNTS.length) fail("Demo accounts resolved to the same identity.");
    const institutions = await db.institutions();
    if (institutions.length !== 2 || institutions[0].slug !== "demo-bez-prijave" || institutions[0].aai_home_org !== null ||
        institutions[1].slug !== INSTITUTION || institutions[1].aai_home_org !== HOME_ORG) fail("Demo institution seed is incomplete.");
    if (sessions.some((session) => session.blocked)) fail("Demo request left its guarded login context.");
    for (const id of TEACHERS) {
      await grant(id);
      const teacher = sessions.find((session) => session.account.id === id);
      const roles = await db.roles(teacher.userId, teacher.institutionId);
      if (roles[0]?.count !== 1) fail("Synthetic teacher grant was not unique and confirmed.");
    }
  } catch (error) { failure = error; }
  let cleanupFailed = false;
  for (const session of sessions) {
    try { await closeSession(session, db, origins); }
    catch (error) { cleanupFailed = true; failure ??= error; }
  }
  if (cleanupFailed) fail("Demo session logout failed; inspect local sessions before retry.");
  if (failure) throw failure;
}

async function main() {
  const env = verifyLocalCompose();
  const discovery = await localResponse(`${OIDC}/.well-known/openid-configuration`);
  if (discovery.status !== 200 || (await discovery.json()).issuer !== ISSUER) fail("Unexpected local OIDC issuer.");
  const login = await localResponse(`${APP}/api/auth/login?returnTo=%2F`);
  if (login.status !== 303 || new URL(login.headers.get("location")).origin !== OIDC) fail("App is not configured for local fake OIDC.");
  const db = localDatabase(env);
  const browser = await chromium.launch({ headless: true });
  try {
    await bootstrap({ browser, db, grant: (id) => {
      const args = id === "demo-teacher" ? [] : [id];
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("./provision-teacher.mjs", import.meta.url)), ...args], {
        cwd: root, env: { ...env, DOCKER_CONTEXT: "default" }, encoding: "utf8", timeout: 30_000, windowsHide: true,
      });
      if (result.error || result.status !== 0) fail("Local teacher operator grant failed.");
    } });
    console.log("Four local demo identities verified; both teachers confirmed; sessions closed.");
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error && /^Demo login failed at /.test(error.message) ? error.message : "Demo account bootstrap failed; inspect local prerequisites and retry.");
    process.exitCode = 1;
  });
}
