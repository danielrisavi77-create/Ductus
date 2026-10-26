import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { nativePsqlTarget } from "../../../db/local/psql-target.mjs";
import {
  CREATE_DATABASE_SQL,
  PORTS,
  main,
  nativeConf,
  nativeDemo,
  nativePaths,
  psqlArgs,
  serviceEnv,
  socketDirectory,
} from "./up.mjs";

// Absolute on the host that runs the tests (C:\... on Windows, /tmp/... in CI on Linux).
const LOCAL = { LOCALAPPDATA: join(tmpdir(), "ductus-native-test", "AppData", "Local") };

test("services get none of the demo's credentials or database steering", () => {
  const env = {
    PATH: "C:\\Windows",
    SystemRoot: "C:\\Windows",
    PGPASSWORD: "x",
    PGHOST: "x",
    pghost: "x",
    DATABASE_URL: "x",
    APP_DATABASE_URL: "x",
    AUTH_DATABASE_URL: "x",
    DUCTUS_AUTH_LOCAL_PASSWORD: "x",
    S3_SECRET_ACCESS_KEY: "x",
    EVIDENCE_S3_LOCAL_SECRET: "x",
    AWS_PROFILE: "x",
    DBMATE_MIGRATIONS_DIR: "x",
    OIDC_CLIENT_SECRET: "x",
    RUSTFS_ROOT_USER: "x",
  };
  assert.deepEqual(serviceEnv(env, { PORT: "8090" }), { PATH: "C:\\Windows", SystemRoot: "C:\\Windows", PORT: "8090" });
});

test("data and tools live under LOCALAPPDATA\\Ductus, never in the repository", () => {
  const paths = nativePaths(LOCAL);
  for (const path of Object.values(paths)) assert.ok(path.startsWith(join(LOCAL.LOCALAPPDATA, "Ductus")));
  assert.throws(() => nativePaths({}), /LOCALAPPDATA must be an absolute path/);
  assert.throws(() => nativePaths({ LOCALAPPDATA: "AppData" }), /LOCALAPPDATA must be an absolute path/);
});

test("the socket folder is one libpq and postgresql.conf read the same way", () => {
  assert.equal(socketDirectory("C:\\Users\\demo\\AppData\\Local\\Ductus\\native-data\\run"), "C:/Users/demo/AppData/Local/Ductus/native-data/run");
  for (const bad of ["C:\\Users\\dé\\run", "C:\\Users\\a,b\\run", "C:\\Users\\o'k\\run", `C:\\${"a".repeat(90)}`]) {
    assert.throws(() => socketDirectory(bad), /plain ASCII/);
  }
});

test("PostgreSQL listens on 127.0.0.1 and the socket only, and psql always takes the socket", () => {
  const socket = "C:/Users/demo/AppData/Local/Ductus/native-data/run";
  assert.equal(nativeConf(socket), `listen_addresses = '127.0.0.1'\nport = 54329\nunix_socket_directories = '${socket}'\n`);
  const args = psqlArgs(socket);
  assert.deepEqual(args.slice(0, 8), ["-h", socket, "-p", "54329", "-U", "ductus", "-d", "ductus"]);
  assert.ok(args.includes("-X") && args.includes("ON_ERROR_STOP=1"));
  // The same target the db/local scripts accept from PR A's nativePsqlTarget.
  assert.doesNotThrow(() => nativePsqlTarget({ command: "psql.exe", args: args.slice(0, 8) }, {}));
  assert.equal(psqlArgs(socket, "postgres")[7], "postgres");
});

test("the ductus database is made only over the local socket", () => {
  assert.match(CREATE_DATABASE_SQL, /inet_server_addr\(\) IS NULL AS local_socket/);
  assert.match(CREATE_DATABASE_SQL, /\\if :local_socket\n\\if :missing\nCREATE DATABASE ductus;/);
  assert.match(CREATE_DATABASE_SQL, /\\else\nDO \$\$ BEGIN RAISE EXCEPTION 'only the local socket is accepted'/);
});

test("the runner refuses unknown flags, production and a non-Windows host before anything starts", async () => {
  const binaries = { pgBin: "Z:\\missing", rustfs: "Z:\\missing\\rustfs.exe" };
  const options = { platform: "win32", binaries };
  await assert.rejects(main(["--prepare"], LOCAL, options), /unknown argument --prepare/);
  await assert.rejects(main([], { ...LOCAL, NODE_ENV: "production" }, options), /refused in production/);
  await assert.rejects(main([], LOCAL, { platform: "linux", binaries }), /runs on Windows only/);
  await assert.rejects(main(["--stop"], { LOCALAPPDATA: "relative" }, options), /LOCALAPPDATA must be an absolute path/);
});

test("a busy app port refuses the full run before any service starts", async (t) => {
  const server = createServer();
  // If another program already holds the port on this machine, the refusal is the same.
  await new Promise((resolve) => {
    server.once("error", resolve);
    server.listen(PORTS.app, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  const dir = await mkdtemp(join(tmpdir(), "ductus-native-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { LOCALAPPDATA: dir, DUCTUS_DEV_SIGNING_KEY_FILE: join(dir, "seed") };
  await assert.rejects(main([], env, { platform: "win32", binaries: { pgBin: join(dir, "none"), rustfs: join(dir, "none") } }), /Port 3000 is already in use/);
});

test("a failing step is reported by name and ends the lifecycle, never thrown", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ductus-native-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const native = nativeDemo({
    paths: nativePaths({ LOCALAPPDATA: dir }),
    env: {},
    platform: "linux",
    binaries: { pgBin: join(dir, "none"), rustfs: join(dir, "none") },
    log: () => {},
  });
  const errors = [];
  t.mock.method(console, "error", (line) => errors.push(line));
  assert.equal(await native.runScript("db:seed", {}), 1);
  assert.deepEqual(errors, ["db:seed: psql on the local socket failed; nothing reached the database over TCP."]);
  native.interrupt();
  assert.equal(await native.runScript("db:seed", {}), 130);
  assert.deepEqual(await native.runNode("db/local/demo-k3.mjs", {}), { code: 130, stdout: "" });
  // Nothing was started, so there is nothing to stop.
  await native.stop();
});
