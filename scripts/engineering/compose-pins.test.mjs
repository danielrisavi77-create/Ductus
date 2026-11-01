// F-017: the local stack pulls the same digest-pinned images as CI, so a
// moved tag on a registry cannot change what `docker compose up` runs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const defaults = [...compose.matchAll(/\$\{(DUCTUS_[A-Z_]*IMAGE):-([^}]+)\}/g)].map(([, name, value]) => ({ name, value }));

test("every image default in compose.yaml names a sha256 digest", () => {
  assert.ok(defaults.length >= 4, "image defaults found");
  for (const { name, value } of defaults) assert.match(value, /^[^\s@]+:[^\s@]+@sha256:[0-9a-f]{64}$/, name);
});

test("each compose default equals every value CI sets for the same variable", () => {
  for (const { name, value } of defaults) {
    const set = [...ci.matchAll(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, "gm"))].map((m) => m[1]);
    assert.ok(set.length > 0, `${name} is set in ci.yml`);
    for (const v of set) assert.equal(v, value, name);
  }
});
