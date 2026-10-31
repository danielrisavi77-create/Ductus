// Guard for OSV exceptions (DAN-370). osv-scanner.toml stays the only place that
// waives a finding; this module only pins what it may contain, how CI must read it,
// and that the waived dev-only packages stay out of production. An ignored ID covers
// every package, version and lockfile, so the dev-only claim needs its own check.
// Run by osv-exceptions.test.mjs in the "Engineering system unit tests" CI step.

export const ALLOWED_IDS = ["GHSA-g3hv-75wg-m249", "GHSA-vfj7-8cjw-p6xm"];
export const IGNORE_UNTIL_WINDOW = { earliest: "2026-11-01", latest: "2027-01-03" };
export const DEV_ONLY_PACKAGES = ["minimatch"];
export const OSV_STEP_NAME = "OSV-Scanner (lockfiles)";
export const OSV_SCAN_ARGS = [
  "scan", "source",
  "--config", "/src/osv-scanner.toml",
  "--lockfile", "/src/pnpm-lock.yaml",
  "--lockfile", "/src/infra/fake-oidc/pnpm-lock.yaml",
];

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

// The step must be the plain scan: exact arguments, so also no --ignore, no shell
// operator after them, and nothing beside name and run that could soften the failure.
export function checkOsvStep(ciText) {
  const job = ciText.replace(/\r\n/g, "\n").split("\n  security:\n")[1]?.split(/^ {2}[\w-]+:\n/m)[0];
  if (!job) fail("ci.yml has no security job");
  if (job.includes("continue-on-error")) fail("the security job must not use continue-on-error");
  const steps = job.split(/^ {6}- /m).filter((step) => step.startsWith(`name: ${OSV_STEP_NAME}\n`));
  if (steps.length !== 1) fail(`the security job needs exactly one "${OSV_STEP_NAME}" step`);
  const [, run, ...command] = lines(steps[0]).filter((line) => !/^ {0,7}(#.*)?$/.test(line));
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

export function checkDevOnlyPackages({ rootLock, fakeOidcLock }) {
  const production = productionPackages(rootLock);
  const fakeOidc = allPackages(fakeOidcLock);
  for (const name of DEV_ONLY_PACKAGES) {
    if (production.has(name)) fail(`${name} reached the production tree of pnpm-lock.yaml`);
    if (fakeOidc.has(name)) fail(`${name} appeared in infra/fake-oidc/pnpm-lock.yaml`);
  }
}
