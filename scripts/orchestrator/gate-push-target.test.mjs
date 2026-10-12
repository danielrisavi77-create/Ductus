// DAN-118: gate status reading and push target resolution. `gh` is injected, never called.
import assert from "node:assert/strict";
import test from "node:test";

import { gateStatus, readGate } from "./gh.mjs";
import { GATE_CONTEXT, parseLsRemote, pickGate, resolvePushTarget } from "./orchestrator-core.mjs";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const st = (id, state, created_at, context = GATE_CONTEXT) => ({ id, state, created_at, context, description: `d${id}` });
const HISTORY = [
  st(4, "success", "2026-10-10T14:37:27Z"),
  st(3, "pending", "2026-10-10T14:37:20Z"),
  st(9, "failure", "2026-10-10T14:40:00Z", "Some other context"),
  st(2, "success", "2026-10-10T14:33:34Z"),
  st(1, "pending", "2026-10-10T14:31:40Z"),
];

test("gate: newest status of the gate context wins, whatever the list order", () => {
  assert.equal(pickGate(HISTORY).id, 4);
  assert.equal(pickGate([...HISTORY].reverse()).id, 4);
  assert.equal(pickGate([st(1, "success", "2026-10-10T14:31:40Z"), st(2, "failure", "2026-10-10T14:33:00Z")]).state, "failure");
  // same second: the higher status id is the later one
  assert.equal(pickGate([st(7, "success", "2026-10-10T14:31:40Z"), st(6, "pending", "2026-10-10T14:31:40Z")]).id, 7);
  assert.equal(pickGate([st(9, "success", "2026-10-10T14:40:00Z", "Some other context")]), null);
  assert.equal(pickGate([]), null);
});

test("gate: read from the commit's statuses list of exactly that head", async () => {
  const paths = [];
  const gate = await gateStatus(H1, async (path) => {
    paths.push(path);
    return HISTORY;
  });
  assert.deepEqual(paths, [`repos/{owner}/{repo}/commits/${H1}/statuses?per_page=100`]);
  assert.equal(gate.state, "success");
  assert.equal(gate.id, 4);
});

test("gate: a transient read error is retried and never turns into 'no status'", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error("HTTP 502: Bad Gateway");
    return st(4, "success", "2026-10-10T14:37:27Z");
  };
  assert.equal((await readGate(H1, { read: flaky })).state, "success");
  assert.equal(calls, 2);

  const down = await readGate(H1, { read: async () => { throw Object.assign(new Error("x"), { stderr: "gh: HTTP 503\nmore" }); } });
  assert.deepEqual(down, { error: "gh: HTTP 503" });
  assert.equal(await readGate(H1, { read: async () => null }), null);
});

const PO = { currentBranch: "local/other", defaultBranch: "main", upstream: { remote: "origin", branch: "pr/branch" } };
const none = { ...PO, upstream: null };

test("push target: upstream by default, --to or an explicit refspec override it", () => {
  assert.deepEqual(resolvePushTarget([], PO), { remote: "origin", src: "HEAD", dst: "pr/branch" });
  assert.deepEqual(resolvePushTarget(["origin", "HEAD"], PO), { remote: "origin", src: "HEAD", dst: "pr/branch" });
  assert.deepEqual(resolvePushTarget(["--to", "x/y"], none), { remote: "origin", src: "HEAD", dst: "x/y" });
  assert.deepEqual(resolvePushTarget(["origin", "--to", "refs/heads/x"], PO), { remote: "origin", src: "HEAD", dst: "x" });
  assert.deepEqual(resolvePushTarget(["origin", "feat/y", "--to", "x"], none), { remote: "origin", src: "feat/y", dst: "x" });
  assert.deepEqual(resolvePushTarget(["origin", "feat/y"], none), { remote: "origin", src: "feat/y", dst: "feat/y" });
  assert.deepEqual(resolvePushTarget(["origin", "HEAD:feat/z"], none), { remote: "origin", src: "HEAD", dst: "feat/z" });
});

test("push target: no usable upstream is an error that names --to", () => {
  assert.throws(() => resolvePushTarget([], none), /no upstream set for local\/other; pass --to <branch>/);
  assert.throws(() => resolvePushTarget([], { ...none, currentBranch: null }), /no upstream set for detached HEAD/);
  assert.throws(() => resolvePushTarget(["fork"], PO), /upstream of local\/other is on remote origin, not fork/);
  assert.throws(() => resolvePushTarget([], { ...PO, upstream: { remote: ".", branch: "x" } }), /on remote \./);
  for (const branch of ["main", "trunk"]) {
    assert.throws(() => resolvePushTarget([], { ...PO, defaultBranch: "trunk", upstream: { remote: "origin", branch } }), /pass --to <branch>/);
  }
});

test("push target: force, +refspec, deletion and protected branches stay refused with --to", () => {
  const bad = [
    ["--to"], ["--to", ""], ["--to", "+x"], ["--to", ":x"], ["--to", "x:y"], ["--to", "--force"], ["--to", "-x"],
    ["--to", "main"], ["--to", "refs/heads/main"], ["--to", "refs/tags/v1"], ["--to", "x*"], ["--to", "x", "--to", "y"],
    ["--force", "--to", "x"], ["origin", "--force", "--to", "x"], ["origin", "+HEAD", "--to", "x"], ["--delete", "--to", "x"],
    ["origin", "HEAD:y", "--to", "x"], ["origin", ":y", "--to", "x"], ["origin", "a", "b", "--to", "x"],
    ["--force"], ["origin", "+HEAD"], ["origin", ":victim"], ["origin", "+a:b"], ["origin", "HEAD:main"],
  ];
  for (const b of bad) assert.throws(() => resolvePushTarget(b, PO), undefined, b.join(" "));
});

test("ls-remote output: exact ref only", () => {
  const out = `${H2}\trefs/heads/x/feat/new\n${H1}\trefs/heads/feat/new\n${H2}\trefs/tags/feat/new\n`;
  assert.equal(parseLsRemote(out, "feat/new"), H1);
  assert.equal(parseLsRemote(out, "feat"), null);
  assert.equal(parseLsRemote("", "feat/new"), null);
  assert.equal(parseLsRemote(`not-a-sha\trefs/heads/feat/new`, "feat/new"), null);
});
