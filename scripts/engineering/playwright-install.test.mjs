import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guards scripts/engineering/playwright-install.sh, which the workflows call
// instead of `playwright install` itself: it must keep --with-deps and the
// browser list on every attempt, cap every attempt (DAN-663: the last one too)
// and the whole run, and fail fast with an ::error:: when all attempts fail.
// fileURLToPath, not URL.pathname: on Windows the pathname keeps a leading
// slash before the drive letter, which fs reads as D:\D:\...
const script = fileURLToPath(new URL("./playwright-install.sh", import.meta.url));

// DAN-369 (#1143): on Windows `bash` in PATH may be WSL (System32), which exits
// 1 before the script starts, and System32 has its own `timeout.exe` in front of
// GNU timeout. So the script runs under the bash that `sh` finds (Git Bash), as
// session-start-hooks.test.mjs does, with that bash's own tools after the fakes.
// No usable bash fails the tests; nothing is skipped.
const windows = process.platform === "win32";
function findBash() {
  if (!windows) return "bash";
  const posix = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" });
  const native = posix.status === 0 ? spawnSync("cygpath", ["-w", posix.stdout.trim()], { encoding: "utf8" }) : null;
  const found = native?.status === 0 ? native.stdout.trim() : "";
  assert.ok(found, "no Git Bash on this Windows machine: sh and cygpath must find bash");
  return found;
}
const bash = findBash();
const tools = windows ? [path.dirname(bash)] : [];

// rmSync in Node 24 throws EPERM at once on Windows and ignores maxRetries (#1141).
function removeDir(dir, deadlineMs = 10000) {
  const start = Date.now();
  for (;;) {
    try { return rmSync(dir, { recursive: true, force: true }); } catch (error) {
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(error?.code) || Date.now() - start >= deadlineMs) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

async function run({ failures = 0, hang = 0, timeout = "2", budget = "60", browsers = ["chromium", "firefox"], withoutDeps = false, probeFails = false, skipDeps = false, fakeTimeout = false, noPerl = false, aptCache = null, debs = true, slowCopy = false, expectCalls = true, sources = {}, resolve = "ok", sedFails = false }) {
  const dir = await mkdtemp(path.join(tmpdir(), "pw-install-"));
  const bin = path.join(dir, "bin");
  const archives = path.join(dir, "archives");
  await mkdir(bin);
  await mkdir(archives);
  // DAN-705: a fake /etc/apt under PLAYWRIGHT_APT_ROOT, so no test touches the real one.
  const root = path.join(dir, "root");
  const sourceFiles = { mirrors: path.join(root, "etc/apt/apt-mirrors.txt"), deb822: path.join(root, "etc/apt/sources.list.d/ubuntu.sources"), legacy: path.join(root, "etc/apt/sources.list") };
  for (const [kind, text] of Object.entries(sources)) {
    await mkdir(path.dirname(sourceFiles[kind]), { recursive: true });
    await writeFile(sourceFiles[kind], text);
  }
  const log = path.join(dir, "calls.log");
  const sudoLog = path.join(dir, "sudo.log");
  const count = path.join(dir, "count");
  // The fake pnpm hangs on its first `hang` calls, fails until call `failures`
  // and, on an install with --with-deps, leaves a .deb in the apt archive as apt
  // does. It notes whether the cached .deb was restored before it ran.
  const fakes = {
    pnpm: `#!/usr/bin/env bash
n=$(cat "${count}" 2>/dev/null || echo 0); echo $((n+1)) > "${count}"
echo "$*" >> "${log}"
cat "${sourceFiles.mirrors}" "${sourceFiles.deb822}" "${sourceFiles.legacy}" 2>/dev/null >> "${dir}/sources-at-install"
[ -f "${archives}/cached_1.0_all.deb" ] && echo restored >> "${dir}/restored"
${probeFails ? 'case "$*" in "exec node"*) exit 9;; esac' : ""}
[ "$n" -lt ${hang} ] && sleep 30
[ "$n" -lt ${failures} ] && exit 7
${debs ? `case "$*" in *--with-deps*) : > "${archives}/new_2.0_all.deb";; esac` : ""}
exit 0
`,
    // Only file copies run for real: pkill and dpkg must never touch this machine.
    sudo: `#!/usr/bin/env bash\necho "$*" >> "${sudoLog}"\n${sedFails ? 'case "$1" in sed) exit 4;; esac\n' : ""}case "$1" in cp|sed) exec "$@";; esac\nexit 0\n`,
    // getent answers for the apt mirror: ok, fail (no such host) or hang.
    getent: `#!/usr/bin/env bash\necho "$*" >> "${dir}/getent.log"\n${{ ok: "echo '10.0.0.1 $2'; exit 0", fail: "exit 2", hang: "sleep 30" }[resolve]}\n`,
    "apt-get": "#!/usr/bin/env bash\nexit 0\n",
  };
  if (fakeTimeout) fakes.timeout = `#!/usr/bin/env bash\n[ "$1" = --version ] && { echo "timeout: not coreutils"; exit 0; }\necho "fake timeout used" >> "${log}"\nexit 0\n`;
  if (noPerl) fakes.perl = "#!/usr/bin/env bash\nexit 1\n";
  // A copy that hangs, as on a full or slow disk; it writes part of the file first.
  if (slowCopy) fakes.cp = "#!/usr/bin/env bash\nfor last; do :; done\n[ -d \"$last\" ] && echo partial > \"$last/new_2.0_all.deb\"\nsleep 40\n";
  for (const [name, body] of Object.entries(fakes)) {
    await writeFile(path.join(bin, name), body);
    await chmod(path.join(bin, name), 0o755);
  }
  if (aptCache?.seed) {
    await mkdir(path.join(dir, "apt"));
    await writeFile(path.join(dir, "apt", "cached_1.0_all.deb"), "");
  }
  if (aptCache?.file) await writeFile(path.join(dir, "apt"), "not a directory");
  const started = Date.now();
  const result = spawnSync(bash, [script, ...browsers], {
    env: {
      ...process.env,
      HOME: dir,
      PATH: [bin, ...tools, process.env.PATH].join(path.delimiter),
      PLAYWRIGHT_INSTALL_TIMEOUT: timeout,
      PLAYWRIGHT_INSTALL_BUDGET: budget,
      PLAYWRIGHT_TRY_WITHOUT_DEPS: withoutDeps ? "1" : "",
      PLAYWRIGHT_SKIP_DEPS: skipDeps ? "1" : "",
      PLAYWRIGHT_APT_CACHE_DIR: aptCache ? aptCache.dir ?? "~/apt" : "",
      PLAYWRIGHT_APT_ARCHIVES: archives,
      PLAYWRIGHT_APT_ROOT: root,
    },
    encoding: "utf8",
  });
  const seconds = (Date.now() - started) / 1000;
  const read = (file) => readFile(file, "utf8").catch(() => "");
  const calls = (await read(log)).trim().split(/\r?\n/).filter(Boolean);
  const sudo = (await read(sudoLog)).trim().split(/\r?\n/).filter(Boolean);
  const restored = (await read(path.join(dir, "restored"))) !== "";
  const cached = await readdir(path.join(dir, "apt")).catch(() => null);
  const archived = await readdir(archives);
  const after = {};
  for (const kind of Object.keys(sources)) after[kind] = await read(sourceFiles[kind]);
  const atInstall = await read(path.join(dir, "sources-at-install"));
  const probes = (await read(path.join(dir, "getent.log"))).trim().split(/\r?\n/).filter(Boolean);
  removeDir(dir);
  // The fake pnpm must have answered: an empty log means the real one could have run.
  if (expectCalls) assert.ok(calls.length > 0, `the fake pnpm was never called (status ${result.status}): ${result.stderr?.slice(0, 300)}`);
  return { status: result.status, stdout: result.stdout, calls, sudo, restored, cached, archived, seconds, after, atInstall, probes };
}

test("every attempt keeps --with-deps and the requested browsers", async () => {
  const { status, calls } = await run({ failures: 2 });
  assert.equal(status, 0);
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call, "exec playwright install --with-deps chromium firefox");
});

test("a hanging attempt is cut off and retried", async () => {
  const { status, calls, stdout } = await run({ hang: 1 });
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
  assert.match(stdout, /^::warning::playwright install attempt 1\/3 timed out after 2s$/m);
});

// The last attempt gets what is left of the budget (8 - 2 - 2 = about 4s).
test("a hanging last attempt is cut off too and the step fails with an error", async () => {
  const { status, calls, stdout, seconds } = await run({ hang: 9, budget: "8" });
  assert.equal(status, 1);
  assert.equal(calls.length, 3);
  assert.ok(seconds < 25, `three capped attempts took ${seconds}s`);
  assert.match(stdout, /^::warning::playwright install attempt 3\/3 timed out after \d+s$/m);
  assert.match(stdout, /^::error::Playwright browsers \(chromium firefox\) could not be installed within 8s \(3 of 3 attempts, last exit 124\)/m);
});

test("three failed attempts fail the step with an error", async () => {
  const { status, calls, stdout } = await run({ failures: 9 });
  assert.equal(status, 1);
  assert.equal(calls.length, 3);
  assert.match(stdout, /^::warning::playwright install attempt 3\/3 failed \(exit 7\)$/m);
  assert.match(stdout, /^::error::Playwright browsers \(chromium firefox\) could not be installed within 60s \(3 of 3 attempts, last exit 7\)/m);
});

test("the budget stops the retries before all attempts are used", async () => {
  const { status, calls, stdout, seconds } = await run({ hang: 9, timeout: "2", budget: "3" });
  assert.equal(status, 1);
  assert.ok(calls.length < 3, `${calls.length} attempts ran within a 3s budget`);
  assert.ok(seconds < 20, `a 3s budget took ${seconds}s`);
  assert.match(stdout, /^::error::.* within 3s \([12] of 3 attempts/m);
});

test("budget and timeout must be whole seconds", async () => {
  for (const bad of [{ budget: "0" }, { budget: "1m" }, { timeout: "2s" }, { timeout: "-5" }]) {
    const { status, calls, stdout } = await run({ ...bad, expectCalls: false });
    assert.equal(status, 1);
    assert.deepEqual(calls, []);
    assert.match(stdout, /^::error::PLAYWRIGHT_INSTALL_BUDGET and PLAYWRIGHT_INSTALL_TIMEOUT/m);
  }
});

test("without GNU timeout perl caps the attempts", async () => {
  const { status, calls } = await run({ hang: 1, fakeTimeout: true });
  assert.equal(status, 0);
  assert.deepEqual(calls, ["exec playwright install --with-deps chromium firefox", "exec playwright install --with-deps chromium firefox"]);
});

test("with nothing to cap the install the step fails before installing", async () => {
  const { status, calls, stdout } = await run({ fakeTimeout: true, noPerl: true, expectCalls: false });
  assert.equal(status, 1);
  assert.deepEqual(calls, []);
  assert.match(stdout, /^::error::Playwright browsers \(chromium firefox\) were not installed: no GNU timeout, gtimeout or perl/m);
});

test("a Chromium-only run can skip apt when Chromium launches", async () => {
  const { status, calls } = await run({ browsers: ["chromium"], withoutDeps: true });
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "exec playwright install chromium");
  assert.match(calls[1], /^exec node .*chromium\.launch/);
});

test("without a working Chromium the --with-deps path still runs", async () => {
  const { status, calls } = await run({ browsers: ["chromium"], withoutDeps: true, probeFails: true });
  assert.equal(status, 0);
  assert.equal(calls.at(-1), "exec playwright install --with-deps chromium");
});

test("a hanging install without apt is cut off and the --with-deps path runs", async () => {
  const { status, calls, stdout } = await run({ browsers: ["chromium"], withoutDeps: true, hang: 1 });
  assert.equal(status, 0);
  assert.deepEqual(calls, ["exec playwright install chromium", "exec playwright install --with-deps chromium"]);
  assert.match(stdout, /^::warning::Chromium did not start without system packages/m);
});

test("the skip never applies to more than Chromium or when not requested", async () => {
  for (const options of [{ browsers: ["chromium", "firefox", "webkit"], withoutDeps: true }, { browsers: ["chromium"], withoutDeps: false }]) {
    const { calls } = await run(options);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /--with-deps/);
  }
});

test("PLAYWRIGHT_SKIP_DEPS installs the browsers alone and never runs sudo", async () => {
  const { status, calls, sudo, cached } = await run({ failures: 1, browsers: ["webkit"], skipDeps: true, aptCache: { seed: true } });
  assert.equal(status, 0);
  assert.deepEqual(calls, ["exec playwright install webkit", "exec playwright install webkit"]);
  assert.deepEqual(sudo, []);
  assert.deepEqual(cached, ["cached_1.0_all.deb"]);
});

test("the apt cache is restored before the install and saved after it", async () => {
  const { status, restored, cached, archived } = await run({ aptCache: { seed: true } });
  assert.equal(status, 0);
  assert.ok(restored, "the cached .deb was not in the apt archive when apt ran");
  assert.deepEqual(archived.sort(), ["cached_1.0_all.deb", "new_2.0_all.deb"]);
  assert.deepEqual(cached.sort(), ["cached_1.0_all.deb", "new_2.0_all.deb"]);
});

test("an empty apt cache is created and filled", async () => {
  const { status, cached } = await run({ aptCache: {} });
  assert.equal(status, 0);
  assert.deepEqual(cached, ["new_2.0_all.deb"]);
});

test("without PLAYWRIGHT_APT_CACHE_DIR the apt archive is never touched", async () => {
  const { status, sudo, cached, archived } = await run({ failures: 1 });
  assert.equal(status, 0);
  assert.equal(cached, null);
  assert.deepEqual(archived, ["new_2.0_all.deb"]);
  assert.ok(sudo.every((line) => !line.startsWith("cp")), sudo.join("\n"));
  assert.ok(sudo.some((line) => line === "dpkg --configure -a"), "a failed attempt still cleans up apt");
});

test("a broken apt cache only warns", async () => {
  const { status, stdout } = await run({ aptCache: { file: true } });
  assert.equal(status, 0);
  assert.match(stdout, /^::warning::could not save the apt package cache to .*apt$/m);
});

// The install succeeds, then saving the cache hangs: the save gets only what is
// left of the 5s budget, and the cut-off copy leaves nothing half-written behind.
test("a hanging cache save stays within the budget and leaves no partial .deb", async () => {
  const { status, stdout, cached, seconds } = await run({ aptCache: {}, budget: "5", slowCopy: true });
  assert.equal(status, 0);
  assert.ok(seconds < 15, `the cache save took the step to ${seconds}s`);
  assert.match(stdout, /^::warning::could not save the apt package cache to .*apt$/m);
  assert.deepEqual(cached, []);
});

test("apt that keeps no .deb files leaves a notice, not a failure", async () => {
  const { status, stdout, cached } = await run({ aptCache: {}, debs: false });
  assert.equal(status, 0);
  assert.equal(cached, null);
  assert.match(stdout, /^::notice::apt left no \.deb files in /m);
});

// DAN-705: the runners' apt mirror azure.archive.ubuntu.com stopped resolving
// (run 43034842276), so the --with-deps path switches the apt sources to
// archive.ubuntu.com when, and only when, that mirror does not resolve.
const deb822 = "Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\n\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu\nSuites: noble-security\n";
// As on the ubuntu-24.04 image (run 43034842276: "Get:1 file:/etc/apt/apt-mirrors.txt").
const mirrors = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n";
const mirrorList = "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates\n";
const legacy = "deb http://azure.archive.ubuntu.com/ubuntu/ jammy main\ndeb http://security.ubuntu.com/ubuntu jammy-security main\n# see azure.archive.ubuntu.com for details\n";
const switched = (text) => text.replaceAll("//azure.archive.ubuntu.com", "//archive.ubuntu.com");
const mirrorWarning = /^::warning::azure\.archive\.ubuntu\.com does not resolve; the apt sources now use archive\.ubuntu\.com$/m;

const mirrorCases = [
  { name: "a resolving mirror leaves the sources alone", sources: { mirrors, deb822 }, resolve: "ok", probed: true, expect: { mirrors, deb822 } },
  { name: "an unresolved mirror switches apt-mirrors.txt and leaves the mirror+file source", sources: { mirrors, deb822: mirrorList }, resolve: "fail", probed: true, warn: true, expect: { mirrors: switched(mirrors), deb822: mirrorList } },
  { name: "an unresolved mirror switches ubuntu.sources before the install", sources: { deb822 }, resolve: "fail", probed: true, warn: true, expect: { deb822: switched(deb822) } },
  { name: "an unresolved mirror switches sources.list", sources: { legacy }, resolve: "fail", probed: true, warn: true, expect: { legacy: switched(legacy) } },
  { name: "an unresolved mirror switches every file that names it", sources: { mirrors, deb822, legacy }, resolve: "fail", probed: true, warn: true, expect: { mirrors: switched(mirrors), deb822: switched(deb822), legacy: switched(legacy) } },
  { name: "a hanging lookup counts as unresolved", sources: { deb822 }, resolve: "hang", probed: true, warn: true, expect: { deb822: switched(deb822) } },
  { name: "sources without the Azure mirror are not probed", sources: { mirrors: switched(mirrors), deb822: switched(deb822), legacy: "deb http://mirror.example.org/ubuntu jammy main\n" }, resolve: "fail", probed: false, expect: { mirrors: switched(mirrors), deb822: switched(deb822), legacy: "deb http://mirror.example.org/ubuntu jammy main\n" } },
  { name: "no apt sources at all are not probed", sources: {}, resolve: "fail", probed: false, expect: {} },
  { name: "PLAYWRIGHT_SKIP_DEPS never probes or switches", sources: { deb822 }, resolve: "fail", probed: false, expect: { deb822 }, options: { skipDeps: true } },
  { name: "a Chromium run that needs no apt never probes or switches", sources: { deb822 }, resolve: "fail", probed: false, expect: { deb822 }, options: { browsers: ["chromium"], withoutDeps: true } },
];

for (const c of mirrorCases) {
  test(`apt mirror: ${c.name}`, async () => {
    const { status, stdout, after, atInstall, probes, seconds } = await run({ sources: c.sources, resolve: c.resolve, ...c.options });
    assert.equal(status, 0);
    assert.deepEqual(after, c.expect);
    assert.deepEqual(probes, c.probed ? ["hosts azure.archive.ubuntu.com"] : []);
    if (c.warn) assert.match(stdout, mirrorWarning);
    else assert.doesNotMatch(stdout, /azure\.archive/);
    // The install already saw the switched sources (apt-get update runs inside it).
    if (c.warn) assert.ok(!atInstall.includes("//azure.archive.ubuntu.com"), atInstall);
    assert.ok(seconds < 25, `the step took ${seconds}s`);
  });
}

test("apt mirror: a failed switch only warns and the retries run as before", async () => {
  const { status, stdout, calls, after } = await run({ sources: { deb822 }, resolve: "fail", sedFails: true, failures: 1 });
  assert.equal(status, 0);
  assert.deepEqual(after, { deb822 });
  assert.match(stdout, /^::warning::azure\.archive\.ubuntu\.com does not resolve and the apt sources could not be switched to archive\.ubuntu\.com$/m);
  assert.match(stdout, /^::warning::playwright install attempt 1\/3 failed \(exit 7\)$/m);
  assert.deepEqual(calls, Array(2).fill("exec playwright install --with-deps chromium firefox"));
});

test("apt mirror: the switch is tried once, not on every retry", async () => {
  const { status, sudo, probes } = await run({ sources: { deb822 }, resolve: "fail", failures: 2 });
  assert.equal(status, 0);
  assert.equal(probes.length, 1);
  assert.equal(sudo.filter((line) => line.startsWith("sed")).length, 1);
});
