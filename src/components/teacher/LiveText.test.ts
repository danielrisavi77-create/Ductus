import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LiveView } from "@/client/live-reader";
import type { CanonicalDocument, NodeId } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";

import type { TextRange } from "./comment-place";
import LiveText, { liveStopped, openMarks } from "./LiveText";
import type { PlacedThread } from "./TeacherComments";

// #732 item 7: the teacher and the student draw the live text through this one
// component (PRODUCT §5 rule 5). Every text and id below is invented.
// SheetFrame is JSX, which this test environment does not parse; its own
// markup (the theme switch and the article) is the same for both sides.
vi.mock("@/components/shell/SheetFrame", async () => {
  const { createElement } = await import("react");
  return { default: ({ children }: { children: unknown }) => createElement("article", { className: "sheet" }, children as never) };
});

const P1 = "0f8e2a64-1b3c-4d5e-8f60-718293a4b5c6" as NodeId;
const H1 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" as NodeId;
const DOC: CanonicalDocument = {
  schemaVersion: 1,
  nodes: [
    { type: "heading", level: 1, id: H1, children: [{ type: "text", text: "Izmišljeni naslov", marks: [] }] },
    { type: "paragraph", id: P1, children: [{ type: "text", text: "Gradske knjižnice su mjesto susreta.", marks: ["italic"] }] },
  ],
} as CanonicalDocument;
const SHOWN: LiveView = { document: DOC, hash: "a".repeat(64), empty: false, connection: "live" };
const MARK: TextRange = { nodeId: P1, start: 8, end: 17 };
const t = messagesHr.liveView;

const render = (props: Parameters<typeof LiveText>[0]) => renderToStaticMarkup(h(LiveText, props));
/** The `role="document"` region alone: the part both sides must share byte for byte. */
const region = (html: string) => html.match(/<div[^>]*role="document"[\s\S]*?<\/article>/)![0];

describe("LiveText", () => {
  it("draws the same markup with or without the teacher's selection handler and ref", () => {
    const teacher = render({ view: SHOWN, marks: [MARK], textRef: { current: null }, onSelect: () => {} });
    const student = render({ view: SHOWN, marks: [MARK] });
    expect(student).toBe(teacher);
    expect(student).toContain("<mark");
    expect(student).toContain(t.note);
  });

  it("draws consecutive bullet items as one list between the other blocks (E1)", () => {
    const B1 = "2b3c4d5e-6f70-4a8b-9cad-1e2f3a4b5c6d" as NodeId;
    const B2 = "3c4d5e6f-7081-4b9c-8dbe-2f3a4b5c6d7e" as NodeId;
    const item = (id: NodeId, text: string) => ({ type: "bulletItem", id, children: [{ type: "text", text, marks: [] }] });
    const document = { ...DOC, nodes: [DOC.nodes[0], item(B1, "Prva izmišljena stavka"), item(B2, "Druga izmišljena stavka"), DOC.nodes[1]] } as CanonicalDocument;
    const html = render({ view: { ...SHOWN, document }, marks: [] });
    expect(html).toContain(`<ul><li data-node-id="${B1}"><span>Prva izmišljena stavka</span></li><li data-node-id="${B2}">`);
    expect(html.match(/<ul>/g)).toHaveLength(1);
    expect(html.indexOf("<ul>")).toBeLessThan(html.indexOf(`<p data-node-id="${P1}">`));
  });

  it("draws a heading above the text region and leaves the region itself unchanged", () => {
    const heading = h("h1", { className: "manuscript manuscript__title" }, "Izmišljeni rad");
    const withHeading = render({ view: SHOWN, marks: [MARK], heading });
    const without = render({ view: SHOWN, marks: [MARK] });
    expect(region(withHeading)).toBe(region(without));
    expect(withHeading.indexOf("<h1")).toBeLessThan(withHeading.indexOf('role="document"'));
    expect(withHeading.indexOf("<h1")).toBeGreaterThan(withHeading.indexOf("<article"));
    // The work's own level 1 heading stays an h2 under the page's h1.
    expect(without).toContain(`<h2 data-node-id="${H1}">`);
  });

  it("draws consecutive bullet items as one list (E1) and keeps marks inside an item", () => {
    const B1 = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d" as NodeId;
    const B2 = "3c4d5e6f-7081-4b9c-8d1e-2f3a4b5c6d7e" as NodeId;
    const doc = {
      schemaVersion: 1,
      nodes: [
        ...DOC.nodes,
        { type: "bulletItem", id: B1, children: [{ type: "text", text: "Prva izmišljena stavka", marks: [] }] },
        { type: "bulletItem", id: B2, children: [{ type: "text", text: "Druga izmišljena stavka", marks: [] }] },
      ],
    } as CanonicalDocument;
    const html = render({ view: { ...SHOWN, document: doc }, marks: [{ nodeId: B2, start: 0, end: 5 }] });
    expect(html.match(/<ul>/g)).toHaveLength(1);
    expect(html).toContain(`<ul><li data-node-id="${B1}">`);
    expect(html).toContain(`<li data-node-id="${B2}"><mark`);
  });

  it.each<[string, LiveView, string]>([
    ["loading", { document: null, hash: null, empty: false, connection: "loading" }, t.loading],
    ["empty", { document: null, hash: null, empty: true, connection: "live" }, t.empty],
    ["signed out", { ...SHOWN, connection: "signedOut" }, t.connection.signedOut],
    ["not found", { ...SHOWN, connection: "notFound" }, t.connection.notFound],
  ])("draws no text and no note when %s", (_name, view, placeholder) => {
    const html = render({ view, marks: [MARK] });
    expect(html).not.toContain("data-node-id");
    expect(html).not.toContain(t.note);
    expect(html).toContain(placeholder);
  });

  it("stops only once the session ended or the work is not this account's", () => {
    expect(liveStopped({ ...SHOWN, connection: "retrying" })).toBe(false);
    expect(liveStopped({ ...SHOWN, connection: "paused" })).toBe(false);
    expect(liveStopped({ ...SHOWN, connection: "signedOut" })).toBe(true);
    expect(liveStopped({ ...SHOWN, connection: "notFound" })).toBe(true);
  });
});

describe("openMarks", () => {
  const placed = (id: string, state: "open" | "answered" | "resolved", range: TextRange | null): PlacedThread => ({
    thread: { id, number: 1, state, anchor: null, comments: [] }, range, pending: false,
  });

  it("marks every placed thread that is not resolved", () => {
    const other: TextRange = { nodeId: P1, start: 0, end: 7 };
    expect(openMarks([
      placed("a", "open", MARK),
      placed("b", "answered", other),
      placed("c", "resolved", MARK),
      placed("d", "open", null),
    ])).toEqual([MARK, other]);
  });
});

describe("one place draws the live text", () => {
  const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it.each(["./LiveWorkView.tsx", "../student/TeacherViewSheet.tsx"])("%s draws it only through LiveText", (path) => {
    const code = source(path);
    expect(code).toMatch(/import LiveText, \{[^}]*useLiveView[^}]*\} from "[^"]*LiveText"/);
    expect(code).toContain("<LiveText ");
    expect(code).not.toContain('role="document"');
    expect(code).not.toContain("blockSegments(");
    expect(code).not.toContain("startLiveReader(");
  });
});
