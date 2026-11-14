// DAN-734 (S-0.21): the `--repo` argument of the orch:* commands and the list
// of tracked repositories. The table covers every input class of the contract
// (#1836 c.6870093006); the properties cover the rest of the string space.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import fc from "fast-check";

import { parseTrackedRepos, takeRepoArg, TRACKED_REPOS } from "./repo-target.mjs";

const EXPECTED = [
  "ductura/server", "ductura/preloader", "ductura/web-chrome", "ductura/web-mobile",
  "ductura/web-other", "ductura/desktop-windows", "ductura/desktop-macos", "danielrisavi77-create/Ductus",
];

test("the configuration lists exactly the eight tracked repositories and nothing else", () => {
  const raw = JSON.parse(readFileSync(new URL("./tracked-repos.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(raw), ["repositories"]);
  assert.deepEqual([...raw.repositories].sort(), [...EXPECTED].sort());
  assert.deepEqual([...TRACKED_REPOS].sort(), [...EXPECTED].sort());
});

test("a malformed configuration is refused, never read as a shorter list", () => {
  const bad = [
    "[]", "null", "{}", '{"repositories": "ductura/server"}', '{"repositories": []}',
    '{"repositories": ["ductura/server"], "token": "x"}', '{"repositories": ["ductura/server", "Ductura/Server"]}',
    '{"repositories": ["ductura"]}', '{"repositories": [7]}', '{"repositories": ["https://github.com/a/b"]}', "not json",
  ];
  for (const text of bad) assert.throws(() => parseTrackedRepos(text), Error, text);
  assert.deepEqual(parseTrackedRepos('{"repositories": ["a/b", "c-d/e.f_g"]}'), ["a/b", "c-d/e.f_g"]);
});

const ok = (argv, repo, rest) => ({ argv, repo, rest });
const OK = [
  ok([], null, []),
  ok(["--json"], null, ["--json"]),
  ok(["17", "--head", "a".repeat(40)], null, ["17", "--head", "a".repeat(40)]),
  ok(["--repo", "ductura/server"], "ductura/server", []),
  ok(["--json", "--repo", "ductura/server"], "ductura/server", ["--json"]),
  ok(["--repo", "ductura/web-mobile", "--json"], "ductura/web-mobile", ["--json"]),
  ok(["12", "--repo=ductura/preloader", "--head", "b".repeat(40)], "ductura/preloader", ["12", "--head", "b".repeat(40)]),
  ok(["--repo", "Ductura/Server"], "ductura/server", []),
  ok(["--repo=DUCTURA/DESKTOP-MACOS"], "ductura/desktop-macos", []),
  ok(["--repo", "danielrisavi77-create/Ductus"], "danielrisavi77-create/Ductus", []),
  ok(["--repo", "danielrisavi77-create/ductus", "--all"], "danielrisavi77-create/Ductus", ["--all"]),
];

test("valid input classes: absent, separate value, = form, case variant, explicit default", () => {
  for (const c of OK) assert.deepEqual(takeRepoArg(c.argv), { repo: c.repo, rest: c.rest }, JSON.stringify(c.argv));
});

const BAD = [
  [["--repo"], /needs a value/],
  [["--json", "--repo"], /needs a value/],
  [["--repo", "--json"], /needs a value/],
  [["--repo", "-h"], /needs a value/],
  [["--repo="], /needs a value/],
  [["--repo", ""], /needs a value/],
  [["--repo", "ductura/server", "--repo", "ductura/server"], /more than once/],
  [["--repo", "ductura/server", "--repo=ductura/preloader"], /more than once/],
  [["--repos", "ductura/server"], /unknown argument --repos/],
  [["--repository", "ductura/server"], /unknown argument --repository/],
  [["--repo-x"], /unknown argument --repo-x/],
  [["--repository=ductura/server"], /unknown argument --repository/],
  [["--repo", "ductura/nepostojeci"], /not a tracked repository/],
  [["--repo", "other/Ductus"], /not a tracked repository/],
  [["--repo", "ductura"], /owner\/name/],
  [["--repo", "ductura/server/x"], /owner\/name/],
  [["--repo", "https://github.com/ductura/server"], /owner\/name/],
  [["--repo", "ductura/server.git"], /not a tracked repository/],
  [["--repo", "../server"], /owner\/name/],
  [["--repo", "ductura/.."], /owner\/name/],
  [["--repo", " ductura/server"], /owner\/name/],
  [["--repo", "ductura/server\n"], /owner\/name/],
  [["--repo", "ductura/ser\u0000ver"], /owner\/name/],
  [["--repo", "{owner}/{repo}"], /owner\/name/],
  [["--repo", "ductura/{repo}"], /owner\/name/],
];

test("refused input classes: missing value, flag as value, repeat, look-alike flag, untracked, malformed", () => {
  for (const [argv, re] of BAD) assert.throws(() => takeRepoArg(argv), re, JSON.stringify(argv));
});

test("the list is injectable, and a name off that list is refused even when tracked by default", () => {
  assert.deepEqual(takeRepoArg(["--repo", "a/b"], ["a/b"]), { repo: "a/b", rest: [] });
  assert.throws(() => takeRepoArg(["--repo", "ductura/server"], ["a/b"]), /not a tracked repository/);
});

const tracked = new Set(EXPECTED.map((r) => r.toLowerCase()));
const otherArg = fc.string().filter((s) => !s.startsWith("--repo"));

test("property: any value that is not a tracked name is refused", () => {
  fc.assert(fc.property(fc.string(), fc.array(otherArg), (value, rest) => {
    fc.pre(!tracked.has(value.toLowerCase()));
    assert.throws(() => takeRepoArg([...rest, "--repo", value]));
    assert.throws(() => takeRepoArg([`--repo=${value}`, ...rest]));
  }), { numRuns: 500 });
});

test("property: a tracked name in any letter case yields its canonical name and the other arguments in order", () => {
  const casing = fc.constantFrom(...EXPECTED).chain((name) =>
    fc.array(fc.boolean(), { minLength: name.length, maxLength: name.length }).map((up) => [name, [...name].map((ch, i) => (up[i] ? ch.toUpperCase() : ch.toLowerCase())).join("")]));
  fc.assert(fc.property(casing, fc.array(otherArg), fc.array(otherArg), fc.boolean(), ([name, spelled], before, after, eq) => {
    const flag = eq ? [`--repo=${spelled}`] : ["--repo", spelled];
    assert.deepEqual(takeRepoArg([...before, ...flag, ...after]), { repo: name, rest: [...before, ...after] });
  }), { numRuns: 500 });
});

test("property: without --repo the arguments come back unchanged", () => {
  fc.assert(fc.property(fc.array(otherArg), (argv) => {
    assert.deepEqual(takeRepoArg(argv), { repo: null, rest: argv });
  }), { numRuns: 300 });
});
