#!/usr/bin/env node
// DAN-701 (#1930, attack plan #1951): prints the canary the production image
// smoke test plants as a negative control (production-image-smoke.sh). It must
// be found by the gitleaks 8.30.1 rule generic-api-key, so a draw is kept only
// when that rule cannot skip it. From the gitleaks v8.30.1 source:
// - config/gitleaks.toml: generic-api-key has entropy = 3.5, and detect/detect.go
//   skips a secret whose Shannon entropy is <= 3.5;
// - the same rule skips a secret holding a stopword (config/gitleaks.toml); all
//   of its stopwords made only of hex characters are below.
// 40 hex characters: the 64-character form is what infra/docker/image-gitleaks.toml
// allows. Prints one canary and exits 0, or exits 1 after too many draws.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const GITLEAKS_ENTROPY = 3.5;
export const MIN_ENTROPY = 3.6;
const HEX_STOPWORDS = ["dead", "feed", "000000", "aaaaaa", "6fe4476ee5a1832882e326b506d14126"];

/** Shannon entropy in bits per character, as gitleaks computes it (detect/utils.go). */
export function shannonEntropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const freq = count / value.length;
    entropy -= freq * Math.log2(freq);
  }
  return entropy;
}

/** Why gitleaks could skip this canary, or null when it cannot. */
export function canaryProblem(value) {
  if (typeof value !== "string" || !/^[0-9a-f]*$/.test(value)) return "not-hex";
  if (value.length !== 40) return "length";
  if (HEX_STOPWORDS.some((word) => value.includes(word))) return "stopword";
  if (shannonEntropy(value) < MIN_ENTROPY) return "low-entropy";
  return null;
}

/** Draws until a canary has no problem; about one draw in five is dropped. */
export function drawCanary(draw = () => randomBytes(20).toString("hex"), attempts = 1000) {
  for (let i = 0; i < attempts; i += 1) {
    const value = draw();
    if (canaryProblem(value) === null) return value;
  }
  throw new Error(`no acceptable canary in ${attempts} draws`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(drawCanary());
  } catch (error) {
    console.error(`image-canary: ${error.message}`);
    process.exit(1);
  }
}
