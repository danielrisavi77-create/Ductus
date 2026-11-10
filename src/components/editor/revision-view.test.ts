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
import {
  RevisionList, canAnswer, displayState, limitAnswer, revisionFromOpen, sendAnswer, type RevisionListProps,
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
  t, formatDate: formatDateHr, status: "ok", requests: [], submitted: false, drafts: {}, sending: null, errors: {},
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

  it("keeps markup as plain text", () => {
    const req = request("open", [v(1, { instruction: "<img src=x onerror=alert(1)>" })]);
    const html = render({ requests: [req] });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("an explanation is cut at 2000 code points, not UTF-16 units", () => {
    expect([...limitAnswer("𝒜".repeat(2100))]).toHaveLength(2000);
  });
});

describe("sending an answer", () => {
  afterEach(() => vi.unstubAllGlobals());

  const deps = (respond = vi.fn(async () => ({ kind: "ok" as const }))) => ({
    respond, revision: vi.fn(async () => ({ kind: "ok" as const, revision: 12 })), current: () => true,
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

  it("nothing is sent once the session has ended", async () => {
    const d = { ...deps(), current: () => false };
    expect(await sendAnswer(STATES.open, "done", "Dodan izvor.", d)).toEqual({ kind: "error", error: "signedOut", reload: false });
    expect(d.revision).not.toHaveBeenCalled();
    expect(d.respond).not.toHaveBeenCalled();
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
      const shown = render({ requests: [req], errors: { [req.id]: "conflict" }, live: t.sent });
      expect(findForbiddenTerms(shown), shown).toEqual([]);
    }
    expect(findForbiddenTerms(JSON.stringify(t))).toEqual([]);
  });
});
