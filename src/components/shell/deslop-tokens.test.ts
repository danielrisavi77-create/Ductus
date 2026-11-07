import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// DAN-670 (design clean-up 1, paper and graphite, D-188): one heading tracking
// token everywhere, radii from the --radius* tokens, and cards inside a page
// with a flat 1 px edge instead of a lifted shadow. The test reads every CSS
// module of the app, so a new module is covered without being listed.

const ROOT = process.cwd();

function modules(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) return modules(path);
    return name.endsWith(".module.css") ? [path] : [];
  });
}

type Declaration = { file: string; selector: string; property: string; value: string };

/** Every declaration of every rule, also inside @media blocks, comments removed. */
function declarations(file: string): Declaration[] {
  const css = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Declaration[] = [];
  for (const [, head, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = head!.trim().replace(/\s+/g, " ");
    for (const part of body!.split(";")) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      found.push({
        file,
        selector,
        property: part.slice(0, colon).trim(),
        value: part.slice(colon + 1).trim(),
      });
    }
  }
  return found;
}

const ALL = [...modules("src"), ...modules("app")].flatMap(declarations);

/** Exceptions, each with its reason. A new entry needs a reason and an owner decision. */
const TRACKING_EXCEPTIONS = new Set([
  // The wordmark in the shell is a logotype, not a heading.
  "src/components/shell/AppShell.module.css|-1px",
]);
const RADIUS_EXCEPTIONS = new Set([
  // The tilted paper slip on the sign-in screen; a deliberate 2 px corner.
  "src/components/auth/SignInScreen.module.css|2px",
  // The full pill of a tag on the landing page.
  "src/components/landing/Landing.module.css|999px",
  // The editor source panel (editor area, separate change).
  "src/components/editor/SourcesPanel.module.css|7px",
]);
// A raised surface keeps its lift: dialogs and drawers float over the page.
// AssignmentNotice leaves the list when its gradient goes (DAN-670 C).
const LIFT_FILES = new Set([
  "src/components/shell/Dialog.module.css",
  "src/components/student/AssignmentNotice.module.css",
]);

describe("heading tracking is one token (DAN-670 A)", () => {
  // The token itself and any negative literal (a heading's tight tracking).
  const negative = ALL.filter(
    (d) => d.property === "letter-spacing" && (d.value.startsWith("-") || d.value.includes("--heading-tracking")),
  );

  it("finds the negative tracking declarations it is meant to cover", () => {
    expect(negative.length).toBeGreaterThan(10);
  });

  it.each(negative.map((d) => [d.file, d.selector, d.value] as const))("%s %s: %s", (file, _selector, value) => {
    if (TRACKING_EXCEPTIONS.has(`${file}|${value}`)) return;
    expect(value).toBe("var(--heading-tracking)");
  });
});

describe("radii come from the tokens (DAN-670 A)", () => {
  const radii = ALL.filter((d) => d.property === "border-radius");

  it("finds the radius declarations it is meant to cover", () => {
    expect(radii.length).toBeGreaterThan(20);
  });

  it.each(radii.map((d) => [d.file, d.selector, d.value] as const))("%s %s: %s", (file, _selector, value) => {
    for (const length of value.match(/\d*\.?\d+px/g) ?? []) {
      if (parseFloat(length) === 0) continue;
      expect(RADIUS_EXCEPTIONS.has(`${file}|${length}`), `${length} is hard-coded`).toBe(true);
    }
  });
});

describe("cards inside a page are flat (DAN-670 A)", () => {
  const lifted = ALL.filter(
    (d) => d.property === "box-shadow" && /var\(--(lift|shadow)\)/.test(d.value),
  );

  it("keeps the lift only on the raised surfaces on the list", () => {
    for (const d of lifted) {
      expect(LIFT_FILES.has(d.file), `${d.file} ${d.selector} uses ${d.value}`).toBe(true);
    }
  });

  it("still finds the raised surfaces, so the check can fail", () => {
    expect(lifted.some((d) => d.file === "src/components/shell/Dialog.module.css")).toBe(true);
  });
});
