import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LiveView } from "@/client/live-reader";
import type { CanonicalDocument, NodeId } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";

import type { TextRange } from "./comment-place";
import { INITIAL_LIVE_VIEW, LiveChip, LiveDocument, LiveNote } from "./live-text";

// #732 item 7 (contract 6396547184 §6 unit 2 and 3): the student's "Kako
// vidi nastavnik" and the teacher's view draw the text through one function,
// so for the same state the markup is the same (PRODUCT §5 rule 5). The
// document is invented.

const t = messagesHr.liveView;
const HEADING = "3b0f6c1e-8a4d-4f2b-9c7e-1d2a3b4c5d6e" as NodeId;
const PARAGRAPH = "5d2e7f80-1a2b-4c3d-9e4f-5a6b7c8d9e0f" as NodeId;
const SENTENCE = "Gradske knjižnice su mjesto susreta.";

const document = {
  nodes: [
    { type: "heading", level: 1, id: HEADING, children: [{ type: "text", text: "Uvod", marks: [] }] },
    { type: "paragraph", id: PARAGRAPH, children: [{ type: "text", text: SENTENCE, marks: ["bold"] }] },
  ],
} as unknown as CanonicalDocument;

const shown: LiveView = { document, hash: "a".repeat(64), empty: false, connection: "live" };
const QUOTE = "mjesto susreta";
const marks: TextRange[] = [{ nodeId: PARAGRAPH, start: SENTENCE.indexOf(QUOTE), end: SENTENCE.indexOf(QUOTE) + QUOTE.length }];

const region = (view: LiveView, onSelect?: () => void) =>
  renderToStaticMarkup(h(LiveDocument, { view, marks, onSelect }));
const note = (view: LiveView) => renderToStaticMarkup(h(LiveNote, { view }));

describe("LiveDocument", () => {
  it("is the same markup with and without the teacher's selection handler", () => {
    const teacher = region(shown, () => {});
    const student = region(shown);
    expect(student).toBe(teacher);
    expect(student).toContain('role="document"');
    expect(student).toContain(`aria-label="${t.documentLabel}"`);
    expect(student).toMatch(/<h2 data-node-id="[^"]+"><span>Uvod<\/span><\/h2>/);
    expect(student).toMatch(/<mark class="[^"]*"><strong>mjesto susreta<\/strong><\/mark>/);
    expect(student).not.toContain("contenteditable");
  });

  it("shows loading, nothing yet, a signed-out and a foreign work without text or note", () => {
    const cases: [LiveView, string][] = [
      [INITIAL_LIVE_VIEW, t.loading],
      [{ ...INITIAL_LIVE_VIEW, empty: true, connection: "live" }, t.empty],
      [{ ...shown, connection: "signedOut" }, t.connection.signedOut],
      [{ ...shown, connection: "notFound" }, t.connection.notFound],
    ];
    for (const [view, line] of cases) {
      const markup = region(view);
      expect(markup).toContain(line);
      expect(markup).not.toContain(SENTENCE.slice(0, 14));
      expect(note(view)).toBe("");
    }
    expect(region(INITIAL_LIVE_VIEW)).toContain('aria-busy="true"');
  });

  it("keeps the last accepted text while the connection retries, with the note", () => {
    const retrying: LiveView = { ...shown, connection: "retrying" };
    expect(region(retrying)).toContain("mjesto susreta");
    expect(note(retrying)).toContain(t.note);
    expect(renderToStaticMarkup(h(LiveChip, { view: retrying }))).toContain(t.connection.retrying);
  });
});

describe("the teacher's view draws its text only through LiveText", () => {
  const source = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

  it("LiveWorkView renders LiveText and no text of its own", () => {
    const view = source("./LiveWorkView.tsx");
    expect(view).toMatch(/<LiveText /);
    expect(view).not.toMatch(/role="document"|blockSegments|<SheetFrame/);
  });

  it("the student's view uses the same LiveText, summary card and limits", () => {
    const sheet = source("../student/TeacherViewSheet.tsx");
    expect(sheet).toMatch(/import LiveText, \{ useLiveMarks, useLiveView \} from "@\/components\/teacher\/LiveText"/);
    expect(sheet).toMatch(/<SummaryCard /);
    expect(sheet).toMatch(/<RecordLimits \/>/);
    expect(sheet).not.toMatch(/role="document"|blockSegments|onSelect/);
  });
});
