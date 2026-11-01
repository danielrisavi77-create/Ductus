import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LogoutDialog from "@/components/editor/LogoutDialog";
import { messagesHr } from "@/lib/i18n/messages.hr";

// Z-08 (#923): one dialog base on the design tokens, and the sign-out
// dialog on it without a change in what it shows or how it is built.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const BASE = read("src/components/shell/Dialog.module.css");
const LOGOUT = read("src/components/editor/LogoutDialog.module.css");
const t = messagesHr.auth;

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  // A plain string search: the selector must start a line, and the line
  // before must not end in a comma (else it is the tail of a longer list).
  const head = `${selector} {`;
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    if (at === 0 || (css[at - 1] === "\n" && css[at - 2] !== ",")) {
      const start = at + head.length;
      return css.slice(start, css.indexOf("}", start));
    }
  }
  throw new Error(`no rule for ${selector}`);
}

const noop = () => {};
const plan = { pending: 3, unsaved: false, submitted: false };
const render = (failed: boolean) =>
  renderToStaticMarkup(
    createElement(LogoutDialog, { plan, working: false, failed, onConfirm: noop, onStay: noop, onExport: noop }),
  );

describe("the shared dialog base (DESIGN-SYSTEM.md §3 and §5)", () => {
  it("takes radius, border, surface, shadow and backdrop from the dialog tokens", () => {
    const dialog = rule(BASE, ".dialog");
    expect(dialog).toContain("border-radius: var(--radius-lg);");
    expect(dialog).toContain("border: 1px solid var(--raised-rule);");
    expect(dialog).toContain("background: var(--raised);");
    expect(dialog).toContain("box-shadow: var(--lift);");
    expect(rule(BASE, ".dialog::backdrop")).toContain("background: var(--scrim);");
  });

  it("keeps the measures of the design: 440 px, 80 px from the top, 16 px inside, title 14 px / 600", () => {
    const dialog = rule(BASE, ".dialog");
    expect(dialog).toContain("width: 440px;");
    expect(dialog).toContain("max-width: calc(100vw - 32px);");
    expect(dialog).toContain("margin: 80px auto auto;");
    expect(rule(BASE, ".body")).toContain("padding: 16px;");
    expect(rule(BASE, ".title")).toMatch(/font-size: 14px;\s*font-weight: 600;/);
  });

  it("gives buttons the control radius and the primary the gold with its ink", () => {
    expect(rule(BASE, ".primary,\n.secondary,\n.quiet")).toContain("border-radius: var(--radius-control);");
    const primary = rule(BASE, ".primary");
    expect(primary).toContain("background: var(--accent);");
    expect(primary).toContain("color: var(--accent-ink);");
  });

  it("marks an error with a shape in the error colours, and keeps its text in the ink", () => {
    const error = rule(BASE, ".error");
    expect(error).toContain("background: var(--error-soft);");
    expect(error).toContain("border: 1px solid var(--error);");
    expect(error).toContain("color: var(--ink);");
    const mark = rule(BASE, ".error::before");
    // The mark is decoration: its alternative text is empty, so the text alone is read.
    expect(mark).toContain('content: "!" / "";');
    expect(mark).toContain("background: var(--error);");
  });

  it("uses colours only as tokens", () => {
    for (const css of [BASE, LOGOUT]) {
      expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });
});

describe("the sign-out dialog on the base (Z-08)", () => {
  it("takes every part from the base and adds no look of its own", () => {
    const pairs: [string, string][] = [
      ["dialog", "dialog"], ["body", "body"], ["title", "title"], ["text", "text"], ["note", "note"],
      ["error", "error"], ["actions", "actions"], ["confirm", "primary"], ["secondary", "secondary"],
      ["stay", "quiet"], ["copy", "section"],
    ];
    for (const [own, base] of pairs) {
      expect(rule(LOGOUT, `.${own}`).trim()).toBe(`composes: ${base} from "../shell/Dialog.module.css";`);
    }
    expect(LOGOUT.match(/^\.[a-z]+ \{/gm)).toHaveLength(pairs.length);
  });

  it("renders the same structure: a labelled, described dialog with its title, text and three choices", () => {
    const html = render(false);
    expect(html).toMatch(/^<dialog [^>]*aria-labelledby="([^"]+)"[^>]*aria-describedby="([^"]+)"/);
    const [, title, text] = html.match(/aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/) ?? [];
    expect(html).toContain(`<h2 id="${title}"`);
    expect(html).toContain(`<p id="${text}"`);
    expect(html).toContain(`>${t.logoutTitle}</h2>`);
    expect(html).toContain(">" + t.logoutPending.few.replace("{n}", "3") + "</p>");
    expect(html).toContain(`>${t.logoutConfirm}</button>`);
    expect(html).toContain(`>${t.logoutStay}</button>`);
    // The live region is there before any failure, so a failure is announced.
    expect(html).toContain('<div role="alert"></div>');
    // Each part keeps its own class from the dialog's module, in the same order.
    expect([...html.matchAll(/class="_([a-z]+)_/g)].map((m) => m[1]))
      .toEqual(["dialog", "body", "title", "text", "note", "actions", "confirm", "stay"]);
  });

  it("shows a failed sign-out with its full text inside the live region", () => {
    const html = render(true);
    const alert = html.slice(html.indexOf('<div role="alert">'));
    expect(alert).toMatch(/^<div role="alert"><p class="_error_[^"]*">/);
    expect(alert).toContain(`">${t.logoutFailed}</p></div>`);
  });
});
