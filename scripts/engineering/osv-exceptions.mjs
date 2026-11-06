// Guard for OSV exceptions (DAN-370). osv-scanner.toml stays the only place that
// waives a finding; this module only pins what it may contain, how CI must read it,
// and that the waived dev-only packages stay out of production. An ignored ID covers
// every package, version and lockfile, so the dev-only claim needs its own check.
// Every tracked lockfile is scanned, and a negative control proves the scan can fail.
// Run by osv-exceptions.test.mjs in the "Engineering system unit tests" CI step.

export const ALLOWED_IDS = ["GHSA-g3hv-75wg-m249"];
export const IGNORE_UNTIL_WINDOW = { earliest: "2026-11-01", latest: "2027-01-03" };
export const DEV_ONLY_PACKAGES = ["minimatch"];
export const OSV_STEP_NAME = "OSV-Scanner (lockfiles)";
export const OSV_SCAN_ARGS = [
  "scan", "source",
  "--config", "/src/osv-scanner.toml",
  "--lockfile", "/src/pnpm-lock.yaml",
  "--lockfile", "/src/infra/fake-oidc/pnpm-lock.yaml",
  "--lockfile", "/src/spikes/b0.2-reconstruction/package-lock.json",
  "--lockfile", "/src/spikes/docx-provenance/package-lock.json",
];
export const NEGATIVE_STEP_NAME = "OSV-Scanner synthetic negative control";
const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$/;

const lines = (text) => text.split(/\r?\n/);
const fail = (message) => { throw new Error(`OSV exceptions: ${message}`); };

// A strict subset of TOML, not a TOML parser: any line outside it is an error, so an
// override table or key cannot pass in a spelling a search for its name would miss.
export function parseIgnoredVulns(text) {
  const entries = [];
  for (const [index, raw] of lines(text).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line === "[[IgnoredVulns]]") {
      entries.push({});
      continue;
    }
    const assignment = line.match(/^(id|ignoreUntil|reason) = (.+)$/);
    const entry = entries.at(-1);
    if (!assignment || !entry || assignment[1] in entry) fail(`line ${index + 1} is not allowed`);
    entry[assignment[1]] = assignment[2];
  }
  return entries;
}

const basicString = (raw) => raw?.match(/^"((?:[^"\\]|\\.)*)"$/)?.[1];
const isLocalDate = (raw) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(raw);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(raw);
};

export function checkIgnoredVulns(text) {
  const ids = [];
  for (const entry of parseIgnoredVulns(text)) {
    const id = basicString(entry.id);
    if (!ALLOWED_IDS.includes(id)) fail(`${entry.id} is not an allowed ID`);
    if (ids.includes(id)) fail(`${id} is listed twice`);
    ids.push(id);
    if (!basicString(entry.reason)?.trim()) fail(`${id} needs a reason`);
    if (entry.ignoreUntil === undefined) fail(`${id} needs an ignoreUntil`);
    if (!isLocalDate(entry.ignoreUntil)) fail(`${id}: ignoreUntil must be a plain date`);
    const { earliest, latest } = IGNORE_UNTIL_WINDOW;
    if (entry.ignoreUntil < earliest || entry.ignoreUntil > latest) {
      fail(`${id}: ignoreUntil ${entry.ignoreUntil} is outside ${earliest} to ${latest}`);
    }
  }
  const missing = ALLOWED_IDS.filter((id) => !ids.includes(id));
  if (missing.length > 0) fail(`missing ${missing.join(", ")}; change the allowed list in the same PR`);
}

const securityStep = (ciText, name) => {
  const job = ciText.replace(/\r\n/g, "\n").split("\n  security:\n")[1]?.split(/^ {2}[\w-]+:\n/m)[0];
  if (!job) fail("ci.yml has no security job");
  if (job.includes("continue-on-error")) fail("the security job must not use continue-on-error");
  const steps = job.split(/^ {6}- /m).filter((step) => step.startsWith(`name: ${name}\n`));
  if (steps.length !== 1) fail(`the security job needs exactly one "${name}" step`);
  return lines(steps[0]).filter((line) => !/^ {0,7}(#.*)?$/.test(line));
};

// The step must be the plain scan: exact arguments, so also no --ignore, no shell
// operator after them, and nothing beside name and run that could soften the failure.
export function checkOsvStep(ciText) {
  const [, run, ...command] = securityStep(ciText, OSV_STEP_NAME);
  if (run?.trim() !== "run: >-") fail(`the step must hold only name and a "run: >-" command`);
  const tokens = command.join(" ").trim().split(/\s+/);
  const prefix = ["docker", "run", "--rm", "-v", '"$PWD:/src"'];
  const matches = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
  if (!matches(tokens.slice(0, 5), prefix) || !tokens[5]?.startsWith("ghcr.io/google/osv-scanner:")) {
    fail("the step must run the pinned osv-scanner image with the repo mounted on /src");
  }
  if (!matches(tokens.slice(6), OSV_SCAN_ARGS)) {
    fail(`the step arguments must be exactly: ${OSV_SCAN_ARGS.join(" ")}`);
  }
  return tokens[5];
}

// The negative control is held to its exact text, with the scan step's own image,
// so neither its check nor the image it proves can drift from the real scan.
export const negativeControlStep = (image) => [
  `name: ${NEGATIVE_STEP_NAME}`,
  "shell: bash",
  "run: |",
  "set -euo pipefail",
  'root="$(mktemp -d "$RUNNER_TEMP/ductus-osv-negative.XXXXXX")"',
  "trap 'rm -rf \"$root\"' EXIT",
  'mkdir "$root/scan"',
  'python3 -I scripts/engineering/osv-negative-control.py build spikes/docx-provenance/package-lock.json "$root/scan/package-lock.json"',
  "status=0",
  'docker run --rm -v "$root/scan:/scan:ro" -v "$PWD/osv-scanner.toml:/cfg/osv-scanner.toml:ro" \\',
  `${image} scan source \\`,
  "--config /cfg/osv-scanner.toml --format json --lockfile /scan/package-lock.json \\",
  '> "$root/report.json" || status=$?',
  'python3 -I scripts/engineering/osv-negative-control.py check "$status" "$root/report.json"',
];

export function checkNegativeControl(ciText) {
  const image = checkOsvStep(ciText);
  const actual = securityStep(ciText, NEGATIVE_STEP_NAME).map((line) => line.trim());
  if (JSON.stringify(actual) !== JSON.stringify(negativeControlStep(image))) {
    fail(`the "${NEGATIVE_STEP_NAME}" step must match negativeControlStep() with the scan image`);
  }
}

// Each tracked lockfile is scanned, and each scanned lockfile is tracked.
export function checkLockfilesScanned(trackedFiles) {
  const tracked = trackedFiles.filter((path) => LOCKFILE.test(path)).map((path) => `/src/${path}`).sort();
  const scanned = OSV_SCAN_ARGS.filter((_, index) => OSV_SCAN_ARGS[index - 1] === "--lockfile").sort();
  const missing = tracked.filter((path) => !scanned.includes(path));
  const stale = scanned.filter((path) => !tracked.includes(path));
  if (missing.length > 0) fail(`not scanned: ${missing.join(", ")}`);
  if (stale.length > 0) fail(`scanned but not tracked: ${stale.join(", ")}`);
}

const packageName = (key) => key.match(/^(@?[^@]+)@/)?.[1] ?? fail(`cannot read package key ${key}`);
const lockEntry = (line) => {
  const match = line.trim().match(/^('[^']*'|[^:\s]+):(?: (.*))?$/);
  return match && { key: match[1].replace(/'/g, ""), value: match[2]?.replace(/'/g, "") };
};
// An alias keeps the real package as its version (patterns: minimatch@3.1.5).
const snapshotKey = (name, version) => (/^@?[^@(]+@/.test(version) ? version : `${name}@${version}`);
const PROD_IMPORTER_DEPS = ["dependencies", "optionalDependencies"];

// The parts of a pnpm v9 lockfile that decide what production installs: the importers'
// non-dev dependencies, and each snapshot's dependencies. Written against lockfile text
// because the repo has no YAML dependency; an unknown shape is an error, never "clean".
export function readPnpmLock(text) {
  if (!/^lockfileVersion: '9\.0'$/m.test(text)) fail("expected pnpm lockfileVersion 9.0");
  const roots = [];
  const snapshots = new Map();
  let section, bucket, snapshot, dependency;
  for (const line of lines(text)) {
    if (line.trim() === "") continue;
    const indent = line.search(/\S/);
    if (indent === 0) {
      section = line.replace(/:.*$/, "");
      continue;
    }
    const entry = lockEntry(line);
    if (section === "importers") {
      if (indent === 4) bucket = entry?.key;
      if (!PROD_IMPORTER_DEPS.includes(bucket)) continue;
      if (indent === 6) dependency = entry?.key;
      if (indent === 8 && entry?.key === "version") {
        if (!entry.value.startsWith("link:")) roots.push(snapshotKey(dependency, entry.value));
      }
    } else if (section === "snapshots") {
      if (indent === 2) {
        if (!entry) fail(`cannot read snapshot ${line.trim()}`);
        snapshot = [];
        snapshots.set(entry.key, snapshot);
      }
      if (indent === 4) bucket = entry?.key;
      if (indent !== 6 || !PROD_IMPORTER_DEPS.includes(bucket)) continue;
      if (!entry?.value) fail(`cannot read dependency ${line.trim()}`);
      if (!entry.value.startsWith("link:")) snapshot.push(snapshotKey(entry.key, entry.value));
    }
  }
  if (roots.length === 0 || snapshots.size === 0) fail("no production roots or snapshots found");
  return { roots, snapshots };
}

export function productionPackages(lockText) {
  const { roots, snapshots } = readPnpmLock(lockText);
  const seen = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const key = pending.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!snapshots.has(key)) fail(`${key} has no snapshot`);
    pending.push(...snapshots.get(key));
  }
  return new Set([...seen].map(packageName));
}

export function allPackages(lockText) {
  return new Set([...readPnpmLock(lockText).snapshots.keys()].map(packageName));
}

// Every package an npm v3 lockfile installs, by its real name (an alias keeps it in "name").
export function npmLockPackages(text) {
  const lock = JSON.parse(text);
  if (lock?.lockfileVersion !== 3 || typeof lock.packages !== "object") fail("expected npm lockfileVersion 3");
  const names = Object.entries(lock.packages)
    .filter(([path]) => path !== "")
    .map(([path, entry]) => entry?.name ?? path.split("node_modules/").at(-1));
  if (names.length === 0 || names.some((name) => !name)) fail("cannot read npm lockfile packages");
  return new Set(names);
}

// The spikes have no dev tree, so a waived package may not appear in them at all.
export function checkDevOnlyPackages({ rootLock, fakeOidcLock, npmLocks = {} }) {
  const production = productionPackages(rootLock);
  const fakeOidc = allPackages(fakeOidcLock);
  const npm = Object.entries(npmLocks).map(([path, text]) => [path, npmLockPackages(text)]);
  for (const name of DEV_ONLY_PACKAGES) {
    if (production.has(name)) fail(`${name} reached the production tree of pnpm-lock.yaml`);
    if (fakeOidc.has(name)) fail(`${name} appeared in infra/fake-oidc/pnpm-lock.yaml`);
    for (const [path, packages] of npm) if (packages.has(name)) fail(`${name} appeared in ${path}`);
  }
}
