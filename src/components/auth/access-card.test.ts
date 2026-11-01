import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import AccessCard, { type AccessCardProps } from "./AccessCard";

const render = (props: AccessCardProps) => renderToStaticMarkup(createElement(AccessCard, props));

// DAN-378 (M1.8): Z-03, "not signed in" and Z-05.
describe("AccessCard", () => {
  it("Z-03 says the session expired and signs in again back to the page", () => {
    const html = render({ kind: "expired", returnTo: "/nastavnik", what: "courses" });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(t.access.expiredTitle);
    expect(html).toContain('role="status"');
    expect(html).toContain('href="/api/auth/login?returnTo=%2Fnastavnik"');
    expect(html).toContain(t.prijava.button);
  });

  it("without a session it says so, never that a session expired (#1234)", () => {
    const html = render({ kind: "signedOut", returnTo: "/nastavnik/brz-put?zadatak=x", what: "fastPath" });
    expect(html).toContain(t.access.signedOutTitle);
    expect(html).toContain(t.access.signedOutBody.replace("{what}", t.access.what.fastPath));
    expect(html).not.toContain("istek");
    expect(html).toContain('href="/api/auth/login?returnTo=%2Fnastavnik%2Fbrz-put%3Fzadatak%3Dx"');
  });

  it("an unsafe page to come back to falls back to the home page", () => {
    const html = render({ kind: "expired", returnTo: "//example.test", what: "home" });
    expect(html).toContain('href="/api/auth/login?returnTo=%2F"');
  });

  it("Z-05 offers no new sign-in and names nothing of the page asked for (#1233)", () => {
    const html = render({ kind: "denied", returnTo: "/nastavnik/brz-put?zadatak=x", what: "fastPath" });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(t.access.deniedTitle);
    expect(html).toContain(t.access.deniedPending);
    expect(html).not.toContain("/api/auth/login");
    expect(html).not.toContain(t.prijava.button);
    expect(html).not.toContain("zadatak");
    expect(html).toContain('href="/"');
    expect(html).toContain(t.access.backToOwn);
  });

  it("uses no forbidden term", () => {
    const { what, ...rest } = t.access;
    expect(findForbiddenTerms([...Object.values(rest), ...Object.values(what)].join(" "))).toEqual([]);
  });
});
