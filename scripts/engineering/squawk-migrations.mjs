// DAN-319: Squawk lints the forward SQL of every migration that is new or
// changed against the accepted base commit. Only the `-- migrate:up` part is
// linted: dbmate runs `-- migrate:down` only on rollback. pgTAP stays the proof
// of grants and RLS; this lint only flags locking and unsafe DDL.
//
//   node scripts/engineering/squawk-migrations.mjs --squawk BIN --base SHA
//   node scripts/engineering/squawk-migrations.mjs --squawk BIN --no-base
//
// BIN is checked against the pinned SHA-256 before every run of it; two
// fixtures prove each run that the binary flags a bad migration and passes a
// good one. The release has no signature or checksum file: the pin was compared
// with the `digest` field of the GitHub release API when it was set.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBase, readMigrations } from "./migrations-ledger.mjs";

export const SQUAWK = Object.freeze({
  version: "2.70.0",
  asset: "squawk-linux-x64",
  sha256: "836ba2ab0c0ec30ae02c9f2cec065b341ff853765ceaa3965c22109c2f53eb10",
});
// The major version of DUCTUS_POSTGRES_IMAGE in ci.yml (a test compares them).
export const PG_VERSION = "17.0";
// The exceptions, rule -> reason, in one place. EXCLUDED_RULES are off for
// every migration. INLINE_RULES may be switched off for one statement with a
// line `-- squawk-ignore <rule>[, <rule>]` that the reviewer sees in the
// migration; any other squawk-ignore form or rule is refused.
export const EXCLUDED_RULES = Object.freeze({
  "require-lock-timeout": "no migration sets lock_timeout; requiring SET LOCAL in each is a Backend decision (DAN-319 PR)",
  "require-statement-timeout": "no migration sets statement_timeout; same Backend decision as require-lock-timeout",
  "prefer-bigint-over-int": "not a locking rule; int columns here are bounded counters with CHECK limits",
});
const IN_ONE_TRANSACTION = "dbmate runs the migration in one transaction, so the lock is unavoidable; acknowledge it per statement";
const DELIBERATE_DROP = "a deliberate drop or replacement, acknowledged per statement";
export const INLINE_RULES = Object.freeze({
  "adding-foreign-key-constraint": IN_ONE_TRANSACTION,
  "constraint-missing-not-valid": IN_ONE_TRANSACTION,
  "disallowed-unique-constraint": IN_ONE_TRANSACTION,
  "require-concurrent-index-creation": IN_ONE_TRANSACTION,
  "adding-not-nullable-field": IN_ONE_TRANSACTION,
  "ban-drop-constraint": DELIBERATE_DROP,
  "ban-drop-function": DELIBERATE_DROP,
  "ban-drop-not-null": DELIBERATE_DROP,
});
const IGNORE_LINE = /^\s*-- squawk-ignore ([a-z-]+(?:, [a-z-]+)*)$/;
// dbmate v2.36.0 migrationFileRegexp (pkg/dbmate/db.go): the files it applies.
export const MIGRATION_NAME = /^(\d+).*\.sql$/;
export const FIXTURES = Object.freeze({
  good: "scripts/engineering/squawk-fixtures/good.sql",
  bad: "scripts/engineering/squawk-fixtures/bad.sql",
  badRule: "adding-required-field",
});

const DIR = "db/migrations";
const UP = "-- migrate:up";
const DOWN = "-- migrate:down";
// Every directive dbmate v2.36.0 can match (upRegExp, downRegExp in
// pkg/dbmate/migration.go) contains this, in any case, spacing or position.
const DIRECTIVE_LIKE = /--\s*migrate:/gi;

/**
 * The SQL dbmate runs on `up`: the text before `-- migrate:down`. Throws for
 * any shape where that could differ from dbmate's own parse: a directive in
 * another spelling, case or place (also inside a $$ body or a string), more
 * than one up or down, down before up, options such as `transaction:false`,
 * a statement before up, or an inline squawk-ignore.
 */
export function upSection(text) {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const up = lines.flatMap((line, index) => (line === UP ? [index] : []));
  const down = lines.flatMap((line, index) => (line === DOWN ? [index] : []));
  if (up.length !== 1) throw new Error(`needs exactly one line "${UP}", found ${up.length}`);
  if (down.length !== 1) throw new Error(`needs exactly one line "${DOWN}", found ${down.length}`);
  if (down[0] < up[0]) throw new Error(`"${DOWN}" comes before "${UP}"`);
  const directives = text.match(DIRECTIVE_LIKE)?.length ?? 0;
  if (directives !== 2) {
    throw new Error(`has ${directives - 2} migrate directive(s) in another form; only "${UP}" and "${DOWN}" lines are allowed`);
  }
  for (const line of lines.slice(0, up[0])) {
    if (!/^\s*$/.test(line) && !/^\s*--/.test(line)) throw new Error(`has a statement before "${UP}"`);
  }
  const forward = lines.slice(0, down[0]);
  const mentions = forward.join("\n").match(/squawk-ignore/gi)?.length ?? 0;
  const ignores = forward.map((line) => IGNORE_LINE.exec(line)).filter(Boolean);
  if (mentions !== ignores.length) {
    throw new Error('has a squawk-ignore in another form; only a line "-- squawk-ignore <rule>[, <rule>]" is allowed');
  }
  for (const rule of ignores.flatMap((match) => match[1].split(", "))) {
    if (!Object.hasOwn(INLINE_RULES, rule)) throw new Error(`ignores ${rule}, which is not in INLINE_RULES`);
  }
  return forward.join("\n") + "\n";
}

/** Names of the migrations that the base lacks or that differ from it. */
export function selectMigrations(migrations, base) {
  const names = [];
  for (const [name, bytes] of migrations) {
    if (base && base.has(name) && base.get(name).equals(bytes)) continue;
    if (!MIGRATION_NAME.test(name)) throw new Error(`${DIR}/${name} is not a file dbmate applies (^\\d+.*\\.sql$)`);
    names.push(name);
  }
  return names.sort();
}

export function verifyBinary(file, sha256 = SQUAWK.sha256) {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== sha256) throw new Error(`${file}: SHA-256 ${actual} is not the pinned ${sha256}`);
}

/** Every option is fixed; the SQL comes on stdin, so no file name is an argument. */
export function squawkArgs(config, name) {
  const args = [`--config=${config}`, `--pg-version=${PG_VERSION}`, "--assume-in-transaction", "--reporter=gcc"];
  const excluded = Object.keys(EXCLUDED_RULES);
  if (excluded.length > 0) args.push(`--exclude=${excluded.join(",")}`);
  args.push(`--stdin-filepath=${name}`);
  return args;
}

/**
 * Runs the verified binary in an empty directory, with an empty config file
 * (no .squawk.toml is discovered) and no environment (no token, no SQUAWK_*).
 */
export function runSquawk({ binary, sha256 = SQUAWK.sha256, name, sql, spawn = spawnSync }) {
  const work = mkdtempSync(path.join(tmpdir(), "squawk-"));
  try {
    const config = path.join(work, "empty.squawk.toml");
    writeFileSync(config, "");
    verifyBinary(binary, sha256);
    const result = spawn(binary, squawkArgs(config, name), {
      cwd: work,
      env: {},
      input: sql,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The fixtures: the good one exits 0, the bad one exits 1 naming its rule. */
export function checkCanary(good, bad, badRule = FIXTURES.badRule) {
  const errors = [];
  if (good.status !== 0) errors.push(`good fixture: exit ${good.status}, expected 0\n${good.output}`);
  if (bad.status !== 1 || !bad.output.includes(badRule)) {
    errors.push(`bad fixture: exit ${bad.status}, expected 1 naming ${badRule}\n${bad.output}`);
  }
  return errors;
}

function version(binary) {
  verifyBinary(binary);
  const result = spawnSync(binary, ["--version"], { env: {}, encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  return (result.stdout ?? "").trim();
}

function main(argv) {
  const [flag, binary, ...rest] = argv;
  const ok = flag === "--squawk" && binary && ((rest[0] === "--base" && rest.length === 2) || (rest[0] === "--no-base" && rest.length === 1));
  if (!ok) throw new Error("usage: squawk-migrations.mjs --squawk <binary> (--base <sha> | --no-base)");
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(`the pinned ${SQUAWK.asset} runs only on linux x64, not ${process.platform} ${process.arch}`);
  }
  const bin = path.resolve(binary);
  const reported = version(bin);
  if (reported !== `squawk ${SQUAWK.version}`) throw new Error(`${bin} reports "${reported}", pinned is squawk ${SQUAWK.version}`);

  const fixture = (file) => runSquawk({ binary: bin, name: file, sql: upSection(readFileSync(file, "utf8")) });
  const canary = checkCanary(fixture(FIXTURES.good), fixture(FIXTURES.bad));
  for (const error of canary) console.error(error);
  if (canary.length > 0) return 1;

  const base = rest[0] === "--base" ? readBase(rest[1]) : null;
  const migrations = readMigrations(DIR);
  const names = base === null ? [] : selectMigrations(migrations, base);
  if (base === null) console.log(`no base commit for this event: none of ${migrations.size} migrations linted (each is linted on its PR)`);
  else console.log(`base ${rest[1].slice(0, 12)}: ${names.length} new or changed migration(s): ${names.join(", ") || "none"}`);

  let failed = 0;
  for (const name of names) {
    const file = path.posix.join(DIR, name);
    let sql;
    try {
      sql = upSection(readFileSync(file, "utf8"));
    } catch (error) {
      console.error(`${file}: ${error.message}`);
      failed += 1;
      continue;
    }
    const result = runSquawk({ binary: bin, name: file, sql });
    if (result.status !== 0) {
      console.error(`${file}: squawk exit ${result.status}\n${result.output}`);
      failed += 1;
    }
  }
  console.log(`squawk ${SQUAWK.version}: ${names.length - failed} of ${names.length} migration(s) pass`);
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
