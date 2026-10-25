import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import ErrorScreen from "./ErrorScreen";

const render = (onRetry?: () => void) =>
  renderToStaticMarkup(
    createElement(ErrorScreen, { title: t.errorPage.errorTitle, body: t.errorPage.errorBody, onRetry }),
  );

describe("error and not-found pages (#732 item 3)", () => {
  it("not-found has one h1, the Croatian text and a way home, no retry", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorScreen, { title: t.errorPage.notFoundTitle, body: t.errorPage.notFoundBody }),
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(t.errorPage.notFoundTitle);
    expect(html).toContain('href="/"');
    expect(html).toContain(t.auth.home);
    expect(html).not.toContain(t.auth.retry);
    expect(html).toContain('id="sadrzaj"');
  });

  it("an error offers retry and home, and announces itself", () => {
    const html = render(() => {});
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(t.auth.retry);
    expect(html).toContain(t.auth.home);
    expect(html).toContain('role="alert"');
  });

  it("uses no forbidden term", () => {
    expect(findForbiddenTerms(Object.values(t.errorPage).join(" "))).toEqual([]);
  });
});
