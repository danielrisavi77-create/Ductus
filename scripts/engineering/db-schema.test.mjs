// D-91 (4), DAN-71: tests of scripts/engineering/db-schema.mjs, its CI step
// and the committed db/schema.sql.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { compare, dumpedVersions, migrationVersions, parseArgs, SCHEMA, serverImage, shim } from "./db-schema.mjs";

const root = new URL("../../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const IMAGE = `sha256:${"a".repeat(64)}`;
const DUMP = "CREATE TABLE x ();\n\nINSERT INTO public.schema_migrations (version) VALUES\n    ('20261003200000'),\n    ('20261003210000');\n";

test("arguments: none, --out FILE or --write, nothing else", () => {
  assert.deepEqual(parseArgs([]), { write: false, out: null });
  assert.deepEqual(parseArgs(["--out", "x/schema.sql"]), { write: false, out: "x/schema.sql" });
  assert.deepEqual(parseArgs(["--write"]), { write: true, out: null });
  for (const bad of [["--out"], ["--out", "--write"], ["--write", "--out", "x"], ["--check"], ["x"]]) {
    assert.throws(() => parseArgs(bad), /usage/, JSON.stringify(bad));
  }
});

test("the shim runs pg_dump from the image in the environment with dbmate's arguments unchanged", () => {
  assert.equal(shim(), '#!/bin/sh\nexec docker run --rm --network host "$DUCTUS_PG_DUMP_IMAGE" pg_dump "$@"\n');
});

test("the server image is the image ID of the one running postgres container", () => {
  const calls = [];
  const run = (outputs) => (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return outputs.shift();
  };
  assert.equal(serverImage(run(["c1\n", `${IMAGE}\n`])), IMAGE);
  assert.deepEqual(calls, ["docker compose ps -q postgres", "docker inspect --format {{.Image}} c1"]);
  assert.throws(() => serverImage(run([""])), /found 0/);
  assert.throws(() => serverImage(run(["c1\nc2\n"])), /found 2/);
  for (const image of ["postgres:17", `${IMAGE} --privileged`, `${IMAGE};id`, "sha256:ABC"]) {
    assert.throws(() => serverImage(run(["c1", image])), /unexpected image ID/, image);
  }
});

test("dbmate's trailing schema_migrations insert gives the dumped versions", () => {
  assert.deepEqual(dumpedVersions(DUMP), ["20261003200000", "20261003210000"]);
  assert.equal(dumpedVersions("CREATE TABLE x ();\n"), null);
});

test("the comparison fails without the file in HEAD, on an empty or foreign dump and on any byte of difference", () => {
  const dump = Buffer.from(DUMP);
  assert.equal(compare(Buffer.from(DUMP), dump), null);
  assert.match(compare(null, dump), /not in Git HEAD/);
  assert.match(compare(dump, Buffer.alloc(0)), /empty/);
  assert.match(compare(Buffer.from("x"), Buffer.from("x")), /no schema_migrations/);
  assert.match(compare(Buffer.from(DUMP.replace("x ()", "y ()")), dump), /differs/);
  assert.match(compare(Buffer.from(`${DUMP}\n`), dump), /differs/);
  assert.match(compare(Buffer.from(DUMP.replaceAll("\n", "\r\n")), dump), /differs/);
});

// A migration added without a new dump fails here, before any stack runs.
test("db/schema.sql lists exactly the versions of db/migrations, in order", () => {
  assert.ok(existsSync(new URL(SCHEMA, root)), `${SCHEMA} is committed`);
  assert.deepEqual(dumpedVersions(read(SCHEMA)), migrationVersions("db/migrations"));
});

test("CI dumps the freshly migrated database and compares it before any other test touches it", () => {
  const ci = read(".github/workflows/ci.yml");
  const start = ci.indexOf("\n  stack-e2e:");
  const end = ci.indexOf("\n  stack-", start + 1);
  assert.ok(start > 0 && end > start, "stack-e2e job found");
  const job = ci.slice(start, end);
  const migrate = job.indexOf("- run: pnpm db:migrate");
  const check = job.indexOf('run: node scripts/engineering/db-schema.mjs --out "$RUNNER_TEMP/db-schema/schema.sql"');
  const prove = job.indexOf("run: pnpm test:db");
  assert.ok(migrate > 0 && check > migrate && prove > check, "db:migrate, then the schema check, then pgTAP");
  assert.equal(job.split("db-schema.mjs").length - 1, 1, "one schema check");
  assert.match(job, /name: db-schema-\$\{\{ matrix\.shard \}\}\n/, "the dump is kept as the db-schema artifact");
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.match(scripts["db:migrate"], /dbmate --url "[^"]+" --no-dump-schema --wait up --strict/);
});
