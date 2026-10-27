import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { scanUiText } from "../../../scripts/forbidden-terms/scan";
import { notificationMessages as t } from "./messages";
import { emptyNotificationState, notificationHref, visibleNotifications, type NotificationItem, type NotificationRead } from "./notification-list";
import NotificationList from "./NotificationList";

// Synthetic values are confined to tests; the component supplies no data.
const items: readonly NotificationItem[] = [
  { id: "one", kind: "comment", title: "Novi komentar", context: "Izmišljeni kolegij", time: "Prije 5 minuta", unread: true, action: { href: "/rad/one", label: "Otvori komentar" } },
  { id: "two", kind: "version", title: "Nove upute", time: "Jučer", unread: false, action: { href: "/zadatak/two", label: "Pročitaj upute" } },
];

function render(read: NotificationRead, audience: "student" | "teacher" = "student") {
  return renderToStaticMarkup(createElement(NotificationList, { read, audience }));
}

describe("DAN-305 notification view", () => {
  it("renders only supplied items and uses a text label as well as a dot for unread", () => {
    const html = render({ kind: "ready", items, complete: true });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(t.studentLead);
    expect(html).toContain("Novi komentar");
    expect(html).toContain("Izmišljeni kolegij");
    expect(html).toContain('href="/rad/one"');
    expect(html).toContain('href="/zadatak/two"');
    expect(html.match(/>Novo</g)).toHaveLength(1);
    expect(html).not.toContain("Označi sve kao pročitano");
  });

  it("does not treat an unavailable or loading read as an empty inbox", () => {
    const unavailable = render({ kind: "unavailable" }, "teacher");
    expect(unavailable).toContain('role="alert"');
    expect(unavailable).toContain(t.teacherLead);
    expect(unavailable).toContain(t.unavailableTitle);
    expect(unavailable).not.toContain(t.emptyTitle);
    expect(unavailable).not.toContain("Novi komentar");
    expect(unavailable).not.toContain('aria-pressed=');
    expect(unavailable).not.toContain(t.retry);
    expect(render({ kind: "unavailable", retryHref: "/obavijesti" })).toContain('href="/obavijesti"');
    expect(render({ kind: "unavailable", retryHref: "//example.invalid" })).not.toContain('href=');

    const loading = render({ kind: "loading" });
    expect(loading).toContain('role="status"');
    expect(loading).toContain(t.loadingTitle);
    expect(loading).not.toContain(t.emptyTitle);
    expect(loading).not.toContain("Novi komentar");
  });

  it("distinguishes a complete empty inbox from a partial empty page", () => {
    const complete = render({ kind: "ready", items: [], complete: true });
    expect(complete).toContain(t.emptyTitle);
    expect(complete).not.toContain(t.partialEmptyTitle);

    const partial = render({ kind: "ready", items: [], complete: false });
    expect(partial).toContain(t.partialEmptyTitle);
    expect(partial).not.toContain(t.emptyTitle);
  });

  it("filters without mutating read status or asserting that a partial page is complete", () => {
    expect(visibleNotifications(items, "unread")).toEqual([items[0]]);
    expect(items[0].unread).toBe(true);
    const readOnly = [items[1]];
    expect(emptyNotificationState(readOnly, true, "unread")).toBe("noUnread");
    expect(emptyNotificationState(readOnly, false, "unread")).toBe("partialUnread");
    expect(emptyNotificationState([], true, "unread")).toBe("empty");
    expect(emptyNotificationState(items, false, "unread")).toBeNull();
  });

  it("does not render an external or malformed action as an application link", () => {
    for (const href of ["https://example.invalid", "//example.invalid", "/\\example.invalid", "javascript:alert(1)", "/rad\n/one"]) {
      expect(notificationHref(href)).toBeNull();
      const html = render({ kind: "ready", items: [{ ...items[0], action: { href, label: "Otvori" } }], complete: true });
      expect(html).not.toContain('href=');
    }
    expect(notificationHref("/rad/one?izvor=obavijesti")).toBe("/rad/one?izvor=obavijesti");
  });

  it("keeps supplied titles as text and its own interface wording within the dictionary", () => {
    const html = render({ kind: "ready", items: [{ ...items[0], title: "<script>demo</script>" }], complete: true });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;demo&lt;/script&gt;");
    expect(findForbiddenTerms(JSON.stringify(t))).toEqual([]);
  });

  it("the project scanner reads this messages module and catches a forbidden value", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ductus-notification-copy-"));
    try {
      const directory = path.join(root, "src/components/notifications");
      mkdirSync(directory, { recursive: true });
      const file = path.join(directory, "messages.ts");
      const copy = readFileSync(path.join(process.cwd(), "src/components/notifications/messages.ts"), "utf8");
      writeFileSync(file, copy);
      expect(scanUiText(root)).toEqual([]);
      writeFileSync(file, `${copy}\nexport const probe = "sumnjivo";\n`);
      expect(scanUiText(root).some((finding) => finding.file.endsWith("src/components/notifications/messages.ts"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
