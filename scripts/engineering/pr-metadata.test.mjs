import test from "node:test";
import assert from "node:assert/strict";

import { evaluateMetadata, minimumRisk } from "./pr-metadata-core.mjs";

const body = (risk = "standard", agent = "claude:a:backend") =>
  `Agent: ${agent}\nRisk: ${risk}\nTask: X-1\n`;

test("docs-only non-governance changes may be low", () => {
  assert.equal(minimumRisk(["docs/README.md"]).risk, "low");
});

test("runtime code requires at least standard", () => {
  assert.equal(minimumRisk(["src/domain/document/index.ts"]).risk, "standard");
});

test("all workflow changes are critical because they can affect required statuses", () => {
  assert.equal(minimumRisk([".github/workflows/ci.yml"]).risk, "critical");
  assert.equal(minimumRisk([".github/workflows/dependency-review.yml"]).risk, "critical");
});

test("engineering gate and governance sources are critical", () => {
  for (const filename of [
    ".github/workflows/engineering-gate.yml",
    ".github/CODEOWNERS",
    "scripts/engineering/review-gate.mjs",
    "CLAUDE.md",
    "AGENTS.md",
    "docs/ENGINEERING_SYSTEM.md",
    "docs/PRODUCT.md",
  ]) {
    assert.equal(minimumRisk([filename]).risk, "critical", filename);
  }
});

test("auth OIDC API and middleware boundaries are critical", () => {
  for (const filename of [
    "app/api/auth/callback/route.ts",
    "app/api/evidence/ingest/route.ts",
    "app/api/submissions/route.ts",
    "src/server/auth/oidc.ts",
    "src/adapters/oidc/client.ts",
    "middleware.ts",
    "src/middleware.ts",
  ]) {
    assert.equal(minimumRisk([filename]).risk, "critical", filename);
  }
});

test("identity, evidence, crypto and forensics paths are critical", () => {
  for (const filename of [
    "src/identity/session.ts",
    "src/server/identity/session.ts",
    "src/application/evidence/ingest.ts",
    "src/application/ports/evidence-ingest.ts",
    "src/application/ports/signing-key-provider.ts",
    "src/adapters/crypto/kms.ts",
    "src/domain/forensics/jcs.ts",
    "src/domain/forensics/signature.ts",
    "src/domain/forensics/replay.ts",
  ]) {
    assert.equal(minimumRisk([filename]).risk, "critical", filename);
  }
});

test("RLS, role and grant migrations plus pgTAP matrix are critical", () => {
  for (const filename of [
    "db/migrations/20261004_roles.sql",
    "db/migrations/20261004_rls_policies.sql",
    "db/migrations/20261004_grants.sql",
    "db/tests/020-identity-session.sql",
  ]) {
    assert.equal(minimumRisk([filename]).risk, "critical", filename);
  }
  // Every migration is critical: a baseline creates the tables the policies protect.
  assert.equal(minimumRisk(["db/migrations/20261004_baseline.sql"]).risk, "critical");
});

test("forbidden terms gate is critical because it enforces PRODUCT rules", () => {
  assert.equal(minimumRisk(["scripts/forbidden-terms/scan.ts"]).risk, "critical");
});

test("declared risk cannot be below the path floor", () => {
  const result = evaluateMetadata({
    body: body("low"),
    files: ["src/domain/document/index.ts"],
  });
  assert.equal(result.ok, false);
});

test("critical path rejects a standard declaration", () => {
  const result = evaluateMetadata({
    body: body("standard"),
    files: ["src/domain/forensics/jcs.ts"],
  });
  assert.equal(result.ok, false);
});

test("critical declaration satisfies a critical path", () => {
  const result = evaluateMetadata({
    body: body("critical"),
    files: ["src/domain/forensics/jcs.ts"],
  });
  assert.equal(result.ok, true);
});

test("standard runtime change passes metadata", () => {
  const result = evaluateMetadata({
    body: body("standard"),
    files: ["src/domain/document/index.ts"],
  });
  assert.equal(result.ok, true);
});

test("metadata parser ignores examples inside fenced code", () => {
  const result = evaluateMetadata({
    body: "```\nAgent: claude:x:backend\nRisk: low\nTask: fake\n```\n" + body("standard"),
    files: ["src/domain/document/index.ts"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.agent, "claude:a:backend");
});

test("unknown role fails", () => {
  const result = evaluateMetadata({
    body: body("standard", "claude:a:whatever"),
    files: ["src/domain/document/index.ts"],
  });
  assert.equal(result.ok, false);
});


test("Grok is a valid agent metadata runtime", () => {
  const result = evaluateMetadata({
    body: body("standard", "grok:a:backend"),
    files: ["src/domain/document/index.ts"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.agent, "grok:a:backend");
});
