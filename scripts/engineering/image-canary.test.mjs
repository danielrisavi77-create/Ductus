import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { GITLEAKS_ENTROPY, MIN_ENTROPY, canaryProblem, drawCanary, shannonEntropy } from "./image-canary.mjs";

// DAN-701 (#1930, attack plan #1951): the canary of the production image smoke
// test must always be found by the gitleaks 8.30.1 rule generic-api-key. Input
// classes of the contract on #1836 (w701 UGOVOR). The values are invented.
const script = resolve(dirname(fileURLToPath(import.meta.url)), "image-canary.mjs");
const SYMBOLS = "0123456789abcdef";
// A hex string with the given count per symbol, spread out round-robin. At length
// 40 no count gives an entropy of exactly 3.5 (the nearest is about 3.50016), so
// LOW and MID bracket the gitleaks threshold.
const fromCounts = (counts) => {
  const left = [...counts];
  let out = "";
  while (left.some((n) => n > 0)) left.forEach((n, i) => n > 0 && ((out += SYMBOLS[i]), (left[i] -= 1)));
  assert.equal(out.length, 40);
  return out;
};
const LOW = fromCounts([7, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2]); // H ~ 3.465
const MID = fromCounts([5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1]); // H ~ 3.585
const HIGH = fromCounts([8, 5, 4, 3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1]); // H ~ 3.606
const EVEN = "0123456789abcdef0123456789abcdef01234567"; // H ~ 3.97

test("entropy matches shannonEntropy of gitleaks on known values", () => {
  for (const [value, expected] of [["", 0], ["aaaa", 0], ["ab", 1], ["abcd", 2], [SYMBOLS, 4]]) {
    assert.equal(shannonEntropy(value), expected, value);
  }
  assert.ok(shannonEntropy(LOW) <= GITLEAKS_ENTROPY);
  assert.ok(shannonEntropy(MID) > GITLEAKS_ENTROPY && shannonEntropy(MID) < MIN_ENTROPY);
  assert.ok(shannonEntropy(HIGH) >= MIN_ENTROPY);
});

test("the accepted floor keeps a margin over the gitleaks 8.30.1 threshold", () => {
  // The threshold and stopwords are copied from gitleaks 8.30.1: a new pin in
  // the smoke script must fail here until they are compared again.
  const smoke = readFileSync(resolve(dirname(script), "production-image-smoke.sh"), "utf8");
  assert.match(smoke, /^gitleaks_image="ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:[0-9a-f]{64}"$/m);
  assert.equal(GITLEAKS_ENTROPY, 3.5);
  assert.ok(MIN_ENTROPY - GITLEAKS_ENTROPY >= 0.1);
});

test("each input class is accepted or rejected with its reason", () => {
  const rows = [
    ["low entropy", LOW, "low-entropy"],
    ["four symbols only", "0123".repeat(10), "low-entropy"],
    ["just above the gitleaks threshold, under the margin", MID, "low-entropy"],
    ["at the floor", HIGH, null],
    ["high entropy", EVEN, null],
    ["stopword dead", `dead${EVEN.slice(4)}`, "stopword"],
    ["stopword feed", `${EVEN.slice(0, 20)}feed${EVEN.slice(24)}`, "stopword"],
    ["stopword 000000", `${EVEN.slice(0, 34)}000000`, "stopword"],
    ["stopword aaaaaa", `aaaaaa${EVEN.slice(6)}`, "stopword"],
    ["32-character hex stopword", "6fe4476ee5a1832882e326b506d1412679c0b3da", "stopword"],
    ["stopword in capitals", `DEAD${EVEN.slice(4)}`, "not-hex"],
    ["no digit", "abcdef".repeat(6) + "abcd", "low-entropy"],
    ["one symbol", "7".repeat(40), "low-entropy"],
    ["39 characters", EVEN.slice(1), "length"],
    ["41 characters", `${EVEN}8`, "length"],
    ["64 characters, the form the allowlist passes", EVEN.repeat(2).slice(0, 64), "length"],
    ["not hex", `g${EVEN.slice(1)}`, "not-hex"],
    ["not a string", undefined, "not-hex"],
  ];
  for (const [name, value, reason] of rows) assert.equal(canaryProblem(value), reason, name);
});

test("a draw retries until a canary is acceptable", () => {
  const values = [LOW, `dead${EVEN.slice(4)}`, MID, HIGH];
  let calls = 0;
  assert.equal(drawCanary(() => values[calls++]), HIGH);
  assert.equal(calls, 4);
});

test("a source that never gives an acceptable canary fails instead of looping", () => {
  let calls = 0;
  assert.throws(() => drawCanary(() => (calls++, LOW), 50), /no acceptable canary in 50 draws/);
  assert.equal(calls, 50);
});

test("2000 draws from the real source are all acceptable and distinct", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const canary = drawCanary();
    assert.equal(canaryProblem(canary), null, canary);
    seen.add(canary);
  }
  assert.equal(seen.size, 2000);
});

test("the command prints one acceptable canary and exits 0", () => {
  const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^[0-9a-f]{40}$/);
  assert.equal(canaryProblem(run.stdout), null);
});
