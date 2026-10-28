import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";

import type { NoticeView } from "@/components/student/assignment-notice-read";
import { DEMO_ASSIGNMENT, DEMO_WORK } from "@/lib/i18n/demo-work.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { InstructionsPanel, WorkPanel, type PanelLoad, type WorkOverview } from "./SidePanels";

const t = messagesHr.workspace;

const instructions = (load: PanelLoad<NoticeView>) => renderToStaticMarkup(createElement(InstructionsPanel, { load }));
const work = (load: PanelLoad<WorkOverview>) => renderToStaticMarkup(createElement(WorkPanel, { load }));

describe("right panel states (FE-D9)", () => {
  it.each([
    ["Upute", instructions as (load: PanelLoad<never>) => string, t.instructionsEmpty],
    ["Rad", work as (load: PanelLoad<never>) => string, t.workEmpty],
  ])("%s has a loading, an error and an empty state", (_name, render, empty) => {
    const loading = render({ kind: "loading" });
    expect(loading).toContain('role="status"');
    expect(loading).toContain(t.panelLoading);

    const unavailable = render({ kind: "unavailable" });
    expect(unavailable).toContain('role="alert"');
    expect(unavailable).toContain(t.panelUnavailable);

    expect(render({ kind: "empty" })).toContain(empty);
  });
});

describe("Upute", () => {
  it("shows the task, its due time in Zagreb and only the allowed uses", () => {
    const html = instructions({ kind: "ready", value: DEMO_ASSIGNMENT });
    expect(html).toContain(DEMO_ASSIGNMENT.title);
    // 22:59 UTC on 20 November is 23:59 in Zagreb (CET), whatever the host zone.
    expect(html).toContain("Rok: 20. studenoga 2026. u 23:59");
    const tools = messagesHr.teacher.tools.purposes;
    expect(html).toContain(tools.formatting);
    expect(html).not.toContain(tools.transcription);
    expect(html).toContain(t.upute.checksNote);
  });

  it("says so when no use of tools is allowed", () => {
    const html = instructions({ kind: "ready", value: { ...DEMO_ASSIGNMENT, aiPurposes: [] } });
    expect(html).toContain(t.upute.toolsNone);
    expect(html).not.toContain("<ul");
  });

  it("renders the teacher's text as text, never as markup", () => {
    const html = instructions({
      kind: "ready",
      value: { ...DEMO_ASSIGNMENT, instructions: '<img src=x onerror="alert(1)">' },
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("shows no invented finding of the form check", () => {
    const html = instructions({ kind: "ready", value: DEMO_ASSIGNMENT });
    expect(html).toContain(t.upute.checks);
    expect(html).toContain(`<span class="soon">${t.soon}</span>`);
    expect(html).not.toContain("prikazuje se ovdje");
  });

  it("marks every placeholder with the same soon capsule and no extra sentence (#732 item 11)", () => {
    const capsule = `<span class="soon">${t.soon}</span>`;
    const upute = instructions({ kind: "ready", value: DEMO_ASSIGNMENT });
    const rad = work({ kind: "ready", value: DEMO_WORK });
    expect(upute.split(capsule).length - 1).toBe(1);
    expect(rad.split(capsule).length - 1).toBe(2);
    expect(upute).not.toContain("rail-empty");
  });
});

describe("Rad", () => {
  it("writes out every stage state and the mentor's note", () => {
    const html = work({ kind: "ready", value: DEMO_WORK });
    for (const stage of DEMO_WORK.stages) {
      expect(html).toContain(stage.name);
      expect(html).toContain(t.rad.stageState[stage.state]);
    }
    expect(html).toContain("Mentor: Dodaj radove");
    expect(html).toContain(t.rad.aiStatement);
    expect(html).toContain(t.rad.package);
  });

  it("has an empty state for a work without stages", () => {
    expect(work({ kind: "ready", value: { stages: [] } })).toContain(t.rad.stagesEmpty);
  });
});

describe("forbidden vocabulary (PRODUCT §5)", () => {
  it("keeps the panel and demo text where the forbidden-terms scan reads it", () => {
    expect(isUiTextModule("src/lib/i18n/messages.hr.ts")).toBe(true);
    expect(isUiTextModule("src/lib/i18n/demo-work.hr.ts")).toBe(true);
  });

  it("appears nowhere in the rendered demo panels", () => {
    const shown = [
      instructions({ kind: "ready", value: DEMO_ASSIGNMENT }),
      work({ kind: "ready", value: DEMO_WORK }),
    ].map((html) => html.replace(/<[^>]*>/g, " "));
    for (const text of shown) expect(findForbiddenTerms(text), text).toEqual([]);
  });
});
