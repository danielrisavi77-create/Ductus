import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The public try-out (DAN-354) keeps the text in memory only. Its code must not
// even load the writing page's local document, journal, sync or sign-out, so
// that no import side effect there can ever reach a visitor without a session.

const ROOT = resolve(__dirname, "../../..");
const SRC = join(ROOT, "src");
const ENTRY = join(SRC, "components/landing/TwoSides.tsx");

const FORBIDDEN: readonly RegExp[] = [
  /^src\/components\/editor\/LocalDocument\.tsx$/,
  /^src\/client\//,
  /^src\/lib\/journal\//,
  /^src\/domain\/sync\//,
  /^src\/domain\/serverSync\//,
];

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (/\.(?:ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null; // CSS and other assets
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT)) {
      const next = resolveLocal(file, match[1] ?? match[2]);
      if (next) queue.push(next);
    }
  }
  return seen;
}

describe("public try-out imports (DAN-354)", () => {
  const files = [...reachable(ENTRY)].map((file) => relative(ROOT, file));

  it("reaches the shared toolbar", () => {
    expect(files).toContain("src/components/editor/EditorToolbarFor.tsx");
  });

  it("never loads the local document, journal, sync or sign-out code", () => {
    expect(files.filter((file) => FORBIDDEN.some((rule) => rule.test(file)))).toEqual([]);
  });
});
