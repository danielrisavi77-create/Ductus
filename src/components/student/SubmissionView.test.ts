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

import { OUTCOME_ID, SubmissionView, type SubmissionState } from "./SubmissionView";

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
const submitButton = new RegExp(`<button[^>]*>${t.submit}</button>`);

describe("SubmissionView (F-10)", () => {
  it("shows the server's text, read-only, and the submit button", () => {
    const html = render(ready());
    expect(html).toContain("Izmišljena rečenica o gradskim knjižnicama.");
    expect(html).toContain(t.textTitle);
    expect(html).toContain(t.serverNote);
    expect(html).toMatch(submitButton);
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain(t.receiptTitle);
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
    expect(html).not.toContain(t.receiptTitle);
    expect(html.toLowerCase()).not.toContain("predano");
  });

  it("without a network the button waits and says a connection is needed (#385 H7)", () => {
    const html = renderToStaticMarkup(h(SubmissionView, { state: ready(), handlers: noop, offline: true }));
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${t.submit}</button>`));
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
    expect(html).not.toContain(t.receiptTitle);
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
