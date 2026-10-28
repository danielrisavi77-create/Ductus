import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = CSS.split("\n").findIndex((line) => line.trim() === `${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const lines = CSS.split("\n").slice(start + 1);
  const end = lines.findIndex((line) => line.trim() === "}");
  return lines.slice(0, end === -1 ? undefined : end).join("\n");
}

function token(block: string, name: string): string | undefined {
  const line = block.split("\n").find((l) => l.trim().startsWith(`${name}:`));
  return line?.slice(line.indexOf(":") + 1).replace(";", "").trim().toLowerCase();
}

describe("design tokens (landing palette, owner decision of 28 Oct 2026, #960)", () => {
  const root = rule(":root");

  // Dark values: the public landing's palette (#952, PrototypeLanding.css:
  // --plum, --night, --plum2, --copper and its named text and line colours);
  // tokens the landing has no colour for keep the Archivum package's value (D-179).
  const PACKAGE: Record<string, string> = {
    "--ground": "#2b1f38", "--chrome": "#21172c", "--sheet": "#392a44",
    "--ink": "#f8f1f4", "--ink-2": "#e1d5e2", "--ink-3": "#d2bfcf", "--ink-muted": "#86738c",
    "--rule": "#86738c", "--rule-2": "#75667c",
    "--accent": "#f0b573", "--accent-hover": "#ffd19c", "--accent-ink": "#21172c", "--accent-soft": "#3c2a4a",
    "--selected": "#3c2a4a", "--well": "#3c2a4a", "--hover": "#3c2a4a", "--raised": "#291e33", "--raised-rule": "#c5afc8",
    "--card": "#33253d", "--link-rule": "#c5afc8",
    "--field": "#2b2035", "--field-rule": "#b09ab6", "--field-placeholder": "#bca4cb", "--error-soft": "#402b46",
  };

  it("takes every dark shell colour from the landing palette", () => {
    for (const [name, value] of Object.entries(PACKAGE)) expect([name, token(root, name)]).toEqual([name, value]);
  });

  it("gives the dark sheet the shell's sheet and ink", () => {
    const sheet = rule(".sheet");
    for (const name of ["--sheet", "--ink", "--ink-2", "--ink-3", "--ink-muted", "--rule", "--rule-2",
      "--accent", "--accent-hover", "--accent-ink", "--accent-soft"]) {
      expect([name, token(sheet, name)]).toEqual([name, PACKAGE[name]]);
    }
  });

  it("takes the radii and the heading scale from the package", () => {
    expect(token(root, "--radius-sm")).toBe("4px");
    expect(token(root, "--radius-control")).toBe("5px");
    expect(token(root, "--radius")).toBe("6px");
    expect(token(root, "--radius-lg")).toBe("10px");
    expect(["--fs-h1", "--fs-h2", "--fs-h3", "--fs-h4"].map((name) => token(root, name)))
      .toEqual(["64px", "42px", "29px", "25px"]);
    expect(token(root, "--heading-leading")).toBe("1.08");
    expect(token(root, "--heading-tracking")).toBe("-0.025em");
  });

  // Light shell and white sheet: the landing's --paper, --page and --ink.
  // The landing's light copper (#8f5d49) is under 4.5:1 on the light hover
  // surfaces, so the darker copper #8f4f33 (27 Oct 2026, option (a)) stays.
  it("takes paper and ink from the landing and keeps the AA copper", () => {
    const shell = rule('[data-theme="light"]');
    expect(token(shell, "--ground")).toBe("#f3ede2");
    expect(token(shell, "--chrome")).toBe("#fffcf5");
    expect(token(shell, "--ink")).toBe("#2c2130");
    expect(token(shell, "--accent")).toBe("#8f4f33");
    const white = rule('.sheet[data-sheet-theme="light"]');
    expect(token(white, "--sheet")).toBe("#fffcf5");
    expect(token(white, "--ink")).toBe("#2c2130");
    expect(token(white, "--accent")).toBe("#8f4f33");
  });

  // Same decision: the light theme supports the new palette, so no colour token
  // falls back to its dark value in the light shell.
  it("gives every colour token of the dark root a light value", () => {
    const shell = rule('[data-theme="light"]');
    const colours = root.split("\n").map((l) => l.trim().match(/^(--[a-z0-9-]+):\s*#[0-9a-f]{6,8};$/i)?.[1])
      .filter((name): name is string => name !== undefined);
    expect(colours.length).toBeGreaterThan(30);
    expect(colours.filter((name) => token(shell, name) === undefined)).toEqual([]);
  });

  // The server save state must not read as the primary or as "saving"
  // (SAVING_LOCAL and SYNCING pulse in the primary colour).
  it("gives SYNCED its own colour, never the primary's", () => {
    const synced = token(root, "--synced");
    expect(synced).toBeDefined();
    expect(synced).not.toBe(token(root, "--accent"));
    const dot = rule('.sync-chip[data-tone="ok"] .sync-chip__dot');
    expect(dot).toContain("var(--synced)");
    expect(dot).not.toContain("--accent");
  });

  // The package has no warning, error or save-state colours; these stay.
  it("keeps the warning and error colours", () => {
    expect(token(root, "--warn")).toBe("#e9c58b");
    expect(token(root, "--error")).toBe("#f0a08f");
  });

  // D-57: the origin colours keep their meaning; the package has none of its own.
  it("keeps the origin colours", () => {
    expect(token(root, "--p-internal")).toBe("#8fb0e0");
    expect(token(root, "--p-unknown")).toBe("#9e9a90");
    expect(token(root, "--p-template")).toBe("#7e7a70");
    expect(token(root, "--p-ai")).toBe("#d3ac63");
  });

});

/** WCAG 2.1 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// The limits the comments in globals.css promise (review #483, findings 1 and 2).
describe("contrast of the semantic tokens (FE-D2)", () => {
  const root = rule(":root");
  const light = rule('.sheet[data-sheet-theme="light"]');
  const dark = (name: string) => token(root, name)!;

  it("dark --ink-muted is at least 3:1 (large text, marks) and below 4.5:1, so small text uses --ink-3", () => {
    for (const surface of ["--chrome", "--sheet", "--raised"]) {
      const ratio = contrast(dark("--ink-muted"), dark(surface));
      expect(ratio).toBeGreaterThanOrEqual(3);
      expect(ratio).toBeLessThan(4.5);
      expect(contrast(dark("--ink-3"), dark(surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("on the white sheet --ink-muted is text-safe and --warn is a mark colour (3:1)", () => {
    expect(contrast(token(light, "--ink-muted")!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(light, "--warn")!, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("keeps the primary readable: its text on it and it on its soft background are 4.5:1 or more", () => {
    expect(contrast(dark("--accent-ink"), dark("--accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark("--accent"), dark("--accent-soft"))).toBeGreaterThanOrEqual(4.5);
  });

  it("light shell text is 4.5:1 or more on its ground and chrome, and on the primary", () => {
    const shell = rule('[data-theme="light"]');
    const value = (name: string) => token(shell, name)!;
    for (const surface of ["--ground", "--chrome"]) {
      for (const ink of ["--ink", "--ink-2", "--ink-3", "--ink-muted", "--error", "--warn", "--accent"]) {
        expect(contrast(value(ink), value(surface))).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(value("--accent-ink"), value("--accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the dark sheet carries its own ink, so a light shell never puts light ink on it", () => {
    const sheet = rule(".sheet");
    for (const ink of ["--ink", "--ink-2", "--ink-3"]) {
      expect(contrast(token(sheet, ink)!, token(sheet, "--sheet")!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps small quiet text readable on the selected, hover and card surfaces too", () => {
    for (const surface of ["--selected", "--hover", "--card"]) {
      expect(contrast(dark("--ink-3"), dark(surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark("--accent"), dark(surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  // DAN-344: the colours the package does not replace stay readable on its surfaces.
  it("keeps the warning, error and save-state colours readable on every dark surface", () => {
    for (const surface of ["--ground", "--chrome", "--sheet", "--raised", "--card", "--selected", "--hover"]) {
      for (const ink of ["--ink", "--ink-2", "--warn", "--error", "--synced"]) {
        expect([ink, surface, contrast(dark(ink), dark(surface)) >= 4.5]).toEqual([ink, surface, true]);
      }
    }
  });

  // DAN-344: --rule-2 became a line colour; quiet surfaces under text are --well
  // (the mode switch, the "uskoro" chip, hover and disabled backgrounds).
  it("keeps quiet text readable on --well, dark and light, and uses no line colour as a surface", () => {
    const shell = rule('[data-theme="light"]');
    for (const ink of ["--ink", "--ink-2", "--ink-3"]) {
      expect(contrast(dark(ink), dark("--well"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(shell, ink)!, token(shell, "--well")!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(CSS).not.toMatch(/background(-color)?: var\(--rule(-2)?\)/);
  });

  it("keeps the field text and its placeholder readable on the field", () => {
    expect(contrast(dark("--ink"), dark("--field"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark("--field-placeholder"), dark("--field"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark("--ink"), dark("--error-soft"))).toBeGreaterThanOrEqual(4.5);
  });

  // Owner decision of 27 Oct 2026: the light theme has the same AA demands as the
  // dark one. Each scope is the cascade a page can produce: shell, then sheet.
  describe("every theme and sheet scope (AA, owner decision of 27 Oct 2026)", () => {
    const shell = rule('[data-theme="light"]');
    const darkSheet = rule(".sheet");
    const whiteSheet = rule('.sheet[data-sheet-theme="light"]');
    const scope = (...blocks: string[]) => (name: string) => {
      for (const block of [...blocks].reverse()) {
        const value = token(block, name);
        if (value !== undefined) return value;
      }
      return undefined;
    };
    const SHELLS = { "dark shell": scope(root), "light shell": scope(root, shell) };
    const SHEETS = {
      "dark sheet in the dark shell": scope(root, darkSheet),
      "dark sheet in the light shell": scope(root, shell, darkSheet),
      "white sheet in the dark shell": scope(root, whiteSheet),
      "white sheet in the light shell": scope(root, shell, whiteSheet),
    };
    const pass = (where: string, fg: string, bg: string, min: number, v: (n: string) => string | undefined) =>
      [where, fg, bg, contrast(v(fg)!, v(bg)!) >= min];

    for (const [where, v] of Object.entries(SHELLS)) {
      it(`${where}: text 4.5:1, focus ring and lines 3:1 on its surfaces`, () => {
        for (const bg of ["--ground", "--chrome", "--raised", "--card", "--hover", "--selected", "--well", "--field"]) {
          for (const fg of ["--ink", "--ink-2", "--ink-3", "--accent", "--error"]) {
            expect(pass(where, fg, bg, 4.5, v)).toEqual([where, fg, bg, true]);
          }
          for (const fg of ["--accent", "--field-rule", "--link-rule"]) {
            expect(pass(where, fg, bg, 3, v)).toEqual([where, fg, bg, true]);
          }
        }
        expect(pass(where, "--field-placeholder", "--field", 4.5, v)).toEqual([where, "--field-placeholder", "--field", true]);
        expect(pass(where, "--ink", "--error-soft", 4.5, v)).toEqual([where, "--ink", "--error-soft", true]);
        expect(pass(where, "--raised-rule", "--raised", 3, v)).toEqual([where, "--raised-rule", "--raised", true]);
        expect(pass(where, "--accent-ink", "--accent", 4.5, v)).toEqual([where, "--accent-ink", "--accent", true]);
      });
    }

    for (const [where, v] of Object.entries(SHEETS)) {
      it(`${where}: its ink 4.5:1 and its focus ring and lines 3:1 on its own surfaces`, () => {
        for (const bg of ["--sheet", "--well", "--card", "--field"]) {
          for (const fg of ["--ink", "--ink-2", "--ink-3", "--accent"]) {
            expect(pass(where, fg, bg, 4.5, v)).toEqual([where, fg, bg, true]);
          }
          for (const fg of ["--field-rule", "--link-rule"]) {
            expect(pass(where, fg, bg, 3, v)).toEqual([where, fg, bg, true]);
          }
        }
        expect(pass(where, "--field-placeholder", "--field", 4.5, v)).toEqual([where, "--field-placeholder", "--field", true]);
        expect(pass(where, "--ink", "--error-soft", 4.5, v)).toEqual([where, "--ink", "--error-soft", true]);
      });
    }

    it("draws the focus ring in the theme's primary", () => {
      expect(CSS).toMatch(/outline: var\(--focus-width\) solid var\(--accent\);/);
      // The landing's ring (#960): 3 px, 4 px away; never thinner than 2 px.
      expect(token(rule(":root"), "--focus-width")).toBe("3px");
      expect(token(rule(":root"), "--focus-offset")).toBe("4px");
    });
  });

  it("gives the white sheet no raised or selected surface", () => {
    expect(token(light, "--raised")).toBeUndefined();
    expect(token(light, "--selected")).toBeUndefined();
  });
});

describe("manuscript type (README §5.1, FE-D2)", () => {
  it("sets the sheet in Newsreader from the repository, not Times", () => {
    const family = token(rule(":root"), "--ff-manuscript");
    expect(family).toMatch(/^var\(--font-display\)/);
    expect(family).not.toContain("times");
  });

  for (const selector of [".manuscript", ".editor-surface .ProseMirror"]) {
    it(`${selector} is 16.5-17 px with leading 1.7`, () => {
      const block = rule(selector);
      expect(block).toContain("var(--ff-manuscript)");
      const size = parseFloat(token(block, "font-size") ?? "");
      expect(size).toBeGreaterThanOrEqual(16.5);
      expect(size).toBeLessThanOrEqual(17);
      expect(token(block, "line-height")).toBe("1.7");
    });
  }
});

describe("workspace breakpoints (design v3 inside the shell, was README §5.1, FE-D2)", () => {
  it("folds the structure up to 1250 px and the panel up to 1050 px, nothing at 1100 px", () => {
    expect(CSS).toContain("@media (max-width: 1250px) {");
    expect(CSS).toContain("@media (max-width: 1050px) {");
    expect(CSS).not.toMatch(/max-width: 1100px/);
  });
});
