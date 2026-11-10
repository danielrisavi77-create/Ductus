import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RevisionRequest, RevisionVersion } from "@/client/revision-requests";
import type { NodeId } from "@/domain/document/schema";
import { formatDateHr } from "@/lib/i18n/hr";
import { messagesEn } from "@/lib/i18n/messages.en";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { RevisionList, displayState, isLive, type RevisionListProps } from "./revision-view";

const t = messagesHr.revisions;
const W = "2026-11-14T10:05:00.000Z";
const anchor = {
  nodeId: "0f8e2a64-1b3c-4d5e-8f60-718293a4b5c6" as NodeId, quote: "pješačkih putovanja", prefix: "Udio ", suffix: " u",
  startHint: 5, endHint: 24,
};
const v = (version: number, extra: Partial<RevisionVersion> = {}): RevisionVersion => ({
  version, instruction: version === 1 ? "Dopunite odlomak izvorom za navedeni udio." : "Navedite stranicu izvora.",
  requestedRevision: 4, openedIsOwn: false, openedWindow: W, response: null, closed: null, ...extra,
});
const response = (kind: "done" | "declined") => ({
  kind, explanation: kind === "done" ? "Dodan izvor uz udio." : "Udio se odnosi na primjer iz uvoda.",
  revision: 9, isOwn: true, window: W,
});
const closed = (as: "accepted" | "reopened" | "withdrawn") => ({
  as, isOwn: false, window: W, acceptedRevision: as === "accepted" ? 9 : null,
});
const request = (state: RevisionRequest["state"], versions: RevisionVersion[], extra: Partial<RevisionRequest> = {}): RevisionRequest => ({
  id: "aaaaaaaa-0000-4000-8000-000000000001", number: 1, state, rowSeq: 3, anchor, versions, ...extra,
});

const STATES = {
  open: request("open", [v(1)]),
  done: request("responded", [v(1, { response: response("done") })]),
  declined: request("responded", [v(1, { response: response("declined") })]),
  accepted: request("accepted", [v(1, { response: response("done"), closed: closed("accepted") })]),
  reopened: request("reopened", [v(1, { response: response("done"), closed: closed("reopened") }), v(2)]),
  withdrawn: request("withdrawn", [v(1, { closed: closed("withdrawn") })]),
} as const;

const props = (extra: Partial<RevisionListProps> = {}): RevisionListProps => ({
  t, formatDate: formatDateHr, status: "ok", requests: [], onRetry: () => {}, ...extra,
});
const render = (extra: Partial<RevisionListProps> = {}) => renderToStaticMarkup(createElement(RevisionList, props(extra)));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("every state of a request (N-08 states 6 to 10)", () => {
  it.each(Object.entries(STATES))("%s: its chip and its instruction, read only", (name, req) => {
    expect(displayState(req)).toBe(name);
    const html = render({ requests: [req] });
    expect(html).toContain(`data-state="${name}"`);
    expect(html).toContain(`>${t.state[name as keyof typeof t.state]}<`);
    expect(html).toContain(`„${anchor.quote}”`);
    expect(html).toContain(req.versions[0]!.instruction);
    // This step only shows the requests: no field and no answer button in any state.
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<form");
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("responded and declined show the student's own words, never a verdict", () => {
    expect(text(render({ requests: [STATES.done] }))).toContain(`${t.own}: Dodan izvor uz udio.`);
    expect(text(render({ requests: [STATES.declined] }))).toContain(`${t.own}: Udio se odnosi na primjer iz uvoda.`);
  });

  it("reopened shows the teacher's new instruction under the first one", () => {
    expect(text(render({ requests: [STATES.reopened] }))).toContain(`${t.teacher}: Navedite stranicu izvora.`);
  });

  it("an earlier answer stays beside its version, and every instruction stays in order (#1506 D1)", () => {
    const third = request("reopened", [
      v(1, { response: response("done"), closed: closed("reopened") }),
      v(2, { instruction: "Navedite stranicu izvora.", response: response("declined"), closed: closed("reopened") }),
      v(3, { instruction: "Dodajte godinu izdanja." }),
    ]);
    const shown = text(render({ requests: [third] }));
    const order = [
      "Dopunite odlomak izvorom za navedeni udio.", `${t.own}: Dodan izvor uz udio.`,
      `${t.teacher}: Navedite stranicu izvora.`, `${t.own}: Udio se odnosi na primjer iz uvoda.`,
      `${t.teacher}: Dodajte godinu izdanja.`,
    ].map((part) => shown.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text(render({ requests: [STATES.reopened] }))).toContain(`${t.own}: Dodan izvor uz udio.`);
  });

  it("accepted and withdrawn say when the request was closed, with one period after the year", () => {
    const accepted = text(render({ requests: [STATES.accepted] }));
    expect(accepted).toContain("Prihvaćeno 14. studenoga 2026. Zahtjev je zatvoren.");
    expect(text(render({ requests: [STATES.withdrawn] }))).toContain("Povučeno 14. studenoga 2026. Zahtjev je zatvoren.");
    expect(accepted).not.toContain("2026..");
  });

  it("the empty state, the loading state and the read error with a retry", () => {
    expect(render({ requests: [] })).toContain(t.empty);
    expect(render({ status: "loading" })).toContain(t.loading);
    const failed = render({ status: "unavailable" });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain(t.unavailable);
    expect(failed).toContain(t.retry);
    expect(render({ status: "forbidden" })).toContain(t.notAvailable);
    expect(render({ status: "signedOut", requests: [STATES.open] })).not.toContain("<article");
  });

  it("a read list can be read again", () => {
    const button = (html: string) => html.match(new RegExp(`<button[^>]*>${t.refresh}</button>`))?.[0];
    const onRetry = vi.fn();
    expect(button(render({ requests: [] }))).toBeDefined();
    expect(button(render({ requests: [STATES.open] }))).not.toContain("disabled");
    for (const status of ["loading", "signedOut", "forbidden", "unavailable"] as const) {
      expect(render({ status, requests: [STATES.open] })).not.toContain(t.refresh);
    }
    const element = RevisionList(props({ requests: [STATES.open], onRetry })) as { props: { children: unknown[] } };
    const refresh = element.props.children.find((child) =>
      (child as { props?: { children?: unknown } } | null)?.props?.children === t.refresh) as { props: { onClick: () => void } };
    refresh.props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps markup as plain text", () => {
    const req = request("open", [v(1, { instruction: "<img src=x onerror=alert(1)>" })]);
    const html = render({ requests: [req] });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("an unmounted panel is not live, though its watch is gone", () => {
    const refs = (mounted: boolean, stopped = false, ended: boolean | null = false) => ({
      mounted: { current: mounted }, stopped: { current: stopped },
      watch: { current: ended === null ? null : { ended: () => ended } },
    });
    expect(isLive(refs(true))).toBe(true);
    expect(isLive(refs(false, false, null))).toBe(false);
    expect(isLive(refs(true, true))).toBe(false);
    expect(isLive(refs(true, false, true))).toBe(false);
  });
});

describe("language", () => {
  it("renders in English from the same props", () => {
    const html = render({ t: messagesEn.revisions, requests: [STATES.accepted], formatDate: () => "14 November 2026" });
    expect(text(html)).toContain("Accepted 14 November 2026. The request is closed.");
    expect(html).toContain(messagesEn.revisions.state.accepted);
  });

  it("the scanner reads both catalogues, and no forbidden term is shown", () => {
    expect(isUiTextModule("src/lib/i18n/messages.hr.ts")).toBe(true);
    expect(isUiTextModule("src/lib/i18n/messages.en.ts")).toBe(true);
    for (const req of Object.values(STATES)) {
      const shown = render({ requests: [req] });
      expect(findForbiddenTerms(shown), shown).toEqual([]);
    }
    expect(findForbiddenTerms(JSON.stringify(t))).toEqual([]);
  });
});