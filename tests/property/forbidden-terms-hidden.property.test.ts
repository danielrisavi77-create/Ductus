import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fc, test } from "@fast-check/vitest";
import { afterAll, expect } from "vitest";

import { scanUiText } from "../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../scripts/forbidden-terms/terms";

// DAN-132 (issue #190, test requirement 3): inline elements hidden from one
// audience around the word and the place. The scan reports a contextual entry
// exactly when one of the texts a person can get leaves the word bare.
type Audience = "sighted" | "spoken";

/** How a piece is wrapped, and who never gets it; `toggled` is the `hidden` attribute, which may show it or not to both. */
const WRAPS = [
  { open: "", close: "" },
  { open: "<span>", close: "</span>" },
  { open: "<b>", close: "</b>" },
  { open: '<span aria-hidden="true">', close: "</span>", without: "spoken" },
  { open: "<i aria-hidden>", close: "</i>", without: "spoken" },
  { open: "<em aria-hidden={true}>", close: "</em>", without: "spoken" },
  { open: '<span className="sr-only">', close: "</span>", without: "sighted" },
  { open: '<small className="note visually-hidden">', close: "</small>", without: "sighted" },
  { open: "<span hidden>", close: "</span>", toggled: true },
  { open: '<span style={{ display: "none" }}>', close: "</span>", toggled: true },
] as const satisfies readonly { open: string; close: string; without?: Audience; toggled?: true }[];

const WORDS = ["Spremljeno", "Spremljena", "Saved", "na uređaju", "na poslužitelju", "on this device", "to the server", "na", "uređaju", "Predano", "14:05"];

const piece = fc.record({ text: fc.constantFrom(...WORDS), wrap: fc.constantFrom(...WRAPS) });
type Piece = { text: string; wrap: (typeof WRAPS)[number] };

/** The texts one audience can get: every piece it is given, with each toggled piece shown or not. */
function readings(pieces: readonly Piece[], audience: Audience): string[] {
  let texts = [""];
  for (const { text, wrap } of pieces) {
    if ("without" in wrap && wrap.without === audience) continue;
    const shown = texts.map((before) => `${before} ${text}`);
    texts = "toggled" in wrap ? [...texts, ...shown] : shown;
  }
  return texts;
}

const root = mkdtempSync(path.join(tmpdir(), "ductus-terms-hidden-"));
const file = path.join(root, "src", "components", "Case.tsx");
mkdirSync(path.dirname(file), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

test.prop([fc.array(piece, { minLength: 1, maxLength: 4 })])(
  "an entry is reported exactly when the sighted or the spoken reading holds it",
  (pieces) => {
    const jsx = pieces.map(({ text, wrap }) => `${wrap.open}${text}${wrap.close}`).join(" ");
    writeFileSync(file, `export const Case = () => <p>${jsx}</p>;\n`);
    const expected = new Set(
      (["sighted", "spoken"] as const).flatMap((audience) => readings(pieces, audience)).flatMap((text) => findForbiddenTerms(text).map((term) => term.entry)),
    );
    const found = scanUiText(root).flatMap((finding) => finding.terms.map((term) => term.entry));
    expect([...found].sort()).toEqual([...expected].sort());
  },
);
