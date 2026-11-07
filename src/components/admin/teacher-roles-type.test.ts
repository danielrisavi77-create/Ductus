import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// DAN-581 (review 6676057928 on #1595): the list headings and the dialog
// title follow the A-02 reference (docs/design/ductura/m2-reference): headings
// 25 px on a wide screen and 21 px on a phone, display headings at weight 500.
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const MODULE = read("src", "components", "admin", "TeacherRoles.module.css");
const REFERENCE = read("docs", "design", "ductura", "m2-reference", "reference.css");
const GLOBALS = read("app", "globals.css");

/** The phone block (max-width 640 px) of a stylesheet. */
const phone = (css: string) => /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, head]) => head!.trim() === selector);
  if (!match) throw new Error(`no rule ${selector}`);
  return Object.fromEntries(
    match[2]!.split(";").map((d) => d.split(":").map((part) => part.trim())).filter(([name, value]) => name && value).map(([n, v]) => [n!, v!]),
  );
}

const TOKENS = new Map([...GLOBALS.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]));
const token = (name: string) => TOKENS.get(name);
const px = (value: string | undefined) => (value?.startsWith("var(") ? token(value.slice(4, -1)) : value);
const top = MODULE.slice(0, MODULE.indexOf("@media"));

describe("TeacherRoles type scale (A-02)", () => {
  it("sets the list headings as the reference sets its section headings", () => {
    const heading = rule(top, ".heading");
    expect(px(heading["font-size"])).toBe(rule(REFERENCE, ".main h2")["font-size"]);
    expect(px(heading["font-size"])).toBe("25px");
    expect(rule(phone(MODULE), ".heading")["font-size"]).toBe(rule(phone(REFERENCE), ".main h2")["font-size"]);
    expect(rule(phone(MODULE), ".heading")["font-size"]).toBe("21px");
  });

  it("gives the headings and the dialog title the reference weight and tracking", () => {
    const display = rule(REFERENCE, "h1, h2, h3");
    expect(display["font-weight"]).toBe("500");
    for (const selector of [".heading", ".title"]) {
      expect(rule(top, selector)["font-weight"]).toBe(display["font-weight"]);
      expect(rule(top, selector)["letter-spacing"]).toBe(display["letter-spacing"]);
    }
    expect(rule(top, ".title")["font-size"]).toBe(rule(REFERENCE, ".dialog h3")["font-size"]);
  });
});
