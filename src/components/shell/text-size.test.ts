import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// #732 item 8: the comments and side panels, which the demo shows on a
// projector, keep the floor that app/globals.css sets for interface text:
// 12 px, and 13 px on a phone.
const MODULES = [
  "src/components/editor/CommentPanel.module.css",
  "src/components/editor/SidePanels.module.css",
  "src/components/summary/ProcessSummaryView.module.css",
  "src/components/teacher/TeacherCourses.module.css",
];

type Size = { selector: string; px: number };

/** The px font sizes of the top-level rules, outside any @media block. */
function baseSizes(css: string): Size[] {
  const sizes: Size[] = [];
  let selector = "";
  let depth = 0;
  for (const line of css.split("\n")) {
    if (depth === 0 && line.trim().endsWith("{")) selector = line.trim().slice(0, -1).trim();
    const size = /^\s*font-size:\s*([\d.]+)px;/.exec(line);
    if (size && depth === 1 && !selector.startsWith("@")) sizes.push({ selector, px: Number(size[1]) });
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return sizes;
}

/** The selectors a phone block (max-width 640 px) sets to 13 px. */
function phoneSelectors(css: string): Set<string> {
  const block = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const rule = /([^{}]+)\{\s*font-size:\s*13px;\s*\}/g;
  const selectors = new Set<string>();
  for (const match of block.matchAll(rule)) {
    for (const selector of match[1]!.split(",")) selectors.add(selector.trim());
  }
  return selectors;
}

describe("text size in comments and side panels (#732 item 8)", () => {
  for (const file of MODULES) {
    const css = readFileSync(join(process.cwd(), file), "utf8");

    it(`${file}: no interface text under 12 px`, () => {
      const sizes = baseSizes(css);
      expect(sizes.length).toBeGreaterThan(0);
      expect(sizes.filter(({ px }) => px < 12)).toEqual([]);
    });

    it(`${file}: 13 px on a phone for every size under 13 px`, () => {
      const phone = phoneSelectors(css);
      const small = baseSizes(css).filter(({ px }) => px < 13).map(({ selector }) => selector);
      expect(small.filter((selector) => !phone.has(selector))).toEqual([]);
    });
  }
});
