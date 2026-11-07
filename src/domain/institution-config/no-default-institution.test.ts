import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

// M2.12-P02 (DAN-443), plan napada #1689 D1, D2, D6: FPZG is one record of
// config/institutions.json, never a default in code. Only the registry reads
// the style files and the records; no production file of src/ or app/ names
// the FPZG style or slug in code.

const ROOT = process.cwd();
const REGISTRY = "src/domain/institution-config/registry.ts";
const SCANNED = ["src", "app"];

function productionFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    if (!/\.(ts|tsx|mts|js|mjs)$/.test(entry.name) || /\.test\.|\.spec\./.test(entry.name)) return [];
    return [path.split(sep).join("/")];
  });
}

/** Code without comments, so a doc comment may still name FPZG. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The findings for one file; empty when it assumes no institution. */
function findings(path: string, text: string): string[] {
  const body = code(text);
  const out: string[] = [];
  if (path !== REGISTRY && /faculties\/|institutions\.json/.test(body)) out.push("reads institution configuration outside the registry");
  if (/fpzgCitationStyle/.test(body)) out.push("names the FPZG style as a value");
  if (/["'`]fpzg["'`]/i.test(body)) out.push("names the FPZG slug or style in code");
  return out;
}

describe("no institution is a default in code", () => {
  it("flags each way of assuming FPZG", () => {
    expect(findings("src/a.ts", 'import s from "../../../config/faculties/fpzg/citation.json";')).toHaveLength(1);
    expect(findings("src/a.ts", "import r from '../config/institutions.json';")).toHaveLength(1);
    expect(findings("src/a.ts", "export const x = fpzgCitationStyle;")).toHaveLength(1);
    expect(findings("src/a.ts", 'resolveCitationStyle("fpzg")')).toHaveLength(1);
    expect(findings("src/a.ts", "const slug = `FPZG`;")).toHaveLength(1);
    expect(findings("src/a.ts", "/** the FPZG style */\n// fpzgCitationStyle was removed\nconst a = 1;")).toEqual([]);
    expect(findings(REGISTRY, 'import s from "../../../config/faculties/fpzg/citation.json";')).toEqual([]);
  });

  it("finds nothing in src/ and app/, the signer and the storage domains included", () => {
    const files = SCANNED.flatMap(productionFiles);
    for (const must of [REGISTRY, "src/components/editor/sources.ts", "src/server/evidence", "src/adapters/evidence", "src/adapters/crypto"]) {
      expect(files.some((file) => file === must || file.startsWith(`${must}/`)), must).toBe(true);
    }
    const bad = files.flatMap((file) =>
      findings(file, readFileSync(join(ROOT, file), "utf8")).map((finding) => `${relative(ROOT, join(ROOT, file))}: ${finding}`),
    );
    expect(bad).toEqual([]);
  });
});
