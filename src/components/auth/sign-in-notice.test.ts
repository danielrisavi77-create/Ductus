import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { signInNotice } from "./sign-in-notice";
import SignInScreen, { type SignInScreenProps } from "./SignInScreen";

const HREF = "/api/auth/login?returnTo=%2F";
const render = (props: SignInScreenProps) => renderToStaticMarkup(createElement(SignInScreen, props));

// S-01 states of /prijava (DAN-566 reference, prijava.html states 1 to 4).
describe("signInNotice", () => {
  it("reads the closed list of ?stanje= values", () => {
    expect(signInNotice("greska")).toBe("failed");
    expect(signInNotice("nedostupno")).toBe("unavailable");
    expect(signInNotice("bez-uloge")).toBe("noRole");
  });

  it.each([undefined, "", "GRESKA", " greska", "greska ", "bez_uloge", "failed", "__proto__", "constructor", "<b>x</b>"])(
    "any other value %j is the plain sign-in",
    (raw) => {
      expect(signInNotice(raw)).toBeNull();
    },
  );

  it("a repeated query, which Next.js hands over as an array, is the plain sign-in", () => {
    expect(signInNotice(["greska", "nedostupno"])).toBeNull();
    expect(signInNotice(["greska"])).toBeNull();
  });
});

describe("SignInScreen states", () => {
  it("without a state shows the sign-in card and an empty redirect status", () => {
    const html = render({ href: HREF });
    expect(html).toContain(t.prijava.cardBody);
    expect(html).toContain(`href="${HREF}"`);
    expect(html).toMatch(/<div class="[^"]*" role="status"><\/div>/);
    expect(html).not.toContain(t.prijava.redirecting);
    expect(html).not.toContain('role="alert"');
  });

  it("a failed sign-in says so and offers the same login route again and the home page", () => {
    const html = render({ href: HREF, notice: "failed" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(t.auth.failedTitle);
    expect(html).toContain(t.auth.failedBody);
    expect(html).toContain(t.auth.retry);
    expect(html).toContain(`href="${HREF}"`);
    expect(html).toContain(t.auth.home);
    expect(html).not.toContain(t.prijava.cardBody);
  });

  it("an unanswering AAI@EduHr gets its own text, a retry and no other way in (D-09)", () => {
    const html = render({ href: HREF, notice: "unavailable" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(t.auth.unavailableBody);
    expect(html).not.toContain(t.auth.failedBody);
    expect(html).toContain(t.auth.retry);
    expect(html.match(/href="\/api\/auth\/login/g)).toHaveLength(1);
    expect(html).not.toContain("<input");
  });

  it("a person without a role reads who assigns it and is offered no new sign-in", () => {
    const html = render({ href: HREF, notice: "noRole" });
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain(t.prijava.noRoleTitle);
    expect(html).toContain(t.prijava.noRoleBody);
    expect(html).toContain(t.prijava.noRoleAssign);
    expect(html).toContain(t.access.deniedNext);
    expect(html).not.toContain("/api/auth/login");
    expect(html).not.toContain(t.auth.retry);
  });

  it("the new texts use no forbidden term", () => {
    const { redirecting, noRoleTitle, noRoleBody, noRoleAssign } = t.prijava;
    expect(findForbiddenTerms([redirecting, noRoleTitle, noRoleBody, noRoleAssign].join(" "))).toEqual([]);
  });
});
