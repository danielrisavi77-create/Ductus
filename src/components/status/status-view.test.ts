import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesEn } from "@/lib/i18n/messages.en";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { PublicStatus } from "@/lib/status/public-status";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import StatusView, { statusSummary, type StatusPhase } from "./StatusView";

const t = messagesHr.statusPage;
const render = (phase: StatusPhase) => renderToStaticMarkup(h(StatusView, { phase, onRetry: () => {} }));
const status = (over: Partial<PublicStatus["components"]> = {}): PublicStatus => ({
  checkedAt: "2026-09-19T12:05:00.000Z",
  components: { writing: "radi", submission: "radi", mentorView: "radi", ...over },
});

// DAN-429: the public status panel in each phase.
describe("StatusView", () => {
  it("is busy with a status line and no retry while the first answer is awaited", () => {
    const html = render({ kind: "loading" });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(`role="status"`);
    expect(html).toContain(t.loading);
    expect(html).not.toContain(t.retry);
  });

  it("alerts and offers a retry when no answer came", () => {
    const html = render({ kind: "error" });
    expect(html).toMatch(new RegExp(`role="alert"[^>]*>${t.error}`));
    expect(html).toContain(t.retry);
    expect(html).not.toContain("aria-busy");
  });

  it("lists every part with its state word and the Zagreb time of the check", () => {
    const html = render({ kind: "filled", status: status({ submission: "ne_radi", mentorView: "nije_ukljuceno" }), stale: false });
    for (const name of ["writing", "submission", "mentorView"] as const) expect(html).toContain(t.components[name]);
    for (const word of Object.values(t.states)) expect(html).toContain(word);
    expect(html).toContain("Zadnja provjera: 19. rujna 2026. u 14:05.");
    expect(html).toContain(t.someNotWorking);
    expect(html).not.toContain(t.stale);
    expect(html).not.toContain(t.retry);
  });

  it("marks a stale answer with an alert and a retry, keeping the last states", () => {
    const html = render({ kind: "filled", status: status(), stale: true });
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain(t.stale);
    expect(html).toContain(t.retry);
    expect(html).toContain(t.states.radi);
  });

  it("carries nothing but the closed words, the time and the fixed text", () => {
    const html = render({ kind: "filled", status: status(), stale: false });
    expect(html).not.toMatch(/@|https?:|\/api\//);
  });
});

describe("statusSummary", () => {
  it.each([
    [{}, t.allWorking],
    [{ mentorView: "nije_ukljuceno" as const }, t.someNotEnabled],
    [{ writing: "ne_radi" as const, mentorView: "nije_ukljuceno" as const }, t.someNotWorking],
  ])("%j → %s", (over, text) => {
    expect(statusSummary(status(over))).toBe(text);
  });
});

describe("status page text", () => {
  const text = (html: string) => html.replace(/<[^>]*>/g, " ");
  it.each([
    { kind: "loading" },
    { kind: "error" },
    { kind: "filled", status: status({ submission: "ne_radi", mentorView: "nije_ukljuceno" }), stale: true },
  ] as StatusPhase[])("shows no forbidden term in phase %j", (phase) => {
    expect(findForbiddenTerms(text(render(phase)))).toEqual([]);
  });

  it("has no forbidden term in either catalogue", () => {
    for (const catalogue of [messagesHr.statusPage, messagesEn.statusPage]) {
      expect(findForbiddenTerms(JSON.stringify(catalogue))).toEqual([]);
    }
  });
});
