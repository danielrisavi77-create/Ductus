// Plan napada #231, 7.4 (and 7.1/3.7 through the real carry-over code): a
// stuck or failing GitHub call must not hold the evaluator and must carry
// nothing. Uses a fake fetch; no network.
import test from "node:test";
import assert from "node:assert/strict";

import { API_CALL_TIMEOUT_MS, CARRY_BUDGET_MS, carriedHeads, createApi } from "./review-gate-api.mjs";

const head = "a".repeat(40);
const earlier = "b".repeat(40);
const baseSha = "e".repeat(40);
const mainParent = "f".repeat(40);
const ownerLogin = "danielrisavi77-create";
const pr = { head: { sha: head }, base: { sha: baseSha } };
const quiet = () => {};

const review = (sha) => ({
  body: `Agent-Review: claude:b:reviewer\nReview-Head: ${sha}\nReview-Verdict: PASS\n`,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: "2026-10-12T10:00:00Z",
});
const comments = [review(earlier)];
const files = { files: [{ filename: "a.mjs", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b", sha: "1".repeat(40) }] };

const json = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) });

// head is a clean merge of main on top of `earlier`; both compares are identical.
function routes(path) {
  if (path.endsWith(`/commits/${head}`)) return { sha: head, parents: [{ sha: earlier }, { sha: mainParent }] };
  if (path.endsWith(`/commits/${earlier}`)) return { sha: earlier, parents: [{ sha: "0".repeat(40) }] };
  if (path.includes("/compare/")) return files;
  throw new Error(`unexpected ${path}`);
}

// Never answers. Honours the signal like the real fetch unless `ignoreSignal`;
// a ref'd timer keeps the event loop alive as an open socket would.
const hanging = ({ ignoreSignal = false } = {}) => (url, init) =>
  new Promise((resolve, reject) => {
    const keepAlive = setTimeout(() => reject(new Error("fake fetch was never aborted")), 10_000);
    if (!ignoreSignal) {
      init.signal.addEventListener("abort", () => {
        clearTimeout(keepAlive);
        reject(init.signal.reason);
      });
    } else {
      init.signal.addEventListener("abort", () => clearTimeout(keepAlive));
    }
  });

const fakeFetch = (stuck = () => false, options) => {
  const hang = hanging(options);
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace("https://api.test", "");
    calls.push(path);
    if (stuck(path)) return hang(url, init);
    return json(routes(path));
  };
  return { fetchImpl, calls };
};

const elapsed = async (work) => {
  const start = performance.now();
  const value = await work();
  return { value, ms: performance.now() - start };
};

test("the limits are finite and the budget covers more than one call", () => {
  assert.ok(Number.isFinite(API_CALL_TIMEOUT_MS) && API_CALL_TIMEOUT_MS > 0);
  assert.ok(Number.isFinite(CARRY_BUDGET_MS) && CARRY_BUDGET_MS > API_CALL_TIMEOUT_MS);
});

test("the fake reaches a carry, so the timeout tests below exercise a real path", async () => {
  const { fetchImpl } = fakeFetch();
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t", timeoutMs: 1000 });
  assert.deepEqual([...(await carriedHeads(api, "o", "r", pr, comments, { log: quiet }))], [earlier]);
});

test("a call that never answers is aborted after its own limit", async () => {
  const { fetchImpl } = fakeFetch(() => true);
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t", timeoutMs: 50 });
  const { ms } = await elapsed(() => assert.rejects(api("/repos/o/r/pulls/1"), { name: "TimeoutError" }));
  assert.ok(ms < 2000, `took ${ms} ms`);
});

test("a fetch that ignores its signal still cannot hold the call", async () => {
  const { fetchImpl } = fakeFetch(() => true, { ignoreSignal: true });
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t", timeoutMs: 50 });
  await assert.rejects(api("/repos/o/r/pulls/1"), { name: "TimeoutError" });
});

test("a body that never finishes is covered by the same limit", async () => {
  const fetchImpl = async (url, init) => ({
    ok: true,
    status: 200,
    json: () => hanging()(url, init),
  });
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t", timeoutMs: 50 });
  await assert.rejects(api("/x"), { name: "TimeoutError" });
});

for (const [name, stuck] of [
  ["the first-parent walk", (path) => path.includes(`/commits/${earlier}`)],
  ["the compare for the current head", (path) => path.includes(`...${head}`)],
  ["the compare for the earlier head", (path) => path.includes(`...${earlier}`)],
]) {
  test(`a stuck call in ${name} carries nothing and returns`, async () => {
    const { fetchImpl, calls } = fakeFetch(stuck);
    const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t", timeoutMs: 50 });
    const lines = [];
    const { value, ms } = await elapsed(() =>
      carriedHeads(api, "o", "r", pr, comments, { log: (line) => lines.push(line) }),
    );
    assert.equal(value.size, 0);
    assert.ok(calls.some(stuck), "the stuck call was reached");
    assert.ok(ms < 2000, `took ${ms} ms`);
    assert.ok(lines.some((line) => /failed closed/.test(line)), lines.join("\n"));
  });
}

test("the carry-over budget ends the check even when each call is within its own limit", async () => {
  // Every call takes 40 ms, under the 1 s per-call limit; the budget is 60 ms.
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(json(routes(url.replace("https://api.test", "")))), 40);
      init.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal.reason);
      });
    });
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t", timeoutMs: 1000 });
  const { value, ms } = await elapsed(() => carriedHeads(api, "o", "r", pr, comments, { budgetMs: 60, log: quiet }));
  assert.equal(value.size, 0);
  assert.ok(ms < 1000, `took ${ms} ms`);
});

test("an unavailable earlier commit (404) carries nothing and does not throw", async () => {
  const fetchImpl = async (url) =>
    url.includes(`/commits/${earlier}`)
      ? { ok: false, status: 404, text: async () => "Not Found" }
      : json(routes(url.replace("https://api.test", "")));
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
  assert.equal((await carriedHeads(api, "o", "r", pr, comments, { log: quiet })).size, 0);
});
