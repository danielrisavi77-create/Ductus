import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ALLOWED_IDS,
  IGNORE_UNTIL_WINDOW,
  allPackages,
  checkDevOnlyPackages,
  checkIgnoredVulns,
  checkOsvStep,
  parseIgnoredVulns,
  productionPackages,
} from "./osv-exceptions.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const entry = (id, { ignoreUntil = "2027-01-03", reason = "Invented reason." } = {}) =>
  `[[IgnoredVulns]]\nid = "${id}"\nignoreUntil = ${ignoreUntil}\nreason = "${reason}"\n`;
const validToml = ALLOWED_IDS.map((id) => entry(id)).join("\n");
const [firstId, ...otherIds] = ALLOWED_IDS;
const withFirst = (text) => [text, ...otherIds.map((id) => entry(id))].join("\n");

test("the repository's own files pass every guard", () => {
  checkIgnoredVulns(read("osv-scanner.toml"));
  checkOsvStep(read(".github/workflows/ci.yml"));
  checkDevOnlyPackages({
    rootLock: read("pnpm-lock.yaml"),
    fakeOidcLock: read("infra/fake-oidc/pnpm-lock.yaml"),
  });
});

test("the existing braces entry keeps its ID and date", () => {
  const braces = parseIgnoredVulns(read("osv-scanner.toml")).find((item) => item.id === '"GHSA-vfj7-8cjw-p6xm"');
  assert.equal(braces?.ignoreUntil, "2027-01-03");
});

test("A7 fixture is itself valid, so the negative cases below fail on their own change", () => {
  checkIgnoredVulns(validToml);
});

test("A7 (a): an ID outside the allowed list fails", () => {
  for (const id of ["GHSA-aaaa-bbbb-cccc", "CVE-2026-118764", "CVE-2026-118773", "GHSA-*", "*", ""]) {
    assert.throws(() => checkIgnoredVulns(`${validToml}\n${entry(id)}`), /not an allowed ID/, id);
  }
  assert.throws(() => checkIgnoredVulns(withFirst(entry("GHSA-G3HV-75WG-M249"))), /not an allowed ID/);
  // The glob exception went with Storybook; it cannot come back without changing the list.
  assert.throws(() => checkIgnoredVulns(`${validToml}\n${entry("GHSA-3g3m-2fjr-6pw4")}`), /not an allowed ID/);
});

test("A7 (a): an unquoted or unnamed ID fails", () => {
  assert.throws(() => checkIgnoredVulns(`${validToml}\n[[IgnoredVulns]]\nid = ${firstId}\n`), /not an allowed ID/);
  assert.throws(() => checkIgnoredVulns(`${validToml}\n[[IgnoredVulns]]\nreason = "No ID."\n`), /not an allowed ID/);
});

test("A7: a lost or repeated exception fails", () => {
  assert.throws(() => checkIgnoredVulns(otherIds.map((id) => entry(id)).join("\n")), /missing GHSA/);
  assert.throws(() => checkIgnoredVulns(""), /missing GHSA/);
  assert.throws(() => checkIgnoredVulns(`${validToml}\n${entry(firstId)}`), /listed twice/);
});

test("A7 (b): any spelling of a package override fails", () => {
  const overrides = [
    '[[PackageOverrides]]\nname = "glob"\nignore = true',
    '[[ PackageOverrides ]]\nname = "glob"',
    '[["PackageOverrides"]]\nname = "glob"',
    '[[packageoverrides]]\nname = "glob"',
    "[PackageOverrides]",
    'PackageOverrides = [{ name = "glob", ignore = true }]',
    '"PackageOverrides" = []',
    "[[IgnoredVulns.nested]]",
    "[ [IgnoredVulns] ]",
  ];
  for (const override of overrides) {
    assert.throws(() => checkIgnoredVulns(`${validToml}\n${override}\n`), /is not allowed/, override);
    assert.throws(() => checkIgnoredVulns(`${override}\n${validToml}`), /is not allowed/, override);
  }
});

test("A7 (b): a key outside id, ignoreUntil and reason fails", () => {
  for (const key of ["ignore = true", "ID = 1", "Reason = 1", "ignoreuntil = 2027-01-03", "vulnerability.ignore = true"]) {
    assert.throws(() => checkIgnoredVulns(`${validToml}${key}\n`), /is not allowed/, key);
  }
  assert.throws(() => checkIgnoredVulns(`reason = "Before any entry."\n${validToml}`), /is not allowed/);
  assert.throws(() => checkIgnoredVulns(`${validToml}reason = "Second reason."\n`), /is not allowed/);
});

test("A7 (c): a missing or blank reason fails", () => {
  const noReason = `[[IgnoredVulns]]\nid = "${firstId}"\nignoreUntil = 2027-01-03\n`;
  assert.throws(() => checkIgnoredVulns(withFirst(noReason)), /needs a reason/);
  for (const reason of ["", "   "]) {
    assert.throws(() => checkIgnoredVulns(withFirst(entry(firstId, { reason }))), /needs a reason/);
  }
  for (const line of [`reason = 'Single quotes.'`, `reason = """Multi-line."""`, `reason = "Text" # comment`, "reason = 1"]) {
    const text = `[[IgnoredVulns]]\nid = "${firstId}"\nignoreUntil = 2027-01-03\n${line}\n`;
    assert.throws(() => checkIgnoredVulns(withFirst(text)), /needs a reason/, line);
  }
});

test("A7 (c): a missing ignoreUntil fails", () => {
  const noDate = `[[IgnoredVulns]]\nid = "${firstId}"\nreason = "Invented reason."\n`;
  assert.throws(() => checkIgnoredVulns(withFirst(noDate)), /needs an ignoreUntil/);
});

test("A7 (d): a date past the window fails, and the window edges pass", () => {
  const { earliest, latest } = IGNORE_UNTIL_WINDOW;
  checkIgnoredVulns(withFirst(entry(firstId, { ignoreUntil: earliest })));
  checkIgnoredVulns(withFirst(entry(firstId, { ignoreUntil: latest })));
  for (const ignoreUntil of ["2027-01-04", "2099-12-31", "2026-10-31", "2020-01-01"]) {
    assert.throws(() => checkIgnoredVulns(withFirst(entry(firstId, { ignoreUntil }))), /is outside/, ignoreUntil);
  }
});

test("A7 (d): only a plain, real date counts", () => {
  for (const ignoreUntil of ['"2027-01-03"', "2027-01-03T00:00:00Z", "2027-02-30", "2027-13-01", "9999", "true"]) {
    assert.throws(() => checkIgnoredVulns(withFirst(entry(firstId, { ignoreUntil }))), /plain date/, ignoreUntil);
  }
});

const image = "ghcr.io/google/osv-scanner:v0.0.0@sha256:0000";
const command = [
  `docker run --rm -v "$PWD:/src" ${image} scan source`,
  "--config /src/osv-scanner.toml",
  "--lockfile /src/pnpm-lock.yaml",
  "--lockfile /src/infra/fake-oidc/pnpm-lock.yaml",
];
const ciWith = ({ lines = command, step = "", job = "", tail = "" } = {}) =>
  `jobs:\n  build:\n    name: Build\n  security:\n    name: Security scanners\n${job}    steps:\n` +
  `      - name: Semgrep\n        run: semgrep scan\n\n      # A comment before the step.\n` +
  `      - name: OSV-Scanner (lockfiles)\n${step}        run: >-\n` +
  lines.map((line) => `          ${line}\n`).join("") +
  tail;

test("A7 (e) fixture is itself valid, also with a later step and another job after it", () => {
  checkOsvStep(ciWith());
  checkOsvStep(ciWith({ tail: "\n      # Next.\n      - name: Later\n        run: ls\n\n  other:\n    name: Other\n" }));
});

test("A7 (e): losing --config or either --lockfile fails", () => {
  for (const index of [1, 2, 3]) {
    const lines = command.filter((_, position) => position !== index);
    assert.throws(() => checkOsvStep(ciWith({ lines })), /arguments must be exactly/, command[index]);
  }
});

test("A7 (e): changed, reordered or added arguments fail", () => {
  const cases = [
    [command[0], "--config /src/other.toml", command[2], command[3]],
    [command[0], command[1], "--lockfile /src/other/pnpm-lock.yaml", command[3]],
    [command[0], command[1], command[3], command[2]],
    [...command, "--ignore GHSA-aaaa-bbbb-cccc"],
    [...command, "--no-resolve"],
    [...command, "|| true"],
    [...command, "; exit 0"],
    [command[0], command[1], command[2], "# --lockfile /src/infra/fake-oidc/pnpm-lock.yaml"],
    // Folded into one line, so the shell would drop every argument after the #.
    [command[0], "# note", command[1], command[2], command[3]],
  ];
  for (const lines of cases) {
    assert.throws(() => checkOsvStep(ciWith({ lines })), /arguments must be exactly/, lines.join(" "));
  }
});

test("A7 (e): anything that softens or moves the step fails", () => {
  assert.throws(() => checkOsvStep(ciWith({ step: "        continue-on-error: true\n" })), /continue-on-error/);
  assert.throws(() => checkOsvStep(ciWith({ job: "    continue-on-error: true\n" })), /continue-on-error/);
  assert.throws(() => checkOsvStep(ciWith({ step: "        if: false\n" })), /only name and/);
  assert.throws(() => checkOsvStep(ciWith().replace("  security:", "  other:")), /no security job/);
  assert.throws(() => checkOsvStep(ciWith().replace("OSV-Scanner (lockfiles)", "OSV")), /exactly one/);
  const twice = ciWith({ tail: "      - name: OSV-Scanner (lockfiles)\n        run: ls\n" });
  assert.throws(() => checkOsvStep(twice), /exactly one/);
  const wrongTool = ciWith({ lines: [`docker run --rm -v "$PWD:/src" ghcr.io/other/tool:1 scan source`, ...command.slice(1)] });
  assert.throws(() => checkOsvStep(wrongTool), /pinned osv-scanner image/);
});

const lock = ({ prod = "alpha", dev = "minimatch", snapshots = "" } = {}) => `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

overrides:
  next>postcss: ^1.0.0

importers:

  .:
    dependencies:
      ${prod}:
        specifier: ^1.0.0
        version: 1.0.0
    devDependencies:
      ${dev}:
        specifier: ^3.1.5
        version: 3.1.5

packages:

  alpha@1.0.0:
    resolution: {integrity: sha512-invented}

snapshots:

  alpha@1.0.0:
    dependencies:
      '@scope/beta': 2.0.0(gamma@1.0.0)
    optionalDependencies:
      delta: 4.0.0

  '@scope/beta@2.0.0(gamma@1.0.0)':
    dependencies:
      gamma: 1.0.0
    transitivePeerDependencies:
      - minimatch

  delta@4.0.0: {}

  gamma@1.0.0: {}

  minimatch@3.1.5: {}

  glob@13.0.6:
    dependencies:
      minimatch: 3.1.5
${snapshots}`;
const cleanOidc = "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      alpha:\n        specifier: ^1.0.0\n        version: 1.0.0\n\nsnapshots:\n\n  alpha@1.0.0: {}\n";

test("A3: the production walk follows dependencies and optional ones, not dev ones", () => {
  const production = productionPackages(lock());
  assert.deepEqual([...production].sort(), ["@scope/beta", "alpha", "delta", "gamma"]);
  assert.ok(allPackages(lock()).has("minimatch"));
  checkDevOnlyPackages({ rootLock: lock(), fakeOidcLock: cleanOidc });
});

test("A3: the walk on the real lockfile is not vacuous", () => {
  const rootLock = read("pnpm-lock.yaml");
  const production = productionPackages(rootLock);
  assert.ok(production.has("next") && production.has("@tiptap/core"), "production roots");
  assert.ok(production.has("react-dom"), "peer of a production package");
  assert.ok(allPackages(rootLock).has("minimatch"), "dev tree");
  assert.ok(!production.has("eslint"), "dev tool outside production");
  assert.ok(productionPackages(read("infra/fake-oidc/pnpm-lock.yaml")).has("koa"));
});

test("A3: a waived package in the production tree fails, directly or transitively", () => {
  const direct = lock({ prod: "minimatch", snapshots: "\n  minimatch@1.0.0: {}\n" });
  assert.throws(() => checkDevOnlyPackages({ rootLock: direct, fakeOidcLock: cleanOidc }), /minimatch reached the production/);

  const transitive = lock().replace("      delta: 4.0.0\n", "      delta: 4.0.0\n      glob: 13.0.6\n");
  assert.throws(() => checkDevOnlyPackages({ rootLock: transitive, fakeOidcLock: cleanOidc }), /minimatch reached the production/);

  const deep = lock().replace("  delta@4.0.0: {}\n", "  delta@4.0.0:\n    dependencies:\n      minimatch: 3.1.5\n");
  assert.throws(() => checkDevOnlyPackages({ rootLock: deep, fakeOidcLock: cleanOidc }), /minimatch reached the production/);

  const aliased = lock().replace("      delta: 4.0.0\n", "      delta: 4.0.0\n      patterns: minimatch@3.1.5\n");
  assert.throws(() => checkDevOnlyPackages({ rootLock: aliased, fakeOidcLock: cleanOidc }), /minimatch reached the production/);
});

test("A3: any waived package in the fake-oidc lockfile fails, even a dev one", () => {
  const fakeOidcLock = `${cleanOidc}\n  minimatch@3.1.5: {}\n`;
  assert.throws(() => checkDevOnlyPackages({ rootLock: lock(), fakeOidcLock }), /minimatch appeared in infra/);
});

test("A3: an unreadable lockfile never counts as clean", () => {
  const cases = [
    ["", /lockfileVersion/],
    [lock().replace("'9.0'", "'10.0'"), /lockfileVersion/],
    ["lockfileVersion: '9.0'\n", /no production roots/],
    [lock().replace("importers:", "workspaces:"), /no production roots/],
    [lock().replace("snapshots:", "resolved:"), /no production roots/],
    [lock().replace("  delta@4.0.0: {}\n", ""), /delta@4\.0\.0 has no snapshot/],
    [lock().replace("      delta: 4.0.0\n", "      - delta\n"), /cannot read dependency/],
  ];
  for (const [rootLock, message] of cases) {
    assert.throws(() => checkDevOnlyPackages({ rootLock, fakeOidcLock: cleanOidc }), message);
  }
});
