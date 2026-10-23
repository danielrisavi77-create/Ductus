import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanUiText } from "../../scripts/forbidden-terms/scan";

// The clipboard action is judged on the whole phrase of a component, not on the
// piece an inline element cuts out of it (DAN-134).
describe("clipboard action over inline elements", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });
  const scanned = (lines: readonly string[]) => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    mkdirSync(path.join(root, "src", "components"), { recursive: true });
    const source = ["export const View = () => (", "  <section>", ...lines.map((line) => `    ${line}`), "  </section>", ");", ""].join("\n");
    writeFileSync(path.join(root, "src", "components", "View.tsx"), source);
    return scanUiText(root).map((f) => [f.line, f.terms.map((t) => t.entry)]);
  };

  it("allows the action when an element cuts the word out of its phrase", () => {
    // One component per text: sibling blocks are also read closed up (see the known limits of the PR).
    expect(scanned(["<p><strong>Copied</strong> to clipboard</p>"])).toEqual([]);
    expect(scanned(["<p><strong>Kopirano</strong> u međuspremnik</p>"])).toEqual([]);
    expect(scanned(["<p>Copied to clipboard</p>"])).toEqual([]);
  });

  it("still reports a word that is not followed by its place in the same phrase", () => {
    expect(scanned(["<p><strong>Copied</strong>. To clipboard settings.</p>"])).toEqual([[3, ["copied"]]]);
    expect(scanned(["<p><strong>Copied</strong></p>"])).toEqual([[3, ["copied"]]]);
    expect(scanned(["<p><strong>Kopirano</strong>. U međuspremniku nema sadržaja.</p>"])).toEqual([[3, ["kopirano"]]]);
  });
});
