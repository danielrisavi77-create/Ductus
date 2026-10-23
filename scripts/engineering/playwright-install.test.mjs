import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

// Guards scripts/engineering/playwright-install.sh, which ci.yml calls instead
// of `playwright install` itself: it must keep --with-deps and the browser
// list on every attempt, cap all attempts but the last, and fail when all fail.
const script = new URL("./playwright-install.sh", import.meta.url).pathname;
const source = await readFile(script, "utf8");

async function run({ failures, hangFirst = false, timeout = "2", browsers = ["chromium", "firefox"], withoutDeps = false, probeFails = false }) {
  const dir = await mkdtemp(path.join(tmpdir(), "pw-install-"));
  const log = path.join(dir, "calls.log");
  const count = path.join(dir, "count");
  await writeFile(path.join(dir, "pnpm"), `#!/usr/bin/env bash
n=$(cat "${count}" 2>/dev/null || echo 0); echo $((n+1)) > "${count}"
echo "$*" >> "${log}"
${probeFails ? 'case "$*" in "exec node"*) exit 9;; esac' : ""}
${hangFirst ? '[ "$n" -eq 0 ] && sleep 30' : ""}
[ "$n" -lt ${failures} ] && exit 7
exit 0
`);
  await writeFile(path.join(dir, "sudo"), "#!/usr/bin/env bash\nexit 0\n");
  await chmod(path.join(dir, "pnpm"), 0o755);
  await chmod(path.join(dir, "sudo"), 0o755);
  const result = spawnSync("bash", [script, ...browsers], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PLAYWRIGHT_INSTALL_TIMEOUT: timeout,
      PLAYWRIGHT_TRY_WITHOUT_DEPS: withoutDeps ? "1" : "",
    },
    encoding: "utf8",
  });
  const calls = (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  return { status: result.status, calls };
}

test("every attempt keeps --with-deps and the requested browsers", async () => {
  const { status, calls } = await run({ failures: 2 });
  assert.equal(status, 0);
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call, "exec playwright install --with-deps chromium firefox");
});

test("a hanging attempt is cut off and retried", async () => {
  const { status, calls } = await run({ failures: 0, hangFirst: true });
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
});

test("three failed attempts fail the step", async () => {
  const { status, calls } = await run({ failures: 9 });
  assert.equal(status, 1);
  assert.equal(calls.length, 3);
});

test("a Chromium-only run can skip apt when Chromium launches", async () => {
  const { status, calls } = await run({ failures: 0, browsers: ["chromium"], withoutDeps: true });
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "exec playwright install chromium");
  assert.match(calls[1], /^exec node .*chromium\.launch/);
});

test("without a working Chromium the --with-deps path still runs", async () => {
  const { status, calls } = await run({ failures: 0, browsers: ["chromium"], withoutDeps: true, probeFails: true });
  assert.equal(status, 0);
  assert.equal(calls.at(-1), "exec playwright install --with-deps chromium");
});

test("the skip never applies to more than Chromium or when not requested", async () => {
  for (const options of [{ browsers: ["chromium", "firefox", "webkit"], withoutDeps: true }, { browsers: ["chromium"], withoutDeps: false }]) {
    const { calls } = await run({ failures: 0, ...options });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /--with-deps/);
  }
});

test("only the last attempt is not capped by timeout", () => {
  assert.match(source, /if \[ "\$attempt" -lt "\$attempts" \]; then\n\s+timeout --kill-after=10 "\$limit" pnpm exec playwright install --with-deps "\$@"\n\s+else\n\s+pnpm exec playwright install --with-deps "\$@"\n\s+fi/);
});
