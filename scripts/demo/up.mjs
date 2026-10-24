import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const APP_DATABASE_USER = "ductus_app_local";
const APP_DATABASE_PASSWORD = "ductus-app-local-only";
const AUTH_DATABASE_USER = "ductus_auth_local";
const EXAMPLE_AUTH_PASSWORD = "<DUCTUS_AUTH_LOCAL_PASSWORD>";
const EVIDENCE_KEY_SCRIPT = "db/local/evidence-signing-key.mjs";
const EVIDENCE_STORAGE_SCRIPT = "db/local/evidence-storage-domain.mjs";
const DEMO_DATA_SCRIPT = "db/local/demo-k3.mjs";
const STORAGE_DOMAINS_VAR = "EVIDENCE_STORAGE_DOMAINS";
// The evidence scripts reach Postgres through docker, not through the database URLs checked below,
// so these variables could aim them at a non-local daemon or container (F-100).
const DOCKER_TARGET_VARS = ["DUCTUS_PSQL_CONTAINER", "DOCKER_HOST", "DOCKER_CONTEXT"];
let activeChild;
let stopSignal;

function localDatabaseUrl(name, value, username) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must point to the local Compose database.`);
  }

  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !LOCAL_HOSTS.has(url.hostname)
    || url.port !== "54329"
    || url.pathname !== "/ductus"
    || url.search !== ""
    || url.hash !== ""
    || decodeURIComponent(url.username) !== username
  ) {
    throw new Error(`${name} must use the local ductus database on 127.0.0.1:54329 as ${username}.`);
  }
  return url;
}

// Every other DOCKER_* and COMPOSE_* variable (COMPOSE_FILE, COMPOSE_PROJECT_NAME, DOCKER_CONFIG,
// DOCKER_TLS_VERIFY, ...) can also steer `docker compose exec` of the evidence scripts, so the
// children never receive them (F-101). Names compare case-insensitively: Windows does.
const DOCKER_STEERING = /^(?:DOCKER_|COMPOSE_)/i;
function withoutDockerSteering(source) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !DOCKER_STEERING.test(name)));
}

export function createDemoEnvironment(source = process.env) {
  for (const name of DOCKER_TARGET_VARS) {
    if (source[name]) {
      throw new Error(`${name} must be unset for the demo: the evidence setup must reach the local Compose database only.`);
    }
  }
  const appUrl = localDatabaseUrl(
    "APP_DATABASE_URL",
    source.APP_DATABASE_URL ?? "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus",
    APP_DATABASE_USER,
  );
  if (decodeURIComponent(appUrl.password) !== APP_DATABASE_PASSWORD) {
    throw new Error("APP_DATABASE_URL must use the local Compose app credentials.");
  }
  const authUrl = localDatabaseUrl(
    "AUTH_DATABASE_URL",
    source.AUTH_DATABASE_URL ?? "postgres://ductus_auth_local@127.0.0.1:54329/ductus",
    AUTH_DATABASE_USER,
  );

  const configuredPassword = source.DUCTUS_AUTH_LOCAL_PASSWORD;
  const parsedUrlPassword = decodeURIComponent(authUrl.password);
  const urlPassword = parsedUrlPassword === EXAMPLE_AUTH_PASSWORD ? "" : parsedUrlPassword;
  if (configuredPassword && urlPassword && configuredPassword !== urlPassword) {
    throw new Error("AUTH_DATABASE_URL and DUCTUS_AUTH_LOCAL_PASSWORD do not match.");
  }

  const authPassword = configuredPassword || urlPassword || randomBytes(32).toString("base64url");
  if (authPassword.length < 16) {
    throw new Error("DUCTUS_AUTH_LOCAL_PASSWORD must be at least 16 characters.");
  }
  if (authPassword.includes("%")) {
    // A percent sign is not round-tripped between the URL and the role password
    // (the URL setter keeps it, pg decodes it), so setup would succeed and sign-in fail.
    throw new Error("DUCTUS_AUTH_LOCAL_PASSWORD and the AUTH_DATABASE_URL password must not contain a percent sign.");
  }
  authUrl.password = authPassword;

  // The development signing seed lives outside the repository, in the home
  // directory, so every run (and every checkout) finds the same key. An
  // absolute path set by the operator wins; the signer refuses one inside the repository.
  const configuredSeed = source.DUCTUS_DEV_SIGNING_KEY_FILE;
  if (configuredSeed && !isAbsolute(configuredSeed)) {
    throw new Error("DUCTUS_DEV_SIGNING_KEY_FILE must be an absolute path.");
  }
  const seedFile = configuredSeed || join(homedir(), ".ductus", "demo-evidence-signing.seed");

  return {
    ...withoutDockerSteering(source),
    DATABASE_URL: "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
    APP_DATABASE_URL: appUrl.href,
    AUTH_DATABASE_URL: authUrl.href,
    DUCTUS_AUTH_LOCAL_PASSWORD: authPassword,
    S3_ENDPOINT: "http://127.0.0.1:9100",
    S3_ACCESS_KEY_ID: "ductus-local",
    S3_SECRET_ACCESS_KEY: "ductus-local-only",
    EVIDENCE_S3_LOCAL_KEY_ID: "ductus-local",
    EVIDENCE_S3_LOCAL_SECRET: "ductus-local-only",
    DUCTUS_DEV_SIGNING_KEY_FILE: seedFile,
    MAILPIT_URL: "http://127.0.0.1:8025",
    SMTP_URL: "smtp://127.0.0.1:1025",
    NODE_ENV: "development",
    DUCTUS_AUTH_PROVIDER: "fake-oidc",
    OIDC_ISSUER: "http://localhost:8090",
    OIDC_REDIRECT_URI: "http://localhost:3000/api/auth/callback",
    OIDC_CLIENT_ID: "ductus-local",
    OIDC_CLIENT_SECRET: "ductus-local-only",
  };
}

export function pnpmInvocation(env, script, platform = process.platform, nodeExecutable = process.execPath) {
  if (typeof env.npm_execpath === "string" && env.npm_execpath.length > 0) {
    return { command: nodeExecutable, args: [env.npm_execpath, script] };
  }
  if (platform === "win32") {
    throw new Error("Run the demo through pnpm so its CLI can be started without a shell.");
  }
  return { command: "pnpm", args: [script] };
}

function forwardSignal(signal) {
  stopSignal ??= signal;
  try {
    activeChild?.kill(signal);
  } catch {
    activeChild?.kill();
  }
}

function runPnpm(script, env) {
  if (stopSignal) return Promise.resolve(stopSignal === "SIGINT" ? 130 : 143);

  let invocation;
  try {
    invocation = pnpmInvocation(env, script);
  } catch (error) {
    console.error(error.message);
    return Promise.resolve(1);
  }

  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    activeChild = child;
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (activeChild === child) activeChild = undefined;
      resolve(stopSignal ? (stopSignal === "SIGINT" ? 130 : 143) : (code ?? 1));
    };

    child.once("error", () => {
      console.error(`Could not start pnpm ${script}.`);
      finish(1);
    });
    child.once("exit", (code) => finish(code));
  });
}

/** Run a local Node script (the db/local evidence scripts) and capture its stdout. */
function runNodeCapture(script, env) {
  if (stopSignal) return Promise.resolve({ code: stopSignal === "SIGINT" ? 130 : 143, stdout: "" });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    activeChild = child;
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (activeChild === child) activeChild = undefined;
      resolve({ code: stopSignal ? (stopSignal === "SIGINT" ? 130 : 143) : (code ?? 1), stdout });
    };
    child.once("error", () => {
      console.error(`Could not start ${script}.`);
      finish(1);
    });
    child.once("exit", (code) => finish(code));
  });
}

/** The one EVIDENCE_STORAGE_DOMAINS line the storage script prints, or undefined. */
export function parseStorageDomainsLine(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length !== 1 || !lines[0].startsWith(`${STORAGE_DOMAINS_VAR}=`)) return undefined;
  const value = lines[0].slice(STORAGE_DOMAINS_VAR.length + 1);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed?.domains) && parsed.domains.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run the shared clean-runner preparation sequence; CI omits only the dev
 * server. After the seed, the evidence signing key and the storage domain of
 * the demo institution are registered (both idempotent), and the storage
 * configuration goes to the app through its environment, never to disk.
 */
export async function runDemoLifecycle(env, runScript = runPnpm, includeApp = true, runNode = runNodeCapture) {
  for (const script of ["stack:up", "db:migrate", "db:seed"]) {
    const code = await runScript(script, env);
    if (code !== 0) return code;
  }

  const key = await runNode(EVIDENCE_KEY_SCRIPT, env);
  if (key.code !== 0) return key.code;
  const storage = await runNode(EVIDENCE_STORAGE_SCRIPT, env);
  if (storage.code !== 0) return storage.code;
  const domains = parseStorageDomainsLine(storage.stdout);
  if (domains === undefined) {
    console.error("The evidence storage script did not print a usable storage configuration.");
    return 1;
  }
  const appEnv = { ...env, [STORAGE_DOMAINS_VAR]: domains };
  if (!includeApp) return 0;

  // K-3 course, assignment and enrolment (#635): demo:up only, because the CI
  // E2E tests after demo:prepare start from an unconfirmed teacher.
  const k3 = await runNode(DEMO_DATA_SCRIPT, env);
  if (k3.code !== 0) return k3.code;
  return runScript("dev", appEnv);
}
async function startDemo(env, prepareOnly) {
  console.log(prepareOnly
    ? "Preparing the local Ductus demo stack, migrations, synthetic institutions, evidence key and storage."
    : "Starting the local Ductus demo stack, migrations, synthetic institutions, evidence key and storage, K-3 course and enrolment, and app.");
  console.log("A local auth password is generated for this run and is not written to disk or printed.");
  const code = await runDemoLifecycle(env, runPnpm, !prepareOnly);
  if (code !== 0) process.exitCode = code;
}

async function main() {
  let env;
  try {
    env = createDemoEnvironment();
  } catch (error) {
    console.error(`Demo setup refused: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  await startDemo(env, process.argv.includes("--prepare-only"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Demo setup failed.");
    process.exitCode = 1;
  });
}
