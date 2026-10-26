// DAN-324 (#799): the demo without Docker, for Windows 10 1803+ and 11.
//
//   pnpm demo:up:native [--prepare-only] [--no-demo-data]
//   pnpm demo:up:native --stop
//
// The same sequence as `pnpm demo:up` (runDemoLifecycle of ../up.mjs), with
// the Compose services replaced by native processes on loopback: PostgreSQL 17
// and rustfs (the pinned, hash-checked binaries of tools.mjs) and the fake
// OIDC provider under the Node of this run. Data lives in
// %LOCALAPPDATA%\Ductus\native-data, outside the repository. psql reaches the
// database only on its local socket (psql-target.mjs); dbmate and the app use
// 127.0.0.1:54329, as with Compose. Ctrl+C or the end of the run stops every
// service it started.
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDemoEnvironment, runDemoLifecycle } from "../up.mjs";
import { ductusHome, ensureTool, toolDir, windowsTar } from "./tools.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LOOPBACK_PRELOAD = new URL("./loopback.mjs", import.meta.url).href;
const PORTS = Object.freeze({ postgres: 54329, rustfs: 9100, oidc: 8090, app: 3000 });
const SUPERUSER_PASSWORD = "ductus-local-only"; // the Compose superuser's, compose.yaml
const DEMO_DATA_SCRIPT = "db/local/demo-k3.mjs";
const FLAGS = new Set(["--prepare-only", "--no-demo-data", "--stop"]);
// libpq, psql and dbmate read these; none may aim the run at another server or file.
const STEERING = /^(?:PG|PSQL|DBMATE_)/i;
const INTERRUPTED = 130;

export function parseArgs(argv) {
  for (const arg of argv) if (!FLAGS.has(arg)) throw new Error(`unknown argument ${arg}`);
  const stop = argv.includes("--stop");
  if (stop && argv.length !== 1) throw new Error("--stop takes no other argument");
  return { stop, prepareOnly: argv.includes("--prepare-only"), demoData: !argv.includes("--no-demo-data") };
}

export function layout(home) {
  const data = join(home, "native-data");
  return {
    data,
    pgdata: join(data, "postgres"),
    objects: join(data, "objects"),
    socket: join(data, "s"),
    logs: join(data, "logs"),
    run: join(data, "run.json"),
    psqlrc: join(data, "psqlrc"),
  };
}

/** Removes the libpq, psql and dbmate variables in place, so children that inherit process.env do not see them either. */
export function stripSteering(env) {
  for (const name of Object.keys(env)) if (STEERING.test(name)) delete env[name];
  return env;
}

/** The only psql target of this runner: the local socket, never TCP. */
export function psqlTarget(pgBin, socketDir, suffix = ".exe") {
  return { command: join(pgBin, `psql${suffix}`), args: ["-h", socketDir, "-p", String(PORTS.postgres), "-U", "ductus", "-d", "ductus"] };
}

const confString = (value) => `'${value.replaceAll("\\", "/").replaceAll("'", "''")}'`;

/** Rewritten before every start; postgresql.conf includes it. */
export function nativeConf(socketDir) {
  return [
    "listen_addresses = '127.0.0.1'",
    `port = ${PORTS.postgres}`,
    `unix_socket_directories = ${confString(socketDir)}`,
    // A failing statement is not copied into the log: auth-login.sql carries a password.
    "log_min_error_statement = panic",
    "",
  ].join("\n");
}

export function refusal(platform, env) {
  if (platform !== "win32") return "the native runner is for Windows; elsewhere use pnpm demo:up";
  if (env.NODE_ENV === "production") return "the demo is refused in production";
  return undefined;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
    socket.once("error", () => resolve(false));
  });
}

/** `stdin` is a file to pipe in, `input` a string. */
function run(command, args, { env, stdin, input, stdout = "inherit" } = {}) {
  return new Promise((resolve) => {
    const piped = stdin !== undefined || input !== undefined;
    const child = spawn(command, args, { cwd: ROOT, env, stdio: [piped ? "pipe" : "ignore", stdout, "inherit"], windowsHide: true });
    child.once("error", () => resolve(-1));
    child.once("exit", (code) => resolve(code ?? 1));
    if (input !== undefined) child.stdin.end(input);
    else if (stdin !== undefined) readFile(stdin).then((sql) => child.stdin.end(sql), () => child.stdin.destroy());
  });
}

async function waitFor(check, what, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${what} did not become ready`);
}

const httpStatus = (url) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) }).then((response) => response.status);

function killTree(platform, env, pid) {
  if (platform === "win32") {
    return run(join(env.SystemRoot, "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { stdout: "ignore" });
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
  return Promise.resolve(0);
}

/** "pid|name|start" lines into pid â†’ { image, start }; start is the UTC file time, or undefined when Windows withheld it. */
export function parseStarts(text) {
  const starts = new Map();
  for (const line of text.split(/\r?\n/)) {
    const row = /^(\d+)\|([^|]+)\|(\d*)$/.exec(line.trim());
    if (row) starts.set(Number(row[1]), { image: `${row[2].toLowerCase()}.exe`, start: row[3] || undefined });
  }
  return starts;
}

/** The image name and start time of each running pid; a pid that does not run is absent. */
function processStarts(env, pids) {
  const script = `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { $t = try { $_.StartTime.ToFileTimeUtc() } catch { '' }; '{0}|{1}|{2}' -f $_.Id, $_.ProcessName, $t }`;
  const shell = join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve) => {
    const child = spawn(shell, ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.once("error", () => resolve(new Map()));
    child.once("exit", () => resolve(parseStarts(out)));
  });
}

/** Before tools() is asked: the ports are free and the provider has its dependencies. */
async function startChecks() {
  for (const [name, port] of Object.entries(PORTS)) {
    if (await portInUse(port)) throw new Error(`port ${port} (${name}) is already in use; stop the other stack first (pnpm demo:up:native --stop or pnpm stack:down)`);
  }
  if (!existsSync(join(ROOT, "infra", "fake-oidc", "node_modules"))) {
    throw new Error("the fake OIDC provider has no dependencies; run pnpm --dir infra/fake-oidc install --frozen-lockfile");
  }
}

/**
 * The run: an environment, the tools and the stop of every service. Exported
 * with its platform and tools injectable, so a test can exercise it with
 * other binaries; the command line refuses anything but Windows.
 */
export function createNativeRun({
  env, home, platform = process.platform, tools, localeArgs = ["--locale=C", "--locale-provider=builtin", "--builtin-locale=C.UTF-8"], demoData = true,
  checks = startChecks, probe = platform === "win32" ? processStarts : async () => new Map(),
}) {
  const paths = layout(home);
  const suffix = platform === "win32" ? ".exe" : "";
  const services = [];
  let bin;
  let stopping;
  let startup;
  let interrupted = false;
  // run.json is this run's only when this run wrote it; a start refused on a busy port leaves the other run's.
  let wroteRun = false;

  /** After Ctrl+C nothing more is started; stop() waits for this step to give up. */
  const checkpoint = () => {
    if (interrupted) throw new Error("interrupted; nothing more is started");
  };

  const pg = (name) => join(bin.pgBin, `${name}${suffix}`);
  const target = () => psqlTarget(bin.pgBin, paths.socket, suffix);
  const psql = (file, vars = []) =>
    run(target().command, [...target().args, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...vars], { env, stdin: join(ROOT, file) });

  /** A service writes to its log in native-data\logs; the app writes to this console. */
  function startService(name, command, args, extraEnv, image, toConsole = false) {
    const log = toConsole ? "inherit" : openSync(join(paths.logs, `${name}.log`), "a");
    const child = spawn(command, args, { cwd: ROOT, env: { ...env, ...extraEnv }, stdio: ["ignore", log, log], windowsHide: true });
    if (!toConsole) closeSync(log);
    const service = { name, child, image, exited: false };
    child.once("exit", () => (service.exited = true));
    child.once("error", () => (service.exited = true));
    services.push(service);
    return service;
  }

  async function initPostgres() {
    if (existsSync(join(paths.pgdata, "PG_VERSION"))) return;
    const staging = `${paths.pgdata}.init`;
    const pwfile = join(paths.data, "initdb.pw");
    await rm(staging, { recursive: true, force: true });
    await writeFile(pwfile, `${SUPERUSER_PASSWORD}\n`, { mode: 0o600 });
    const code = await run(pg("initdb"), [
      "-D", staging, "-U", "ductus", `--pwfile=${pwfile}`, "--auth-host=scram-sha-256", "--auth-local=trust", "-E", "UTF8", ...localeArgs,
    ], { env, stdout: "ignore" }).finally(() => rm(pwfile, { force: true }));
    if (code !== 0) throw new Error("initdb failed");
    await writeFile(join(staging, "postgresql.conf"), "\ninclude 'ductus-native.conf'\n", { flag: "a" });
    await rename(staging, paths.pgdata);
  }

  async function stackUp() {
    await checks();
    bin = await tools();
    checkpoint();
    for (const dir of [paths.data, paths.objects, paths.socket, paths.logs]) await mkdir(dir, { recursive: true });
    await writeFile(paths.psqlrc, "");
    await initPostgres();
    checkpoint();
    await writeFile(join(paths.pgdata, "ductus-native.conf"), nativeConf(paths.socket));
    if ((await run(pg("pg_ctl"), ["start", "-D", paths.pgdata, "-l", join(paths.logs, "postgres.log"), "-w", "-t", "120"], { env, stdout: "ignore" })) !== 0) {
      throw new Error(`PostgreSQL did not start; see ${join(paths.logs, "postgres.log")}`);
    }
    services.push({ name: "postgres" });
    // The database Compose makes from POSTGRES_DB; on the maintenance database, on the socket.
    const maintenance = [...target().args.slice(0, -1), "postgres"];
    const made = await run(target().command, [...maintenance, "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
      env,
      stdout: "ignore",
      input: "SELECT 'CREATE DATABASE ductus' WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'ductus') \\gexec\n",
    });
    if (made !== 0) throw new Error("the ductus database could not be made");
    checkpoint();

    startService("rustfs", bin.rustfs, ["server", "--address", `127.0.0.1:${PORTS.rustfs}`, paths.objects], {
      RUSTFS_ACCESS_KEY: env.S3_ACCESS_KEY_ID,
      RUSTFS_SECRET_KEY: env.S3_SECRET_ACCESS_KEY,
      RUSTFS_CONSOLE_ENABLE: "false",
    }, "rustfs.exe");
    // An anonymous request is refused: the store answers, and it is not open.
    await waitFor(async () => (await httpStatus(`http://127.0.0.1:${PORTS.rustfs}/`)) === 403, "rustfs");
    checkpoint();

    startService("oidc", process.execPath, ["--import", LOOPBACK_PRELOAD, join(ROOT, "infra", "fake-oidc", "server.mjs")], {
      PORT: String(PORTS.oidc),
      ISSUER: env.OIDC_ISSUER,
      NODE_ENV: "development",
    }, "node.exe");
    await waitFor(async () => (await httpStatus(`http://127.0.0.1:${PORTS.oidc}/.well-known/openid-configuration`)) === 200, "the fake OIDC provider");

    // With each start time: --stop kills a pid only while it is still the process recorded here.
    const recorded = [{ name: "runner", pid: process.pid, image: "node.exe" }, ...services.filter((service) => service.child).map(({ name, child, image }) => ({ name, pid: child.pid, image }))];
    const starts = await probe(env, recorded.map(({ pid }) => pid));
    const [runner, ...rest] = recorded.map((entry) => ({ ...entry, start: starts.get(entry.pid)?.start }));
    await writeFile(paths.run, JSON.stringify({ runner, services: rest }));
    wroteRun = true;
  }

  async function migrate() {
    if ((await psql("db/local/migrator.sql")) !== 0) return 1;
    const url = `postgres://ductus:${SUPERUSER_PASSWORD}@127.0.0.1:${PORTS.postgres}/ductus?sslmode=disable&role=ductus_migrator`;
    const dbmate = join(ROOT, "node_modules", "dbmate", "dist", "cli.js");
    if ((await run(process.execPath, [dbmate, "--url", url, "--no-dump-schema", "--wait", "up"], { env })) !== 0) return 1;
    if ((await psql("db/local/app-login.sql")) !== 0) return 1;
    // One argv element, never a shell; the statement is not logged (nativeConf).
    return psql("db/local/auth-login.sql", ["-v", `auth_password=${env.DUCTUS_AUTH_LOCAL_PASSWORD}`]);
  }

  function dev(appEnv) {
    const next = join(ROOT, "node_modules", "next", "dist", "bin", "next");
    const app = startService("app", process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", String(PORTS.app)], { ...appEnv, NEXT_TELEMETRY_DISABLED: "1" }, "node.exe", true);
    console.log(`Ductus: http://localhost:${PORTS.app} (Ctrl+C stops the app and every service).`);
    return new Promise((resolve) => {
      if (app.exited) resolve(1);
      app.child.once("exit", (code) => resolve(code ?? 1));
      app.child.once("error", () => resolve(1));
    });
  }

  async function runScript(script, scriptEnv) {
    if (interrupted) return INTERRUPTED;
    try {
      if (script === "stack:up") return await (startup = stackUp()), 0;
      if (script === "db:migrate") return await migrate();
      if (script === "db:seed") return await psql("db/local/seed.sql");
      if (script === "dev") return await dev(scriptEnv);
      throw new Error(`no native step for ${script}`);
    } catch (error) {
      console.error(error.message);
      return 1;
    }
  }

  async function runNode(script, nodeEnv) {
    if (interrupted) return { code: INTERRUPTED, stdout: "" };
    if (script === DEMO_DATA_SCRIPT && !demoData) return { code: 0, stdout: "" };
    try {
      const { main } = await import(pathToFileURL(join(ROOT, script)).href);
      const result = await main(nodeEnv, [], target());
      return { code: 0, stdout: typeof result === "string" ? `${result}\n` : "" };
    } catch (error) {
      console.error(error instanceof Error ? error.message : "failed");
      return { code: 1, stdout: "" };
    }
  }

  /** Stops the app, the provider, the store and PostgreSQL; once, whoever asks first. */
  function stop() {
    stopping ??= (async () => {
      // A start under way finishes or gives up first, so every service it began is in the list.
      await startup?.catch(() => {});
      for (const service of [...services].reverse()) {
        if (service.name === "postgres") {
          await run(pg("pg_ctl"), ["stop", "-D", paths.pgdata, "-m", "fast", "-w"], { env, stdout: "ignore" });
        } else if (!service.exited) {
          await killTree(platform, env, service.child.pid);
        }
      }
      if (wroteRun) await rm(paths.run, { force: true });
    })();
    return stopping;
  }

  function interrupt() {
    interrupted = true;
    return stop();
  }

  return { env, paths, runScript, runNode, stop, interrupt };
}

/**
 * --stop: PostgreSQL first, then what run.json names. A pid is killed only while
 * its image name and start time are the recorded ones: after a restart Windows
 * reuses pids, and a record without a start time is never trusted.
 */
export async function stopRecorded(env, home, { probe = processStarts, kill = (pid) => killTree("win32", env, pid) } = {}) {
  const paths = layout(home);
  const pgCtl = join(toolDir(home, "postgres"), "bin", "pg_ctl.exe");
  if (existsSync(join(paths.pgdata, "postmaster.pid")) && existsSync(pgCtl)) {
    await run(pgCtl, ["stop", "-D", paths.pgdata, "-m", "fast", "-w"], { env, stdout: "ignore" });
  }
  let recorded;
  try {
    recorded = JSON.parse(await readFile(paths.run, "utf8"));
  } catch {
    recorded = { services: [] };
  }
  const entries = [recorded.runner, ...(recorded.services ?? []).reverse()]
    .filter((entry) => entry && Number.isInteger(entry.pid) && entry.pid !== process.pid);
  const running = entries.length > 0 ? await probe(env, entries.map(({ pid }) => pid)) : new Map();
  for (const { name, pid, image, start } of entries) {
    const now = running.get(pid);
    if (now === undefined) continue;
    if (now.image !== image || typeof start !== "string" || now.start !== start) {
      console.error(`pid ${pid} (${name}) is not the process this demo started; it is left alone`);
      continue;
    }
    await kill(pid);
  }
  await rm(paths.run, { force: true });
  console.log("The native demo services are stopped.");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const refused = refusal(process.platform, process.env);
    if (refused) throw new Error(refused);
  } catch (error) {
    console.error(`Native demo refused: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const home = ductusHome(process.env);
  if (options.stop) return stopRecorded(process.env, home);

  stripSteering(process.env);
  let env;
  try {
    env = createDemoEnvironment(process.env);
  } catch (error) {
    console.error(`Native demo refused: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  // psql reads no startup file: the db/local scripts spawn it with the inherited environment.
  process.env.PSQLRC = env.PSQLRC = layout(home).psqlrc;

  const tar = windowsTar(process.env);
  const tools = async () => {
    const postgres = await ensureTool("postgres", { home, tar });
    const rustfs = await ensureTool("rustfs", { home, tar });
    return { pgBin: join(postgres, "bin"), rustfs: join(rustfs, "rustfs.exe") };
  };
  const nativeRun = createNativeRun({ env, home, tools, demoData: options.demoData });
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
    process.on(signal, () => {
      process.exitCode = INTERRUPTED;
      nativeRun.interrupt();
    });
  }

  console.log(options.prepareOnly
    ? "Preparing the native Ductus demo: PostgreSQL, rustfs, fake OIDC, migrations, synthetic institutions, evidence key and storage."
    : "Starting the native Ductus demo: PostgreSQL, rustfs, fake OIDC, migrations, synthetic data and the app.");
  console.log("A local auth password is generated for this run and is not written to disk or printed.");
  try {
    const code = await runDemoLifecycle(env, nativeRun.runScript, !options.prepareOnly, nativeRun.runNode);
    if (code !== 0 && process.exitCode === undefined) process.exitCode = code;
  } finally {
    await nativeRun.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Native demo failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
