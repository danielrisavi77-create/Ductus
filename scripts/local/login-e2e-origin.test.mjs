import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const DIR = "e2e/login";
const files = () => readdirSync(DIR, { recursive: true }).filter((name) => /\.(ts|tsx|mjs)$/.test(name)).map((name) => join(DIR, name));

// The app origin of the login E2E is https (or http against a reused server),
// so a spec that spells it out passes on one and fails on the other. Every spec
// takes it from ./origin (DAN-232).
test("no login spec spells out the app origin", () => {
  const spelled = [];
  for (const file of files()) {
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (/https?:(?:\/\/|\\\/\\\/)localhost:3000/.test(line)) spelled.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(spelled, []);
});

test("the one place that names the origin takes it from the launcher", () => {
  const origin = readFileSync(join(DIR, "origin.ts"), "utf8");
  assert.match(origin, /loginOrigin/);
  assert.doesNotMatch(origin, /localhost/);
});
