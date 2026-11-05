// DAN-521 (#1516): db:up:native and test:db:native without a PostgreSQL; F-215 hardening.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTH_PASSWORD_VAR, BOOTSTRAP_PASSWORD_VAR, BOOTSTRAP_SQL, childEnv, dbmateUrl, fileStore, loginPassword,
  nativeConfig, pgProveArgs, READY_ATTEMPTS, ROLE_MARKER, testDb, up, WORKER_PASSWORD_VAR,
} from "./native-db.mjs";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));
const DEFAULT = { host: "127.0.0.1", port: "5432", socket: "/var/run/postgresql", user: "ductus", database: "ductus" };
const LOGIN = "l".repeat(32);
const quiet = () => {};

/** An in-memory password store. */
function memoryStore(value = null) {
  const store = { value, writes: 0, read: () => store.value, write: (next) => { store.value = next; store.writes += 1; } };
  return store;
}

/** A run that records every call and answers with `answer(command, args)`. */
function recorder(answer = () => 0) {
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    return answer(command, args);
  };
  return { calls, run };
}

const sqlFile = (call) => call.options.stdinFile?.replaceAll("\\", "/").split("/").slice(-3).join("/");

test("the defaults are the local loopback cluster", () => {
  assert.deepEqual(nativeConfig({}), DEFAULT);
});

test("connection settings: every input class is accepted or refused", () => {
  const accepted = [
    ["DUCTUS_NATIVE_PGHOST", "localhost"], ["DUCTUS_NATIVE_PGHOST", "::1"], ["DUCTUS_NATIVE_PGHOST", "127.0.0.1"],
    ["DUCTUS_NATIVE_PGPORT", "1"], ["DUCTUS_NATIVE_PGPORT", "54329"], ["DUCTUS_NATIVE_PGPORT", "65535"],
    ["DUCTUS_NATIVE_PGSOCKET", "/tmp"], ["DUCTUS_NATIVE_PGSOCKET", "/run/postgresql"],
    ["DUCTUS_NATIVE_PGUSER", "dx_test"], ["DUCTUS_NATIVE_PGUSER", "postgresx"],
    ["DUCTUS_NATIVE_PGDATABASE", "_d1"],
  ];
  for (const [name, value] of accepted) assert.equal(nativeConfig({ [name]: value })[{
    DUCTUS_NATIVE_PGHOST: "host", DUCTUS_NATIVE_PGPORT: "port", DUCTUS_NATIVE_PGSOCKET: "socket",
    DUCTUS_NATIVE_PGUSER: "user", DUCTUS_NATIVE_PGDATABASE: "database",
  }[name]], value, `${name}=${value}`);

  const refused = [
    // Hosts: anything but loopback, including names, other addresses, lists, URIs, conninfo and sockets.
    ["DUCTUS_NATIVE_PGHOST", ""], ["DUCTUS_NATIVE_PGHOST", "db.example.invalid"], ["DUCTUS_NATIVE_PGHOST", "10.0.0.5"],
    ["DUCTUS_NATIVE_PGHOST", "127.0.0.2"], ["DUCTUS_NATIVE_PGHOST", "127.0.0.1,db.example.invalid"],
    ["DUCTUS_NATIVE_PGHOST", "postgres://db.example.invalid/ductus"], ["DUCTUS_NATIVE_PGHOST", "host=db.example.invalid"],
    ["DUCTUS_NATIVE_PGHOST", "/var/run/postgresql"], ["DUCTUS_NATIVE_PGHOST", "LOCALHOST"], ["DUCTUS_NATIVE_PGHOST", " 127.0.0.1"],
    // Ports.
    ["DUCTUS_NATIVE_PGPORT", ""], ["DUCTUS_NATIVE_PGPORT", "0"], ["DUCTUS_NATIVE_PGPORT", "65536"], ["DUCTUS_NATIVE_PGPORT", "05432"],
    ["DUCTUS_NATIVE_PGPORT", "5432 "], ["DUCTUS_NATIVE_PGPORT", "-1"], ["DUCTUS_NATIVE_PGPORT", "5432,5433"], ["DUCTUS_NATIVE_PGPORT", "1e3"],
    // Socket directories.
    ["DUCTUS_NATIVE_PGSOCKET", ""], ["DUCTUS_NATIVE_PGSOCKET", "relative/dir"], ["DUCTUS_NATIVE_PGSOCKET", "/a,/b"],
    ["DUCTUS_NATIVE_PGSOCKET", "/var/../etc"], ["DUCTUS_NATIVE_PGSOCKET", "/with space"], ["DUCTUS_NATIVE_PGSOCKET", "C:\\pg"],
    // Role and database names.
    ["DUCTUS_NATIVE_PGUSER", ""], ["DUCTUS_NATIVE_PGUSER", "Ductus"], ["DUCTUS_NATIVE_PGUSER", "1ductus"], ["DUCTUS_NATIVE_PGUSER", "a b"],
    ["DUCTUS_NATIVE_PGUSER", "x\"; DROP ROLE y; --"], ["DUCTUS_NATIVE_PGUSER", "a".repeat(64)],
    // F-215: the cluster's own roles and the roles the migrations and db/local make.
    ["DUCTUS_NATIVE_PGUSER", "postgres"], ["DUCTUS_NATIVE_PGUSER", "pg_monitor"], ["DUCTUS_NATIVE_PGUSER", "pg_read_server_files"],
    ["DUCTUS_NATIVE_PGUSER", "ductus_migrator"], ["DUCTUS_NATIVE_PGUSER", "ductus_app_local"], ["DUCTUS_NATIVE_PGUSER", "ductus_auth_local"],
    ["DUCTUS_NATIVE_PGDATABASE", ""], ["DUCTUS_NATIVE_PGDATABASE", "ductus?host=x"], ["DUCTUS_NATIVE_PGDATABASE", "a-b"],
    ["DUCTUS_NATIVE_PGDATABASE", "postgres"], ["DUCTUS_NATIVE_PGDATABASE", "template0"], ["DUCTUS_NATIVE_PGDATABASE", "template1"],
  ];
  for (const [name, value] of refused) assert.throws(() => nativeConfig({ [name]: value }), new RegExp(name), `${name}=${JSON.stringify(value)}`);
  assert.throws(() => nativeConfig({ NODE_ENV: "production" }), /production/);
});

test("F-215: the login password is given, stored or generated once; never a fixed default", () => {
  const given = "p@ss:/?#word with spaces";
  assert.equal(loginPassword({ DUCTUS_NATIVE_PGPASSWORD: given }, memoryStore("x".repeat(20)), { create: true }), given);
  for (const bad of ["", "short", "a".repeat(15), `${"a".repeat(16)}\nb`, `${"a".repeat(16)}\rb`, `${"a".repeat(16)}\0b`]) {
    assert.throws(() => loginPassword({ DUCTUS_NATIVE_PGPASSWORD: bad }, memoryStore(), { create: true }), /DUCTUS_NATIVE_PGPASSWORD/, JSON.stringify(bad));
  }
  assert.equal(loginPassword({}, memoryStore(LOGIN), { create: false }), LOGIN, "test:db:native reuses the stored one");
  assert.throws(() => loginPassword({}, memoryStore("short"), { create: true }), /stored native database password is not valid/);
  assert.throws(() => loginPassword({}, memoryStore(), { create: false }), /run pnpm db:up:native first/);
  const made = [];
  for (let i = 0; i < 2; i += 1) {
    const store = memoryStore();
    const value = loginPassword({}, store, { create: true });
    assert.match(value, /^[0-9a-f]{48}$/);
    assert.equal(store.value, value);
    assert.equal(store.writes, 1);
    made.push(value);
  }
  assert.notEqual(made[0], made[1]);
  assert.doesNotMatch(readFileSync(fileURLToPath(new URL("./native-db.mjs", import.meta.url)), "utf8"), /ductus-local-only/, "no public default");
});

test("F-215: the stored password file is one line, readable by its owner only", () => {
  const dir = mkdtempSync(join(tmpdir(), "ductus-native-pw-"));
  try {
    const file = join(dir, "sub", "native-db-password");
    const store = fileStore(file);
    assert.equal(store.read(), null);
    store.write(LOGIN);
    assert.equal(store.read(), LOGIN);
    assert.equal(readFileSync(file, "utf8"), `${LOGIN}\n`);
    // POSIX file modes; Windows has no 0600 to check.
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("children never see the caller's libpq, psql, dbmate or DUCTUS_NATIVE_* variables", () => {
  const env = {
    PATH: "/bin", PGHOST: "db.example.invalid", pgservice: "x", PGPASSFILE: "/x", PSQLRC: "/x", DBMATE_URL: "x", DATABASE_URL: "kept",
    DUCTUS_NATIVE_PGPASSWORD: "x", [BOOTSTRAP_PASSWORD_VAR]: "injected", [AUTH_PASSWORD_VAR]: "injected",
    [WORKER_PASSWORD_VAR]: "injected",
  };
  assert.deepEqual(childEnv(env, LOGIN), { PATH: "/bin", DATABASE_URL: "kept", PGPASSWORD: LOGIN });
});

test("the dbmate URL is the db:migrate URL on the native port, with an encoded password", () => {
  const plain = new URL(dbmateUrl(DEFAULT, LOGIN));
  assert.equal(`${plain.protocol}//${plain.username}@${plain.host}${plain.pathname}${plain.search}`, "postgres://ductus@127.0.0.1:5432/ductus?sslmode=disable&role=ductus_migrator");
  assert.equal(plain.password, LOGIN);
  const url = new URL(dbmateUrl({ ...DEFAULT, host: "::1" }, "a@b/c?d#e"));
  assert.equal(url.password, "a%40b%2Fc%3Fd%23e", "reserved characters are percent-encoded");
  assert.equal(decodeURIComponent(url.password), "a@b/c?d#e");
  assert.equal(url.hostname, "[::1]");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/ductus");
  assert.equal(url.search, "?sslmode=disable&role=ductus_migrator");
});

test("test:db:native is the pg_prove of test:db over loopback", async () => {
  assert.match(pkg.scripts["test:db"], /pg_prove -U ductus -d ductus --recurse --ext \.sql \/db\/tests$/, "test:db is unchanged");
  assert.equal(pkg.scripts["test:db:native"], "node scripts/db/native-db.mjs test");
  assert.equal(pkg.scripts["db:up:native"], "node scripts/db/native-db.mjs up");
  assert.match(pkg.scripts["test:local"], /scripts\/db\/native-db\.test\.mjs/, "CI runs this file through pnpm test");
  const { calls, run } = recorder(() => 3);
  assert.equal(await testDb({ env: { PGHOST: "db.example.invalid" }, run, store: memoryStore(LOGIN) }), 3, "pg_prove's exit code is the result");
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ["pg_prove", "-h", "127.0.0.1", "-p", "5432", "-U", "ductus", "-d", "ductus", "--recurse", "--ext", ".sql", "db/tests"],
  ]);
  assert.equal(calls[0].options.env.PGHOST, undefined);
  assert.equal(calls[0].options.env.PGPASSWORD, LOGIN);
  assert.deepEqual(pgProveArgs({ ...DEFAULT, port: "54329" }).slice(0, 4), ["-h", "127.0.0.1", "-p", "54329"]);
  const none = recorder();
  await assert.rejects(testDb({ env: {}, run: none.run, store: memoryStore() }), /db:up:native first/);
  assert.deepEqual(none.calls, []);
});

test("db:up:native on a running cluster runs the db:migrate files in order, with no secret in any argv", async () => {
  const { calls, run } = recorder();
  const auth = "s".repeat(16);
  const worker = "w".repeat(16);
  await up({ env: { DUCTUS_AUTH_LOCAL_PASSWORD: auth, DUCTUS_WORKER_LOCAL_PASSWORD: worker }, run, isRoot: true, store: memoryStore(LOGIN), log: quiet });
  assert.deepEqual(calls.map(({ command }) => command), ["pg_isready", "runuser", "runuser", process.execPath, "runuser", "runuser", "runuser"]);
  assert.deepEqual(calls.slice(2).map((call) => sqlFile(call) ?? "dbmate"), ["db/local/migrator.sql", "dbmate", "db/local/app-login.sql", "db/local/worker-login.sql", "db/local/auth-login.sql"]);
  // Provisioning on the socket as the cluster superuser, never over TCP.
  for (const call of calls.filter(({ command }) => command === "runuser")) {
    assert.deepEqual(call.args.slice(0, 8), ["-u", "postgres", "--", "psql", "-h", "/var/run/postgresql", "-p", "5432"]);
    assert.ok(!call.args.includes("127.0.0.1"));
  }
  for (const call of calls) {
    const argv = call.args.join(" ");
    assert.ok(!argv.includes(LOGIN) && !argv.includes(auth) && !argv.includes(worker) && !argv.includes("password="), `${call.command}: no secret in argv`);
  }
  assert.equal(calls[1].options.input, BOOTSTRAP_SQL);
  assert.equal(calls[1].options.env[BOOTSTRAP_PASSWORD_VAR], LOGIN);
  const dbmate = calls[3];
  assert.deepEqual(dbmate.args.slice(1), ["--no-dump-schema", "--wait", "up", "--strict"]);
  assert.equal(dbmate.options.env.DATABASE_URL, dbmateUrl(DEFAULT, LOGIN));
  const authLogin = calls[6];
  assert.equal(authLogin.options.input, `\\getenv auth_password ${AUTH_PASSWORD_VAR}\n`);
  assert.equal(authLogin.options.env[AUTH_PASSWORD_VAR], auth);
  assert.equal(calls[1].options.env[AUTH_PASSWORD_VAR], undefined, "each secret only reaches its own step");
  const workerLogin = calls[5];
  assert.equal(workerLogin.options.input, `\\getenv worker_password ${WORKER_PASSWORD_VAR}\n`);
  assert.equal(workerLogin.options.env[WORKER_PASSWORD_VAR], worker, "DUCTUS_WORKER_LOCAL_PASSWORD reaches the worker login");
  assert.equal(workerLogin.options.env[AUTH_PASSWORD_VAR], undefined, "the worker login gets only its own secret");
  assert.equal(authLogin.options.env[WORKER_PASSWORD_VAR], undefined, "the auth login gets only its own secret");
  assert.equal(calls[1].options.env[WORKER_PASSWORD_VAR], undefined);
  assert.equal(authLogin.options.env[BOOTSTRAP_PASSWORD_VAR], undefined);
  for (const call of calls) assert.equal(call.options.env.PGPASSWORD, LOGIN);
});

test("F-215: the bootstrap refuses an existing role it did not create, and marks the roles it creates", () => {
  assert.match(BOOTSTRAP_SQL, /^\\getenv ductus_password DUCTUS_NATIVE_BOOTSTRAP_PASSWORD$/m);
  assert.doesNotMatch(BOOTSTRAP_SQL, /-v ductus_password/);
  const lines = BOOTSTRAP_SQL.split("\n");
  const at = (pattern) => lines.findIndex((line) => pattern.test(line));
  const raise = at(/RAISE EXCEPTION 'the role exists and was not created by db:up:native/);
  const create = at(/format\('CREATE ROLE %I'/);
  const mark = at(/COMMENT ON ROLE %I IS %L/);
  const alter = at(/ALTER ROLE %I LOGIN SUPERUSER PASSWORD %L/);
  assert.ok(at(/^\\if :role_exists$/) < at(/^\\if :role_ours$/) && at(/^\\if :role_ours$/) < raise, "the refusal is inside role_exists and not role_ours");
  assert.ok(raise < create && create < mark && mark < alter, "create and mark only in the else branch, before SUPERUSER is granted");
  assert.ok(BOOTSTRAP_SQL.includes(`'${ROLE_MARKER}' AS role_ours`));
  assert.ok(BOOTSTRAP_SQL.includes(`'${ROLE_MARKER}') \\gexec`));
  assert.match(BOOTSTRAP_SQL, /WHERE NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_database/);
});

test("without DUCTUS_AUTH_LOCAL_PASSWORD or DUCTUS_WORKER_LOCAL_PASSWORD a random one is made per run; a short one is refused before anything runs", async () => {
  const seen = [];
  for (let i = 0; i < 2; i += 1) {
    const { calls, run } = recorder();
    await up({ env: {}, run, isRoot: true, store: memoryStore(LOGIN), log: quiet });
    const auth = calls.at(-1).options.env[AUTH_PASSWORD_VAR];
    const worker = calls.at(-2).options.env[WORKER_PASSWORD_VAR];
    assert.match(auth, /^[0-9a-f]{48}$/, "24 random bytes in hex");
    assert.match(worker, /^[0-9a-f]{48}$/, "24 random bytes in hex");
    assert.notEqual(auth, worker, "each login gets its own password");
    seen.push(auth, worker);
  }
  assert.equal(new Set(seen).size, 4);
  for (const name of ["DUCTUS_AUTH_LOCAL_PASSWORD", "DUCTUS_WORKER_LOCAL_PASSWORD"]) {
    const { calls, run } = recorder();
    const store = memoryStore();
    await assert.rejects(up({ env: { [name]: "short" }, run, isRoot: true, store, log: quiet }), new RegExp(`${name} must be at least 16`));
    assert.deepEqual(calls, []);
    assert.equal(store.writes, 0, "nothing is stored when the run is refused");
  }
});

test("a stopped cluster is started as root and waited for; not as another user", async () => {
  let answers = 0;
  const { calls, run } = recorder((command) => (command === "pg_isready" ? (answers++ < 3 ? 2 : 0) : 0));
  await up({ env: {}, run, isRoot: true, store: memoryStore(LOGIN), wait: async () => {}, log: quiet });
  assert.deepEqual(calls.slice(0, 5).map(({ command, args }) => [command, args[0]]), [
    ["pg_isready", "-q"], ["service", "postgresql"], ["pg_isready", "-q"], ["pg_isready", "-q"], ["pg_isready", "-q"],
  ]);

  const down = recorder((command) => (command === "pg_isready" ? 2 : 0));
  await assert.rejects(up({ env: {}, run: down.run, isRoot: true, store: memoryStore(LOGIN), wait: async () => {}, log: quiet }), /did not become ready/);
  assert.equal(down.calls.filter(({ command }) => command === "pg_isready").length, READY_ATTEMPTS + 1);
  assert.ok(!down.calls.some(({ command }) => command === "runuser"), "nothing is provisioned on a cluster that never answered");

  const user = recorder((command) => (command === "pg_isready" ? 2 : 0));
  await assert.rejects(up({ env: {}, run: user.run, isRoot: false, store: memoryStore(LOGIN), log: quiet }), /does not answer/);
  assert.deepEqual(user.calls.map(({ command }) => command), ["pg_isready"]);
});

test("not as root the provisioning psql runs as the calling user on the socket", async () => {
  const { calls, run } = recorder();
  await up({ env: {}, run, isRoot: false, store: memoryStore(LOGIN), log: quiet });
  assert.deepEqual(calls[1].args.slice(0, 4), ["-h", "/var/run/postgresql", "-p", "5432"]);
  assert.equal(calls[1].command, "psql");
});

test("the first failing step stops the run", async () => {
  const order = ["bootstrap", "migrator.sql", "dbmate", "app-login.sql", "worker-login.sql", "auth-login.sql"];
  for (const failing of order) {
    let index = -1;
    const { calls, run } = recorder((command) => {
      if (command === "pg_isready") return 0;
      index += 1;
      return order[index] === failing ? 1 : 0;
    });
    await assert.rejects(up({ env: {}, run, isRoot: true, store: memoryStore(LOGIN), log: quiet }), /failed/);
    assert.equal(calls.length, 1 + order.indexOf(failing) + 1, `stops at ${failing}`);
  }
});

test("a second db:up:native runs the same idempotent steps and keeps the stored password", async () => {
  const store = memoryStore();
  const first = recorder();
  const second = recorder();
  const env = { DUCTUS_AUTH_LOCAL_PASSWORD: "t".repeat(20), DUCTUS_WORKER_LOCAL_PASSWORD: "w".repeat(20) };
  await up({ env, run: first.run, isRoot: true, store, log: quiet });
  await up({ env, run: second.run, isRoot: true, store, log: quiet });
  assert.equal(store.writes, 1, "the generated password is made once");
  const shape = (calls) => calls.map(({ command, args, options }) => [command, args, options.input, options.stdinFile, options.env]);
  assert.deepEqual(shape(second.calls), shape(first.calls));
  assert.match(BOOTSTRAP_SQL, /%I.*%L/, "names and the password are quoted by format()");
});
