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

describe("design tokens (D-123)", () => {
  const root = rule(":root");

  it("takes the primary and its text from the handoff table", () => {
    expect(token(root, "--accent")).toBe("#6fbfa5");
    expect(token(root, "--accent-ink")).toBe("#0e1c17");
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

  it("names the handoff's raised, selected, muted, warning and error colours (README §8)", () => {
    expect(token(root, "--raised")).toBe("#1a1e19");
    expect(token(root, "--hover")).toBe("#1e221d");
    expect(token(root, "--selected")).toBe("#232722");
    expect(token(root, "--ink-muted")).toBe("#767d75");
    expect(token(root, "--warn")).toBe("#d3ac63");
    expect(token(root, "--error")).toBe("#e07a6a");
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

describe("workspace breakpoints (README §5.1, FE-D2)", () => {
  it("folds the structure below 1240 px and the panel below 1000 px, nothing at 1100 px", () => {
    expect(CSS).toContain("@media (max-width: 1239.98px) {");
    expect(CSS).toContain("@media (max-width: 999.98px) {");
    expect(CSS).not.toMatch(/max-width: 1100px/);
  });
});
