import assert from "node:assert/strict";
import { test } from "node:test";

import { openPrNumbers, readOpenPrs, transientError, withRetry } from "./gh.mjs";

const gh = (stderr) => Object.assign(new Error("Command failed: gh api"), { stderr });

test("transient GitHub errors are told apart from errors worth no retry", () => {
  for (const e of [gh("HTTP 502: Bad Gateway"), gh("gh: HTTP 504"), gh("HTTP 503"), new Error("504 Gateway Time-out"), new Error("read ETIMEDOUT"), new Error("socket hang up"), gh("connect ECONNRESET")]) {
    assert.equal(transientError(e), true, e.stderr ?? e.message);
  }
  for (const e of [gh("HTTP 404: Not Found"), gh("HTTP 403: Resource not accessible"), new Error("Unexpected token < in JSON"), gh("HTTP 422"), undefined]) {
    assert.equal(transientError(e), false, String(e?.stderr ?? e?.message));
  }
});

test("withRetry repeats a 502/504 up to the limit with growing waits, and stops at once on a 404", async () => {
  const waits = [];
  const sleep = async (ms) => waits.push(ms);
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw gh(calls === 1 ? "HTTP 502" : "HTTP 504");
    return "ok";
  }, { sleep, waitMs: 10 });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);

  calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw gh("HTTP 502"); }, { sleep, waitMs: 1, tries: 4 }), /gh api/);
  assert.equal(calls, 4, "gives up after the limit");

  calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw gh("HTTP 404"); }, { sleep, waitMs: 1 }));
  assert.equal(calls, 1, "a 404 is not repeated");
});

test("openPrNumbers reads the light REST list and refuses an entry without a number", async () => {
  let path;
  assert.deepEqual(await openPrNumbers({ list: async (p) => ((path = p), [{ number: 9 }, { number: 3 }]) }), [3, 9]);
  assert.equal(path, "repos/{owner}/{repo}/pulls?state=open&per_page=100");
  await assert.rejects(openPrNumbers({ list: async () => [{ number: 3 }, {}] }), /without a number/);
});

test("readOpenPrs: numbers first, then one PR at a time with retries; an unreadable PR stays in the output", async () => {
  const order = [];
  const tries = new Map();
  const retry = (fn) => withRetry(fn, { sleep: async () => {}, waitMs: 0, tries: 3 });
  const out = await readOpenPrs(async (n) => {
    order.push(n);
    tries.set(n, (tries.get(n) ?? 0) + 1);
    if (n === 5 && tries.get(n) < 2) throw gh("HTTP 504");
    if (n === 7) throw gh("HTTP 502");
    return `pr${n}`;
  }, { numbers: async () => [3, 5, 7], retry });
  assert.deepEqual(out, [
    { number: 3, value: "pr3" },
    { number: 5, value: "pr5" },
    { number: 7, error: "HTTP 502" },
  ]);
  assert.deepEqual(order, [3, 5, 5, 7, 7, 7], "one PR at a time, in order, retried");
  // A failed number list is a failure, never an empty list.
  await assert.rejects(readOpenPrs(async () => "x", { numbers: async () => { throw gh("HTTP 404"); }, retry }));
});
