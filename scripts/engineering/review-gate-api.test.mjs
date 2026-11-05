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
const pr = { head: { sha: head }, base: { sha: baseSha, ref: "main" } };
const quiet = () => {};

const review = (sha) => ({
  body: `Agent-Review: claude:b:reviewer\nReview-Head: ${sha}\nReview-Verdict: PASS\n`,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: "2026-10-12T10:00:00Z",
});
const comments = [review(earlier)];
const files = {
  merge_base_commit: { sha: baseSha },
  files: [{ filename: "a.mjs", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b", sha: "1".repeat(40) }],
};
// F-046: the live tip of main and a whole tree for every compared side.
const tipAndTree = (path) => {
  if (path === "/repos/o/r/branches/main") return { commit: { sha: baseSha } };
  if (path.includes("/git/trees/")) return { truncated: false, tree: [{ path: "a.mjs", mode: "100644", type: "blob" }] };
  return undefined;
};

const json = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) });

// head is a clean merge of main on top of `earlier`; both compares are identical.
function routes(path) {
  const served = tipAndTree(path);
  if (served) return served;
  if (path.endsWith(`/commits/${head}`)) return { sha: head, parents: [{ sha: earlier }, { sha: mainParent }] };
  if (path.endsWith(`/commits/${earlier}`)) return { sha: earlier, parents: [{ sha: "0".repeat(40) }] };
  if (path.includes(`/compare/main...${mainParent}`)) return { status: "behind", files: [] };
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

// #231, question 1: the runner marks a merge as a base merge only when GitHub
// says its second parent is in the base branch.
test("a merge whose second parent is not in the base branch carries nothing", async () => {
  for (const status of ["ahead", "diverged", undefined]) {
    const fetchImpl = async (url) => {
      const path = url.replace("https://api.test", "");
      if (path.includes(`/compare/main...${mainParent}`)) return json({ status, files: [] });
      return json(routes(path));
    };
    const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
    assert.equal((await carriedHeads(api, "o", "r", pr, comments, { log: quiet })).size, 0, String(status));
  }
});

test("the base check asks about the second parent against the base branch name", async () => {
  const { fetchImpl, calls } = fakeFetch();
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
  assert.equal((await carriedHeads(api, "o", "r", pr, comments, { log: quiet })).size, 1);
  assert.ok(calls.some((path) => path === `/repos/o/r/compare/main...${mainParent}?per_page=1`), calls.join("\n"));
  const noRef = { ...pr, base: { sha: baseSha } };
  assert.equal((await carriedHeads(api, "o", "r", noRef, comments, { log: quiet })).size, 0);
});

test("an error on the base check carries nothing", async () => {
  const fetchImpl = async (url) =>
    url.includes(`/compare/main...${mainParent}`)
      ? { ok: false, status: 404, text: async () => "Not Found" }
      : json(routes(url.replace("https://api.test", "")));
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
  assert.equal((await carriedHeads(api, "o", "r", pr, comments, { log: quiet })).size, 0);
});

// F-148: the walk starts only when a trusted block names an earlier head, and
// it stops once it has passed every named head.
const chainSha = (i) => (i === 0 ? head : `${i}`.padStart(40, "c"));
function chainFetch(depth) {
  const calls = [];
  const fetchImpl = async (url) => {
    const path = url.replace("https://api.test", "");
    calls.push(path);
    if (tipAndTree(path)) return json(tipAndTree(path));
    const at = [...Array(depth + 1).keys()].find((i) => path.endsWith(`/commits/${chainSha(i)}`));
    if (at !== undefined) {
      // A chain of base merges ending in the PR's own commit at `depth`.
      return json(at < depth
        ? { sha: chainSha(at), parents: [{ sha: chainSha(at + 1) }, { sha: mainParent }] }
        : { sha: chainSha(at), parents: [{ sha: "0".repeat(40) }] });
    }
    if (path.includes(`/compare/main...${mainParent}`)) return json({ status: "behind", files: [] });
    if (path.includes("/compare/")) return json(files);
    throw new Error(`unexpected ${path}`);
  };
  return { fetchImpl, calls };
}
const commitCalls = (calls) => calls.filter((path) => path.includes("/commits/")).length;

test("no trusted block naming an earlier head means no walk and no API call (F-148)", async () => {
  const outsider = { ...review(chainSha(2)), user: { login: "someone" }, author_association: "NONE", performed_via_github_app: null };
  for (const list of [[], [review(head)], [outsider]]) {
    const { fetchImpl, calls } = chainFetch(12);
    const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
    assert.equal((await carriedHeads(api, "o", "r", pr, list, { log: quiet })).size, 0);
    assert.deepEqual(calls, []);
  }
});

test("the walk stops once it has passed every named head and still carries (F-148)", async () => {
  const { fetchImpl, calls } = chainFetch(12);
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
  const carried = await carriedHeads(api, "o", "r", pr, [review(chainSha(2))], { log: quiet });
  assert.deepEqual([...carried], [chainSha(2)]);
  // head, chain 1 and chain 2: three commits instead of thirteen.
  assert.equal(commitCalls(calls), 3);
});

test("an older named head with a FAIL is still reached and carried with the newer one (F-148)", async () => {
  const { fetchImpl, calls } = chainFetch(12);
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
  const fail = { ...review(chainSha(5)), body: review(chainSha(5)).body.replace("PASS", "FAIL") };
  const carried = await carriedHeads(api, "o", "r", pr, [review(chainSha(2)), fail], { log: quiet });
  assert.deepEqual([...carried].sort(), [chainSha(2), chainSha(5)].sort());
  assert.equal(commitCalls(calls), 6);
});

test("a named head that is not on the path still walks to the PR's own commit (F-148)", async () => {
  const { fetchImpl, calls } = chainFetch(4);
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
  const carried = await carriedHeads(api, "o", "r", pr, [review("d".repeat(40)), review(chainSha(1))], { log: quiet });
  assert.deepEqual([...carried], [chainSha(1)]);
  assert.equal(commitCalls(calls), 5);
});
// DAN-664 (#1551): a transient 5xx or network error is retried inside the same
// limits; a 4xx, an abort or a timeout never is; the error names the call and
// never the token. Fake fetch only; `retryDelayMs` keeps the backoff short.
const secret = "ghs_SECRETtoken0123456789";
const reply = (status, value = { ok: status }) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
  text: async () => `body ${status}`,
});
const scripted = (steps) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ path: url.replace("https://api.test", ""), init });
    const step = steps[Math.min(calls.length, steps.length) - 1];
    if (step instanceof Error) throw step;
    return reply(step);
  };
  return { fetchImpl, calls };
};
const retryApi = (fetchImpl, extra = {}) =>
  createApi({ fetchImpl, baseUrl: "https://api.test", token: secret, timeoutMs: 1000, retryDelayMs: 5, ...extra });
const networkError = () => new TypeError("fetch failed");
const noToken = (error) => !String(error.message).includes(secret) && !/authorization|bearer/i.test(error.message);

for (const [name, steps, calls] of [
  ["500 then 200", [500, 200], 2],
  ["502 then 200", [502, 200], 2],
  ["503 then 200", [503, 200], 2],
  ["504 then 200", [504, 200], 2],
  ["500, 503 then 200", [500, 503, 200], 3],
  ["a network error then 200", [networkError(), 200], 2],
  ["a network error, 502 then 200", [networkError(), 502, 200], 3],
]) {
  test(`a transient failure is retried: ${name} (DAN-664)`, async () => {
    const { fetchImpl, calls: seen } = scripted(steps);
    assert.deepEqual(await retryApi(fetchImpl)("/repos/o/r/pulls/1"), { ok: 200 });
    assert.equal(seen.length, calls);
  });
}

test("a 204 after a 5xx returns null (DAN-664)", async () => {
  const { fetchImpl, calls } = scripted([503, 204]);
  assert.equal(await retryApi(fetchImpl)("/repos/o/r/x"), null);
  assert.equal(calls.length, 2);
});

for (const [name, steps, pattern] of [
  ["500", [500], /^GitHub API GET \/repos\/o\/r\/pulls\/1\?page=2 500: body 500$/],
  ["502", [502], /^GitHub API GET \/repos\/o\/r\/pulls\/1\?page=2 502: /],
  ["599", [599], /^GitHub API GET \/repos\/o\/r\/pulls\/1\?page=2 599: /],
  ["a network error", [networkError()], /^GitHub API GET \/repos\/o\/r\/pulls\/1\?page=2 failed: fetch failed$/],
]) {
  test(`a lasting ${name} fails after three calls and names the call, not the token (DAN-664)`, async () => {
    const { fetchImpl, calls } = scripted(steps);
    await assert.rejects(retryApi(fetchImpl)("/repos/o/r/pulls/1?page=2"), (error) => {
      assert.match(error.message, pattern);
      assert.ok(noToken(error), error.message);
      return true;
    });
    assert.equal(calls.length, 3);
  });
}

for (const status of [400, 401, 403, 404, 409, 422, 429, 304, 199]) {
  test(`${status} is never retried and names the call, not the token (DAN-664)`, async () => {
    const { fetchImpl, calls } = scripted([status, 200]);
    await assert.rejects(retryApi(fetchImpl)("/repos/o/r/pulls/1"), (error) => {
      assert.equal(error.message, `GitHub API GET /repos/o/r/pulls/1 ${status}: body ${status}`);
      assert.ok(noToken(error), error.message);
      return true;
    });
    assert.equal(calls.length, 1);
  });
}

test("a long error body is cut so the message stays short (DAN-664)", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "x".repeat(5000) });
  await assert.rejects(retryApi(fetchImpl)("/x"), (error) => error.message.length < 600);
});

test("a status write is retried with the same body and headers; other writes are not (DAN-664)", async () => {
  const body = JSON.stringify({ state: "success", context: "Engineering review gate", description: "ok" });
  const write = scripted([502, 201]);
  assert.deepEqual(await retryApi(write.fetchImpl)(`/repos/o/r/statuses/${head}`, { method: "POST", body }), { ok: 201 });
  assert.equal(write.calls.length, 2);
  const [first, second] = write.calls;
  assert.equal(first.path, second.path);
  assert.equal(second.init.method, "POST");
  assert.equal(second.init.body, body);
  assert.deepEqual(second.init.headers, first.init.headers);
  for (const [method, path] of [
    ["POST", "/repos/o/r/issues/1/comments"],
    ["POST", `/repos/o/r/statuses/${head}/extra`],
    ["PATCH", "/repos/o/r/pulls/1"],
    ["DELETE", `/repos/o/r/statuses/${head}`],
    ["PUT", `/repos/o/r/statuses/${head}`],
  ]) {
    const other = scripted([503, 201]);
    await assert.rejects(retryApi(other.fetchImpl)(path, { method, body }), (error) => error.message === `GitHub API ${method} ${path} 503: body 503`);
    assert.equal(other.calls.length, 1, `${method} ${path}`);
  }
});

test("an outer abort during the backoff ends the call with no further attempt (DAN-664)", async () => {
  const controller = new AbortController();
  const { fetchImpl, calls } = scripted([500, 200]);
  const api = retryApi(fetchImpl, { retryDelayMs: 5000 });
  setTimeout(() => controller.abort(new Error("budget spent")), 20);
  const { ms } = await elapsed(() => assert.rejects(api("/x", { signal: controller.signal }), /budget spent/));
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.equal(calls.length, 1);
});

test("the per-call limit covers the backoff: no attempt after it (DAN-664)", async () => {
  const { fetchImpl, calls } = scripted([503, 200]);
  const api = retryApi(fetchImpl, { timeoutMs: 50, retryDelayMs: 5000 });
  const { ms } = await elapsed(() => assert.rejects(api("/x"), { name: "TimeoutError" }));
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.equal(calls.length, 1);
});

test("an abort, a timeout or a non-network error from fetch is not retried (DAN-664)", async () => {
  for (const thrown of [new DOMException("stopped", "AbortError"), new DOMException("stopped", "TimeoutError"), new Error("broken")]) {
    const calls = [];
    const fetchImpl = async () => {
      calls.push(1);
      throw thrown;
    };
    await assert.rejects(retryApi(fetchImpl)("/x"), (error) => error === thrown);
    assert.equal(calls.length, 1, thrown.name);
  }
});

test("a broken 2xx body is not retried (DAN-664)", async () => {
  const calls = [];
  const fetchImpl = async () => {
    calls.push(1);
    return { ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } };
  };
  await assert.rejects(retryApi(fetchImpl)("/x"), SyntaxError);
  assert.equal(calls.length, 1);
});
