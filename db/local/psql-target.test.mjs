import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PSQL_ARGS, loadInvocation, main as loadK3 } from "./demo-k3.mjs";
import { registrationInvocation, main as registerKey } from "./evidence-signing-key.mjs";
import { institutionInvocation, main as storageDomain } from "./evidence-storage-domain.mjs";
import { nativePsqlTarget } from "./psql-target.mjs";

const KEY = { keyId: "local-dev", keyVersion: "1", keyBase64Url: "AAAA" };
const CONNECTION = ["-p", "54329", "-U", "ductus", "-d", "ductus"];
const K3_SQL = fileURLToPath(new URL("./demo-k3.sql", import.meta.url));
const KEY_SQL = fileURLToPath(new URL("./evidence-signing-key.sql", import.meta.url));

// Stands in for psql: an executable that records its argv, stdin and the PG*
// variables it was given, and prints the given line. Record path and line come
// through the environment, so the target's args stay what a real psql gets.
const FAKE_PSQL = `#!${process.execPath}
  import { writeFileSync } from "node:fs";
  const argv = process.argv.slice(2);
  const pg = Object.keys(process.env).filter((name) => name.toUpperCase().startsWith("PG")).sort();
  let stdin = "";
  process.stdin.on("data", (chunk) => (stdin += chunk));
  process.stdin.on("end", () => {
    writeFileSync(process.env.FAKE_PSQL_RECORD, JSON.stringify({ argv, stdin, pg }));
    process.stdout.write(process.env.FAKE_PSQL_LINE + "\\n");
  });`;

// libpq variables that could choose a host, in the caller's environment.
const HOSTILE_PG = { PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", pghostaddr: "127.0.0.1", PGSERVICE: "x", PGSERVICEFILE: "/tmp/x" };

async function withFakePsql(line, run) {
  const dir = await mkdtemp(join(tmpdir(), "ductus-psql-target-"));
  try {
    const fake = join(dir, "fake-psql");
    const record = join(dir, "record.json");
    await writeFile(fake, FAKE_PSQL, { mode: 0o755 });
    const target = { command: fake, args: ["-h", dir, ...CONNECTION] };
    const fakeEnv = { FAKE_PSQL_RECORD: record, FAKE_PSQL_LINE: line, PGPASSWORD: "invented", ...HOSTILE_PG };
    const read = async () => JSON.parse(await readFile(record, "utf8"));
    await run({ dir, target, record, read, fakeEnv });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a native target names one absolute socket directory, POSIX or Windows", () => {
  for (const socket of ["/tmp/ductus-socket", "C:\\Users\\demo\\AppData\\Local\\Ductus\\native-data\\socket"]) {
    const args = ["-h", socket, ...CONNECTION];
    const target = nativePsqlTarget({ command: "psql", args });
    assert.deepEqual(target, { command: "psql", args, env: {} });
    args.push("-c", "changed later");
    assert.equal(target.args.length, 8, "the target is a copy");
  }
});

test("a native target that could reach TCP or is malformed is refused", () => {
  const refused = [
    undefined,
    null,
    { command: "", args: ["-h", "/tmp/s"] },
    { command: "psql", args: "-h /tmp/s" },
    { command: "psql", args: ["-h", "/tmp/s", 5432] },
    { command: "psql", args: CONNECTION },
    { command: "psql", args: ["-h", "127.0.0.1", ...CONNECTION] },
    { command: "psql", args: ["-h", "localhost", ...CONNECTION] },
    { command: "psql", args: ["-h", "relative/socket", ...CONNECTION] },
    { command: "psql", args: ["-h"] },
    { command: "psql", args: ["-h", "/tmp/s", "-h", "/tmp/t"] },
    { command: "psql", args: ["-h", "/tmp/s", "--host=127.0.0.1"] },
    { command: "psql", args: ["-h", "/tmp/s", "-h127.0.0.1"] },
    { command: "psql", args: ["-h", "/tmp/s", "-d", "host=127.0.0.1 dbname=ductus"] },
    { command: "psql", args: ["-h", "/tmp/s", "-d", "postgres://ductus@127.0.0.1:54329/ductus"] },
    // Review 804, finding 1: hostaddr in a conninfo and joined short options.
    { command: "psql", args: ["-h", "/tmp/s", "-d", "hostaddr=127.0.0.1 dbname=ductus"] },
    { command: "psql", args: ["-h", "/tmp/s", "-Xh", "127.0.0.1"] },
    { command: "psql", args: ["-h", "/tmp/s", "--dbname=hostaddr=127.0.0.1"] },
    { command: "psql", args: ["-h", "/tmp/s", "-d", "service=demo"] },
    { command: "psql", args: ["-h", "/tmp/s,127.0.0.1", ...CONNECTION] },
    { command: "psql", args: ["-h", "\\\\server\\share", ...CONNECTION] },
    { command: "psql", args: ["-h", "/tmp/s", "-p", "5432,5433"] },
    { command: "psql", args: ["-h", "/tmp/s", "-p", "65536"] },
    { command: "psql", args: ["-h", "/tmp/s", "-U", "postgres"] },
    { command: "psql", args: ["-h", "/tmp/s", "-p", "1", "-p", "2"] },
    { command: "psql", args: ["-h", "/tmp/s", "-c", "SELECT 1"] },
    { command: "psql", args: ["-h", "/tmp/s", "-p"] },
  ];
  for (const psql of refused) assert.throws(() => nativePsqlTarget(psql), /psql target/);
});

test("without a native target every script keeps its docker invocation", () => {
  const env = { DUCTUS_PSQL: "psql", PSQL: "psql", PGHOST: "127.0.0.1" };
  assert.deepEqual(registrationInvocation(env, "demo-fakultet", KEY), {
    command: "docker",
    args: [
      "compose", "exec", "-T", "postgres",
      "psql", "-U", "ductus", "-d", "ductus", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
      "-v", "institution_slug=demo-fakultet", "-v", "key_id=local-dev", "-v", "key_version=1", "-v", "key_base64url=AAAA",
    ],
  });
  assert.deepEqual(institutionInvocation(env, "demo-fakultet"), {
    command: "docker",
    args: [
      "compose", "exec", "-T", "postgres",
      "psql", "-U", "ductus", "-d", "ductus", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", "slug=demo-fakultet",
    ],
  });
  assert.deepEqual(loadInvocation(undefined), { command: "docker", args: [...PSQL_ARGS] });
  assert.deepEqual(PSQL_ARGS, ["compose", "exec", "-T", "postgres", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "ductus", "-d", "ductus"]);
});

test("DUCTUS_PSQL_CONTAINER still names a container and nothing else", () => {
  const env = { DUCTUS_PSQL_CONTAINER: "ductus-test-db" };
  assert.deepEqual(registrationInvocation(env, "x", KEY).args.slice(0, 4), ["exec", "-i", "ductus-test-db", "psql"]);
  assert.deepEqual(institutionInvocation(env, "x").args.slice(0, 4), ["exec", "-i", "ductus-test-db", "psql"]);
  for (const bad of ["", "-rm", "a b", "x;y"]) {
    assert.throws(() => registrationInvocation({ DUCTUS_PSQL_CONTAINER: bad }, "x", KEY), /container name/);
    assert.throws(() => institutionInvocation({ DUCTUS_PSQL_CONTAINER: bad }, "x"), /container name/);
  }
});

test("a native target runs without the PG* variables that could choose a host", () => {
  const env = { PATH: "/usr/bin", ...HOSTILE_PG, PGPASSWORD: "invented", pgpassfile: "/tmp/pass" };
  const target = nativePsqlTarget({ command: "psql", args: ["-h", "/tmp/s"] }, env);
  assert.deepEqual(target.env, { PATH: "/usr/bin", PGPASSWORD: "invented", pgpassfile: "/tmp/pass" });
  assert.equal(registrationInvocation(env, "x", KEY, { command: "psql", args: ["-h", "/tmp/s"] }).env.PGHOSTADDR, undefined);
  assert.equal(institutionInvocation(env, "x", { command: "psql", args: ["-h", "/tmp/s"] }).env.PGHOSTADDR, undefined);
  assert.equal(loadInvocation({ command: "psql", args: ["-h", "/tmp/s"] }, env).env.pghostaddr, undefined);
});

test("with a native target the connection comes first and the script's options follow", () => {
  const psql = { command: "C:\\pg\\bin\\psql.exe", args: ["-h", "C:\\Ductus\\socket", ...CONNECTION] };
  const env = { DUCTUS_PSQL_CONTAINER: "ignored-for-native" };
  assert.deepEqual(registrationInvocation(env, "demo-fakultet", KEY, psql), {
    command: psql.command,
    args: [
      ...psql.args, "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
      "-v", "institution_slug=demo-fakultet", "-v", "key_id=local-dev", "-v", "key_version=1", "-v", "key_base64url=AAAA",
    ],
    env,
  });
  assert.deepEqual(institutionInvocation(env, "demo-fakultet", psql), {
    command: psql.command,
    args: [...psql.args, "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", "slug=demo-fakultet"],
    env,
  });
  assert.deepEqual(loadInvocation(psql, env), {
    command: psql.command,
    args: [...psql.args, "-X", "-q", "-v", "ON_ERROR_STOP=1"],
    env,
  });
});

test("the signing key script registers through the native target", async () => {
  await withFakePsql("00000000-0000-4000-8000-000000000001", async ({ dir, target, read, fakeEnv }) => {
    const env = { ...fakeEnv, NODE_ENV: "test", DUCTUS_DEV_SIGNING_KEY_FILE: join(dir, "seed", "signing.key") };
    const registered = await registerKey(env, ["--institution", "demo-fakultet"], target);
    assert.equal(registered.evidenceDomainId, "00000000-0000-4000-8000-000000000001");
    const { argv, stdin, pg } = await read();
    assert.deepEqual(pg, ["PGPASSWORD"]);
    assert.deepEqual(argv.slice(0, 8), ["-h", dir, ...CONNECTION]);
    assert.ok(argv.includes(`key_id=${registered.keyId}`));
    assert.equal(stdin, await readFile(KEY_SQL, "utf8"));
  });
});

test("the storage script reads the institution through the native target", async () => {
  await withFakePsql("not-an-id", async ({ dir, target, read, fakeEnv }) => {
    const env = { ...fakeEnv, NODE_ENV: "test", EVIDENCE_S3_LOCAL_KEY_ID: "invented-key", EVIDENCE_S3_LOCAL_SECRET: "invented-secret" };
    await assert.rejects(storageDomain(env, [], target), /no institution with slug demo-fakultet/);
    const { argv, stdin, pg } = await read();
    assert.deepEqual(pg, ["PGPASSWORD"]);
    assert.match(stdin, /inet_server_addr\(\) IS NULL/);
    assert.deepEqual(argv, ["-h", dir, ...CONNECTION, "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", "slug=demo-fakultet"]);
    assert.match(stdin, /FROM identity\.institution WHERE slug = :'slug'/);
  });
});

test("the K-3 script loads its SQL through the native target and takes no argument", async () => {
  await withFakePsql("", async ({ dir, target, record, read, fakeEnv }) => {
    const env = { ...fakeEnv, NODE_ENV: "test" };
    await assert.rejects(loadK3(env, ["--institution", "x"], target), /takes no argument/);
    assert.equal(existsSync(record), false);
    await loadK3(env, [], target);
    const { argv, stdin, pg } = await read();
    assert.deepEqual(pg, ["PGPASSWORD"]);
    assert.deepEqual(argv, ["-h", dir, ...CONNECTION, "-X", "-q", "-v", "ON_ERROR_STOP=1"]);
    assert.equal(stdin, await readFile(K3_SQL, "utf8"));
  });
});

test("the storage script refuses an answer from a TCP connection", async () => {
  await withFakePsql("tcp", async ({ target, fakeEnv }) => {
    const env = { ...fakeEnv, NODE_ENV: "test", EVIDENCE_S3_LOCAL_KEY_ID: "invented-key", EVIDENCE_S3_LOCAL_SECRET: "invented-secret" };
    await assert.rejects(storageDomain(env, [], target), /over TCP/);
  });
});

test("a refused native target starts nothing and writes no seed", async () => {
  await withFakePsql("", async ({ dir, target, record, fakeEnv }) => {
    const seed = join(dir, "seed", "signing.key");
    const refused = [
      ["-h", "127.0.0.1", ...CONNECTION],
      ["-h", dir, "-d", "hostaddr=127.0.0.1 dbname=ductus"],
      ["-h", dir, "-Xh", "127.0.0.1"],
    ];
    for (const args of refused) {
      const tcp = { command: target.command, args };
      const env = { ...fakeEnv, NODE_ENV: "test", EVIDENCE_S3_LOCAL_KEY_ID: "k", EVIDENCE_S3_LOCAL_SECRET: "s" };
      await assert.rejects(loadK3({ ...fakeEnv, NODE_ENV: "test" }, [], tcp), /psql target/);
      await assert.rejects(storageDomain(env, [], tcp), /psql target/);
      await assert.rejects(registerKey({ ...fakeEnv, NODE_ENV: "test", DUCTUS_DEV_SIGNING_KEY_FILE: seed }, [], tcp), /psql target/);
      assert.equal(existsSync(record), false);
      assert.equal(existsSync(join(dir, "seed")), false, "review 804, finding 2: no seed directory or file");
    }
  });
});

test("production refuses every script before a target is judged", async () => {
  const psql = { command: "psql", args: ["-h", "/tmp/s"] };
  await assert.rejects(loadK3({ NODE_ENV: "production" }, [], psql), /refused in production/);
  await assert.rejects(storageDomain({ NODE_ENV: "production" }, [], psql), /refused in production/);
  await assert.rejects(registerKey({ NODE_ENV: "production" }, [], psql), /refused in production/);
});
