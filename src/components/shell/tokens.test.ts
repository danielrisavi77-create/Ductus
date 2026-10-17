import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

function token(block: string, name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1].trim().toLowerCase();
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
});
