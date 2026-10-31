// D-91 (3), DAN-71: the migration runner holds an advisory lock on its own
// connection for the whole dbmate run and stops dbmate when the lock is lost.
// Fakes stand in for the pg client and the dbmate child; the real lock against
// PostgreSQL is tested in tests/integration/migrate-lock.integration.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import { dbmateArgs, LOCK_KEY, runLocked } from "../db/migrate-locked.mjs";

class FakeClient extends EventEmitter {
  constructor({ lock = "ok", heartbeat = "ok" } = {}) {
    super();
    this.queries = [];
    this.ended = false;
    this.lock = lock;
    this.heartbeat = heartbeat;
  }
  query(text, params) {
    this.queries.push(params ? `${text} ${params.join(",")}` : text);
    if (text.includes("pg_advisory_lock(") && this.lock === "fail") return Promise.reject(new Error("lock timeout"));
    if (text === "SELECT 1" && this.heartbeat === "fail") return Promise.reject(new Error("gone"));
    if (text === "SELECT 1" && this.heartbeat === "hang") return new Promise(() => {});
    return Promise.resolve({ rows: [] });
  }
  end() {
    this.ended = true;
    return Promise.resolve();
  }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.signals = [];
  }
  kill(signal) {
    this.signals.push(signal);
    return true;
  }
  exit(code) {
    this.exitCode = code;
    this.emit("exit", code);
  }
}

function harness(clientOptions, { connectFails = false } = {}) {
  const client = new FakeClient(clientOptions);
  const child = new FakeChild();
  const logs = [];
  let started = 0;
  let queriesAtStart = null;
  const run = (options = {}) =>
    runLocked({
      connect: async () => {
        if (connectFails) throw new Error("refused");
        return client;
      },
      start: () => {
        started += 1;
        queriesAtStart = [...client.queries];
        return child;
      },
      log: (line) => logs.push(line),
      heartbeatMs: 5,
      killGraceMs: 5,
      ...options,
    });
  return { client, child, logs, run, started: () => started, queriesAtStart: () => queriesAtStart };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("the lock is taken before dbmate starts and released after it, and the exit code passes through", async () => {
  for (const code of [0, 3]) {
    const h = harness();
    const done = h.run({ heartbeatMs: 1000 });
    await tick();
    assert.equal(h.started(), 1);
    assert.deepEqual(h.queriesAtStart(), ["SET lock_timeout = 600000", `SELECT pg_catalog.pg_advisory_lock($1::bigint) ${LOCK_KEY}`]);
    h.child.exit(code);
    assert.equal(await done, code);
    assert.equal(h.client.queries.at(-1), `SELECT pg_catalog.pg_advisory_unlock($1::bigint) ${LOCK_KEY}`);
    assert.ok(h.client.ended);
  }
});

test("dbmate never starts when the lock connection or the lock cannot be had", async () => {
  const refused = harness({}, { connectFails: true });
  assert.equal(await refused.run(), 1);
  assert.equal(refused.started(), 0);

  const held = harness({ lock: "fail" });
  assert.equal(await held.run(), 1);
  assert.equal(held.started(), 0);
  assert.ok(held.client.ended);
  assert.match(held.logs.join("\n"), /could not take the lock/);
});

test("a lost lock connection stops dbmate and the run fails, even if dbmate then exits 0", async () => {
  for (const event of ["error", "end"]) {
    const h = harness();
    const done = h.run({ heartbeatMs: 1000 });
    await tick();
    h.client.emit(event, new Error("boom"));
    assert.deepEqual(h.child.signals, ["SIGTERM"]);
    h.child.exit(0);
    assert.equal(await done, 1, event);
    assert.match(h.logs.join("\n"), /Migration lock lost/);
    assert.ok(!h.client.queries.some((q) => q.includes("pg_advisory_unlock")), "no unlock on a lost session");
  }
});

test("a failed or hanging heartbeat counts as a lost lock", async () => {
  for (const heartbeat of ["fail", "hang"]) {
    const h = harness({ heartbeat });
    const done = h.run();
    await tick(60);
    assert.equal(h.child.signals[0], "SIGTERM", heartbeat);
    h.child.exit(0);
    assert.equal(await done, 1, heartbeat);
    assert.match(h.logs.join("\n"), heartbeat === "fail" ? /heartbeat failed/ : /heartbeat timed out/);
  }
});

test("a dbmate that ignores SIGTERM is killed", async () => {
  const h = harness();
  const done = h.run({ heartbeatMs: 1000 });
  await tick();
  h.client.emit("end");
  await tick(20);
  assert.deepEqual(h.child.signals, ["SIGTERM", "SIGKILL"]);
  h.child.exit(null);
  assert.equal(await done, 1);
});

test("dbmate always runs up --strict without a schema dump, and the URL is passed only to dbmate", () => {
  const args = dbmateArgs("postgres://u:secret@h/d");
  assert.deepEqual(args.slice(1), ["--url", "postgres://u:secret@h/d", "--no-dump-schema", "--wait", "up", "--strict"]);
  assert.match(args[0], /dbmate[\\/]dist[\\/]cli\.js$/);
});

test("pnpm db:migrate applies migrations only through the locked runner", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(scripts["db:migrate"], /node scripts\/db\/migrate-locked\.mjs --url "[^"]+role=ductus_migrator"/);
  assert.doesNotMatch(scripts["db:migrate"], /\bdbmate\b[^&]*\sup\b/);
});
