import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import RouteLoading from "./RouteLoading";

const ROUTES = ["rad", "rad/[assignmentId]/predaja", "nastavnik", "nastavnik/brz-put", "upis"];

describe("route loading (#732 item 4)", () => {
  it("announces the wait in the page's main, without a session mark", () => {
    const html = renderToStaticMarkup(
      createElement(RouteLoading, { label: t.fastPath.loading }),
    );
    expect(html).toContain('id="sadrzaj"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(new RegExp(`<p role="status">${t.fastPath.loading}</p>`));
    expect(html).not.toContain("<h1");
  });

  it.each(ROUTES)("app/%s has a loading.tsx under the plain header", (route) => {
    const file = join(process.cwd(), "app", route, "loading.tsx");
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/<AppHeader\s/);
    expect(source).toMatch(/<RouteLoading\s/);
    expect(source).not.toMatch(/AppShell|SessionObserver/);
  });
});
