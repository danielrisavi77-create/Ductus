// DAN-521 (#1516): db:up:native and test:db:native without a PostgreSQL.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BOOTSTRAP_SQL, childEnv, dbmateUrl, nativeConfig, pgProveArgs, READY_ATTEMPTS, testDb, up } from "./native-db.mjs";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));
const DEFAULT = { host: "127.0.0.1", port: "5432", socket: "/var/run/postgresql", user: "ductus", database: "ductus", password: "ductus-local-only" };
const quiet = () => {};

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
    ["DUCTUS_NATIVE_PGUSER", "ductus_test"], ["DUCTUS_NATIVE_PGDATABASE", "_d1"],
    ["DUCTUS_NATIVE_PGPASSWORD", "p@ss:/?#word with spaces"],
  ];
  for (const [name, value] of accepted) assert.equal(nativeConfig({ [name]: value })[{
    DUCTUS_NATIVE_PGHOST: "host", DUCTUS_NATIVE_PGPORT: "port", DUCTUS_NATIVE_PGSOCKET: "socket",
    DUCTUS_NATIVE_PGUSER: "user", DUCTUS_NATIVE_PGDATABASE: "database", DUCTUS_NATIVE_PGPASSWORD: "password",
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
    ["DUCTUS_NATIVE_PGDATABASE", ""], ["DUCTUS_NATIVE_PGDATABASE", "ductus?host=x"], ["DUCTUS_NATIVE_PGDATABASE", "a-b"],
    // Passwords.
    ["DUCTUS_NATIVE_PGPASSWORD", ""], ["DUCTUS_NATIVE_PGPASSWORD", "a\nb"], ["DUCTUS_NATIVE_PGPASSWORD", "a\rb"], ["DUCTUS_NATIVE_PGPASSWORD", "a\0b"],
  ];
  for (const [name, value] of refused) assert.throws(() => nativeConfig({ [name]: value }), new RegExp(name), `${name}=${JSON.stringify(value)}`);
  assert.throws(() => nativeConfig({ NODE_ENV: "production" }), /production/);
});

test("children never see the caller's libpq, psql or dbmate variables", () => {
  const env = { PATH: "/bin", PGHOST: "db.example.invalid", pgservice: "x", PGPASSFILE: "/x", PSQLRC: "/x", DBMATE_URL: "x", DATABASE_URL: "kept" };
  const cleaned = childEnv(env, DEFAULT);
  assert.deepEqual(cleaned, { PATH: "/bin", DATABASE_URL: "kept", PGPASSWORD: "ductus-local-only" });
});

test("the dbmate URL is the db:migrate URL on the native port, with an encoded password", () => {
  assert.equal(dbmateUrl(DEFAULT), "postgres://ductus:ductus-local-only@127.0.0.1:5432/ductus?sslmode=disable&role=ductus_migrator");
  assert.equal(dbmateUrl({ ...DEFAULT, host: "::1", password: "a@b/c?d#e" }), "postgres://ductus:a%40b%2Fc%3Fd%23e@[::1]:5432/ductus?sslmode=disable&role=ductus_migrator");
});

test("test:db:native is the pg_prove of test:db over loopback", async () => {
  assert.match(pkg.scripts["test:db"], /pg_prove -U ductus -d ductus --recurse --ext \.sql \/db\/tests$/, "test:db is unchanged");
  assert.equal(pkg.scripts["test:db:native"], "node scripts/db/native-db.mjs test");
  assert.equal(pkg.scripts["db:up:native"], "node scripts/db/native-db.mjs up");
  assert.match(pkg.scripts["test:demo"], /scripts\/db\/native-db\.test\.mjs/, "CI runs this file through pnpm test");
  const { calls, run } = recorder(() => 3);
  assert.equal(await testDb({ env: { PGHOST: "db.example.invalid" }, run }), 3, "pg_prove's exit code is the result");
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ["pg_prove", "-h", "127.0.0.1", "-p", "5432", "-U", "ductus", "-d", "ductus", "--recurse", "--ext", ".sql", "db/tests"],
  ]);
  assert.equal(calls[0].options.env.PGHOST, undefined);
  assert.deepEqual(pgProveArgs({ ...DEFAULT, port: "54329" }).slice(0, 4), ["-h", "127.0.0.1", "-p", "54329"]);
});

test("db:up:native on a running cluster runs the db:migrate files in order", async () => {
  const { calls, run } = recorder();
  await up({ env: { DUCTUS_AUTH_LOCAL_PASSWORD: "s".repeat(16) }, run, isRoot: true, log: quiet });
  const steps = calls.map((call) => [call.command, call.args.includes("up") ? "dbmate up" : sqlFile(call) ?? call.args.at(-1)]);
  assert.deepEqual(steps.map(([command]) => command), ["pg_isready", "runuser", "runuser", process.execPath, "runuser", "runuser"]);
  assert.deepEqual(calls.slice(2).map((call) => sqlFile(call) ?? "dbmate"), ["db/local/migrator.sql", "dbmate", "db/local/app-login.sql", "db/local/auth-login.sql"]);
  // Provisioning on the socket as the cluster superuser, never over TCP.
  for (const call of calls.filter(({ command }) => command === "runuser")) {
    assert.deepEqual(call.args.slice(0, 8), ["-u", "postgres", "--", "psql", "-h", "/var/run/postgresql", "-p", "5432"]);
    assert.ok(!call.args.includes("127.0.0.1"));
  }
  assert.equal(calls[1].options.input, BOOTSTRAP_SQL);
  assert.ok(calls[1].args.includes("ductus_password=ductus-local-only"));
  const dbmate = calls[3].args;
  assert.deepEqual(dbmate.slice(1), ["--url", dbmateUrl(DEFAULT), "--no-dump-schema", "--wait", "up", "--strict"]);
  assert.ok(calls[5].args.includes(`auth_password=${"s".repeat(16)}`));
});

test("without DUCTUS_AUTH_LOCAL_PASSWORD a random one is made per run; a short one is refused before anything runs", async () => {
  const seen = [];
  for (let i = 0; i < 2; i += 1) {
    const { calls, run } = recorder();
    await up({ env: {}, run, isRoot: true, log: quiet });
    const arg = calls.at(-1).args.find((a) => a.startsWith("auth_password="));
    assert.match(arg, /^auth_password=[0-9a-f]{48}$/);
    seen.push(arg);
  }
  assert.notEqual(seen[0], seen[1]);
  const { calls, run } = recorder();
  await assert.rejects(up({ env: { DUCTUS_AUTH_LOCAL_PASSWORD: "short" }, run, isRoot: true, log: quiet }), /at least 16/);
  assert.deepEqual(calls, []);
});

test("a stopped cluster is started as root and waited for; not as another user", async () => {
  let answers = 0;
  const { calls, run } = recorder((command) => (command === "pg_isready" ? (answers++ < 3 ? 2 : 0) : 0));
  await up({ env: {}, run, isRoot: true, wait: async () => {}, log: quiet });
  assert.deepEqual(calls.slice(0, 5).map(({ command, args }) => [command, args[0]]), [
    ["pg_isready", "-q"], ["service", "postgresql"], ["pg_isready", "-q"], ["pg_isready", "-q"], ["pg_isready", "-q"],
  ]);

  const down = recorder((command) => (command === "pg_isready" ? 2 : 0));
  await assert.rejects(up({ env: {}, run: down.run, isRoot: true, wait: async () => {}, log: quiet }), /did not become ready/);
  assert.equal(down.calls.filter(({ command }) => command === "pg_isready").length, READY_ATTEMPTS + 1);
  assert.ok(!down.calls.some(({ command }) => command === "runuser"), "nothing is provisioned on a cluster that never answered");

  const user = recorder((command) => (command === "pg_isready" ? 2 : 0));
  await assert.rejects(up({ env: {}, run: user.run, isRoot: false, log: quiet }), /does not answer/);
  assert.deepEqual(user.calls.map(({ command }) => command), ["pg_isready"]);
});

test("not as root the provisioning psql runs as the calling user on the socket", async () => {
  const { calls, run } = recorder();
  await up({ env: {}, run, isRoot: false, log: quiet });
  assert.deepEqual(calls[1].args.slice(0, 4), ["-h", "/var/run/postgresql", "-p", "5432"]);
  assert.equal(calls[1].command, "psql");
});

test("the first failing step stops the run", async () => {
  const order = ["bootstrap", "migrator.sql", "dbmate", "app-login.sql", "auth-login.sql"];
  for (const failing of order) {
    let index = -1;
    const { calls, run } = recorder((command) => {
      if (command === "pg_isready") return 0;
      index += 1;
      return order[index] === failing ? 1 : 0;
    });
    await assert.rejects(up({ env: {}, run, isRoot: true, log: quiet }), /failed/);
    assert.equal(calls.length, 1 + order.indexOf(failing) + 1, `stops at ${failing}`);
  }
});

test("a second db:up:native runs the same idempotent steps and nothing more", async () => {
  const first = recorder();
  const second = recorder();
  const env = { DUCTUS_AUTH_LOCAL_PASSWORD: "t".repeat(20) };
  await up({ env, run: first.run, isRoot: true, log: quiet });
  await up({ env, run: second.run, isRoot: true, log: quiet });
  const shape = (calls) => calls.map(({ command, args, options }) => [command, args, options.input, options.stdinFile]);
  assert.deepEqual(shape(second.calls), shape(first.calls));
  assert.match(BOOTSTRAP_SQL, /WHERE NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_roles/);
  assert.match(BOOTSTRAP_SQL, /WHERE NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_database/);
  assert.match(BOOTSTRAP_SQL, /%I.*%L/, "names and the password are quoted by format()");
});
