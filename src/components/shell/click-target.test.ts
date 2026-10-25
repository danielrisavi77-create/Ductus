import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// #732 items 9 and 19: the text links and buttons in the comment panel and the
// fast path rows are dense bars, so their targets keep the 32 px floor that
// app/globals.css sets ("at least 32 px in dense bars, 44 px elsewhere").
const TARGETS = [
  ["src/components/editor/CommentPanel.module.css", ".link"],
  ["src/components/editor/CommentPanel.module.css", ".send"],
  ["src/components/teacher/FastPath.module.css", ".linkButton"],
  ["src/components/teacher/LiveWorkView.module.css", ".link"],
] as const;

/** The min-height in px of the top-level rule whose selector is exactly `selector`. */
function minHeight(css: string, selector: string): number | null {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/\./g, "\\.");
  const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain);
  const height = rule && /min-height:\s*([\d.]+)px;/.exec(rule[1]);
  return height ? Number(height[1]) : null;
}

describe("click targets in dense bars", () => {
  it.each(TARGETS)("%s %s is at least 32 px high", (file, selector) => {
    const css = readFileSync(join(process.cwd(), file), "utf8");
    expect(minHeight(css, selector)).toBeGreaterThanOrEqual(32);
  });
});
