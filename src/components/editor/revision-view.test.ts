import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenOutcome } from "@/client/evidence-ingest";
import { respondRevisionRequest, type RevisionRequest, type RevisionVersion } from "@/client/revision-requests";
import type { NodeId } from "@/domain/document/schema";
import { formatDateHr } from "@/lib/i18n/hr";
import { messagesEn } from "@/lib/i18n/messages.en";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { unconfirmedOf } from "./document-saver";
import {
  RevisionList, answerText, canAnswer, clearSent, displayState, isLive, limitAnswer, revisionFromOpen, sendAnswer,
  type RevisionListProps,
} from "./revision-view";

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
  t, formatDate: formatDateHr, status: "ok", requests: [], submitted: false, unconfirmed: false, drafts: {}, sending: null, errors: {},
  live: "", onDraft: () => {}, onAnswer: () => {}, onRetry: () => {}, ...extra,
});
const render = (extra: Partial<RevisionListProps> = {}) => renderToStaticMarkup(createElement(RevisionList, props(extra)));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("every state of a request (N-08 states 6 to 10)", () => {
  it.each(Object.entries(STATES))("%s: its chip, and a form only while the student can answer", (name, req) => {
    expect(displayState(req)).toBe(name);
    const html = render({ requests: [req] });
    expect(html).toContain(`data-state="${name}"`);
    expect(html).toContain(`>${t.state[name as keyof typeof t.state]}<`);
    expect(html).toContain(`„${anchor.quote}”`);
    expect(html).toContain(req.versions[0]!.instruction);
    const answerable = name === "open" || name === "reopened";
    expect(canAnswer(req)).toBe(answerable);
    expect(html.includes("<textarea")).toBe(answerable);
    expect(html.includes(t.done)).toBe(answerable);
    expect(html.includes(t.declined)).toBe(answerable);
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

  it("a read list can be read again, but not while an answer is on its way", () => {
    const button = (html: string) => html.match(new RegExp(`<button[^>]*>${t.refresh}</button>`))?.[0];
    const onRetry = vi.fn();
    expect(button(render({ requests: [] }))).toBeDefined();
    expect(button(render({ requests: [STATES.open] }))).not.toContain("disabled");
    expect(button(render({ requests: [STATES.open], sending: STATES.open.id }))).toContain('disabled=""');
    for (const status of ["loading", "signedOut", "forbidden", "unavailable"] as const) {
      expect(render({ status, requests: [STATES.open] })).not.toContain(t.refresh);
    }
    const element = RevisionList(props({ requests: [STATES.open], onRetry })) as { props: { children: unknown[] } };
    const refresh = element.props.children.find((child) =>
      (child as { props?: { children?: unknown } } | null)?.props?.children === t.refresh) as { props: { onClick: () => void } };
    refresh.props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("after submission no form is shown, and the panel says why", () => {
    const html = render({ requests: [STATES.open], submitted: true });
    expect(html).not.toContain("<textarea");
    expect(html).toContain(t.submittedNote);
  });

  it("buttons stay off until the explanation is text the route accepts", () => {
    const off = render({ requests: [STATES.open], drafts: { [STATES.open.id]: "   " } });
    expect(off.match(/disabled=""/g)).toHaveLength(2);
    const on = render({ requests: [STATES.open], drafts: { [STATES.open.id]: "Dodan izvor." } });
    expect(on).not.toContain('disabled=""');
  });

  it("the explanation is read-only while it is on its way", () => {
    const field = (html: string) => html.match(/<textarea[^>]*>/)?.[0];
    const drafts = { [STATES.open.id]: "Dodan izvor." };
    expect(field(render({ requests: [STATES.open], drafts, sending: STATES.open.id }))).toMatch(/readonly=""/i);
    expect(field(render({ requests: [STATES.open], drafts }))).not.toMatch(/readonly/i);
  });

  it("a sent answer clears only the explanation that was sent", () => {
    const id = STATES.open.id;
    expect(clearSent({ [id]: "Dodan izvor.", b: "x" }, id, "Dodan izvor.")).toEqual({ b: "x" });
    expect(clearSent({ [id]: "Dodan izvor i stranica." }, id, "Dodan izvor.")).toEqual({ [id]: "Dodan izvor i stranica." });
  });

  it("an explanation that could not be sent stays readable once the request is closed", () => {
    const html = render({
      requests: [STATES.withdrawn], drafts: { [STATES.withdrawn.id]: "Ne slažem se." }, errors: { [STATES.withdrawn.id]: "conflict" },
    });
    expect(html).toContain(t.keptLabel);
    expect(html).toContain(t.keptHint);
    expect(html.match(/<textarea[^>]*>/)?.[0]).toMatch(/readonly=""/i);
    expect(html).toContain("Ne slažem se.");
    expect(html).not.toContain(t.done);
    expect(render({ requests: [STATES.withdrawn] })).not.toContain("<textarea");
    expect(render({ requests: [STATES.open], drafts: { [STATES.open.id]: "x" } })).not.toContain(t.keptLabel);
  });

  it("keeps markup as plain text", () => {
    const req = request("open", [v(1, { instruction: "<img src=x onerror=alert(1)>" })]);
    const html = render({ requests: [req] });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("an explanation is cut at 2000 code points, not UTF-16 units", () => {
    expect([...limitAnswer("𝒜".repeat(2100))]).toHaveLength(2000);
  });

  it("the cut counts after NFC, as the route counts: a field that fits can always be sent", () => {
    // U+0958 is one code point that NFC turns into two; 1500 of them are 3000 after NFC.
    const cut = limitAnswer("\u0958".repeat(1500));
    expect([...cut.normalize("NFC")].length).toBeLessThanOrEqual(2000);
    expect(answerText(cut)).not.toBeNull();
    expect(limitAnswer("Dodan izvor.")).toBe("Dodan izvor.");
  });

  it("while the text holds changes the server has not confirmed, the buttons wait and say why (DAN-314)", () => {
    const drafts = { [STATES.open.id]: "Dodan izvor." };
    const waiting = render({ requests: [STATES.open], drafts, unconfirmed: true });
    expect(waiting.match(/<button type="button" class="[^"]*" disabled=""/g)).toHaveLength(2);
    expect(waiting).toContain(t.unconfirmedNote);
    expect(waiting).toContain(`aria-describedby="revision-${STATES.open.id}-hint revision-${STATES.open.id}-wait"`);
    expect(waiting).not.toMatch(/<textarea[^>]*readonly/i);
    const ready = render({ requests: [STATES.open], drafts });
    expect(ready).not.toContain("disabled");
    expect(ready).not.toContain(t.unconfirmedNote);
  });
});

describe("sending an answer", () => {
  afterEach(() => vi.unstubAllGlobals());

  const deps = (respond = vi.fn(async () => ({ kind: "ok" as const }))) => ({
    respond, revision: vi.fn(async () => ({ kind: "ok" as const, revision: 12 })), current: () => true,
    unconfirmed: vi.fn(() => false),
  });

  it("carries the counter list returned and the revision open read, in NFC", async () => {
    const d = deps();
    expect(await sendAnswer(STATES.open, "done", "Café dodan.", d)).toEqual({ kind: "sent" });
    expect(d.respond).toHaveBeenCalledTimes(1);
    expect(d.respond.mock.calls[0]).toEqual([
      { requestId: STATES.open.id, expectedSeq: 3, kind: "done", explanation: "Café dodan.", responseRevision: 12 },
      d.current,
    ]);
  });

  it("Istodobnost: a 409 is shown with a reload of the list and is never sent again", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ outcome: "conflict", row_seq: 5, version: 2, state: "reopened" }), { status: 409 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const d = { ...deps(), respond: respondRevisionRequest };
    expect(await sendAnswer(STATES.reopened, "declined", "Ne slažem se.", d))
      .toEqual({ kind: "error", error: "conflict", reload: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const html = render({
      requests: [STATES.reopened], drafts: { [STATES.reopened.id]: "Ne slažem se." }, errors: { [STATES.reopened.id]: "conflict" },
    });
    expect(html).toContain(t.errors.conflict);
    expect(html).toContain("Ne slažem se.");
  });

  it("nothing is sent for a request the student can no longer answer, or text the route refuses", async () => {
    const d = deps();
    expect(await sendAnswer(STATES.done, "done", "Opet.", d)).toMatchObject({ error: "invalid" });
    expect(await sendAnswer(STATES.open, "done", " \n ", d)).toMatchObject({ error: "invalid" });
    expect(d.revision).not.toHaveBeenCalled();
    expect(d.respond).not.toHaveBeenCalled();
  });

  it("nothing is sent while the text holds changes the server has not confirmed (DAN-314)", async () => {
    const d = { ...deps(), unconfirmed: vi.fn(() => true) };
    expect(await sendAnswer(STATES.open, "done", "Dodan izvor.", d)).toEqual({ kind: "error", error: "unconfirmed", reload: false });
    expect(d.revision).not.toHaveBeenCalled();
    expect(d.respond).not.toHaveBeenCalled();
    expect(render({ requests: [STATES.open], errors: { [STATES.open.id]: "unconfirmed" } })).toContain(t.errors.unconfirmed);
  });

  it("Istodobnost: a change typed while the revision is read is not answered on that revision", async () => {
    const d = deps();
    d.revision.mockImplementationOnce(async () => {
      d.unconfirmed.mockReturnValue(true);
      return { kind: "ok" as const, revision: 12 };
    });
    expect(await sendAnswer(STATES.open, "done", "Dodan izvor.", d)).toEqual({ kind: "error", error: "unconfirmed", reload: false });
    expect(d.respond).not.toHaveBeenCalled();
  });

  it.each([
    ["loading", null, false, true],
    ["ready, nothing confirmed yet", undefined, false, true],
    ["ready, the editor holds invalid text", false, true, true],
    ["ready, changes on the device", true, false, true],
    ["ready, every change confirmed", false, false, false],
  ] as const)("the gate of the answer buttons: %s", (phase, flag, invalid, expected) => {
    const snapshot = flag === null ? null : ({ unconfirmed: flag } as Parameters<typeof unconfirmedOf>[1]);
    expect(unconfirmedOf(phase.startsWith("ready") ? "ready" : "loading", snapshot, invalid)).toBe(expected);
  });

  it("nothing is sent once the session has ended", async () => {
    const d = { ...deps(), current: () => false };
    expect(await sendAnswer(STATES.open, "done", "Dodan izvor.", d)).toEqual({ kind: "error", error: "signedOut", reload: false });
    expect(d.revision).not.toHaveBeenCalled();
    expect(d.respond).not.toHaveBeenCalled();
  });

  it("nothing is sent when the session or the panel ends while the revision is read", async () => {
    const d = { ...deps(), current: vi.fn(() => true) };
    d.revision.mockImplementationOnce(async () => {
      d.current.mockReturnValue(false);
      return { kind: "ok" as const, revision: 12 };
    });
    expect(await sendAnswer(STATES.open, "done", "Dodan izvor.", d)).toEqual({ kind: "error", error: "signedOut", reload: false });
    expect(d.respond).not.toHaveBeenCalled();
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

  it("a submitted work is not answered", async () => {
    const d = { ...deps(), revision: vi.fn(async () => ({ kind: "submitted" as const })) };
    expect(await sendAnswer(STATES.open, "done", "Dodan izvor.", d)).toMatchObject({ error: "submitted" });
    expect(d.respond).not.toHaveBeenCalled();
    expect(render({ requests: [STATES.open], errors: { [STATES.open.id]: "submitted" } })).toContain(t.submittedNote);
  });

  it.each([
    [{ status: "unauthenticated" }, { kind: "signedOut" }],
    [{ status: "not_found" }, { kind: "unavailable" }],
    [{ status: "not_accepting" }, { kind: "unavailable" }],
    [{ status: "unavailable" }, { kind: "unavailable" }],
  ])("the revision of an answer from open %j", (outcome, expected) => {
    expect(revisionFromOpen(outcome as OpenOutcome)).toEqual(expected);
  });

  it("the revision of an answer is the current one of an open, unsubmitted work", () => {
    const work = { currentRevision: 12, submitted: false } as Extract<OpenOutcome, { status: "opened" }>["work"];
    expect(revisionFromOpen({ status: "opened", work })).toEqual({ kind: "ok", revision: 12 });
    expect(revisionFromOpen({ status: "opened", work: { ...work, submitted: true } })).toEqual({ kind: "submitted" });
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
      const shown = render({ requests: [req], drafts: { [req.id]: "Dodan izvor." }, errors: { [req.id]: "conflict" }, live: t.sent });
      expect(findForbiddenTerms(shown), shown).toEqual([]);
    }
    expect(findForbiddenTerms(JSON.stringify(t))).toEqual([]);
  });
});
