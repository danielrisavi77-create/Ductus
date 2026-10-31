// D-91 (4), DAN-71: the schema the migrations build must equal the committed
// db/schema.sql. CI migrates a fresh database with
// `dbmate --no-dump-schema up --strict` (pnpm db:migrate); this script then
// dumps it with `dbmate --schema-file <tmp>/schema.sql dump` into a temporary
// file and compares that file with db/schema.sql read from Git HEAD, never
// from the working tree, so nothing a migration run writes can change the
// expected schema before the comparison.
//
// pg_dump must have the server's major version (docs/BACKEND.md 4.8, 4). The
// runner has none, so dbmate finds a pg_dump shim first on PATH that runs
// pg_dump from the image of the running compose postgres container: the same
// build as the server, reaching it on the host network. POSIX shell only.
//
//   node scripts/engineering/db-schema.mjs              compare with HEAD
//   node scripts/engineering/db-schema.mjs --out FILE   also keep the dump
//   node scripts/engineering/db-schema.mjs --write      write db/schema.sql
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const SCHEMA = "db/schema.sql";
// Local and CI stack only (compose.yaml). No role= here: libpq rejects the
// parameter that dbmate adds for migrations, and a dump only reads.
const DB_URL = "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus?sslmode=disable";
const IMAGE = /^sha256:[0-9a-f]{64}$/;

/** --write, or a check with an optional --out FILE; anything else is an error. */
export function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--write") return { write: true, out: null };
  if (argv.length === 0) return { write: false, out: null };
  if (argv.length === 2 && argv[0] === "--out" && argv[1] && !argv[1].startsWith("-")) {
    return { write: false, out: argv[1] };
  }
  throw new Error("usage: db-schema.mjs [--out FILE | --write]");
}

/** The pg_dump shim; the image comes from the environment, never from this text. */
export function shim() {
  return '#!/bin/sh\nexec docker run --rm --network host "$DUCTUS_PG_DUMP_IMAGE" pg_dump "$@"\n';
}

/** The image ID of the running compose postgres container. */
export function serverImage(run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" })) {
  const ids = run("docker", ["compose", "ps", "-q", "postgres"]).trim().split(/\s+/).filter(Boolean);
  if (ids.length !== 1) throw new Error(`expected one running postgres container, found ${ids.length}`);
  const image = run("docker", ["inspect", "--format", "{{.Image}}", ids[0]]).trim();
  if (!IMAGE.test(image)) throw new Error(`unexpected image ID: ${JSON.stringify(image)}`);
  return image;
}

/**
 * Migration versions in the order dbmate's dump lists them in its trailing
 * INSERT INTO public.schema_migrations; null when the dump has none.
 */
export function dumpedVersions(text) {
  const insert = /INSERT INTO public\.schema_migrations \(version\) VALUES\s*([\s\S]*?);/.exec(text);
  if (!insert) return null;
  return [...insert[1].matchAll(/\('(\d+)'\)/g)].map((m) => m[1]);
}

/** Versions of the migration files, sorted as dbmate applies them. */
export function migrationVersions(dir) {
  return execFileSync("git", ["ls-files", "--", dir], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.basename(f).split("_")[0])
    .sort();
}

/** Why the dump differs from the expected schema, or null when equal. */
export function compare(expected, actual) {
  if (expected === null) return `${SCHEMA} is not in Git HEAD`;
  if (actual.length === 0) return "the dump is empty";
  if (dumpedVersions(actual.toString("utf8")) === null) return "the dump has no schema_migrations versions";
  return Buffer.compare(expected, actual) === 0 ? null : `the migrated schema differs from ${SCHEMA} in Git HEAD`;
}

function headSchema() {
  try {
    return execFileSync("git", ["show", `HEAD:${SCHEMA}`], { maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function dump(tmp) {
  const bin = path.join(tmp, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "pg_dump"), shim());
  chmodSync(path.join(bin, "pg_dump"), 0o755);
  const file = path.join(tmp, "schema.sql");
  const dbmate = fileURLToPath(new URL("../../node_modules/dbmate/dist/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [dbmate, "--url", DB_URL, "--schema-file", file, "dump"], {
    stdio: "inherit",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, DUCTUS_PG_DUMP_IMAGE: serverImage() },
  });
  if (result.status !== 0) throw new Error(`dbmate dump exited with ${result.status ?? result.signal}`);
  return readFileSync(file);
}

function main(argv) {
  const { write, out } = parseArgs(argv);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ductus-schema-"));
  try {
    const actual = dump(tmp);
    if (write) {
      writeFileSync(SCHEMA, actual);
      console.log(`wrote ${SCHEMA}`);
      return 0;
    }
    if (out) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, actual);
    }
    const expected = headSchema();
    const reason = compare(expected, actual);
    if (reason === null) {
      console.log(`${SCHEMA} matches the migrated schema`);
      return 0;
    }
    console.error(`D-91 (4): ${reason}.`);
    if (expected !== null) {
      writeFileSync(path.join(tmp, "expected.sql"), expected);
      spawnSync("git", ["diff", "--no-index", "--no-color", "--", path.join(tmp, "expected.sql"), path.join(tmp, "schema.sql")], {
        stdio: "inherit",
      });
    }
    console.error(
      `Commit the dump as ${SCHEMA}: the CI artifact db-schema holds it, or run ` +
        "`node scripts/engineering/db-schema.mjs --write` against a migrated local stack.",
    );
    return 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`D-91 (4): ${error.message}`);
    process.exitCode = 1;
  }
}
