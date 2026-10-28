import test from "node:test";
import assert from "node:assert/strict";
import { classifyDiff } from "./ci-docs-scope.mjs";

const record = (path, modes = "100644 100644", status = "M") =>
  `:${modes} ${"a".repeat(40)} ${"b".repeat(40)} ${status}\0${path}\0`;

// #971: the tests profile skips the stack, DB, browser and property jobs, so it
// may hold only plain unit tests that the always-on unit job still runs.
test("tests profile only for plain unit tests that the unit job runs", () => {
  assert.equal(classifyDiff(record("src/domain/sync/queue.test.ts")), "tests");
  assert.equal(classifyDiff(record("tests/unit/a.test.ts", "000000 100644", "A")), "tests");
  for (const path of [
    "e2e/login/login.spec.ts",
    "db/tests/030-institution-access-matrix.sql",
    "tests/integration/replay-route.integration.test.ts",
    "src/domain/x.property.test.ts",
    "tests/property/setup.ts",
  ]) assert.equal(classifyDiff(record(path)), "full", path);
  assert.equal(classifyDiff(record("src/a.test.ts") + record("e2e/b.spec.ts")), "full");
  assert.equal(classifyDiff(record("src/a.test.ts", "100644 100755")), "full");
  assert.equal(classifyDiff(record("src/a.test.ts", "100644 100644", "R100")), "full");
});
