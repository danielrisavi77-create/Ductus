import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const compose = readFileSync(resolve(root, "compose.yaml"), "utf8");
const dockerfile = readFileSync(resolve(root, "infra/fake-oidc/Dockerfile"), "utf8");
const digest = "@sha256:[a-f0-9]{64}";
const stackJobs = ["stack-e2e", "stack-login"].map((name) => {
  const text = ci.split(`\n  ${name}:\n`)[1]?.split(/^ {2}[\w-]+:\n/m)[0];
  assert.ok(text, `${name} job exists`);
  return { name, text };
});

test("CI pins all stack images outside Docker Hub and compose defaults to the same pins (F-017)", () => {
  const sources = new Map([
    ["DUCTUS_OBJECTS_IMAGE", "ghcr.io/rustfs/rustfs:1.0.0"],
    ["DUCTUS_MAIL_IMAGE", "ghcr.io/axllent/mailpit:v1.31.4"],
    ["DUCTUS_OIDC_BASE_IMAGE", "mirror.gcr.io/library/node:24.21.0-alpine"],
  ]);
  for (const job of stackJobs) {
    for (const [name, source] of sources) {
      const match = job.text.match(new RegExp(`^\\s+${name}:\\s*["']?([^\\s"']+)["']?$`, "m"));
      assert.ok(match, `${name} must be set in ${job.name}`);
      assert.ok(match[1].startsWith(source + "@sha256:"), `${job.name}: ${name} wrong provenance`);
      assert.match(match[1], new RegExp(`${digest}$`), `${job.name}: ${name} not SHA-256 pinned`);
    }
  }

  assert.ok(compose.includes("image: ${DUCTUS_OBJECTS_IMAGE:-ghcr.io/rustfs/rustfs:1.0.0@sha256:"));
  assert.ok(compose.includes("image: ${DUCTUS_MAIL_IMAGE:-ghcr.io/axllent/mailpit:v1.31.4@sha256:"));
  assert.ok(compose.includes("OIDC_BASE_IMAGE: ${DUCTUS_OIDC_BASE_IMAGE:-mirror.gcr.io/library/node:24.21.0-alpine@sha256:"));
  assert.ok(dockerfile.includes("ARG OIDC_BASE_IMAGE=node:24.21.0-alpine"));
  assert.ok(dockerfile.includes("FROM ${OIDC_BASE_IMAGE}"));
});

test("Postgres (built with pgTAP) takes a registry-pinned base image in CI and no hard-coded FROM", () => {
  const source = "mirror.gcr.io/library/postgres:17.11-trixie";
  for (const job of stackJobs) {
    const match = job.text.match(/^\s+DUCTUS_POSTGRES_IMAGE:\s*["']?([^\s"']+)["']?$/m);
    assert.ok(match, `DUCTUS_POSTGRES_IMAGE must be set in ${job.name}`);
    assert.ok(match[1].startsWith(source + "@sha256:"), `${job.name}: DUCTUS_POSTGRES_IMAGE wrong provenance`);
    assert.match(match[1], new RegExp(`${digest}$`), `${job.name}: DUCTUS_POSTGRES_IMAGE not SHA-256 pinned`);
  }

  const block = compose.match(/^ {2}postgres:\n((?: {4}.*\n|\s*\n)+)/m);
  assert.ok(block, "postgres service block missing");
  assert.ok(!/^ {4}image:/m.test(block[1]), "postgres must be built, not pulled by a floating image");
  assert.ok(
    block[1].includes("context: infra/postgres") &&
      block[1].includes("POSTGRES_BASE_IMAGE: ${DUCTUS_POSTGRES_IMAGE:-mirror.gcr.io/library/postgres:17.11-trixie@sha256:"),
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

const workflowsDir = resolve(root, ".github/workflows");
const workflows = readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => ({ name, text: readFileSync(resolve(workflowsDir, name), "utf8") }));

/** Every `uses:` reference outside a local `./` action, with its trailing comment. */
const usesLines = (text) =>
  [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)].map((m) => ({ ref: m[1], rest: m[2] }));

test("every workflow action is pinned to a full commit SHA with its version comment", () => {
  assert.ok(workflows.length > 0);
  for (const { name, text } of workflows) {
    for (const { ref, rest } of usesLines(text)) {
      if (ref.startsWith("./")) continue;
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name}: ${ref} not pinned to a full SHA`);
      assert.match(rest, /^\s+# v\d/, `${name}: ${ref} needs a "# vX" version comment`);
    }
  }
});

// A privileged trigger runs with the base repository's cache scope; a cache
// restored or saved there could carry attacker-controlled PR content.
// The whole `on:` value, inline (scalar or flow array) and block form, with
// comments dropped; a privileged event named anywhere in it counts.
const onSection = (text) => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^["']?on["']?\s*:/.test(line));
  if (start === -1) return "";
  const section = [lines[start].replace(/^["']?on["']?\s*:/, "")];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    section.push(line);
  }
  return section.map((line) => line.replace(/#.*$/, "")).join("\n");
};
const isPrivileged = (text) => /\b(?:pull_request_target|workflow_run|issue_comment)\b/.test(onSection(text));
const usesCache = (text) => /actions\/cache(?:\/(?:restore|save))?@/.test(text) || /^\s+cache(?:-dependency-path)?:/m.test(text);

test("no cache in workflows with a privileged trigger; CI caches only in build and runtime stacks", () => {
  const privileged = workflows.filter(({ text }) => isPrivileged(text));
  assert.ok(privileged.length > 0, "the engineering gate runs on pull_request_target");
  for (const { name, text } of privileged) {
    assert.ok(!usesCache(text), `${name}: privileged workflow must not use a cache`);
  }
  assert.ok(!isPrivileged(ci), "ci.yml must not gain a privileged trigger");
  const jobs = ci.split(/^ {2}(?=[\w-]+:\s*$)/m);
  const cached = jobs.filter((job) => /actions\/cache@/.test(job)).map((job) => job.split(":")[0]);
  assert.deepEqual(cached, ["build", "stack-e2e", "stack-login"]);
});

test("login dev and production build use separate Next cache keys", () => {
  for (const { name, text } of stackJobs) {
    const prefix = name === "stack-login" ? "stack-login-next-" : "stack-next-";
    assert.ok(text.includes(`key: ${prefix}`), `${name}: cache key`);
    assert.ok(text.includes(`restore-keys: |\n            ${prefix}`), `${name}: restore prefix`);
  }
});

test("every stack Next cache saves per commit and restores by a prefix of its key", () => {
  // A GitHub cache entry is immutable: a key without the SHA freezes .next/cache
  // at its first save, and a restore prefix the key does not start with never hits.
  for (const { name, text } of stackJobs) {
    const prefix = text.match(/^ {12}(stack-(?:login-)?next-\S.*-)$/m)?.[1];
    assert.ok(prefix, `${name}: restore prefix`);
    assert.ok(text.includes(`key: ${prefix}\${{ github.sha }}\n`), `${name}: key is the prefix plus the SHA`);
  }
});

test("the build cache key changes with the ESLint config and the lockfile", () => {
  const prefix = "build-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml', 'eslint.config.mjs') }}-";
  assert.ok(ci.includes(`key: ${prefix}\${{ github.sha }}`), "build cache key");
  assert.ok(ci.includes(`restore-keys: |\n            ${prefix}\n`), "build restore-keys");
});

test("the cache and trigger detectors see every form a workflow could use", () => {
  assert.ok(usesCache("      - uses: actions/cache@0123456789012345678901234567890123456789 # v6.1.0\n"));
  assert.ok(usesCache("      - uses: actions/cache/restore@0123456789012345678901234567890123456789 # v6\n"));
  assert.ok(usesCache("        with:\n          cache: pnpm\n"));
  assert.ok(!usesCache("      - run: pnpm lint --cache\n"));
  assert.ok(isPrivileged("on:\n  pull_request_target:\n"));
  assert.ok(isPrivileged("on: [push, pull_request_target]\njobs:\n"));
  assert.ok(isPrivileged("on: issue_comment\njobs:\n"));
  assert.ok(isPrivileged("on: # note\n  workflow_run:\n    workflows: [CI]\n"));
  assert.ok(isPrivileged("\"on\":\n  - pull_request_target\n"));
  assert.ok(!isPrivileged("on:\n  pull_request:\njobs:\n  x:\n    name: issue_comment\n"));
  assert.ok(!isPrivileged("on: [push] # pull_request_target later\n"));
});
