import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "osv-negative-control.py");
const spikeLock = resolve(here, "../../spikes/docx-provenance/package-lock.json");
const dir = mkdtempSync(join(tmpdir(), "osv-negative-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) => spawnSync("python3", ["-I", script, ...args], { encoding: "utf8" });
const reportFile = (name, report) => {
  const path = join(dir, name);
  writeFileSync(path, typeof report === "string" ? report : JSON.stringify(report));
  return path;
};
const pkg = (name, version, vulnerabilities) => ({ package: { name, version, ecosystem: "npm" }, vulnerabilities });
const reportOf = (...packages) => ({ results: [{ source: { path: "/scan/package-lock.json" }, packages }] });
const hit = reportOf(pkg("fflate", "0.8.3", []), pkg("minimist", "1.2.5", [{ id: "GHSA-xvch-5gv4-984h" }]));

test("build adds only the vulnerable package to a copy of the spike lockfile", () => {
  const target = join(dir, "package-lock.json");
  const result = run("build", spikeLock, target);
  assert.equal(result.status, 0, result.stderr);
  const source = JSON.parse(readFileSync(spikeLock, "utf8"));
  const copy = JSON.parse(readFileSync(target, "utf8"));
  assert.deepEqual(copy.packages["node_modules/minimist"], { version: "1.2.5", license: "MIT" });
  assert.equal(copy.packages[""].dependencies.minimist, "1.2.5");
  delete copy.packages["node_modules/minimist"];
  delete copy.packages[""].dependencies.minimist;
  assert.deepEqual(copy, source);
});

test("build refuses anything but an npm v3 lockfile", () => {
  for (const text of ['{"lockfileVersion": 2, "packages": {"": {}}}', '{"lockfileVersion": 3}', "[]"]) {
    const result = run("build", reportFile("bad-lock.json", text), join(dir, "out.json"));
    assert.notEqual(result.status, 0, text);
  }
});

test("N4: exit 1 with the advisory in the report is the only pass", () => {
  for (const report of [
    hit,
    reportOf(pkg("minimist", "1.2.5", [{ id: "CVE-2021-44906", aliases: ["GHSA-xvch-5gv4-984h"] }])),
  ]) {
    const result = run("check", "1", reportFile("hit.json", report));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /rejected minimist 1\.2\.5 with GHSA-xvch-5gv4-984h/);
  }
});

test("N1: exit 0 means the scanner missed the finding", () => {
  const result = run("check", "0", reportFile("hit.json", hit));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /passed a lockfile with minimist/);
});

test("N2: any exit but 0 or 1 is a failed run, whatever the report says", () => {
  for (const code of ["127", "128", "2", "-1", ""]) {
    const result = run("check", code, reportFile("hit.json", hit));
    assert.notEqual(result.status, 0, code);
    assert.match(result.stderr, /did not finish a scan/, code);
  }
});

test("N3: exit 1 without the advisory for that exact package fails", () => {
  const cases = [
    reportOf(),
    reportOf(pkg("minimist", "1.2.5", [{ id: "GHSA-aaaa-bbbb-cccc" }])),
    reportOf(pkg("minimist", "1.2.6", [{ id: "GHSA-xvch-5gv4-984h" }])),
    reportOf(pkg("other", "1.2.5", [{ id: "GHSA-xvch-5gv4-984h" }])),
    reportOf(pkg("minimist", "1.2.5", null)),
  ];
  for (const report of cases) {
    const result = run("check", "1", reportFile("miss.json", report));
    assert.notEqual(result.status, 0, JSON.stringify(report));
    assert.match(result.stderr, /missing from the report/);
  }
});

test("N3: exit 1 with no readable report fails as a scanner error", () => {
  for (const text of ["", "not json", "{}", '{"results": [{}]}']) {
    const result = run("check", "1", reportFile("broken.json", text));
    assert.notEqual(result.status, 0, text);
    assert.match(result.stderr, /Scanner failed before producing a report/, text);
  }
  const absent = run("check", "1", join(dir, "absent.json"));
  assert.match(absent.stderr, /Scanner failed before producing a report/);
});

test("an unknown command fails", () => {
  assert.notEqual(run("scan", "1", "x").status, 0);
  assert.notEqual(run("check", "1").status, 0);
});
