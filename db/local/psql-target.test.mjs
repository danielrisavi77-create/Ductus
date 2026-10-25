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

// Stands in for psql.exe: records its argv and stdin, prints the given line.
const FAKE_PSQL = `
  import { writeFileSync } from "node:fs";
  const [record, line, ...argv] = process.argv.slice(2);
  let stdin = "";
  process.stdin.on("data", (chunk) => (stdin += chunk));
  process.stdin.on("end", () => {
    writeFileSync(record, JSON.stringify({ argv, stdin }));
    process.stdout.write(line + "\\n");
  });`;

async function withFakePsql(line, run) {
  const dir = await mkdtemp(join(tmpdir(), "ductus-psql-target-"));
  try {
    const fake = join(dir, "fake-psql.mjs");
    const record = join(dir, "record.json");
    await writeFile(fake, FAKE_PSQL);
    const target = { command: process.execPath, args: [fake, record, line, "-h", dir, ...CONNECTION] };
    const read = async () => JSON.parse(await readFile(record, "utf8"));
    await run({ dir, target, record, read });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a native target names one absolute socket directory, POSIX or Windows", () => {
  for (const socket of ["/tmp/ductus-socket", "C:\\Users\\demo\\AppData\\Local\\Ductus\\native-data\\socket"]) {
    const args = ["-h", socket, ...CONNECTION];
    const target = nativePsqlTarget({ command: "psql", args });
    assert.deepEqual(target, { command: "psql", args });
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

test("with a native target the connection comes first and the script's options follow", () => {
  const psql = { command: "C:\\pg\\bin\\psql.exe", args: ["-h", "C:\\Ductus\\socket", ...CONNECTION] };
  const env = { DUCTUS_PSQL_CONTAINER: "ignored-for-native" };
  assert.deepEqual(registrationInvocation(env, "demo-fakultet", KEY, psql), {
    command: psql.command,
    args: [
      ...psql.args, "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
      "-v", "institution_slug=demo-fakultet", "-v", "key_id=local-dev", "-v", "key_version=1", "-v", "key_base64url=AAAA",
    ],
  });
  assert.deepEqual(institutionInvocation(env, "demo-fakultet", psql), {
    command: psql.command,
    args: [...psql.args, "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", "slug=demo-fakultet"],
  });
  assert.deepEqual(loadInvocation(psql), { command: psql.command, args: [...psql.args, "-X", "-q", "-v", "ON_ERROR_STOP=1"] });
});

test("the signing key script registers through the native target", async () => {
  await withFakePsql("00000000-0000-4000-8000-000000000001", async ({ dir, target, read }) => {
    const env = { NODE_ENV: "test", DUCTUS_DEV_SIGNING_KEY_FILE: join(dir, "seed", "signing.key") };
    const registered = await registerKey(env, ["--institution", "demo-fakultet"], target);
    assert.equal(registered.evidenceDomainId, "00000000-0000-4000-8000-000000000001");
    const { argv, stdin } = await read();
    assert.deepEqual(argv.slice(0, 8), ["-h", dir, ...CONNECTION]);
    assert.ok(argv.includes(`key_id=${registered.keyId}`));
    assert.equal(stdin, await readFile(KEY_SQL, "utf8"));
  });
});

test("the storage script reads the institution through the native target", async () => {
  await withFakePsql("not-an-id", async ({ dir, target, read }) => {
    const env = { NODE_ENV: "test", EVIDENCE_S3_LOCAL_KEY_ID: "invented-key", EVIDENCE_S3_LOCAL_SECRET: "invented-secret" };
    await assert.rejects(storageDomain(env, [], target), /no institution with slug demo-fakultet/);
    const { argv, stdin } = await read();
    assert.deepEqual(argv, ["-h", dir, ...CONNECTION, "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", "slug=demo-fakultet"]);
    assert.match(stdin, /FROM identity\.institution WHERE slug = :'slug'/);
  });
});

test("the K-3 script loads its SQL through the native target and takes no argument", async () => {
  await withFakePsql("", async ({ dir, target, record, read }) => {
    await assert.rejects(loadK3({ NODE_ENV: "test" }, ["--institution", "x"], target), /takes no argument/);
    assert.equal(existsSync(record), false);
    await loadK3({ NODE_ENV: "test" }, [], target);
    const { argv, stdin } = await read();
    assert.deepEqual(argv, ["-h", dir, ...CONNECTION, "-X", "-q", "-v", "ON_ERROR_STOP=1"]);
    assert.equal(stdin, await readFile(K3_SQL, "utf8"));
  });
});

test("a refused native target starts nothing", async () => {
  await withFakePsql("", async ({ dir, target, record }) => {
    const tcp = { command: target.command, args: [...target.args.slice(0, 3), "-h", "127.0.0.1", ...CONNECTION] };
    const env = { NODE_ENV: "test", EVIDENCE_S3_LOCAL_KEY_ID: "k", EVIDENCE_S3_LOCAL_SECRET: "s" };
    await assert.rejects(loadK3({ NODE_ENV: "test" }, [], tcp), /psql target/);
    await assert.rejects(storageDomain(env, [], tcp), /psql target/);
    await assert.rejects(
      registerKey({ NODE_ENV: "test", DUCTUS_DEV_SIGNING_KEY_FILE: join(dir, "seed", "signing.key") }, [], tcp),
      /psql target/,
    );
    assert.equal(existsSync(record), false);
  });
});

test("production refuses every script before a target is judged", async () => {
  const psql = { command: "psql", args: ["-h", "/tmp/s"] };
  await assert.rejects(loadK3({ NODE_ENV: "production" }, [], psql), /refused in production/);
  await assert.rejects(storageDomain({ NODE_ENV: "production" }, [], psql), /refused in production/);
  await assert.rejects(registerKey({ NODE_ENV: "production" }, [], psql), /refused in production/);
});
