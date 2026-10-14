import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const APP_DATABASE_USER = "ductus_app_local";
const APP_DATABASE_PASSWORD = "ductus-app-local-only";
const AUTH_DATABASE_USER = "ductus_auth_local";
const EXAMPLE_AUTH_PASSWORD = "<DUCTUS_AUTH_LOCAL_PASSWORD>";
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
    || decodeURIComponent(url.username) !== username
  ) {
    throw new Error(`${name} must use the local ductus database on 127.0.0.1:54329 as ${username}.`);
  }
  return url;
}

export function createDemoEnvironment(source = process.env) {
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
  authUrl.password = authPassword;

  return {
    ...source,
    DATABASE_URL: "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
    APP_DATABASE_URL: appUrl.href,
    AUTH_DATABASE_URL: authUrl.href,
    DUCTUS_AUTH_LOCAL_PASSWORD: authPassword,
    S3_ENDPOINT: "http://127.0.0.1:9100",
    S3_ACCESS_KEY_ID: "ductus-local",
    S3_SECRET_ACCESS_KEY: "ductus-local-only",
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

/** Run the shared clean-runner preparation sequence; CI omits only the dev server. */
export async function runDemoLifecycle(env, runScript = runPnpm, includeApp = true) {
  const scripts = includeApp
    ? ["stack:up", "db:migrate", "db:seed", "dev"]
    : ["stack:up", "db:migrate", "db:seed"];
  for (const script of scripts) {
    const code = await runScript(script, env);
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

async function startDemo(env, prepareOnly) {
  console.log(prepareOnly
    ? "Preparing the local Ductus demo stack, migrations, and synthetic institutions."
    : "Starting the local Ductus demo stack, migrations, synthetic institutions, and app.");
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
