import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
 * #960: docs/design/DESIGN-SYSTEM.md is the single written source of the
 * design. Its token table must name exactly the tokens app/globals.css sets in
 * each of the four scopes, with the same values, so the document and the code
 * can never again describe two different palettes.
 */

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const DOC = readFileSync(join(process.cwd(), "docs", "design", "DESIGN-SYSTEM.md"), "utf8");

const SCOPES = [":root", ':root[data-theme="light"]:not(:has(#prijava-kartica, #pocetna-naslov))', ".sheet", '.sheet[data-sheet-theme="light"]'] as const;
type Scope = (typeof SCOPES)[number];

/** Colour tokens (hex values) declared in the first rule whose selector is exactly `selector`. */
function cssColours(selector: Scope): Map<string, string> {
  const lines = CSS.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const out = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "}") break;
    const m = /^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8});/.exec(line);
    if (m) out.set(m[1], m[2].toLowerCase());
  }
  return out;
}

/** The colour table between the `<!-- tokens:start -->` and `<!-- tokens:end -->` markers. */
function docColours(): Map<Scope, Map<string, string>> {
  const start = DOC.indexOf("<!-- tokens:start -->");
  const end = DOC.indexOf("<!-- tokens:end -->");
  if (start === -1 || end === -1) throw new Error("DESIGN-SYSTEM.md has no token table markers");
  const out = new Map<Scope, Map<string, string>>(SCOPES.map((s) => [s, new Map()]));
  for (const row of DOC.slice(start, end).split("\n")) {
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    const name = /^`(--[a-z0-9-]+)`$/.exec(cells[0] ?? "")?.[1];
    if (!name) continue;
    SCOPES.forEach((scope, i) => {
      const value = /`(#[0-9a-fA-F]{3,8})`/.exec(cells[i + 1] ?? "")?.[1];
      if (value) out.get(scope)!.set(name, value.toLowerCase());
    });
  }
  return out;
}

describe("DESIGN-SYSTEM.md matches app/globals.css (#960)", () => {
  const doc = docColours();

  for (const scope of SCOPES) {
    it(`names every colour of ${scope} with the value the code uses`, () => {
      expect(Object.fromEntries(doc.get(scope)!)).toEqual(Object.fromEntries(cssColours(scope)));
    });
  }

  // Teal (D-115), mint (D-123) and burgundy (#867) were replaced by D-179, and
  // the landing's plum and copper (D-184) by paper and graphite (D-188); they
  // may appear only in the history section at the end.
  it("names no replaced primary outside the history section", () => {
    const current = DOC.slice(0, DOC.indexOf("## Povijest"));
    expect(DOC.includes("## Povijest")).toBe(true);
    for (const old of ["#14b8a6", "#6fbfa5", "#cf9d72", "#19161a", "#0a0f0e", "#0f110e", "#2b1f38", "#f0b573", "#8f4f33"]) {
      expect(current.toLowerCase()).not.toContain(old);
    }
  });

  // D-188 replaces every colour of D-179 (#915) and D-184 (#964); none of them
  // stays a token in the app's stylesheet or in the demo provider's page, which
  // repeats the tokens as values.
  it("keeps no colour of D-179 or D-184 in the stylesheet or the demo provider", () => {
    const provider = readFileSync(join(process.cwd(), "infra", "fake-oidc", "server.mjs"), "utf8").toLowerCase();
    const replaced = [
      "#2b1f38", "#21192a", "#f7f0fa", "#f0b573", // D-179
      "#21172c", "#3c2a4a", "#f3ede2", "#fffcf5", "#2c2130", "#6b5b66", "#d1c3b7", "#8f4f33", // D-184
      "#19161a", "#cf9d72", "#231720", "#f1e5d6", "#292329", // #867, replaced by D-179
    ];
    for (const old of replaced) {
      expect(CSS.toLowerCase(), old).not.toContain(old);
      expect(provider, old).not.toContain(old);
    }
  });
});

describe("shared focus ring and curtain (#960)", () => {
  const files = (readdirSync(join(process.cwd(), "src", "components"), { recursive: true }) as string[])
    // The public landing page included (review of #973): one focus ring everywhere.
    .filter((f) => f.endsWith(".module.css"))
    .map((f) => [f, readFileSync(join(process.cwd(), "src", "components", f), "utf8")] as const);

  it("draws every focus ring from --focus-width and --focus-offset", () => {
    expect(files.filter(([, css]) => /outline:\s*\d+px solid|outline-offset:\s*\d+px/.test(css)).map(([f]) => f)).toEqual([]);
  });

  it("takes every dialog curtain from --scrim", () => {
    expect(files.filter(([, css]) => /background:\s*#0008/.test(css)).map(([f]) => f)).toEqual([]);
  });
});
