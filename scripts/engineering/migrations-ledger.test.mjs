// D-91 (1), DAN-71: db/migrations.sum holds the SHA-256 of every migration, and
// a migration that exists in the accepted base may never change or disappear,
// even when the ledger changes with it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkBase, checkLedger, readMigrations, renderLedger } from "./migrations-ledger.mjs";

const script = path.resolve("scripts/engineering/migrations-ledger.mjs");
const A = "20261001000000_a.sql";
const B = "20261002000000_b.sql";
const files = (entries) => new Map(Object.entries(entries).map(([name, text]) => [name, Buffer.from(text)]));
// sha256("a"); used with one space instead of two to make a malformed line.
const SHA_A = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

test("the ledger lists every migration by name, sorted, with its SHA-256", () => {
  const text = renderLedger(files({ [B]: "b", [A]: "a" }));
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`^[0-9a-f]{64}  ${A}$`));
  assert.match(lines[1], new RegExp(`^[0-9a-f]{64}  ${B}$`));
  assert.equal(lines[0].slice(0, 64), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  assert.ok(text.endsWith("\n"));
});

test("a ledger that matches the migrations passes", () => {
  const migrations = files({ [A]: "a", [B]: "b" });
  assert.deepEqual(checkLedger(migrations, renderLedger(migrations)), []);
});

test("a new migration without a ledger line, a stale line or a changed hash fails", () => {
  const migrations = files({ [A]: "a", [B]: "b" });
  const onlyA = renderLedger(files({ [A]: "a" }));
  assert.match(checkLedger(migrations, onlyA).join("\n"), new RegExp(`${B}.*not in db/migrations.sum`));
  assert.match(checkLedger(files({ [A]: "a" }), renderLedger(migrations)).join("\n"), new RegExp(`${B}.*no such migration`));
  assert.match(checkLedger(files({ [A]: "a2" }), onlyA).join("\n"), new RegExp(`${A}.*hash`));
  assert.match(checkLedger(files({ [A]: "a" }), `${SHA_A} ${A}\n`).join("\n"), /line 1/);
  assert.match(checkLedger(files({ [A]: "a" }), "").join("\n"), /not in db\/migrations.sum/);
  // A missing ledger file reads as null and fails, never as "nothing to check".
  assert.ok(checkLedger(files({ [A]: "a" }), null).length > 0);
});

test("a base migration that changed, disappeared or was renamed fails, even with an updated ledger", () => {
  const base = files({ [A]: "a" });
  assert.deepEqual(checkBase(base, files({ [A]: "a", [B]: "b" })), []);
  assert.match(checkBase(base, files({ [A]: "a changed" })).join("\n"), new RegExp(`${A}.*changed`));
  assert.match(checkBase(base, files({ [B]: "b" })).join("\n"), new RegExp(`${A}.*removed`));
  assert.match(checkBase(base, files({ ["20261001000000_renamed.sql"]: "a" })).join("\n"), new RegExp(`${A}.*removed`));
});

test("the committed ledger matches db/migrations of this checkout", () => {
  const migrations = readMigrations("db/migrations");
  assert.ok(migrations.size > 0);
  assert.deepEqual(checkLedger(migrations, readFileSync("db/migrations.sum", "utf8")), []);
});

// The CLI against a throwaway git repository, the way CI runs it.
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "migrations-ledger-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "ci@example.test");
  git("config", "user.name", "CI");
  git("config", "commit.gpgsign", "false");
  mkdirSync(path.join(dir, "db", "migrations"), { recursive: true });
  const put = (name, text) => writeFileSync(path.join(dir, "db", "migrations", name), text);
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  const commit = () => {
    git("add", "-A");
    git("commit", "-q", "-m", "x");
    return git("rev-parse", "HEAD");
  };
  return { dir, git, put, cli, commit };
}

test("CLI: --write records the ledger, a later addition passes, an edit of a base migration fails", () => {
  const r = repo();
  try {
    r.put(A, "create table a ();\n");
    assert.equal(r.cli("--write").status, 0);
    const base = r.commit();
    assert.equal(r.cli("--base", base).status, 0);

    r.put(B, "create table b ();\n");
    assert.equal(r.cli("--base", base).status, 1, "a new migration without a ledger line fails");
    assert.equal(r.cli("--write").status, 0);
    assert.equal(r.cli("--base", base).status, 0);

    r.put(A, "create table a (x int);\n");
    assert.equal(r.cli("--write").status, 0);
    const edited = r.cli("--base", base);
    assert.equal(edited.status, 1, "an edited base migration fails even with the ledger rewritten");
    assert.match(edited.stderr, /changed/);
    assert.equal(r.cli().status, 0, "without a base only the ledger is checked");
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("CLI: a deleted base migration, an unknown base and a directory in db/migrations fail closed", () => {
  const r = repo();
  try {
    r.put(A, "a\n");
    r.put(B, "b\n");
    r.cli("--write");
    const base = r.commit();
    rmSync(path.join(r.dir, "db", "migrations", B));
    r.cli("--write");
    assert.equal(r.cli("--base", base).status, 1);
    r.put(B, "b\n");
    r.cli("--write");
    assert.equal(r.cli("--base", "f".repeat(40)).status, 1);
    assert.equal(r.cli("--base", "not-a-sha").status, 1);
    mkdirSync(path.join(r.dir, "db", "migrations", "nested"));
    assert.equal(r.cli().status, 1);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("CI checks the ledger against the PR base and the previous main head", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const start = ci.indexOf("\n  build:\n");
  assert.ok(start > 0);
  const next = ci.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  const build = ci.slice(start, next > 0 ? start + 1 + next : undefined);
  assert.match(build, /- name: Migration ledger \(D-91\)\n/);
  assert.match(build, /PR_BASE: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(build, /PUSH_BEFORE: \$\{\{ github\.event\.before \}\}/);
  assert.match(build, /node scripts\/engineering\/migrations-ledger\.mjs --base "\$base"/);
});
