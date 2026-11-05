// D-91 (3), DAN-71: the migration runner holds an advisory lock on its own
// connection for the whole dbmate run and stops dbmate when the lock is lost.
// Fakes stand in for the pg client and the dbmate child; the real lock against
// PostgreSQL is tested in tests/integration/migrate-lock.integration.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";

import { dbmateArgs, dbmateBinary, LOCK_KEY, runLocked, startDbmate } from "../db/migrate-locked.mjs";

class FakeClient extends EventEmitter {
  // lock: ok | fail | wait (pending until end()); heartbeat: ok | fail | hang;
  // unlock: ok | hang; end: ok | hang.
  constructor({ lock = "ok", heartbeat = "ok", unlock = "ok", end = "ok" } = {}) {
    super();
    this.queries = [];
    this.ended = false;
    this.lock = lock;
    this.heartbeat = heartbeat;
    this.unlock = unlock;
    this.endMode = end;
    this.waiting = null;
  }
  query(text, params) {
    this.queries.push(params ? `${text} ${params.join(",")}` : text);
    if (text.includes("pg_advisory_lock(") && this.lock === "fail") return Promise.reject(new Error("lock timeout"));
    if (text.includes("pg_advisory_lock(") && this.lock === "wait") return new Promise((_, reject) => (this.waiting = reject));
    if (text.includes("pg_advisory_unlock(") && this.unlock === "hang") return new Promise(() => {});
    if (text === "SELECT 1" && this.heartbeat === "fail") return Promise.reject(new Error("gone"));
    if (text === "SELECT 1" && this.heartbeat === "hang") return new Promise(() => {});
    return Promise.resolve({ rows: [] });
  }
  end() {
    this.ended = true;
    this.waiting?.(new Error("Connection terminated"));
    return this.endMode === "hang" ? new Promise(() => {}) : Promise.resolve();
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

/** The run's result, or "pending" when it has not finished within `ms`. */
function settled(promise, ms = 2000) {
  let timer;
  const late = new Promise((resolve) => (timer = setTimeout(resolve, ms, "pending")));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

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

// #1051 Codex P2: a release on a connection that hangs once dbmate has
// exited must not keep the run waiting, and neither may closing it.
test("a lock release or a close that hangs ends the run with 1 in bounded time", async () => {
  for (const options of [{ unlock: "hang" }, { unlock: "hang", end: "hang" }]) {
    const h = harness(options);
    const done = h.run();
    await tick();
    h.child.exit(0);
    assert.equal(await settled(done), 1, JSON.stringify(options));
    assert.match(h.logs.join("\n"), /release did not finish/);
  }
  const closing = harness({ end: "hang" });
  const done = closing.run();
  await tick();
  closing.child.exit(0);
  assert.equal(await settled(done), 0, "a hanging close after a release is bounded and keeps dbmate's code");
});

// #1051 Codex P2: SIGINT or SIGTERM while the runner waits for the lock
// cancels the run; it must not start dbmate once the lock is granted.
test("a run cancelled before dbmate starts never starts it and fails", async () => {
  const early = harness();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await early.run({ signal: controller.signal }), 1);
  assert.equal(early.started(), 0);

  const waiting = harness({ lock: "wait" });
  const cancel = new AbortController();
  const done = waiting.run({ signal: cancel.signal });
  await tick();
  assert.equal(waiting.started(), 0, "still waiting for the lock");
  cancel.abort();
  assert.equal(await settled(done), 1);
  assert.equal(waiting.started(), 0);
  assert.ok(waiting.client.ended, "the lock connection is closed, so the pending lock fails");
  assert.match(waiting.logs.join("\n"), /cancelled before dbmate started/);
  assert.doesNotMatch(waiting.logs.join("\n"), /could not take the lock/);
});

test("a run cancelled while dbmate runs stops dbmate and fails, even if dbmate then exits 0", async () => {
  const h = harness();
  const controller = new AbortController();
  const done = h.run({ signal: controller.signal, heartbeatMs: 1000 });
  await tick();
  controller.abort();
  assert.deepEqual(h.child.signals, ["SIGTERM"]);
  h.child.exit(0);
  assert.equal(await done, 1);
});

test("dbmate always runs up --strict without a schema dump, and the URL is passed only to dbmate", () => {
  const args = dbmateArgs("postgres://u:secret@h/d");
  assert.deepEqual(args.slice(1), ["--url", "postgres://u:secret@h/d", "--no-dump-schema", "--wait", "up", "--strict"]);
  // The platform binary, not node_modules/dbmate/dist/cli.js.
  assert.equal(args[0], dbmateBinary());
  assert.match(args[0], /@dbmate[\\/][^\\/]+[\\/]bin[\\/]dbmate(\.exe)?$/);
});

// #1051 Codex P1: the npm dbmate command is a Node wrapper that runs the
// binary with spawnSync, so a signal to it never reached dbmate. The runner's
// child must be dbmate itself, and SIGTERM must leave no dbmate behind.
test("the runner's child is the dbmate process itself and SIGTERM stops it", async () => {
  const marker = `ductus_lock_test_${process.pid}_${Date.now()}`;
  // Nothing listens on port 1, so dbmate keeps waiting for the server (--wait).
  const child = startDbmate(`postgres://x@127.0.0.1:1/${marker}?sslmode=disable`, { stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve(signal ?? code)));
  try {
    await tick(300);
    assert.equal(child.exitCode, null, "dbmate is waiting for the server");
    if (existsSync("/proc/self/exe")) {
      assert.equal(realpathSync(`/proc/${child.pid}/exe`), realpathSync(dbmateBinary()), "the child runs the dbmate binary");
    }
    child.kill("SIGTERM");
    assert.equal(await settled(exited, 5000), "SIGTERM");
    if (existsSync("/proc/self/cmdline")) {
      await tick(100);
      const left = readdirSync("/proc").filter((pid) => {
        if (!/^\d+$/.test(pid)) return false;
        try {
          return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(marker);
        } catch {
          return false;
        }
      });
      assert.deepEqual(left, [], "no dbmate process survives SIGTERM");
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

test("pnpm db:migrate applies migrations only through the locked runner", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(scripts["db:migrate"], /node scripts\/db\/migrate-locked\.mjs --url "[^"]+role=ductus_migrator"/);
  assert.doesNotMatch(scripts["db:migrate"], /\bdbmate\b[^&]*\sup\b/);
});
