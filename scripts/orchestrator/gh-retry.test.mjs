import assert from "node:assert/strict";
import { test } from "node:test";

import { openPrNumbers, readOpenPrs, repoId, transientError, withRetry } from "./gh.mjs";
import { requiredOfMain } from "./merge-ready.mjs";

const gh = (stderr) => Object.assign(new Error("Command failed: gh api"), { stderr });

test("transient GitHub errors are told apart from errors worth no retry", () => {
  for (const e of [gh("HTTP 502: Bad Gateway"), gh("gh: HTTP 504"), gh("HTTP 503"), new Error("504 Gateway Time-out"), new Error("read ETIMEDOUT"), new Error("socket hang up"), gh("connect ECONNRESET")]) {
    assert.equal(transientError(e), true, e.stderr ?? e.message);
  }
  for (const e of [gh("HTTP 404: Not Found"), gh("HTTP 403: Resource not accessible"), new Error("Unexpected token < in JSON"), gh("HTTP 422"), undefined]) {
    assert.equal(transientError(e), false, String(e?.stderr ?? e?.message));
  }
});

test("Codex CLI #1197 (1042d636): gh's Go network errors are transient and retried", async () => {
  // As gh prints them (cli/cli#1761).
  const tls = gh('Post "https://api.github.com/graphql": net/http: TLS handshake timeout');
  const reset = gh("read tcp 192.0.2.1:50000->140.82.112.6:443: read: connection reset by peer");
  for (const e of [tls, reset]) assert.equal(transientError(e), true, e.stderr);
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw tls;
    if (calls === 2) throw reset;
    return "ok";
  }, { sleep: async () => {}, waitMs: 0 });
  assert.deepEqual([value, calls], ["ok", 3]);
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

test("Codex CLI #1197: a failed repo read is not cached, and required checks of main are retried, then null", async () => {
  // repoId: a 502 is not kept, so the retry asks GitHub again and gets the answer.
  await assert.rejects(repoId({ json: async () => { throw gh("HTTP 502"); } }), /gh api/);
  assert.deepEqual(await repoId({ json: async () => ({ owner: { login: "o" }, name: "r" }) }), { owner: "o", repo: "r" });

  const retry = (fn) => withRetry(fn, { sleep: async () => {}, waitMs: 0, tries: 3 });
  const protection = { protection: { required_status_checks: { checks: [{ context: "Security scanners", app_id: 15368 }], contexts: ["Security scanners"] } } };
  // One 502 on the repo read and one on the branch read: both retried, the list is read.
  let repoCalls = 0;
  let mainCalls = 0;
  const required = await requiredOfMain({
    retry,
    repo: async () => { repoCalls += 1; if (repoCalls === 1) throw gh("HTTP 502"); return { owner: "o", repo: "r" }; },
    json: async (args) => { mainCalls += 1; assert.equal(args[1], "repos/o/r/branches/main"); if (mainCalls === 1) throw gh("HTTP 504"); return protection; },
  });
  assert.deepEqual(required, [{ context: "Security scanners", appId: 15368 }]);
  assert.deepEqual([repoCalls, mainCalls], [2, 2]);
  // Still failing after the retries: null (every PR then reads UNREAD), not a thrown exit.
  assert.equal(await requiredOfMain({ retry, repo: async () => { throw gh("HTTP 502"); }, json: async () => protection }), null);
  assert.equal(await requiredOfMain({ retry, repo: async () => ({ owner: "o", repo: "r" }), json: async () => { throw gh("HTTP 403"); } }), null);
});
