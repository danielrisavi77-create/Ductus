// DAN-666: .gitguardian.yaml may exclude only the listed test files that hold invented credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ALLOWED_IGNORED_PATHS, parseGitGuardianConfig } from "./gitguardian-config.mjs";

const OK = "scripts/db/native-db.test.mjs";
const file = (paths, extra = "") => `version: 2\nsecret:\n  ignored_paths:\n${paths.map((p) => `    - ${p}`).join("\n")}\n${extra}`;

test("the one allowed path is an exact test file under scripts/", () => {
  assert.deepEqual(ALLOWED_IGNORED_PATHS, [OK]);
  for (const path of ALLOWED_IGNORED_PATHS) assert.match(path, /^scripts\/[A-Za-z0-9_\-/]+\.test\.mjs$/);
});

test("every input class is accepted or refused", () => {
  const accepted = [["the allowed test file", file([OK])]];
  const refused = [
    ["glob of a whole directory", file(["scripts/db/**"]), /not allowed/],
    ["glob of all of scripts", file(["scripts/**"]), /not allowed/],
    ["glob of src", file(["src/**"]), /not allowed/],
    ["glob of db", file(["db/**"]), /not allowed/],
    ["glob without .test.", file(["scripts/db/*.mjs"]), /not allowed/],
    ["glob over test files", file(["scripts/**/*.test.mjs"]), /not allowed/],
    ["path outside scripts/", file(["src/server/x.test.mjs"]), /not allowed/],
    ["a non-test file in scripts/", file(["scripts/db/native-db.mjs"]), /not allowed/],
    ["traversal", file(["scripts/../src/a.test.mjs"]), /not allowed/],
    ["absolute path", file(["/scripts/db/native-db.test.mjs"]), /not allowed/],
    ["backslash", file(["scripts\\db\\native-db.test.mjs"]), /not allowed/],
    ["negation", file(["!scripts/db/native-db.test.mjs"]), /not allowed/],
    ["the allowed path plus another", file([OK, "src/**"]), /not allowed/],
    ["quoted wildcard", file([`'${OK}'`, "'*'"]), /not allowed/],
    ["empty list", "version: 2\nsecret:\n  ignored_paths: []\n", /empty|no ignored/i],
    ["missing key", "version: 2\nsecret:\n", /empty|no ignored/i],
    ["empty file", "", /version/],
    ["unknown key ignored_matches", file([OK], "  ignored_matches:\n    - name: x\n"), /unknown key/],
    ["unknown key ignored_detectors", file([OK], "  ignored_detectors:\n    - x\n"), /unknown key/],
    ["hyphenated key", `version: 2\nsecret:\n  ignored-paths:\n    - ${OK}\n`, /unknown key/],
    ["unknown top-level key", file([OK], "other:\n  a: 1\n"), /unknown key/],
    ["missing version", `secret:\n  ignored_paths:\n    - ${OK}\n`, /version/],
    ["version 1", `version: 1\nsecret:\n  ignored_paths:\n    - ${OK}\n`, /version/],
    ["duplicate version", `version: 1\n${file([OK])}`, /duplicate key/],
    ["duplicate entry", file([OK, OK]), /duplicate/],
    ["NEL hides an entry behind a comment", `${file([OK])}`.replace(OK, `${OK} # c\u0085    - src/**`), /unsupported character U\+0085/],
    ["line separator U+2028 after a comment", file([OK]).replace(OK, `${OK} # c\u2028    - src/**`), /unsupported character U\+2028/],
    ["paragraph separator U+2029 after a comment", file([OK]).replace(OK, `${OK} # c\u2029    - src/**`), /unsupported character U\+2029/],
    ["lone CR after a comment", file([OK]).replace(OK, `${OK} # c\r    - src/**`), /unsupported character U\+000D/],
    ["vertical tab after a comment", file([OK]).replace(OK, `${OK} # c\u000b    - src/**`), /unsupported character U\+000B/],
    ["form feed after a comment", file([OK]).replace(OK, `${OK} # c\u000c    - src/**`), /unsupported character U\+000C/],
    ["byte order mark", `\ufeff${file([OK])}`, /unsupported character U\+FEFF/],
    ["non-ASCII letter in a comment", file([OK]).replace(OK, `${OK} # č`), /unsupported character U\+010D/],
    ["tab indentation", `version: 2\nsecret:\n\tignored_paths:\n\t\t- ${OK}\n`, /unsupported|unknown/],
  ];
  for (const [name, text] of accepted) assert.deepEqual(parseGitGuardianConfig(text).ignoredPaths, [OK], name);
  for (const [name, text, re] of refused) assert.throws(() => parseGitGuardianConfig(text), re, name);
});

test("CRLF line ends are accepted", () => {
  assert.deepEqual(parseGitGuardianConfig(file([OK]).replace(/\n/g, "\r\n")).ignoredPaths, [OK]);
});

test("comments and blank lines are allowed", () => {
  assert.deepEqual(parseGitGuardianConfig(`# why\n\nversion: 2\n\nsecret:\n  # invented values only\n  ignored_paths:\n    - ${OK} # test\n`).ignoredPaths, [OK]);
});

test("the repository's .gitguardian.yaml passes, and the listed files exist", () => {
  const text = readFileSync(fileURLToPath(new URL("../../.gitguardian.yaml", import.meta.url)), "utf8");
  const { ignoredPaths } = parseGitGuardianConfig(text);
  assert.ok(ignoredPaths.length > 0);
  for (const path of ignoredPaths) readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
});
