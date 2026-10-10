import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const compose = readFileSync(resolve(root, "compose.yaml"), "utf8");
const dockerfile = readFileSync(resolve(root, "infra/fake-oidc/Dockerfile"), "utf8");
const digest = "@sha256:[a-f0-9]{64}";

test("CI pins all stack images outside Docker Hub while local defaults stay intact", () => {
  const sources = new Map([
    ["DUCTUS_OBJECTS_IMAGE", "ghcr.io/rustfs/rustfs:1.0.0"],
    ["DUCTUS_MAIL_IMAGE", "ghcr.io/axllent/mailpit:v1.31.4"],
    ["DUCTUS_OIDC_BASE_IMAGE", "public.ecr.aws/docker/library/node:24.21.0-alpine"],
  ]);
  for (const [name, source] of sources) {
    const match = ci.match(new RegExp(`^\\s+${name}:\\s*["']?([^\\s"']+)["']?$`, "m"));
    assert.ok(match, `${name} must be set in the CI stack job`);
    assert.ok(match[1].startsWith(source + "@sha256:"), `${name} wrong provenance`);
    assert.match(match[1], new RegExp(`${digest}$`), `${name} not SHA-256 pinned`);
  }

  assert.ok(compose.includes("image: ${DUCTUS_OBJECTS_IMAGE:-rustfs/rustfs:1.0.0}"));
  assert.ok(compose.includes("image: ${DUCTUS_MAIL_IMAGE:-axllent/mailpit:v1.31.4}"));
  assert.ok(compose.includes("OIDC_BASE_IMAGE: ${DUCTUS_OIDC_BASE_IMAGE:-node:24.21.0-alpine}"));
  assert.ok(dockerfile.includes("ARG OIDC_BASE_IMAGE=node:24.21.0-alpine"));
  assert.ok(dockerfile.includes("FROM ${OIDC_BASE_IMAGE}"));
});

test("Postgres (built with pgTAP) takes a registry-pinned base image in CI and no hard-coded FROM", () => {
  const source = "public.ecr.aws/docker/library/postgres:17.11-trixie";
  const match = ci.match(/^\s+DUCTUS_POSTGRES_IMAGE:\s*["']?([^\s"']+)["']?$/m);
  assert.ok(match, "DUCTUS_POSTGRES_IMAGE must be set in the CI stack job");
  assert.ok(match[1].startsWith(source + "@sha256:"), "DUCTUS_POSTGRES_IMAGE wrong provenance");
  assert.match(match[1], new RegExp(`${digest}$`), "DUCTUS_POSTGRES_IMAGE not SHA-256 pinned");

  const block = compose.match(/^ {2}postgres:\n((?: {4}.*\n|\s*\n)+)/m);
  assert.ok(block, "postgres service block missing");
  assert.ok(!/^ {4}image:/m.test(block[1]), "postgres must be built, not pulled by a floating image");
  assert.ok(
    block[1].includes("context: infra/postgres") &&
      block[1].includes("POSTGRES_BASE_IMAGE: ${DUCTUS_POSTGRES_IMAGE:-postgres:17.11-trixie}"),
    "compose must pass DUCTUS_POSTGRES_IMAGE into the POSTGRES_BASE_IMAGE build arg",
  );

  const pgDockerfile = readFileSync(resolve(root, "infra/postgres/Dockerfile"), "utf8");
  assert.ok(pgDockerfile.includes("ARG POSTGRES_BASE_IMAGE=postgres:17.11-trixie"));
  const froms = pgDockerfile.split("\n").filter((line) => /^\s*FROM\s/i.test(line));
  assert.deepEqual(froms, ["FROM ${POSTGRES_BASE_IMAGE}"], "Dockerfile FROM must be the build arg only");
});

test("CI preserves full-history security tools and pins registry images by digest", () => {
  assert.match(ci, /ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:[a-f0-9]{64}/);
  assert.match(ci, /git --redact --no-banner \/repo/);
  assert.match(ci, new RegExp(`mirror\\.gcr\\.io/semgrep/semgrep:1\\.179\\.0${digest}\\s+semgrep scan --config p/default --config p/typescript --error --metrics off /src`));
  assert.match(ci, new RegExp(`ghcr\\.io/zizmorcore/zizmor:1\\.30\\.1${digest} --min-severity medium`));
  assert.match(ci, new RegExp(`ghcr\\.io/google/osv-scanner:v2\\.6\\.0${digest} scan source`));
  assert.match(ci, /fetch-depth:\s*0/);
  assert.match(ci, /0 commits scanned/);
  assert.match(ci, /- run: pnpm stack:up/);
  assert.match(ci, /- run: pnpm test:integration/);
  assert.match(ci, /run: pnpm stack:down/);
  assert.match(ci, /- run: pnpm test:unit/);
});

test("Gitleaks negative smoke proves scanner rejection, not just a nonzero startup error", () => {
  assert.match(ci, /name: Gitleaks synthetic negative smoke/);
  assert.match(ci, /ductus-synthetic-secret/);
  assert.match(ci, /--report-format json --report-path \/reports\/leaks\.json/);
  assert.match(ci, /finding\.get\("RuleID"\) == "ductus-synthetic-secret"/);
  assert.match(ci, /Scanner failed before producing a report/);
});
