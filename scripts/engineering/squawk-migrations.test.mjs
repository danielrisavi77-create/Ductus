// DAN-319 (attack plan #1174): Squawk lints only the forward SQL of new or
// changed migrations, with a pinned and re-verified binary, in a step that
// cannot pass silently. The real binary runs in CI on the two fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readBase, readMigrations } from "./migrations-ledger.mjs";
import {
  EXCLUDED_RULES,
  FIXTURES,
  INLINE_RULES,
  MIGRATION_NAME,
  PG_VERSION,
  SQUAWK,
  checkCanary,
  runSquawk,
  selectMigrations,
  squawkArgs,
  upSection,
  verifyBinary,
} from "./squawk-migrations.mjs";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migration = (up, down = "DROP TABLE a;") => `-- header\n-- migrate:up\n${up}\n\n-- migrate:down\n${down}\n`;
const files = (entries) => new Map(Object.entries(entries).map(([name, text]) => [name, Buffer.from(text)]));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// dbmate v2.36.0, pkg/dbmate/migration.go: upRegExp and downRegExp; the up
// block is the text from the up directive to the down directive.
const DBMATE_UP = /^--\s*migrate:up(\s*$|\s+\S+)/m;
const DBMATE_DOWN = /^--\s*migrate:down(\s*$|\s+\S+)/m;
const dbmateUp = (text) => text.slice(text.search(DBMATE_UP), text.search(DBMATE_DOWN));

test("C1, C2: the linted part is dbmate's up block, never the down block", () => {
  const text = migration("CREATE TABLE a (id bigint);", "ALTER TABLE b DROP COLUMN c;");
  const forward = upSection(text);
  assert.ok(forward.includes("CREATE TABLE a"));
  assert.ok(!forward.includes("DROP COLUMN"));
  assert.equal(forward.slice(forward.indexOf("-- migrate:up")).trimEnd(), dbmateUp(text).trimEnd());
  // Line numbers stay those of the file: the header is kept as comments.
  assert.equal(forward.split("\n")[2], "CREATE TABLE a (id bigint);");
  assert.equal(upSection(text.replaceAll("\n", "\r\n")), forward);
});

test("C2: every migration in db/migrations parses, and the part equals dbmate's up block", () => {
  const names = readdirSync("db/migrations");
  assert.ok(names.length > 0);
  for (const name of names) {
    const text = readFileSync(`db/migrations/${name}`, "utf8");
    const forward = upSection(text);
    assert.equal(forward.slice(forward.indexOf("-- migrate:up")).trimEnd(), dbmateUp(text).trimEnd(), name);
  }
});

test("C2, C3: a directive shape where dbmate could differ is refused, never linted as empty", () => {
  const ok = "CREATE TABLE a (id bigint);";
  const shapes = {
    "no space": `--migrate:up\n${ok}\n-- migrate:down\n`,
    "upper case": `-- MIGRATE:UP\n${ok}\n-- migrate:down\n`,
    "trailing space": `-- migrate:up \n${ok}\n-- migrate:down\n`,
    "transaction:false": `-- migrate:up transaction:false\n${ok}\n-- migrate:down\n`,
    "up twice": `-- migrate:up\n${ok}\n-- migrate:up\n${ok}\n-- migrate:down\n`,
    "down twice": `-- migrate:up\n${ok}\n-- migrate:down\n-- migrate:down\n`,
    "two sections": `-- migrate:up\n${ok}\n-- migrate:down\n-- migrate:up\n${ok}\n-- migrate:down\n`,
    "down first": `-- migrate:down\nDROP TABLE a;\n-- migrate:up\n${ok}\n`,
    "no down": `-- migrate:up\n${ok}\n`,
    "no up": `${ok}\n-- migrate:down\n`,
    "in a $$ body": `-- migrate:up\nCREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$\n-- migrate:down\nSELECT 1 $$;\n-- migrate:down\n`,
    "in a string": `-- migrate:up\nSELECT '-- migrate:down';\n-- migrate:down\n`,
    "split over lines": `-- migrate:up\n${ok}\n--\nmigrate:down\n-- migrate:down\n`,
    "statement before up": `CREATE TYPE s AS ENUM ('a');\n-- migrate:up\n${ok}\n-- migrate:down\n`,
  };
  for (const [label, text] of Object.entries(shapes)) assert.throws(() => upSection(text), Error, label);
});

test("D4: only the listed squawk-ignore form and rules are accepted", () => {
  const drop = "DROP FUNCTION f(bigint);";
  assert.doesNotThrow(() => upSection(migration(`-- squawk-ignore ban-drop-function\n${drop}`)));
  assert.doesNotThrow(() => upSection(migration(`-- squawk-ignore ban-drop-constraint, constraint-missing-not-valid\n${drop}`)));
  const refused = {
    "unlisted rule": `-- squawk-ignore ban-drop-column\n${drop}`,
    "unlisted second rule": `-- squawk-ignore ban-drop-function, ban-drop-table\n${drop}`,
    "file wide": `-- squawk-ignore-file ban-drop-function\n${drop}`,
    "bare": `-- squawk-ignore\n${drop}`,
    "block comment": `/* squawk-ignore ban-drop-function */\n${drop}`,
    "upper case": `-- SQUAWK-IGNORE ban-drop-function\n${drop}`,
    "no space after comma": `-- squawk-ignore ban-drop-function,ban-drop-constraint\n${drop}`,
    "trailing text": `${drop} -- squawk-ignore ban-drop-function`,
  };
  for (const [label, up] of Object.entries(refused)) assert.throws(() => upSection(migration(up)), Error, label);
  // A prototype key is not a listed rule.
  assert.throws(() => upSection(migration(`-- squawk-ignore constructor\n${drop}`)));
});

test("D4: the exception lists are disjoint, each with a reason, and the canary rule is not excluded", () => {
  for (const [rule, reason] of [...Object.entries(EXCLUDED_RULES), ...Object.entries(INLINE_RULES)]) {
    assert.match(rule, /^[a-z-]+$/);
    assert.ok(reason.length > 20, rule);
  }
  for (const rule of Object.keys(INLINE_RULES)) assert.ok(!Object.hasOwn(EXCLUDED_RULES, rule), rule);
  assert.ok(!Object.hasOwn(EXCLUDED_RULES, FIXTURES.badRule));
  assert.ok(!Object.hasOwn(INLINE_RULES, FIXTURES.badRule));
});

test("B1, B6: only migrations the base lacks or that differ from it are selected", () => {
  const base = files({ "20261001000000_a.sql": "a", "20261003000000_c.sql": "c" });
  const head = files({
    "20261001000000_a.sql": "a",
    "20261003000000_c.sql": "c changed",
    "20261002000000_older_than_c.sql": "new",
    "20261004000000_d.sql": "new",
  });
  assert.deepEqual(selectMigrations(head, base), ["20261002000000_older_than_c.sql", "20261003000000_c.sql", "20261004000000_d.sql"]);
  assert.deepEqual(selectMigrations(base, base), []);
});

test("B4: the selected set is the set dbmate applies; any other new file fails", () => {
  // dbmate v2.36.0 migrationFileRegexp `^(\d+).*\.sql$` (Go: `$` is end of text, `.` no newline).
  for (const name of ["20261101000000_a.sql", "1.sql", "20261101000000 a b.sql", "1--config=x.sql"]) {
    assert.ok(MIGRATION_NAME.test(name), name);
    assert.deepEqual(selectMigrations(files({ [name]: "x" }), new Map()), [name]);
  }
  for (const name of ["a.sql", "-1.sql", "1.SQL", "1.Sql", "1.sql.bak", "1_a.sql\nx", "1_a\n.sql", "README.md"]) {
    assert.ok(!MIGRATION_NAME.test(name), name);
    assert.throws(() => selectMigrations(files({ [name]: "x" }), new Map()), /not a file dbmate applies/, name);
  }
  // The name reaches Squawk only as one --stdin-filepath= argument, never as a path or option.
  const args = squawkArgs("/tmp/empty.toml", "db/migrations/1 --exclude=all.sql");
  assert.equal(args.at(-1), "--stdin-filepath=db/migrations/1 --exclude=all.sql");
  assert.ok(args.every((arg) => arg.startsWith("--")));
});

test("B2, B5: a git error or a non-file entry fails instead of selecting nothing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "squawk-sel-"));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { stdio: "pipe" });
    git("init", "-q");
    mkdirSync("db/migrations", { recursive: true });
    writeFileSync("db/migrations/20261001000000_a.sql", "a");
    git("add", "db/migrations");
    git("commit", "-qm", "base");
    const sha = git("rev-parse", "HEAD").toString().trim();
    writeFileSync("db/migrations/20261002000000_b.sql", "b");
    assert.deepEqual(selectMigrations(readMigrations("db/migrations"), readBase(sha)), ["20261002000000_b.sql"]);
    assert.throws(() => readBase("f".repeat(40)));
    assert.throws(() => readBase("HEAD"));
    mkdirSync("db/migrations/20261003000000_dir.sql");
    assert.throws(() => readMigrations("db/migrations"), /not a plain file/);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A1, A3, A4: the binary is checked against the pin before every run", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "squawk-bin-"));
  try {
    const bin = path.join(dir, "squawk");
    writeFileSync(bin, "fake binary");
    const pin = sha256(Buffer.from("fake binary"));
    assert.doesNotThrow(() => verifyBinary(bin, pin));
    let calls = 0;
    const spawn = () => ((calls += 1), { status: 0, stdout: "", stderr: "" });
    runSquawk({ binary: bin, sha256: pin, name: "x.sql", sql: "SELECT 1;\n", spawn });
    assert.equal(calls, 1);
    appendFileSync(bin, "\0");
    assert.throws(() => verifyBinary(bin, pin), /is not the pinned/);
    assert.throws(() => runSquawk({ binary: bin, sha256: pin, name: "x.sql", sql: "", spawn }), /is not the pinned/);
    assert.equal(calls, 1, "a changed binary is never run");
    writeFileSync(bin, "");
    assert.throws(() => verifyBinary(bin, pin), /is not the pinned/);
    assert.throws(() => verifyBinary(path.join(dir, "missing"), pin));
    assert.throws(() => verifyBinary(bin), /is not the pinned/, "the default pin is SQUAWK.sha256");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A6, D6, C5: fixed options, explicit empty config, no environment, empty working directory", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "squawk-run-"));
  try {
    const bin = path.join(dir, "squawk");
    writeFileSync(bin, "fake");
    let seen;
    const spawn = (file, args, options) => {
      const config = args.find((arg) => arg.startsWith("--config="))?.slice("--config=".length);
      seen = { file, args, options, config: readFileSync(config, "utf8"), cwdFiles: readdirSync(options.cwd) };
      return { status: 1, stdout: "x.sql:1:0: warning: a-rule\n", stderr: "" };
    };
    const result = runSquawk({ binary: bin, sha256: sha256(Buffer.from("fake")), name: "x.sql", sql: "SELECT 1;\n", spawn });
    assert.deepEqual(result, { status: 1, output: "x.sql:1:0: warning: a-rule\n" });
    assert.equal(seen.file, bin);
    assert.deepEqual(seen.options.env, {});
    assert.equal(seen.options.input, "SELECT 1;\n");
    assert.equal(seen.config, "");
    assert.deepEqual(seen.cwdFiles, ["empty.squawk.toml"]);
    assert.ok(seen.args.includes("--assume-in-transaction"));
    assert.ok(seen.args.includes(`--pg-version=${PG_VERSION}`));
    assert.ok(seen.args.includes(`--exclude=${Object.keys(EXCLUDED_RULES).join(",")}`));
    assert.ok(!seen.args.some((arg) => /upload-to-github|^--include/.test(arg)));
    // A spawn failure (no binary, exit 127 or a signal) is an error, not a pass.
    assert.throws(() => runSquawk({ binary: bin, sha256: sha256(Buffer.from("fake")), name: "x", sql: "", spawn: () => ({ error: new Error("ENOENT") }) }), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const image = /DUCTUS_POSTGRES_IMAGE: \S+\/postgres:(\d+)\./.exec(ci);
  assert.ok(image);
  assert.equal(PG_VERSION, `${image[1]}.0`);
});

test("D2: the canary passes only for exit 0 on the good fixture and exit 1 naming the rule on the bad one", () => {
  const good = { status: 0, output: "" };
  const bad = { status: 1, output: `bad.sql:4:25: warning: ${FIXTURES.badRule} Adding ...` };
  assert.deepEqual(checkCanary(good, bad), []);
  assert.equal(checkCanary({ status: 1, output: "x" }, bad).length, 1);
  assert.equal(checkCanary(good, { status: 1, output: "error: syntax-error" }).length, 1);
  assert.equal(checkCanary(good, { status: 127, output: FIXTURES.badRule }).length, 1);
  assert.equal(checkCanary(good, { status: 2, output: FIXTURES.badRule }).length, 1);
  assert.equal(checkCanary(good, { status: null, output: FIXTURES.badRule }).length, 1);
  assert.equal(checkCanary({ status: null, output: "" }, bad).length, 1);
});

test("D3, C1: the fixtures are outside what dbmate and pg_prove run, and parse", () => {
  for (const file of [FIXTURES.good, FIXTURES.bad]) {
    assert.ok(!file.startsWith("db/"), file);
    upSection(readFileSync(file, "utf8"));
  }
  const good = readFileSync(FIXTURES.good, "utf8");
  assert.match(good.slice(good.indexOf("-- migrate:down")), /DROP COLUMN/);
  assert.match(readFileSync(FIXTURES.bad, "utf8"), /ADD COLUMN \w+ text NOT NULL;/);
});

const step = () => {
  const start = ci.indexOf("- name: Squawk lint of new migrations (DAN-319)");
  assert.ok(start > 0, "the Squawk step exists");
  const end = ci.indexOf("\n      - ", start + 1);
  return { start, text: ci.slice(start, end) };
};

test("A1, A2, A3, A5: the step downloads the pinned asset, checks it, then runs it by absolute path", () => {
  const { text } = step();
  const url = `https://github.com/sbdchd/squawk/releases/download/v${SQUAWK.version}/${SQUAWK.asset}`;
  assert.ok(text.includes(`curl -fsSL --proto '=https' --retry 3 -o "$bin" ${url}\n`));
  assert.ok(text.includes(`echo "${SQUAWK.sha256}  $bin" | sha256sum -c -`));
  assert.ok(text.includes(`bin="$RUNNER_TEMP/squawk-${SQUAWK.version}/squawk"`));
  const check = text.indexOf("sha256sum -c");
  assert.ok(check < text.indexOf("chmod +x"));
  assert.ok(check < text.indexOf("node scripts/engineering/squawk-migrations.mjs"));
  assert.equal(text.match(/squawk-migrations\.mjs --squawk "\$bin" (--base "\$base"|--no-base)\n/g).length, 2);
  assert.match(SQUAWK.sha256, /^[0-9a-f]{64}$/);
  assert.match(SQUAWK.version, /^\d+\.\d+\.\d+$/);
});

test("A2, A6, D1, B7: no unpinned source, no token, nothing that hides the exit code, no condition", () => {
  const { text } = step();
  assert.ok(text.includes("set -euo pipefail"));
  for (const bad of ["|| true", "|| :", "continue-on-error", "if:", "upload-to-github", "secrets.", "GITHUB_TOKEN", "github.token", "| tee", "xargs", "latest", "npx", "pip ", "cache"]) {
    assert.ok(!text.includes(bad), bad);
  }
  // The step is in the required build job, right after the migration ledger.
  const build = ci.indexOf("\n  build:\n");
  const next = ci.indexOf("\n  stack:\n");
  assert.ok(build < step().start && step().start < next);
  assert.ok(ci.indexOf("- name: Migration ledger (D-91)") < step().start);
  // No other workflow fetches Squawk another way.
  for (const name of readdirSync(".github/workflows")) {
    const workflow = readFileSync(`.github/workflows/${name}`, "utf8");
    for (const line of workflow.split("\n").filter((l) => /squawk/i.test(l) && !/^\s*#/.test(l))) {
      assert.ok(!/latest|npx|pip|npm|cargo|brew|upload-to-github/i.test(line), `${name}: ${line}`);
    }
  }
});
