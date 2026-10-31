import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { nativePsqlTarget } from "../../../db/local/psql-target.mjs";
import { TOOLS, download, ductusHome, ensureTool, toolDir, treeHash } from "./tools.mjs";
import { createNativeRun, layout, nativeConf, parseArgs, parseStarts, psqlTarget, refusal, stopRecorded, stripSteering } from "./up.mjs";

// A URL, not a path: --import takes D:\... on Windows for a URL scheme and refuses it.
const LOOPBACK = new URL("./loopback.mjs", import.meta.url).href;
const scratch = () => mkdtemp(join(tmpdir(), "ductus-native-"));
const bytesResponse = (bytes) => new Response(new Blob([bytes]).stream(), { status: 200 });

test("the runner takes its three flags and refuses any other argument", () => {
  assert.deepEqual(parseArgs([]), { stop: false, prepareOnly: false, sampleData: true });
  assert.deepEqual(parseArgs(["--prepare-only", "--no-sample-data"]), { stop: false, prepareOnly: true, sampleData: false });
  assert.deepEqual(parseArgs(["--stop"]), { stop: true, prepareOnly: false, sampleData: true });
  assert.throws(() => parseArgs(["--allow-non-windows"]), /unknown argument/);
  assert.throws(() => parseArgs(["--stop", "--prepare-only"]), /--stop takes no other argument/);
});

test("the runner refuses anything but Windows, and production", () => {
  assert.match(refusal("linux", {}), /for Windows/);
  assert.match(refusal("darwin", {}), /for Windows/);
  assert.match(refusal("win32", { NODE_ENV: "production" }), /production/);
  assert.equal(refusal("win32", { NODE_ENV: "development" }), undefined);
});

test("libpq, psql and dbmate variables are removed in place, whatever their case", () => {
  const env = { PGHOST: "db.example.test", pgpassfile: "x", PSQLRC: "y", DBMATE_MIGRATIONS_DIR: "z", PATH: "p", APP_DATABASE_URL: "a" };
  assert.equal(stripSteering(env), env);
  assert.deepEqual(env, { PATH: "p", APP_DATABASE_URL: "a" });
});

test("the psql target is the local socket alone, as the db/local scripts accept it", () => {
  const target = psqlTarget("C:\\Users\\demo\\AppData\\Local\\Ductus\\native\\postgres-17.11-1\\bin", "C:\\Users\\demo\\AppData\\Local\\Ductus\\native-data\\s");
  assert.match(target.command, /psql\.exe$/);
  assert.deepEqual(target.args, ["-h", "C:\\Users\\demo\\AppData\\Local\\Ductus\\native-data\\s", "-p", "54329", "-U", "ductus", "-d", "ductus"]);
  assert.deepEqual(nativePsqlTarget(target), { ...target, env: {} });
});

test("PostgreSQL listens on loopback and its socket path is quoted for postgresql.conf", () => {
  const conf = nativeConf("C:\\Users\\o'demo\\Ductus\\s");
  assert.match(conf, /^listen_addresses = '127\.0\.0\.1'$/m);
  assert.match(conf, /^port = 54329$/m);
  assert.match(conf, /^unix_socket_directories = 'C:\/Users\/o''demo\/Ductus\/s'$/m);
  assert.match(conf, /^log_min_error_statement = panic$/m);
});

test("data and tools live under %LOCALAPPDATA%\\Ductus, never a relative path", () => {
  assert.throws(() => ductusHome({}), /LOCALAPPDATA/);
  assert.throws(() => ductusHome({ LOCALAPPDATA: "relative" }), /LOCALAPPDATA/);
  const home = ductusHome({ LOCALAPPDATA: "/home/demo/local" });
  assert.equal(layout(home).run, join(home, "native-data", "run.json"));
  assert.equal(toolDir(home, "postgres"), join(home, "native", "postgres-17.11-1"));
});

test("every pinned archive comes from its publisher over HTTPS with a full SHA-256", () => {
  assert.ok(Object.isFrozen(TOOLS));
  for (const tool of Object.values(TOOLS)) {
    assert.ok(Object.isFrozen(tool));
    assert.match(tool.url, /^https:\/\/(get\.enterprisedb\.com|github\.com\/rustfs\/rustfs\/releases\/download)\//);
    assert.match(tool.sha256, /^[0-9a-f]{64}$/);
    assert.match(tool.tree, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(tool.size) && tool.size > 0);
  }
});

test("one changed byte changes the tree hash, and so does an added file", async () => {
  const dir = await scratch();
  await mkdir(join(dir, "bin"));
  await writeFile(join(dir, "bin", "a.exe"), "abc");
  await writeFile(join(dir, "b.dll"), "def");
  const before = await treeHash(dir);
  assert.equal(await treeHash(dir), before);
  await writeFile(join(dir, "bin", "a.exe"), "abd");
  assert.notEqual(await treeHash(dir), before);
  await writeFile(join(dir, "bin", "a.exe"), "abc");
  assert.equal(await treeHash(dir), before);
  await writeFile(join(dir, "extra.dll"), "");
  assert.notEqual(await treeHash(dir), before);
});

test("a download that differs from the pin is deleted, never kept", async () => {
  const dir = await scratch();
  const dest = join(dir, "tool.zip");
  const bytes = new TextEncoder().encode("pinned bytes");
  const sha256 = execFileSync(process.execPath, ["-e", "process.stdout.write(require('crypto').createHash('sha256').update('pinned bytes').digest('hex'))"]).toString();
  const tool = { url: "https://example.test/tool.zip", size: bytes.length, sha256 };

  const changed = bytes.slice();
  changed[0] ^= 1;
  await assert.rejects(download(tool, dest, async () => bytesResponse(changed)), /does not match the pinned SHA-256/);
  assert.equal(existsSync(dest), false);
  assert.equal(existsSync(`${dest}.part`), false);
  await assert.rejects(download(tool, dest, async () => bytesResponse(bytes.slice(1))), /does not match/);
  await assert.rejects(download(tool, dest, async () => new Response("", { status: 404 })), /download failed \(404\)/);

  await download(tool, dest, async () => bytesResponse(bytes));
  assert.deepEqual(new Uint8Array(await readFile(dest)), bytes);
});

test("an unpacked tool whose files differ is refused and left for the user to delete", async () => {
  const home = await scratch();
  const dir = toolDir(home, "rustfs");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "rustfs.exe"), "not the pinned binary");
  let fetched = false;
  await assert.rejects(
    ensureTool("rustfs", { home, tar: "/nonexistent/tar", fetchImpl: async () => ((fetched = true), new Response("")), log: () => {} }),
    /does not match the pinned files of rustfs 1\.0\.0; delete that folder/,
  );
  assert.equal(fetched, false);
  assert.equal(await readFile(join(dir, "rustfs.exe"), "utf8"), "not the pinned binary");
});

test("the fake OIDC preload binds a port to loopback and refuses a pipe or a socket path", () => {
  const listen = (code) => execFileSync(process.execPath, ["--import", LOOPBACK, "--input-type=module", "-e", code], { encoding: "utf8" }).trim();
  const port = `import net from "node:net"; const s = net.createServer().listen(0, () => { console.log(s.address().address); s.close(); });`;
  assert.equal(listen(port), "127.0.0.1");
  const object = `import net from "node:net"; const s = net.createServer().listen({ port: 0, host: "0.0.0.0" }, () => { console.log(s.address().address); s.close(); });`;
  assert.equal(listen(object), "127.0.0.1");
  const path = `import net from "node:net"; try { net.createServer().listen("/tmp/x.sock"); } catch (e) { console.log(e.message); }`;
  assert.match(listen(path), /loopback port only/);
});

test("without sample data the K-3 step is skipped and nothing else is", async () => {
  const home = await scratch();
  const run = createNativeRun({ env: {}, home, platform: "linux", tools: async () => ({}), sampleData: false });
  assert.deepEqual(await run.runNode("db/local/demo-k3.mjs", {}), { code: 0, stdout: "" });
  assert.equal(await run.runScript("stack:down", {}), 1);
  await run.interrupt();
  assert.equal(await run.runScript("db:seed", {}), 130);
  assert.deepEqual(await run.runNode("db/local/evidence-signing-key.mjs", {}), { code: 130, stdout: "" });
});

test("Ctrl+C during preparation starts nothing more and stops only after the start gives up", async () => {
  const home = await scratch();
  let release;
  let toolsCalled = false;
  const tools = () => {
    toolsCalled = true;
    return new Promise((resolve) => (release = () => resolve({ pgBin: join(home, "missing"), rustfs: join(home, "missing") })));
  };
  const run = createNativeRun({ env: {}, home, platform: "linux", tools, checks: async () => {} });
  const step = run.runScript("stack:up", {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  let stopped = false;
  const stopping = run.interrupt().then(() => (stopped = true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(toolsCalled, true);
  assert.equal(stopped, false);
  release();
  assert.equal(await step, 1);
  await stopping;
  assert.equal(existsSync(layout(home).data), false);
});

test("a start that fails leaves the run.json of the run already up as it was", async () => {
  const home = await scratch();
  const { data, run: runFile } = layout(home);
  await mkdir(data, { recursive: true });
  const other = JSON.stringify({ runner: { name: "runner", pid: 4242, image: "node.exe", start: "1" }, services: [] });
  await writeFile(runFile, other);
  const run = createNativeRun({ env: {}, home, platform: "linux", tools: async () => ({}), checks: async () => {
    throw new Error("port 3000 (app) is already in use");
  } });
  assert.equal(await run.runScript("stack:up", {}), 1);
  await run.stop();
  assert.equal(await readFile(runFile, "utf8"), other);
});

test("the process list gives each pid its image and start time, or no start when Windows withholds it", () => {
  const starts = parseStarts("4242|node|134060000000000000\r\n77|rustfs|\r\nnot a row\r\n");
  assert.deepEqual([...starts], [[4242, { image: "node.exe", start: "134060000000000000" }], [77, { image: "rustfs.exe", start: undefined }]]);
});

test("--stop kills a recorded pid only while its image and start time are the recorded ones", async () => {
  const home = await scratch();
  const { data, run: runFile } = layout(home);
  await mkdir(data, { recursive: true });
  await writeFile(runFile, JSON.stringify({
    runner: { name: "runner", pid: 101, image: "node.exe", start: "500" },
    services: [
      { name: "rustfs", pid: 102, image: "rustfs.exe", start: "501" },
      { name: "oidc", pid: 103, image: "node.exe", start: "502" },
      { name: "old", pid: 104, image: "node.exe" },
    ],
  }));
  const now = new Map([
    [101, { image: "node.exe", start: "999" }], // the pid reused after a restart, by another node.exe
    [102, { image: "rustfs.exe", start: "501" }], // the store this run started
    [103, { image: "code.exe", start: "502" }],
    [104, { image: "node.exe", start: "600" }], // a record without a start time
  ]);
  const killed = [];
  const errors = [];
  const error = console.error;
  const log = console.log;
  console.error = (line) => errors.push(line);
  console.log = () => {};
  try {
    await stopRecorded({}, home, { probe: async (_env, pids) => new Map(pids.filter((pid) => now.has(pid)).map((pid) => [pid, now.get(pid)])), kill: async (pid) => killed.push(pid) });
  } finally {
    console.error = error;
    console.log = log;
  }
  assert.deepEqual(killed, [102]);
  assert.equal(errors.length, 3);
  assert.equal(existsSync(runFile), false);
});
