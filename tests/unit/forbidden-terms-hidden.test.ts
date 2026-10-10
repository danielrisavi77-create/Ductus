import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HIDING_CLASSES, VISUALLY_HIDDEN_CLASSES, scanUiText } from "../../scripts/forbidden-terms/scan";

// DAN-132, plan of attack in issue #190: content hidden from one audience.
// An element's text is read twice, as a sighted person sees it and as a screen
// reader speaks it, and an entry found in either reading is reported.
describe("content hidden from the eye or from a screen reader", () => {
  const HR = "spremljeno (bez pojašnjenja)";
  const EN = "saved (without saying where)";

  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  /** Rows of the plan: its number and what it is, the JSX, the entries it must be reported for. */
  const HIDDEN_CONTENT: readonly [string, readonly string[], readonly string[]][] = [
    ["1 place hidden from a screen reader", ['<p>Spremljeno <span aria-hidden="true">na uređaju</span></p>'], [HR]],
    ["1 place on the server hidden from a screen reader", ['<p>Spremljena <b aria-hidden="true">na poslužitelju</b></p>'], [HR]],
    ["2 aria-hidden without a value", ["<p>Spremljeno <span aria-hidden>na uređaju</span></p>"], [HR]],
    ["2 aria-hidden={true}", ["<p>Spremljeno <span aria-hidden={true}>na uređaju</span></p>"], [HR]],
    ["2 aria-hidden in capitals", ['<p>Spremljeno <span aria-hidden="TRUE">na uređaju</span></p>'], [HR]],
    ["2 aria-hidden as a string expression", ['<p>Spremljeno <span aria-hidden={"true"}>na uređaju</span></p>'], [HR]],
    ["3 aria-hidden false as a string", ['<p>Spremljeno <span aria-hidden="false">na uređaju</span></p>'], []],
    ["3 aria-hidden={false}", ["<p>Spremljeno <span aria-hidden={false}>na uređaju</span></p>"], []],
    ["3 aria-hidden={undefined}", ["<p>Spremljeno <span aria-hidden={undefined}>na uređaju</span></p>"], []],
    ["4 computed aria-hidden on the place", ["<p>Spremljeno <span aria-hidden={a}>na uređaju</span></p>"], [HR]],
    ["4 computed aria-hidden after the whole phrase", ["<p>Spremljeno na uređaju <span aria-hidden={a}>14:05</span></p>"], []],
    ["5 spread props on the place", ["<p>Spremljeno <span {...props}>na uređaju</span></p>"], [HR]],
    ["5 spread of a literal object", ['<p>Spremljeno <span {...{ "aria-hidden": true }}>na uređaju</span></p>'], [HR]],
    ["5 spread props, then aria-hidden false", ['<p>Spremljeno <span {...props} aria-hidden="false">na uređaju</span></p>'], [HR]],
    ["5 spread props after the whole phrase", ["<p>Spremljeno na uređaju <span {...props}>14:05</span></p>"], []],
    ["6 element inside the hidden one", ['<p>Spremljeno <span aria-hidden="true"><b>na</b> uređaju</span></p>'], [HR]],
    ["6 hidden element inside another", ['<p>Spremljeno <span><span aria-hidden="true">na uređaju</span></span></p>'], [HR]],
    ["6 hidden element three levels down", ['<p>Saved <b><i><span aria-hidden="true">on the server</span></i></b></p>'], [EN]],
    ["7 the whole text hidden from a screen reader", ['<p aria-hidden="true">Spremljeno na uređaju</p>'], []],
    ["7 a bare word hidden from a screen reader is still seen", ['<p aria-hidden="true">Spremljeno</p>'], [HR]],
    ["8 place with the hidden attribute", ["<p>Spremljeno <span hidden>na uređaju</span></p>"], [HR]],
    ["8 place with a computed hidden attribute", ["<p>Saved <span hidden={a}>on this device</span></p>"], [EN]],
    ["8 hidden={false}", ["<p>Spremljeno <span hidden={false}>na uređaju</span></p>"], []],
    ["8 a bare word that the hidden attribute may show later", ["<p>Predano <span hidden>Spremljeno</span></p>"], [HR]],
    ["9 place for screen readers only", ['<p>Spremljeno <span className="sr-only">na uređaju</span></p>'], [HR]],
    ["9 place in a visually-hidden element", ['<p>Spremljeno <span className="note visually-hidden">na uređaju</span></p>'], [HR]],
    ["9 class attribute", ['<p>Spremljeno <span class="sr-only">na uređaju</span></p>'], [HR]],
    ["9 class in a call", ['<p>Spremljeno <span className={cn("sr-only", a)}>na uređaju</span></p>'], [HR]],
    ["9 class by a condition", ['<p>Spremljeno <span className={a ? "sr-only" : "note"}>na uređaju</span></p>'], [HR]],
    ["9 class with a variant", ['<p>Spremljeno <span className="md:sr-only">na uređaju</span></p>'], [HR]],
    ["9 display class with a variant", ['<p>Spremljeno <span className="hidden md:inline">na uređaju</span></p>'], [HR]],
    ["9 invisible class", ['<p>Saved <span className="invisible">on this device</span></p>'], [EN]],
    ["9 word for screen readers, place for the eye", ['<p><span className="sr-only">Spremljeno</span> <span aria-hidden="true">na uređaju</span></p>'], [HR]],
    ["10 display none", ['<p>Spremljeno <span style={{ display: "none" }}>na uređaju</span></p>'], [HR]],
    ["10 visibility hidden", ['<p>Spremljeno <span style={{ visibility: "hidden" }}>na uređaju</span></p>'], [HR]],
    ["10 display by a condition", ['<p>Spremljeno <span style={{ display: a ? "inline" : "none" }}>na uređaju</span></p>'], [HR]],
    ["10 computed display", ["<p>Spremljeno <span style={{ display: n }}>na uređaju</span></p>"], [HR]],
    ["10 display inline", ['<p>Spremljeno <span style={{ display: "inline" }}>na uređaju</span></p>'], []],
    ["10 style without display", ['<p>Spremljeno <span style={{ color: "red" }}>na uređaju</span></p>'], []],
    ["11 place rendered by &&", ["<p>Spremljeno {a && <span>na poslužitelju</span>}</p>"], [HR]],
    ["11 place rendered by a condition", ["<p>Spremljeno {a ? <span>na uređaju</span> : null}</p>"], [HR]],
    ["11 hidden place in both branches", ['<p>Saved {a ? <i aria-hidden="true">on this device</i> : <i hidden>on the server</i>}</p>'], [EN]],
    ["12 English place hidden from a screen reader", ['<p>Saved <span aria-hidden="true">on this device</span></p>'], [EN]],
    ["12 English place for screen readers only", ['<p>Saved <span className="sr-only">to the server</span></p>'], [EN]],
    ["13 place in a component", ["<p>Spremljeno <VisuallyHidden>na uređaju</VisuallyHidden></p>"], [HR]],
    ["13 place in a component with aria-hidden", ['<p>Spremljeno <Where aria-hidden="true">na uređaju</Where></p>'], [HR]],
    // An entry that is never contextual, put together by what one audience does not get.
    ["attack: phrase a screen reader joins", ['<p>Nestali <span aria-hidden="true">x</span> podaci</p>'], ["nestali podaci"]],
    ["attack: word the eye joins", ['<p>Sum<span className="sr-only">x</span>njivo</p>'], ["sumnjivo"]],
    ["attack: phrase the hidden attribute joins", ["<p>Missing <span hidden>x</span> data</p>"], ["missing data"]],
    ["attack: word split by a hidden element", ['<p>Spre<span aria-hidden="true">x</span>mljeno</p>'], [HR]],
    ["attack: hidden place in an attribute", ['<Row label={<>Spremljeno <span aria-hidden="true">na uređaju</span></>} />'], [HR]],
    ["attack: bare word for the eye, phrase for screen readers", ['<p><span aria-hidden="true">Spremljeno</span><span className="sr-only">Spremljeno na uređaju</span></p>'], [HR]],
    ["attack: phrase for the eye, bare word for screen readers", ['<p><span aria-hidden="true">Saved on the server</span><span className="sr-only">Saved</span></p>'], [EN]],
    ["attack: sentence end for the eye only", ['<p>Spremljeno<span aria-hidden="true">.</span> Na uređaju nema promjena</p>'], [HR]],
    // Hidden from both audiences by a class, which only the stylesheet makes true: still read by itself.
    ["attack: bare word hidden from both", ['<p>Predano <span aria-hidden="true" className="sr-only">Spremljeno</span></p>'], [HR]],
    ["attack: bare word hidden from both, nested", ['<p>Predano <span aria-hidden="true"><b className="sr-only">Saved</b></span></p>'], [EN]],
    // False positives the two readings must not produce.
    ["F1 hidden input after the phrase", ['<p>Spremljeno na uređaju <input type="hidden" name="saved" /></p>'], []],
    ["F1 display class on the whole text", ['<p className="hidden md:block">Spremljeno na uređaju</p>'], []],
    ["F5 place for each audience", ['<p>Spremljeno <span aria-hidden="true">na uređaju</span><span className="sr-only">na uređaju</span></p>'], []],
    ["F5 phrase for each audience", ['<p><span aria-hidden="true">Saved on device</span><span className="sr-only">Saved on this device</span></p>'], []],
    ["F5 word hidden from a screen reader, place for both", ['<p><span aria-hidden="true">Spremljeno</span> na uređaju</p>'], []],
    ["F5 separator after the whole phrase", ['<p>Spremljeno na uređaju <span aria-hidden="true">·</span> 14:05</p>'], []],
    ["F5 empty hidden element inside the phrase", ['<p>Spremljeno <span aria-hidden="true"> </span>na uređaju</p>'], []],
    ["F6 hidden icon before the phrase", ['<p><svg aria-hidden="true"><path d="M0 0" /></svg> Spremljeno na uređaju</p>'], []],
    ["F6 hidden icon after the phrase", ['<p>Saved on the server <svg aria-hidden="true"><path d="M0 0" /></svg></p>'], []],
    // Stricter side, kept on purpose. The separator is seen, and a symbol the
    // eye sees between the word and the place ends the phrase (row 19 of the
    // phrase boundary plan: `Spremljeno <span>✓</span> na uređaju`).
    ["F5 stricter: separator between the word and the place", ['<p>Spremljeno <span aria-hidden="true">·</span> na uređaju</p>'], [HR]],
    // Stricter side: a hidden parent is not carried into its content.
    ["7 stricter: hidden place in a hidden parent", ['<p aria-hidden="true">Spremljeno <span aria-hidden="true">na uređaju</span></p>'], [HR]],
    // Not covered (remaining risk, see the comment on `hiding` in scan.ts): the
    // scan cannot tell what a value from elsewhere holds.
    ["not covered: style from a variable", ["<p>Spremljeno <span style={hiddenStyle}>na uređaju</span></p>"], []],
    ["not covered: class from a variable", ["<p>Spremljeno <span className={styles.hidden}>na uređaju</span></p>"], []],
  ];

  it.each(HIDDEN_CONTENT)("row %s", (_, lines, expected) => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    const file = path.join(root, "src", "components", "Case.tsx");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, ["export const Case = ({ a, n, props }: Props) => (", ...lines.map((line) => `  ${line}`), ");", ""].join("\n"));
    const found = scanUiText(root);
    // Each entry is reported, and reported once.
    expect(found.flatMap((f) => f.terms.map((t) => t.entry))).toEqual(expected);
    for (const finding of found) expect(finding.line).toBe(2);
  });

  it("keeps the class names that hide content in one place", () => {
    expect([...VISUALLY_HIDDEN_CLASSES].sort()).toEqual(["sr-only", "visually-hidden"]);
    expect([...HIDING_CLASSES].sort()).toEqual(["hidden", "invisible"]);
  });
});
