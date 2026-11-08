// DAN-346: the teacher provision reaches the Compose container by default and,
// with --native, only the native runner's local socket. Nothing here runs psql.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TOOLS } from "./native/tools.mjs";
import { provision, psqlArgs } from "./provision-teacher.mjs";

const SQL = readFileSync(new URL("../../db/local/provision-demo-teacher.sql", import.meta.url), "utf8");
const BASE = join(tmpdir(), "provision-teacher-local-app-data");
const HOME = join(BASE, "Ductus");
const PINNED = async () => TOOLS.postgres.tree;

function recorder(status = 0) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status, stdout: "", stderr: "" };
  };
  return { calls, spawn };
}

const quiet = { log: () => {}, error: () => {} };
const never = () => assert.fail("nothing may run");

test("without --native the Docker command and arguments are those of before", async () => {
  // The arguments as they were before --native existed, written out.
  const before = (account) => ["compose", "exec", "-T", "postgres", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
    "-v", `account=${account}`, "-U", "ductus", "-d", "ductus"];
  for (const [argv, account] of [[[], "demo-teacher"], [["demo-teacher"], "demo-teacher"], [["demo-teacher-2"], "demo-teacher-2"]]) {
    assert.deepEqual(psqlArgs(argv), before(account));
    const { calls, spawn } = recorder();
    assert.equal(await provision(argv, { spawn, ...quiet, hash: never, exists: never }), 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "docker");
    assert.deepEqual(calls[0].args, before(account));
    assert.equal(calls[0].options.input, SQL);
    assert.equal(calls[0].options.timeout, 25_000);
    // The child inherits the environment, as before.
    assert.equal("env" in calls[0].options, false);
  }
});

test("--native runs the pinned psql on the runner's socket, never TCP, without steering variables", async () => {
  const env = {
    LOCALAPPDATA: BASE, PATH: "kept", PGHOST: "db.example.test", pghostaddr: "192.0.2.1", PGSERVICE: "remote",
    PGPASSWORD: "local-only", PSQLRC: "elsewhere", PSQL_HISTORY: "elsewhere",
  };
  for (const [argv, account] of [[["--native"], "demo-teacher"], [["--native", "demo-teacher-2"], "demo-teacher-2"]]) {
    const { calls, spawn } = recorder();
    assert.equal(await provision(argv, { env, platform: "win32", spawn, exists: () => true, hash: PINNED, ...quiet }), 0);
    assert.equal(calls.length, 1);
    const { command, args, options } = calls[0];
    assert.equal(command, join(HOME, "native", `postgres-${TOOLS.postgres.version}`, "bin", "psql.exe"));
    assert.deepEqual(args, ["-h", join(HOME, "native-data", "s"), "-p", "54329", "-U", "ductus", "-d", "ductus",
      "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", `account=${account}`]);
    for (const arg of args) assert.doesNotMatch(arg, /127\.0\.0\.1|localhost|:\/\/|host=/);
    assert.equal(options.input, SQL);
    assert.equal(options.timeout, 25_000);
    assert.equal(options.env.PATH, "kept");
    assert.equal(options.env.PSQLRC, join(HOME, "native-data", "psqlrc"));
    for (const name of ["PGHOST", "pghostaddr", "PGSERVICE", "PSQL_HISTORY"]) assert.equal(name in options.env, false, name);
  }
});

test("anything but [--native] [demo-teacher-2] is refused before anything runs", async () => {
  for (const argv of [["x"], ["demo-teacher-3"], ["--native", "--native"], ["demo-teacher-2", "--native"],
    ["--native", "demo-teacher", "demo-teacher-2"], ["demo-teacher", "demo-teacher-2"], ["--NATIVE"]]) {
    const errors = [];
    const code = await provision(argv, { env: { LOCALAPPDATA: BASE }, platform: "win32", spawn: never, exists: never, hash: never, log: () => {}, error: (line) => errors.push(line) });
    assert.equal(code, 1, argv.join(" "));
    assert.match(errors[0], /accepts no argument or one of: demo-teacher-2/);
  }
});

test("--native is refused, without running psql, off Windows or with a missing or changed PostgreSQL", async () => {
  const cases = [
    { platform: "linux", exists: () => true, hash: PINNED },
    { platform: "darwin", exists: () => true, hash: PINNED },
    { platform: "win32", exists: () => false, hash: never },
    { platform: "win32", exists: () => true, hash: async () => "0".repeat(64) },
  ];
  for (const options of cases) {
    const errors = [];
    const code = await provision(["--native"], { env: { LOCALAPPDATA: BASE }, spawn: never, log: () => {}, error: (line) => errors.push(line), ...options });
    assert.equal(code, 1);
    assert.match(errors[0], /^Teacher provision refused: /);
  }
  // LOCALAPPDATA must be an absolute path (tools.mjs).
  assert.equal(await provision(["--native"], { env: { LOCALAPPDATA: "relative" }, platform: "win32", spawn: never, exists: never, hash: never, ...quiet }), 1);
});

test("a failing psql gives exit 1 and a message without SQL or credentials, on both paths", async () => {
  for (const [argv, extra] of [[[], {}], [["--native"], { platform: "win32", exists: () => true, hash: PINNED }]]) {
    const errors = [];
    const { spawn } = recorder(3);
    const code = await provision(argv, { env: { LOCALAPPDATA: BASE, PGPASSWORD: "local-only" }, spawn, log: () => {}, error: (line) => errors.push(line), ...extra });
    assert.equal(code, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^Teacher provision failed: /);
    assert.doesNotMatch(errors[0], /local-only|SELECT|INSERT|account=/i);
  }
});
