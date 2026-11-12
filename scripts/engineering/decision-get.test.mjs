// decisions:get: one decision out of the register, never the whole file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findDecision, INDEX, main } from "./decision-get.mjs";

const TEXT = [
  "# Registar",
  "",
  "| ID | Odluka | Razlog |",
  "|---|---|---|",
  "| D-09 | prva | a |",
  "| D-090 | druga, spominje D-09 | b |",
  "",
  "## D-177: naslov",
  "",
  "tijelo D-177",
  "",
  "### Podnaslov",
  "",
  "još",
  "",
  "## D-183: sljedeća",
  "",
  "tijelo D-183",
].join("\n");

const run = (argv, read = () => TEXT) => {
  const out = [];
  const err = [];
  const code = main(argv, { read, log: (s) => out.push(s), error: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

test("a table row is found by its own ID only", () => {
  assert.deepEqual(findDecision(TEXT, "D-09"), [{ line: 5, text: "| D-09 | prva | a |" }]);
  assert.deepEqual(findDecision(TEXT, "D-090").map((f) => f.line), [6]);
});

test("a heading section runs to the next heading of the same level", () => {
  const [found] = findDecision(TEXT, "D-177");
  assert.equal(found.line, 8);
  assert.match(found.text, /^## D-177: naslov\n\ntijelo D-177\n\n### Podnaslov\n\njoš$/);
  assert.equal(findDecision(TEXT, "D-183")[0].text, "## D-183: sljedeća\n\ntijelo D-183");
  assert.deepEqual(findDecision(TEXT, "D-17"), []);
});

test("main prints path and line, and reports a missing ID with exit 1", () => {
  const ok = run(["D-09", "D-183"]);
  assert.equal(ok.code, 0);
  assert.match(ok.out, new RegExp(`^${INDEX}:5\\n\\| D-09 `));
  assert.match(ok.out, new RegExp(`${INDEX}:16\\n## D-183`));
  const miss = run(["D-09", "D-999"]);
  assert.equal(miss.code, 1);
  assert.match(miss.err, /D-999: not defined/);
  assert.match(miss.out, /D-09/);
});

test("main rejects a missing or malformed ID and an unreadable register", () => {
  for (const argv of [[], ["188"], ["D-1"], ["D-188", "--all"], ["d-188"]]) assert.equal(run(argv).code, 2, argv.join(" "));
  const broken = run(["D-09"], () => { throw new Error("ENOENT"); });
  assert.equal(broken.code, 2);
  assert.match(broken.err, /ENOENT/);
});

test("the real register defines D-09 and D-188 and the output stays small", () => {
  const real = readFileSync(new URL(`../../${INDEX}`, import.meta.url), "utf8");
  for (const id of ["D-09", "D-188"]) {
    const found = findDecision(real, id);
    assert.equal(found.length, 1, id);
    assert.ok(found[0].text.length < real.length / 20, id);
  }
});
