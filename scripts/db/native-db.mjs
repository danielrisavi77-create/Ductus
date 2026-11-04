// DAN-521 (#1516): the database steps without Docker, for Claude Code cloud
// sessions and any Linux machine with PostgreSQL, pgTAP and pg_prove installed
// from the distribution (for example postgresql-16, postgresql-16-pgtap and
// libtap-parser-sourcehandler-pgtap-perl).
//
//   pnpm db:up:native     start or check PostgreSQL, provision, migrate
//   pnpm test:db:native   pg_prove over db/tests, as pnpm test:db does in compose
//
// The compose path (stack:up, db:migrate, test:db) and CI are unchanged. The
// same files run in the same order as `pnpm db:migrate`: db/local/migrator.sql,
// dbmate up --strict as ductus_migrator, db/local/app-login.sql and
// db/local/auth-login.sql. The provisioning files run on the local socket as
// the cluster's own superuser (auth-login.sql refuses anything but a socket);
// dbmate and pg_prove log in over loopback TCP as `ductus`, the superuser
// compose makes. Only loopback hosts are accepted, and no PG*, PSQL* or DBMATE_*
// variable of the caller reaches a child, so nothing here can aim at another
// server.
//
// F-215: the bootstrap makes its login a SUPERUSER, so it refuses the cluster's
// own roles (postgres, pg_*), the roles the migrations make (ductus_*) and any
// existing role it did not create itself (ROLE_MARKER). No password is public
// and none goes through argv: the login password comes from
// DUCTUS_NATIVE_PGPASSWORD or is generated once and kept in a 0600 file
// (passwordFile), and psql reads the secrets with \getenv from its own
// environment, dbmate its URL from DATABASE_URL.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const DEFAULTS = Object.freeze({
  DUCTUS_NATIVE_PGHOST: "127.0.0.1",
  DUCTUS_NATIVE_PGPORT: "5432",
  DUCTUS_NATIVE_PGSOCKET: "/var/run/postgresql",
  DUCTUS_NATIVE_PGUSER: "ductus",
  DUCTUS_NATIVE_PGDATABASE: "ductus",
});
export const ROLE_MARKER = "ductus native-db";
const RESERVED_ROLE = /^(?:postgres$|pg_|ductus_)/;
const RESERVED_DATABASE = new Set(["postgres", "template0", "template1"]);
// The psql variables holding secrets are read from these child variables.
export const BOOTSTRAP_PASSWORD_VAR = "DUCTUS_NATIVE_BOOTSTRAP_PASSWORD";
export const AUTH_PASSWORD_VAR = "DUCTUS_NATIVE_AUTH_PASSWORD";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const PORT = /^[1-9][0-9]{0,4}$/;
const SOCKET_DIR = /^\/[A-Za-z0-9._/-]*$/;
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const STEERING = /^(?:PG|PSQL|DBMATE_)/i;
export const READY_ATTEMPTS = 30;

// Idempotent: a missing role is created and marked; an existing one must carry
// the mark, else the run stops. Then the role is stated again, so a role left
// with another password or without SUPERUSER is reset. psql variables are not
// read inside DO bodies, hence format() and \gexec.
export const BOOTSTRAP_SQL = [
  `\\getenv ductus_password ${BOOTSTRAP_PASSWORD_VAR}`,
  "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'ductus_user') AS role_exists,",
  `  COALESCE((SELECT pg_catalog.shobj_description(oid, 'pg_authid') FROM pg_catalog.pg_roles WHERE rolname = :'ductus_user'), '') = '${ROLE_MARKER}' AS role_ours \\gset`,
  "\\if :role_exists",
  "\\if :role_ours",
  "\\else",
  "DO $$ BEGIN RAISE EXCEPTION 'the role exists and was not created by db:up:native; drop it or set DUCTUS_NATIVE_PGUSER'; END $$;",
  "\\endif",
  "\\else",
  "SELECT pg_catalog.format('CREATE ROLE %I', :'ductus_user') \\gexec",
  `SELECT pg_catalog.format('COMMENT ON ROLE %I IS %L', :'ductus_user', '${ROLE_MARKER}') \\gexec`,
  "\\endif",
  "SELECT pg_catalog.format('ALTER ROLE %I LOGIN SUPERUSER PASSWORD %L', :'ductus_user', :'ductus_password') \\gexec",
  "SELECT pg_catalog.format('CREATE DATABASE %I OWNER %I', :'ductus_db', :'ductus_user') WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = :'ductus_db') \\gexec",
  "",
].join("\n");

/** The validated connection settings (without the password), from DUCTUS_NATIVE_* with the defaults above. */
export function nativeConfig(env) {
  if (env.NODE_ENV === "production") throw new Error("the native database steps are refused in production");
  const value = (name) => env[name] ?? DEFAULTS[name];
  const host = value("DUCTUS_NATIVE_PGHOST");
  const port = value("DUCTUS_NATIVE_PGPORT");
  const socket = value("DUCTUS_NATIVE_PGSOCKET");
  const user = value("DUCTUS_NATIVE_PGUSER");
  const database = value("DUCTUS_NATIVE_PGDATABASE");
  if (!LOOPBACK.has(host)) throw new Error("DUCTUS_NATIVE_PGHOST must be 127.0.0.1, localhost or ::1");
  if (!PORT.test(port) || Number(port) > 65535) throw new Error("DUCTUS_NATIVE_PGPORT must be a port number");
  if (!SOCKET_DIR.test(socket) || socket.split("/").includes("..")) throw new Error("DUCTUS_NATIVE_PGSOCKET must be an absolute socket directory");
  if (!NAME.test(user) || RESERVED_ROLE.test(user)) {
    throw new Error("DUCTUS_NATIVE_PGUSER must be a plain role name other than postgres, pg_* and ductus_*");
  }
  if (!NAME.test(database) || RESERVED_DATABASE.has(database)) {
    throw new Error("DUCTUS_NATIVE_PGDATABASE must be a plain database name other than postgres and the templates");
  }
  return { host, port, socket, user, database };
}

/** Where a generated login password is kept between db:up:native and test:db:native. */
export const passwordFile = (env) => join(env.HOME || homedir(), ".config", "ductus", "native-db-password");

const validPassword = (value) => typeof value === "string" && value.length >= 16 && !/[\0\r\n]/.test(value);

/** The default password store: one line in a 0600 file under a 0700 directory. */
export const fileStore = (file) => ({
  read() {
    try {
      return readFileSync(file, "utf8").trim();
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  },
  write(value) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${value}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  },
});

/**
 * The login password: DUCTUS_NATIVE_PGPASSWORD, else the stored one, else (only
 * when `create`) a new random one that is stored. Never a fixed default.
 */
export function loginPassword(env, store, { create }) {
  const given = env.DUCTUS_NATIVE_PGPASSWORD;
  if (given !== undefined) {
    if (!validPassword(given)) throw new Error("DUCTUS_NATIVE_PGPASSWORD must be one line of at least 16 characters");
    return given;
  }
  const stored = store.read();
  if (stored !== null && stored !== "") {
    if (!validPassword(stored)) throw new Error("the stored native database password is not valid; delete it and run pnpm db:up:native");
    return stored;
  }
  if (!create) throw new Error("no native database password; run pnpm db:up:native first or set DUCTUS_NATIVE_PGPASSWORD");
  const made = randomBytes(24).toString("hex");
  store.write(made);
  return made;
}

/** The caller's environment without the libpq, psql and dbmate variables, plus the password for the TCP login. */
export function childEnv(env, password) {
  const clean = Object.fromEntries(Object.entries(env).filter(([name]) => !STEERING.test(name) && !name.startsWith("DUCTUS_NATIVE_")));
  return { ...clean, PGPASSWORD: password };
}

const tcp = (config) => ["-h", config.host, "-p", config.port, "-U", config.user, "-d", config.database];

export function dbmateUrl(config, password) {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const credentials = `${encodeURIComponent(config.user)}:${encodeURIComponent(password)}`;
  return `postgres://${credentials}@${host}:${config.port}/${config.database}?sslmode=disable&role=ductus_migrator`;
}

/** psql on the local socket as the cluster superuser: through runuser as root, else as the calling OS user. */
export function adminPsql(config, isRoot, database) {
  const psql = ["psql", "-h", config.socket, "-p", config.port, "-d", database, "-X", "-q", "-v", "ON_ERROR_STOP=1"];
  return isRoot ? { command: "runuser", args: ["-u", "postgres", "--", ...psql] } : { command: psql[0], args: psql.slice(1) };
}

export function pgProveArgs(config) {
  return [...tcp(config), "--recurse", "--ext", ".sql", "db/tests"];
}

function authPassword(env) {
  const given = env.DUCTUS_AUTH_LOCAL_PASSWORD;
  if (given === undefined || given === "") return randomBytes(24).toString("hex");
  if (given.length < 16) throw new Error("DUCTUS_AUTH_LOCAL_PASSWORD must be at least 16 characters");
  return given;
}

/**
 * db:up:native. `run(command, args, { env, input, stdinFile })` resolves to an
 * exit code; injectable so a test needs no PostgreSQL. `input` is written to
 * stdin before the `stdinFile` contents.
 */
export async function up({ env, run, isRoot, store = fileStore(passwordFile(env)), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log }) {
  const config = nativeConfig(env);
  const auth = authPassword(env);
  const password = loginPassword(env, store, { create: true });
  const cenv = childEnv(env, password);
  const ready = () => run("pg_isready", ["-q", "-h", config.host, "-p", config.port], { env: cenv });
  if ((await ready()) !== 0) {
    if (!isRoot) throw new Error(`PostgreSQL does not answer on ${config.host}:${config.port}; start it (for example: sudo service postgresql start)`);
    log("Starting PostgreSQL (service postgresql start).");
    await run("service", ["postgresql", "start"], { env: cenv });
    let answered = false;
    for (let attempt = 0; attempt < READY_ATTEMPTS && !answered; attempt += 1) {
      answered = (await ready()) === 0;
      if (!answered) await wait(1000);
    }
    if (!answered) throw new Error(`PostgreSQL did not become ready on ${config.host}:${config.port}`);
  }
  const step = async (what, command, args, options = {}) => {
    if ((await run(command, args, { env: cenv, ...options })) !== 0) throw new Error(`${what} failed`);
  };
  const admin = (database, vars = []) => {
    const { command, args } = adminPsql(config, isRoot, database);
    return [command, [...args, ...vars]];
  };
  await step("creating the ductus login and database", ...admin("postgres", [
    "-v", `ductus_user=${config.user}`, "-v", `ductus_db=${config.database}`,
  ]), { input: BOOTSTRAP_SQL, env: { ...cenv, [BOOTSTRAP_PASSWORD_VAR]: password } });
  await step("db/local/migrator.sql", ...admin(config.database), { stdinFile: join(ROOT, "db/local/migrator.sql") });
  const dbmate = join(ROOT, "node_modules", "dbmate", "dist", "cli.js");
  await step("dbmate up", process.execPath, [dbmate, "--no-dump-schema", "--wait", "up", "--strict"], {
    env: { ...cenv, DATABASE_URL: dbmateUrl(config, password) },
  });
  await step("db/local/app-login.sql", ...admin(config.database), { stdinFile: join(ROOT, "db/local/app-login.sql") });
  await step("db/local/auth-login.sql", ...admin(config.database), {
    input: `\\getenv auth_password ${AUTH_PASSWORD_VAR}\n`,
    stdinFile: join(ROOT, "db/local/auth-login.sql"),
    env: { ...cenv, [AUTH_PASSWORD_VAR]: auth },
  });
  log(`Native database ready on ${config.host}:${config.port}/${config.database}; run pnpm test:db:native.`);
}

/** test:db:native: the pg_prove of test:db, over loopback instead of docker compose exec. */
export async function testDb({ env, run, store = fileStore(passwordFile(env)) }) {
  const config = nativeConfig(env);
  return run("pg_prove", pgProveArgs(config), { env: childEnv(env, loginPassword(env, store, { create: false })) });
}

function spawnRun(command, args, { env, input, stdinFile } = {}) {
  return new Promise((resolve) => {
    const piped = input !== undefined || stdinFile !== undefined;
    const child = spawn(command, args, { cwd: ROOT, env, stdio: [piped ? "pipe" : "ignore", "inherit", "inherit"], windowsHide: true });
    child.once("error", (error) => {
      console.error(`could not start ${command}: ${error.message}`);
      resolve(-1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
    if (stdinFile !== undefined) {
      readFile(stdinFile).then((sql) => child.stdin.end(Buffer.concat([Buffer.from(input ?? ""), sql])), () => child.stdin.destroy());
    } else if (input !== undefined) child.stdin.end(input);
  });
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  try {
    if (rest.length > 0 || !["up", "test"].includes(mode)) throw new Error("usage: native-db.mjs up|test");
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (mode === "up") await up({ env: process.env, run: spawnRun, isRoot });
    else process.exitCode = await testDb({ env: process.env, run: spawnRun });
  } catch (error) {
    console.error(`Native database: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
