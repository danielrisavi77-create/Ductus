import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProcessSummaryView } from "@/components/summary/ProcessSummaryView";
import type { ProcessSummaryV1 } from "@/domain/projection/process-summary";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { SummaryCardBody } from "./SummaryCard";

// An invented summary: one session, one listed paste, no gaps.
const SUMMARY: ProcessSummaryV1 = {
  summaryFormat: "ductus-process-summary-v1",
  sessions: {
    evidenceKind: "observed",
    breakAboveMinutes: 30,
    count: 1,
    items: [{ from: "2026-10-19T08:00:00.000Z", to: "2026-10-19T08:41:00.000Z" }],
  },
  pastes: {
    evidenceKind: "observed",
    listedAboveCharacters: 200,
    listed: [{ at: { from: "2026-10-19T08:10:00.000Z", to: "2026-10-19T08:11:00.000Z" }, characters: 412, origin: "not_observed" }],
    smallerCount: 2,
  },
  gaps: { evidenceKind: "observed", items: [] },
  recordState: "complete",
};

const noop = () => {};
const t = messagesHr.summaryCard;

describe("SummaryCardBody", () => {
  it("draws the summary as exactly the markup every reader gets, with only the refresh button outside it", () => {
    const card = renderToStaticMarkup(h(SummaryCardBody, { outcome: { kind: "ok", summary: SUMMARY }, onReload: noop }));
    const shared = renderToStaticMarkup(h(ProcessSummaryView, { summary: SUMMARY }));
    expect(card).toMatch(/^<div class="[^"]+">/);
    const inner = card.replace(/^<div class="[^"]+">/, "").replace(/<\/div>$/, "");
    expect(inner).toBe(`${shared}<button type="button" class="${inner.match(/<button type="button" class="([^"]+)"/)![1]}">${t.refresh}</button>`);
  });

  it.each([
    [null, t.loading],
    [{ kind: "signedOut" as const }, t.signedOut],
    [{ kind: "notFound" as const }, t.notFound],
    [{ kind: "unavailable" as const }, t.unavailable],
  ])("shows only a state line for %j, never a summary", (outcome, line) => {
    const card = renderToStaticMarkup(h(SummaryCardBody, { outcome, onReload: noop }));
    expect(card).toContain(`role="status">${line}</p>`);
    expect(card).toContain(`>${messagesHr.summary.title}</h2>`);
    expect(card).not.toContain(messagesHr.summary.sameForEveryone);
    expect(card).toContain(`>${t.refresh}</button>`);
  });
});
