// DAN-324 (#799): `pnpm demo:up:native` brings up the local demo on Windows
// without Docker. It reuses createDemoEnvironment and runDemoLifecycle of
// scripts/demo/up.mjs, which stays unchanged, and gives them native steps:
// PostgreSQL 17 and rustfs from the pinned binaries of tools.mjs, the fake
// OIDC server under node, each on 127.0.0.1 only, and every db/local SQL file
// through psql on the local socket, so their socket-only guards still hold.
//
//   pnpm demo:up:native [--prepare-only]    (Ctrl+C stops the app and services)
//   pnpm demo:up:native --stop              (stops services a --prepare-only left)
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDemoEnvironment, pnpmInvocation, runDemoLifecycle } from "../up.mjs";
import { MANIFEST, ensureTool, portInUse, run, startService, waitFor, windowsTar } from "./tools.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OIDC_DIR = join(ROOT, "infra", "fake-oidc");
const PRELOAD = pathToFileURL(fileURLToPath(new URL("./loopback-listen.mjs", import.meta.url))).href;
export const PORTS = Object.freeze({ postgres: 54329, rustfs: 9100, oidc: 8090, app: 3000 });
const FLAGS = new Set(["--prepare-only", "--stop", "--allow-non-windows"]);
const MIGRATOR_URL = "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus?sslmode=disable&role=ductus_migrator";
// initdb makes only the postgres database; Compose's image also makes ductus.
// Like the db/local SQL, it is made only on the local socket.
export const CREATE_DATABASE_SQL = `SELECT pg_catalog.inet_server_addr() IS NULL AS local_socket,
  NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = 'ductus') AS missing \\gset
\\if :local_socket
\\if :missing
CREATE DATABASE ductus;
\\endif
\\else
DO $$ BEGIN RAISE EXCEPTION 'only the local socket is accepted'; END $$;
\\endif
`;
// Services get none of the demo's credentials or database steering; each gets only its own values.
const NOT_FOR_SERVICES = /^(?:PG|RUSTFS_|S3_|EVIDENCE_|AWS_|DBMATE_|OIDC_|DUCTUS_)|^(?:APP_|AUTH_)?DATABASE_URL$/i;

export function serviceEnv(env, own = {}) {
  return { ...Object.fromEntries(Object.entries(env).filter(([name]) => !NOT_FOR_SERVICES.test(name))), ...own };
}

export function nativePaths(env) {
  if (!env.LOCALAPPDATA || !isAbsolute(env.LOCALAPPDATA)) throw new Error("LOCALAPPDATA must be an absolute path.");
  const data = join(env.LOCALAPPDATA, "Ductus", "native-data");
  return {
    tools: join(env.LOCALAPPDATA, "Ductus", "native"),
    data,
    postgres: join(data, "postgres"),
    socket: join(data, "run"),
    rustfs: join(data, "rustfs"),
    logs: join(data, "logs"),
    state: join(data, "state.json"),
  };
}

/** The socket directory as libpq and postgresql.conf take it: forward slashes, short, plain ASCII. */
export function socketDirectory(path) {
  const value = path.replaceAll("\\", "/");
  if (value.length > 90 || !/^[\x20-\x7e]+$/.test(value) || /[,']/.test(value)) {
    throw new Error("The socket folder under LOCALAPPDATA must be plain ASCII, without a comma or quote, and at most 90 characters.");
  }
  return value;
}

export function nativeConf(socket) {
  return `listen_addresses = '127.0.0.1'\nport = ${PORTS.postgres}\nunix_socket_directories = '${socket}'\n`;
}

export function psqlArgs(socket, database = "ductus") {
  return ["-h", socket, "-p", String(PORTS.postgres), "-U", "ductus", "-d", database, "-X", "-q", "-v", "ON_ERROR_STOP=1"];
}

const exists = (path) => stat(path).then(() => true, () => false);

/** Image name of a live pid, so a recycled pid of another program is never reused or stopped. */
function processName(pid, platform, env) {
  if (platform !== "win32") return readFile(`/proc/${pid}/comm`, "utf8").then((name) => name.trim(), () => undefined);
  const tasklist = join(env.SystemRoot || "C:\\Windows", "System32", "tasklist.exe");
  return new Promise((resolve) => {
    const child = spawn(tasklist, ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.once("error", () => resolve(undefined));
    child.once("exit", () => {
      const [, image, listed] = /^"([^"]+)","(\d+)"/.exec(out.trim()) ?? [];
      resolve(listed === String(pid) ? image : undefined);
    });
  });
}

/** The native steps for runDemoLifecycle, plus stop(). binaries ({ pgBin, rustfs }) is for a writer's local test only. */
export function nativeDemo({ paths, env, platform = process.platform, binaries, log = console.log }) {
  const socket = socketDirectory(paths.socket);
  const exeName = (name) => (platform === "win32" ? `${name}.exe` : name);
  const names = { rustfs: exeName("rustfs"), oidc: basename(process.execPath) };
  let bins = binaries;
  let activeChild;
  let stopping = false;

  async function tools() {
    if (bins !== undefined) return bins;
    await mkdir(paths.tools, { recursive: true });
    const options = { tar: windowsTar(env), log };
    const pg = await ensureTool("postgres", paths.tools, options);
    const rustfs = await ensureTool("rustfs", paths.tools, options);
    bins = { pgBin: join(pg, "pgsql", "bin"), rustfs: join(rustfs, MANIFEST.rustfs.members[0]) };
    return bins;
  }
  const pgTool = (name) => join(bins.pgBin, exeName(name));
  const quiet = { env: serviceEnv(env), stdio: ["ignore", "ignore", "inherit"] };
  const readState = () => readFile(paths.state, "utf8").then(JSON.parse, () => ({}));

  async function psql(input, extra = [], database = "ductus") {
    const code = await run(pgTool("psql"), [...psqlArgs(socket, database), ...extra], { env: serviceEnv(env), input, cwd: ROOT });
    if (code !== 0) throw new Error("psql on the local socket failed; nothing reached the database over TCP.");
  }
  const sqlFile = (file, extra) => psql(createReadStream(join(ROOT, "db", "local", file)), extra);

  async function initPostgres() {
    const partial = `${paths.postgres}.partial`;
    await rm(partial, { recursive: true, force: true });
    const pwfile = join(paths.data, `initdb-${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(pwfile, "ductus-local-only\n", { flag: "wx", mode: 0o600 });
    try {
      const args = ["-D", partial, "-U", "ductus", `--pwfile=${pwfile}`, "--auth-host=scram-sha-256", "--auth-local=trust", "-E", "UTF8"];
      if ((await run(pgTool("initdb"), args, quiet)) !== 0) throw new Error("initdb failed");
    } finally {
      await rm(pwfile, { force: true });
    }
    await appendFile(join(partial, "postgresql.conf"), "\ninclude_if_exists = 'ductus-native.conf'\n");
    await rename(partial, paths.postgres);
  }

  async function startPostgres() {
    if (!(await exists(paths.postgres))) await initPostgres();
    await writeFile(join(paths.postgres, "ductus-native.conf"), nativeConf(socket));
    if ((await run(pgTool("pg_ctl"), ["status", "-D", paths.postgres], { ...quiet, stdio: "ignore" })) !== 0) {
      if (await portInUse(PORTS.postgres)) throw new Error(`Port ${PORTS.postgres} is already in use by another program.`);
      const logFile = join(paths.logs, "postgres.log");
      const args = ["start", "-D", paths.postgres, "-w", "-t", "60", "-l", logFile];
      if ((await run(pgTool("pg_ctl"), args, { ...quiet, stdio: "ignore", detached: true })) !== 0) throw new Error(`PostgreSQL did not start; see ${logFile}`);
    }
    const ready = ["-h", socket, "-p", String(PORTS.postgres), "-d", "postgres", "-q"];
    await waitFor("PostgreSQL", async () => (await run(pgTool("pg_isready"), ready, { ...quiet, stdio: "ignore" })) === 0);
  }

  async function startOwn(name, port, start, ready) {
    const state = await readState();
    const pid = state[name];
    if (Number.isInteger(pid) && (await processName(pid, platform, env)) === names[name] && (await ready().catch(() => false))) return;
    if (await portInUse(port)) throw new Error(`Port ${port} is already in use by another program.`);
    await writeFile(paths.state, JSON.stringify({ ...state, [name]: await start() }));
    await waitFor(name, ready);
  }

  async function stackUp() {
    if (!(await exists(join(OIDC_DIR, "node_modules", "oidc-provider")))) {
      throw new Error("Run pnpm --dir infra/fake-oidc install --frozen-lockfile first.");
    }
    await tools();
    for (const dir of [paths.data, paths.socket, paths.rustfs, paths.logs]) await mkdir(dir, { recursive: true });
    await startPostgres();
    await startOwn("rustfs", PORTS.rustfs, () => startService(bins.rustfs, ["server", "--address", `127.0.0.1:${PORTS.rustfs}`, paths.rustfs], {
      env: serviceEnv(env, { RUSTFS_ACCESS_KEY: "ductus-local", RUSTFS_SECRET_KEY: "ductus-local-only", RUSTFS_CONSOLE_ENABLE: "false" }),
      log: join(paths.logs, "rustfs.log"),
    }), async () => (await fetch(`http://127.0.0.1:${PORTS.rustfs}/`)).status === 403);
    await startOwn("oidc", PORTS.oidc, () => startService(process.execPath, ["--import", PRELOAD, "server.mjs"], {
      env: serviceEnv(env, { PORT: String(PORTS.oidc), ISSUER: "http://localhost:8090", REDIRECT_URI: "http://localhost:3000/api/auth/callback" }),
      log: join(paths.logs, "fake-oidc.log"),
      cwd: OIDC_DIR,
    }), async () => (await fetch(`http://127.0.0.1:${PORTS.oidc}/.well-known/openid-configuration`)).ok);
  }

  // The same order as pnpm db:migrate and db:seed, on the local socket.
  async function migrate(scriptEnv) {
    await psql(CREATE_DATABASE_SQL, [], "postgres");
    await sqlFile("migrator.sql");
    const { resolveBinary } = await import("dbmate");
    const code = await run(resolveBinary(), ["--url", MIGRATOR_URL, "--no-dump-schema", "--wait", "up"], { env: serviceEnv(env), cwd: ROOT });
    if (code !== 0) throw new Error("dbmate up failed");
    await sqlFile("app-login.sql");
    await sqlFile("auth-login.sql", ["-v", `auth_password=${scriptEnv.DUCTUS_AUTH_LOCAL_PASSWORD}`]);
  }

  function dev(appEnv) {
    const invocation = pnpmInvocation(appEnv, "dev", platform);
    const args = [...invocation.args, "--hostname", "127.0.0.1", "--port", String(PORTS.app)];
    return new Promise((resolve) => {
      activeChild = spawn(invocation.command, args, { cwd: ROOT, env: appEnv, stdio: "inherit", windowsHide: true });
      activeChild.once("error", () => resolve(1));
      activeChild.once("exit", (code) => resolve(stopping ? 130 : (code ?? 1)));
    });
  }

  const steps = { "stack:up": stackUp, "db:migrate": migrate, "db:seed": () => sqlFile("seed.sql"), dev };
  async function runScript(script, scriptEnv) {
    if (stopping) return 130;
    try {
      const code = await steps[script](scriptEnv);
      return typeof code === "number" ? code : 0;
    } catch (error) {
      console.error(`${script}: ${error instanceof Error ? error.message : "failed"}`);
      return 1;
    }
  }

  async function runNode(script, scriptEnv) {
    if (stopping) return { code: 130, stdout: "" };
    try {
      const { main } = await import(pathToFileURL(join(ROOT, script)).href);
      const target = { command: pgTool("psql"), args: ["-h", socket, "-p", String(PORTS.postgres), "-U", "ductus", "-d", "ductus"] };
      const result = await main(scriptEnv, [], target);
      if (result === undefined) log("K-3 demo course, assignment and enrolment are in place.");
      return { code: 0, stdout: typeof result === "string" ? `${result}\n` : result === undefined ? "" : JSON.stringify(result) };
    } catch (error) {
      console.error(`${script}: ${error instanceof Error ? error.message : "failed"}`);
      return { code: 1, stdout: "" };
    }
  }

  async function stop() {
    if (await exists(join(paths.postgres, "PG_VERSION"))) {
      await tools();
      if ((await run(pgTool("pg_ctl"), ["status", "-D", paths.postgres], { ...quiet, stdio: "ignore" })) === 0) {
        await run(pgTool("pg_ctl"), ["stop", "-D", paths.postgres, "-m", "fast", "-w", "-t", "60"], quiet);
      }
    }
    const state = await readState();
    for (const name of ["oidc", "rustfs"]) {
      if (Number.isInteger(state[name]) && (await processName(state[name], platform, env)) === names[name]) {
        process.kill(state[name]);
        await waitFor(`stopping ${name}`, async () => (await processName(state[name], platform, env)) === undefined, { timeoutMs: 15_000 });
      }
    }
    await rm(paths.state, { force: true });
  }

  function interrupt() {
    stopping = true;
    activeChild?.kill("SIGINT");
  }

  return { runScript, runNode, stop, interrupt };
}

export async function main(argv = process.argv.slice(2), env = process.env, { platform = process.platform, binaries } = {}) {
  const unknown = argv.find((arg) => !FLAGS.has(arg));
  if (unknown !== undefined) throw new Error(`unknown argument ${unknown}; the flags are ${[...FLAGS].join(", ")}`);
  if (env.NODE_ENV === "production") throw new Error("the native demo is refused in production");
  if (platform !== "win32" && !argv.includes("--allow-non-windows")) throw new Error("the native demo runs on Windows only");
  const paths = nativePaths(env);
  if (argv.includes("--stop")) {
    await nativeDemo({ paths, env: serviceEnv(env), platform, binaries }).stop();
    return 0;
  }
  const demoEnv = createDemoEnvironment(env);
  const native = nativeDemo({ paths, env: demoEnv, platform, binaries });
  const prepareOnly = argv.includes("--prepare-only");
  if (!prepareOnly && (await portInUse(PORTS.app))) throw new Error(`Port ${PORTS.app} is already in use by another program.`);
  process.on("SIGINT", native.interrupt);
  process.on("SIGTERM", native.interrupt);
  console.log(prepareOnly
    ? "Preparing the native Ductus demo: PostgreSQL, rustfs and fake OIDC on 127.0.0.1, migrations, synthetic institutions, evidence key and storage."
    : "Starting the native Ductus demo: PostgreSQL, rustfs and fake OIDC on 127.0.0.1, migrations, synthetic institutions, evidence key and storage, K-3 course and enrolment, and app.");
  console.log("A local auth password is generated for this run and is not written to disk or printed.");
  const code = await runDemoLifecycle(demoEnv, native.runScript, !prepareOnly, native.runNode).catch(() => 1);
  // --prepare-only leaves the services up for the tests that follow; any failure or the end of the app stops them.
  if (!prepareOnly || code !== 0) await native.stop();
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(`Native demo refused: ${error instanceof Error ? error.message : "failed"}`);
      process.exitCode = 1;
    },
  );
}
