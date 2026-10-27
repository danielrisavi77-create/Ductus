import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";

import type { LiveContext } from "./live-context";
import { LiveHeader, LiveRail } from "./LiveHeader";

// Archivum T05 (DAN-344, #923 contract 6430008106 §4 and §7). Invented
// course, assignment, name and ids.
const t = messagesHr.liveView;
const CONTEXT: LiveContext = {
  assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  course: "Izmišljeni kolegij o gradovima",
  motif: "city",
  title: "Izmišljeni zadatak o prometu",
  workType: "Seminarski rad",
  studentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  submission: null,
};
const render = (node: ReactNode) => renderToStaticMarkup(h("div", null, node));
const header = (context: LiveContext | null, name: string | null) => render(LiveHeader({ context, name }));
const h1s = (html: string) => html.match(/<h1[ >]/g)?.length ?? 0;

describe("LiveHeader (T05)", () => {
  it("names the course, the assignment and the student only from what was read", () => {
    const html = header(CONTEXT, "Ana Izmišljena");
    expect(html).toContain('data-motif="city"');
    expect(html).toContain(CONTEXT.course);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${CONTEXT.title}</h1>`));
    expect(html).toMatch(/Ana Izmišljena<\/span>.*Seminarski rad<\/span>.*Rad u nastajanju<\/span>/);
    expect(h1s(html)).toBe(1);
  });

  it("leaves out a name or a work type that did not arrive", () => {
    const html = header({ ...CONTEXT, workType: null }, null);
    expect(html).not.toContain("Seminarski rad");
    expect(html).toMatch(new RegExp(`<p class="[^"]*"><span>${t.writing}</span></p>`));
  });

  it("without a context is only the hidden \"Rad uživo\"", () => {
    const html = header(null, "Ana Izmišljena");
    expect(html).toBe(`<div><h1 class="visually-hidden">${t.context}</h1></div>`);
  });
});

describe("LiveRail (T05)", () => {
  const outline = [
    { nodeId: "n-1", level: 1 as const, text: "Uvod" },
    { nodeId: "n-2", level: 2 as const, text: "Okvir" },
  ];

  it("links back to the works of the assignment and to the headings on screen", () => {
    const html = render(LiveRail({ context: CONTEXT, outline, onPick: () => {} }));
    expect(html).toContain(`href="/nastavnik/brz-put?zadatak=${CONTEXT.assignmentId}"`);
    expect(html).toContain(t.backToWorks);
    expect(html).toContain(t.outline);
    expect(html).toContain('<li data-level="1"><a href="#naslov-n-1">Uvod</a></li>');
    expect(html).toContain('<li data-level="2"><a href="#naslov-n-2">Okvir</a></li>');
  });

  it("has no way back without a context and no outline without headings", () => {
    const html = render(LiveRail({ context: null, outline: [], onPick: () => {} }));
    expect(html).not.toContain(t.backToWorks);
    expect(html).not.toContain("<ol");
    expect(html).not.toContain(`>${t.outline}</h2>`);
  });
});

// T06 (#923 contract 6430008106 §5): "Predano" only with the live route's submitted text,
// the version and the minute only with a recorded submission.
describe("LiveHeader: the submitted revision (T06)", () => {
  const recorded = { ...CONTEXT, submission: { revision: 12, requestedMinute: "2026-10-26T15:10:00.000Z" } };
  const parts = (html: string) => [...html.matchAll(/<\/span>([^<]+)<\/span>|<span>([^<]+)<\/span>/g)].map((m) => m[1] ?? m[2]);

  it("says Predano with the recorded version and minute", () => {
    const html = render(LiveHeader({ context: recorded, name: "Ana Izmišljena", submitted: true }));
    expect(parts(html)).toEqual(["Ana Izmišljena", "Seminarski rad", t.submittedLabel, "Verzija 12", "26. listopada 2026. u 16:10"]);
    expect(html).not.toContain(t.writing);
  });

  it("says only Predano without a recorded submission", () => {
    const html = render(LiveHeader({ context: CONTEXT, name: null, submitted: true }));
    expect(parts(html)).toEqual(["Seminarski rad", t.submittedLabel]);
  });

  it("never names a version or Predano while the text is the live one", () => {
    const html = render(LiveHeader({ context: recorded, name: null, submitted: false }));
    expect(parts(html)).toEqual(["Seminarski rad", t.writing]);
    expect(html).not.toContain("Verzija");
  });
});
