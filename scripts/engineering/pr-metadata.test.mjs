import test from "node:test";
import assert from "node:assert/strict";

import { evaluateMetadata, minimumRisk } from "./pr-metadata-core.mjs";

const body = (risk = "standard", agent = "claude:a:backend") =>
  `Agent: ${agent}\nRisk: ${risk}\nTask: X-1\n`;

test("docs-only changes may be low", () => {
  assert.equal(minimumRisk(["docs/README.md"]).risk, "low");
});

test("runtime code requires at least standard", () => {
  assert.equal(minimumRisk(["src/domain/document/index.ts"]).risk, "standard");
});

test("workflow changes require at least standard", () => {
  assert.equal(minimumRisk([".github/workflows/ci.yml"]).risk, "standard");
});

test("identity and evidence paths are critical", () => {
  assert.equal(minimumRisk(["src/server/identity/session.ts"]).risk, "critical");
  assert.equal(minimumRisk(["src/application/evidence/ingest.ts"]).risk, "critical");
});

test("security migrations are critical while baseline migration is standard", () => {
  assert.equal(minimumRisk(["db/migrations/20261004_roles.sql"]).risk, "critical");
  assert.equal(minimumRisk(["db/migrations/20261004_baseline.sql"]).risk, "standard");
});

test("declared risk cannot be below the path floor", () => {
  const result = evaluateMetadata({
    body: body("low"),
    files: ["src/domain/document/index.ts"],
  });
  assert.equal(result.ok, false);
});

test("standard runtime change passes metadata", () => {
  const result = evaluateMetadata({
    body: body("standard"),
    files: ["src/domain/document/index.ts"],
  });
  assert.equal(result.ok, true);
});

test("unknown role fails", () => {
  const result = evaluateMetadata({
    body: body("standard", "claude:a:whatever"),
    files: ["src/domain/document/index.ts"],
  });
  assert.equal(result.ok, false);
});
