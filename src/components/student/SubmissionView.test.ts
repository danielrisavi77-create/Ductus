import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RECEIPT } from "@/client/submission.fixture";
import type { SubmitOutcome } from "@/client/submission";
import { ProcessSummaryView } from "@/components/summary/ProcessSummaryView";
import { SummaryCardBody } from "@/components/teacher/SummaryCard";
import { validateDocument, type CanonicalDocument } from "@/domain/document";
import type { ProcessSummaryV1 } from "@/domain/projection/process-summary";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { NO_CONTEXT, OUTCOME_ID, SubmissionFrame, SubmissionView, type SubmissionContext, type SubmissionState } from "./SubmissionView";

// F-10 (#476 contract 6384297464, QA criteria 3, 4, 5 and 8). Invented text only.
const t = messagesHr.submission;
const noop = { onSubmit: () => {}, onReload: () => {}, onReloadSummary: () => {} };

function doc(text: string): CanonicalDocument {
  const result = validateDocument({
    schemaVersion: 1,
    nodes: [
      { id: "11111111-1111-4111-8111-111111111111", type: "heading", level: 1, children: [{ type: "text", text: "Uvod", marks: [] }] },
      { id: "22222222-2222-4222-8222-222222222222", type: "paragraph", children: [{ type: "text", text, marks: [] }] },
    ],
  });
  if (!result.ok) throw new Error("invalid synthetic document");
  return result.doc;
}

const SUMMARY: ProcessSummaryV1 = {
  summaryFormat: "ductus-process-summary-v1",
  sessions: { evidenceKind: "observed", breakAboveMinutes: 30, count: 1, items: [{ from: "2026-10-19T08:00:00.000Z", to: "2026-10-19T08:41:00.000Z" }] },
  pastes: { evidenceKind: "observed", listedAboveCharacters: 200, listed: [], smallerCount: 0 },
  gaps: { evidenceKind: "observed", items: [] },
  recordState: "complete",
};

function ready(overrides: Partial<Extract<SubmissionState, { phase: "ready" }>> = {}): SubmissionState {
  return {
    phase: "ready", document: doc("Izmišljena rečenica o gradskim knjižnicama."), revision: 7,
    sending: false, outcome: null, summary: { kind: "ok", summary: SUMMARY }, ...overrides,
  };
}

const render = (state: SubmissionState) => renderToStaticMarkup(h(SubmissionView, { state, handlers: noop }));
const ARROW = `(<span aria-hidden="true" class="[^"]*">→</span>)?`;
const submitButton = new RegExp(`<button[^>]*>${t.submit}${ARROW}</button>`);

describe("SubmissionView (F-10)", () => {
  it("shows the server's text, read-only, and the submit button", () => {
    const html = render(ready());
    expect(html).toContain("Izmišljena rečenica o gradskim knjižnicama.");
    expect(html).toContain(t.textTitle);
    expect(html).toContain(t.serverNote);
    expect(html).toMatch(submitButton);
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain(`>${t.receiptTitle}</h2>`);
  });

  it("shows consecutive bullet items as one list, never as a heading (E1, #823)", () => {
    const item = (n: number, text: string) =>
      ({ id: `3333333${n}-3333-4333-8333-333333333333`, type: "bulletItem", children: [{ type: "text", text, marks: [] }] });
    const result = validateDocument({
      schemaVersion: 1,
      nodes: [
        item(1, "Prva stavka"), item(2, "Druga stavka"),
        { id: "44444444-4444-4444-8444-444444444444", type: "paragraph", children: [{ type: "text", text: "Odlomak", marks: [] }] },
        item(3, "Treća stavka"),
      ],
    });
    if (!result.ok) throw new Error("invalid synthetic document");
    const html = render(ready({ document: result.doc }));
    expect(html).toContain("<ul><li><span>Prva stavka</span></li><li><span>Druga stavka</span></li></ul><p><span>Odlomak</span></p>" +
      "<ul><li><span>Treća stavka</span></li></ul>");
    expect(html).not.toMatch(/<h[2-4]>/);
  });

  it("shows consecutive quote paragraphs as one block quote, never as a heading (E1, #823)", () => {
    const block = (n: number, type: string, text: string) =>
      ({ id: `6666666${n}-6666-4666-8666-666666666666`, type, children: [{ type: "text", text, marks: [] }] });
    const result = validateDocument({
      schemaVersion: 1,
      nodes: [block(1, "quote", "Navod"), block(2, "quote", "Nastavak"), block(3, "paragraph", "Odlomak"), block(4, "bulletItem", "Stavka")],
    });
    if (!result.ok) throw new Error("invalid synthetic document");
    const html = render(ready({ document: result.doc }));
    expect(html).toContain("<blockquote><p><span>Navod</span></p><p><span>Nastavak</span></p></blockquote><p><span>Odlomak</span></p>" +
      "<ul><li><span>Stavka</span></li></ul>");
    expect(html).not.toMatch(/<h[2-4]>/);
  });

  it("with revision 0 says there is no text on the server and offers no button (criterion 4)", () => {
    const html = render(ready({ revision: 0 }));
    expect(html).toContain(t.noEvidence);
    expect(html).not.toContain(t.submit);
  });

  it("disables the button while a submission is in flight (criterion 2)", () => {
    const html = render(ready({ sending: true }));
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${t.sending}</button>`));
  });

  it("shows the receipt after a submission, never claiming a checked signature", () => {
    const html = render(ready({ outcome: { kind: "submitted", receipt: RECEIPT } }));
    expect(html).toContain(t.receiptTitle);
    expect(html).toContain(RECEIPT.payload.artifactSha256);
    expect(html).toContain(t.records.continuous);
    expect(html).toContain(t.receiptNote);
    expect(html).not.toContain(t.afterDeadline);
    expect(html).not.toMatch(submitButton);
    expect(html.toLowerCase()).not.toMatch(/provjeren|verific/);
    const late = render(ready({ outcome: { kind: "submitted", receipt: { ...RECEIPT, payload: { ...RECEIPT.payload, afterDeadline: true, evidenceRecord: "with_gaps" } } } }));
    expect(late).toContain(t.afterDeadline);
    expect(late).toContain(t.records.with_gaps);
  });

  const refusals: [SubmitOutcome, string][] = [
    [{ kind: "noEvidence" }, t.noEvidence],
    [{ kind: "recordMismatch" }, t.outcome.recordMismatch],
    [{ kind: "blocked" }, t.outcome.blocked],
    [{ kind: "staleRevision" }, t.outcome.staleRevision],
    [{ kind: "alreadyRequested" }, t.outcome.alreadyRequested],
    [{ kind: "notOpen" }, t.outcome.notOpen],
    [{ kind: "notFound" }, t.outcome.notFound],
    [{ kind: "signedOut" }, t.outcome.signedOut],
    [{ kind: "unavailable" }, t.outcome.unavailable],
  ];
  it.each(refusals)("shows %j with its own text and no receipt (criteria 3 and 8)", (outcome, text) => {
    const html = render(ready({ outcome }));
    expect(html).toContain(text);
    expect(html).not.toContain(`>${t.receiptTitle}</h2>`);
    expect(html.toLowerCase()).not.toContain("predano");
    // DAN-344 S06: no "Rad je predan." and no step 3 without a receipt (QA (a)).
    expect(html).not.toContain(t.doneHeading);
    expect(html).not.toContain(t.submittedNote);
    expect(html).toMatch(new RegExp(`<li aria-current="step">[^]*?${t.steps.check}</span></li>`));
  });

  it("without a network the button waits and says a connection is needed (#385 H7)", () => {
    const html = renderToStaticMarkup(h(SubmissionView, { state: ready(), handlers: noop, offline: true }));
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${t.submit}${ARROW}</button>`));
    expect(html).toContain(t.offline);
    expect(render(ready())).not.toContain(t.offline);
  });

  it("puts every outcome in one focusable element for the focus move (#385 H8)", () => {
    for (const outcome of [{ kind: "submitted", receipt: RECEIPT }, { kind: "recordMismatch" }] as SubmitOutcome[]) {
      expect(render(ready({ outcome }))).toMatch(new RegExp(`id="${OUTCOME_ID}" tabindex="-1"`));
    }
  });

  it("offers a reload after a newer revision on the server", () => {
    expect(render(ready({ outcome: { kind: "staleRevision" } }))).toContain(`>${t.reload}</button>`);
  });

  it.each(["signedOut", "notFound", "unavailable", "unreadable"] as const)("closed %s shows no text of the work", (reason) => {
    const html = render({ phase: "closed", reason });
    expect(html).toContain(reason === "unreadable" ? t.unreadable : reason === "unavailable" ? t.openUnavailable : t.outcome[reason]);
    expect(html).not.toContain(t.submit);
    expect(html).not.toContain(`>${t.receiptTitle}</h2>`);
  });

  // Codex 4367324506: without a receipt the server may have recorded the
  // submission (signing after the record, or a lost answer), so neither the
  // answer nor a failed open says whether the submission was recorded.
  it("never says whether the submission was recorded when no receipt came back", () => {
    for (const html of [render(ready({ outcome: { kind: "unavailable" } })), render({ phase: "closed", reason: "unavailable" })]) {
      expect(html).not.toMatch(/zabilježen/i);
      expect(html).not.toMatch(/predaja nije/i);
    }
  });

  it("draws the same summary region the teacher gets for the same answer (criterion 5)", () => {
    const html = render(ready());
    const teacher = renderToStaticMarkup(h(SummaryCardBody, { outcome: { kind: "ok", summary: SUMMARY }, onReload: () => {} }));
    expect(html).toContain(teacher);
    expect(html).toContain(renderToStaticMarkup(h(ProcessSummaryView, { summary: SUMMARY })));
  });
});

// DAN-344 Archivum S05 and S06 (#923 contract 6430008106 §3 and §7). Invented
// course and assignment; the facts come only from the page's own read.
describe("SubmissionView: Archivum S05 and S06 (DAN-344)", () => {
  const CONTEXT: SubmissionContext = {
    course: "Izmišljeni kolegij o gradovima",
    title: "Izmišljeni zadatak o knjižnicama",
    dueAt: "2026-11-30T22:59:00.000Z",
    motif: "research",
    workHref: "/rad?zadatak=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  const draw = (state: SubmissionState, context: SubmissionContext = CONTEXT) =>
    renderToStaticMarkup(h(SubmissionView, { state, handlers: noop, context }));
  const current = (html: string) => html.match(/<li aria-current="step">[^]*?<span>([^<]*)<\/span><\/li>/)?.[1];
  const h1s = (html: string) => html.match(/<h1[ >]/g)?.length ?? 0;
  const submitted = ready({ outcome: { kind: "submitted", receipt: RECEIPT } });

  it("S05 names the course, the assignment, the revision and the deadline from the read", () => {
    const html = draw(ready());
    expect(html).toMatch(new RegExp(`<h1[^>]*>${t.reviewHeading}</h1>`));
    expect(html).toContain(CONTEXT.course);
    expect(html).toContain(CONTEXT.title);
    expect(html).toContain('data-motif="research"');
    expect(html).toContain("<dt>Verzija teksta na poslužitelju</dt><dd>7</dd>");
    expect(html).toContain("30. studenoga 2026. u 23:59");
    expect(html).toContain(t.unsentNote);
    expect(html).toContain(t.readOnly);
    expect(html).toContain(t.receiptPending);
    expect(html).toContain(`href="${CONTEXT.workHref!.replace(/&/g, "&amp;")}"`);
    expect(html).toContain(t.backToEditor);
    expect(current(html)).toBe(t.steps.check);
    expect(h1s(html)).toBe(1);
  });

  it("S05 without a read shows no course, title, deadline, motif or way back", () => {
    const html = draw(ready(), NO_CONTEXT);
    expect(html).not.toContain(t.courseLabel);
    expect(html).not.toContain("data-motif");
    expect(html).not.toContain(t.dueAt);
    expect(html).not.toContain(t.backToWork);
    expect(html).not.toContain(t.backToEditor);
    expect(html).not.toContain("sheet-runhead");
    expect(html).toMatch(submitButton);
  });

  it("step 2 is current only while the submission is in flight", () => {
    expect(current(draw(ready({ sending: true })))).toBe(t.steps.submit);
    expect(current(draw(ready({ revision: 0 })))).toBe(t.steps.check);
  });

  it("S06 comes only with the receipt: its heading, step 3, the folded hash and text, and the way to /zadaci", () => {
    const html = draw(submitted);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${t.doneHeading}</h1>`));
    expect(html).toContain(t.receiptLead);
    expect(current(html)).toBe(t.steps.receipt);
    expect(html).toMatch(new RegExp(`<summary>${t.hashShow}</summary><code[^>]*>${RECEIPT.payload.artifactSha256}</code>`));
    expect(html).toContain(`<dt>${t.receiptRevision}</dt><dd>${RECEIPT.payload.revision}</dd>`);
    expect(html).toContain(t.receiptDueAt);
    expect(html).toContain(t.submittedTextShow);
    expect(html).toContain("Izmišljena rečenica o gradskim knjižnicama.");
    expect(html).toContain('href="/zadaci"');
    expect(html).toContain(t.submittedNote);
    expect(html).not.toContain(t.reviewHeading);
    expect(html).not.toMatch(submitButton);
    expect(h1s(html)).toBe(1);
  });

  it.each([
    ["loading", { phase: "loading" } as SubmissionState],
    ["closed", { phase: "closed", reason: "unavailable" } as SubmissionState],
  ])("%s has the review heading and no steps", (_, state) => {
    const html = draw(state);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${t.reviewHeading}</h1>`));
    expect(html).not.toContain(t.steps.receipt);
    expect(html).not.toContain(t.doneHeading);
    expect(h1s(html)).toBe(1);
  });

  it("the page's own frame never claims a submission", () => {
    const html = renderToStaticMarkup(h(SubmissionFrame, { context: CONTEXT }, h("p", null, "x")));
    expect(html).toMatch(new RegExp(`<h1[^>]*>${t.reviewHeading}</h1>`));
    expect(html).not.toContain(t.doneHeading);
    expect(html).not.toContain(t.receiptLead);
  });

  it("carries no text of the prototype", () => {
    for (const html of [draw(ready()), draw(submitted)]) {
      expect(html).not.toMatch(/Vizualni prijedlog|ogledni/i);
    }
  });
});
