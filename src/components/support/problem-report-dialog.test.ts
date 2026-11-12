import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PROBLEM_REPORT_DESCRIPTION_MAX, PROBLEM_REPORT_HOURLY_LIMIT } from "@/domain/support/problem-report";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import ProblemReport, { ProblemReportDialog, checkMessage, endedAfter, endedFrom, endedMessage, stepAfter } from "./ProblemReport";
import type { FailureReason } from "./problem-report-client";

// DAN-431: what the dialog shows for each answer and each description class,
// and where the shell offers it. The failures name what happened and what to
// do, in plain words, without a status code or a technical term.
const t = messagesHr.support;
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const REASONS: FailureReason[] = ["network", "timeout", "signedOut", "tooLarge", "invalid", "tooMany", "unavailable", "unknown"];
const TECHNICAL = /\b(?:HTTP|JSON|API|status|server|request|payload|\d{3})\b|poslužitelj|zahtjev|kod greške/i;

describe("failure messages", () => {
  it.each(REASONS)("%s reads as plain Croatian with a next step", (reason) => {
    const step = stepAfter({ kind: "failed", reason });
    expect(step).toMatchObject({ kind: "failed", message: t.failure[reason] });
    if (step.kind !== "failed") return;
    expect(step.message).not.toMatch(TECHNICAL);
    expect(step.message).toMatch(/pokušajte ponovno|pošaljite/i);
    expect(findForbiddenTerms(step.message)).toEqual([]);
  });

  // A timeout or an unconfirmed answer may still have been recorded, so the
  // lead must not say the report was not sent (Grok review, #1967).
  it.each(["timeout", "unknown"] as const)("%s does not claim the report was not sent", (reason) => {
    const step = stepAfter({ kind: "failed", reason });
    expect(step).toMatchObject({ kind: "failed", lead: t.keptLead });
    if (step.kind !== "failed") return;
    expect(`${step.lead} ${step.message}`).not.toMatch(/nije poslana/);
  });

  it.each(["network", "signedOut", "tooLarge", "invalid", "tooMany", "unavailable"] as const)(
    "%s says the report was not sent",
    (reason) => {
      expect(stepAfter({ kind: "failed", reason })).toMatchObject({ lead: t.failedLead });
      expect(t.failedLead).toMatch(/nije poslana/);
    },
  );

  it("shows the lead the step carries", () => {
    expect(read("src/components/support/ProblemReport.tsx")).toContain("{step.lead} {step.message}");
  });

  it("names the hourly limit for 429 and asks to shorten for 413", () => {
    // The text names the limit in words, so it is tied to the domain constant.
    expect(PROBLEM_REPORT_HOURLY_LIMIT).toBe(5);
    expect(stepAfter({ kind: "failed", reason: "tooMany" })).toMatchObject({ message: expect.stringContaining("pet prijava") });
    expect(stepAfter({ kind: "failed", reason: "tooLarge" })).toMatchObject({ message: expect.stringContaining("Skratite") });
  });

  // Codex, #1967: once the session ends, the dialog says so and keeps nothing.
  it("an ended session reads in plain words and keeps no description", () => {
    expect(stepAfter({ kind: "ended" })).toEqual({ kind: "ended", delivery: "notSent" });
    expect(t.ended).toMatch(/nije poslan/);
    expect(t.ended).toMatch(/uklonjen/);
    expect(t.ended).not.toMatch(TECHNICAL);
    expect(findForbiddenTerms(t.ended)).toEqual([]);
  });

  // Grok review, #1967: a report that left before the session ended must not
  // read as not sent, or the person sends it twice; a reference stays shown.
  it("a session that ends after the report left does not say it was not sent", () => {
    expect(endedAfter({ kind: "sent", reference: "PR-0123456789" })).toEqual({ kind: "ended", delivery: "received", reference: "PR-0123456789" });
    expect(endedAfter({ kind: "failed", reason: "timeout" })).toEqual({ kind: "ended", delivery: "maybe" });
    expect(endedAfter({ kind: "failed", reason: "unknown" })).toEqual({ kind: "ended", delivery: "maybe" });
    expect(endedAfter({ kind: "failed", reason: "invalid" })).toEqual({ kind: "ended", delivery: "notSent" });
    expect(endedAfter({ kind: "ended" })).toEqual({ kind: "ended", delivery: "notSent" });

    expect(endedFrom({ kind: "sending" })).toEqual({ kind: "ended", delivery: "maybe" });
    expect(endedFrom(stepAfter({ kind: "failed", reason: "timeout" }))).toEqual({ kind: "ended", delivery: "maybe" });
    expect(endedFrom(stepAfter({ kind: "failed", reason: "tooMany" }))).toEqual({ kind: "ended", delivery: "notSent" });
    expect(endedFrom({ kind: "editing" })).toEqual({ kind: "ended", delivery: "notSent" });
    expect(endedFrom({ kind: "sent", reference: "PR-0123456789" })).toEqual({ kind: "sent", reference: "PR-0123456789" });

    const maybe = endedMessage({ delivery: "maybe" });
    const received = endedMessage({ delivery: "received", reference: "PR-0123456789" });
    expect(endedMessage({ delivery: "notSent" })).toBe(t.ended);
    expect(received).toContain("PR-0123456789");
    for (const text of [maybe, received]) {
      expect(text).not.toMatch(/nije poslan/);
      expect(text).toMatch(/uklonjen/);
      expect(text).not.toMatch(TECHNICAL);
      expect(findForbiddenTerms(text)).toEqual([]);
    }
    expect(maybe).toMatch(/možda/);
  });

  it("shows the reference after a sent report", () => {
    expect(stepAfter({ kind: "sent", reference: "PR-0123456789" })).toEqual({ kind: "sent", reference: "PR-0123456789" });
  });
});

describe("description check messages", () => {
  it("says nothing for a description that can go", () => {
    expect(checkMessage("ok", 10)).toBeNull();
  });

  it("gives the length and the limit for one that is too long", () => {
    expect(checkMessage("tooLong", 1001)).toBe(
      t.check.tooLong.replace("{n}", "1001").replace("{max}", String(PROBLEM_REPORT_DESCRIPTION_MAX)),
    );
  });

  it.each(["empty", "invalid"] as const)("%s has its own text", (check) => {
    expect(checkMessage(check, 0)).toBe(t.check[check]);
  });
});

describe("the dialog markup", () => {
  const html = renderToStaticMarkup(createElement(ProblemReportDialog, { session: null, onClose: () => {} }));

  it("is a dialog named by its heading", () => {
    const id = /<h2[^>]*id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${id}"`);
    expect(html).toContain(`>${t.title}</h2>`);
  });

  it("groups the categories under a legend, the first one chosen", () => {
    expect(html).toContain(`<legend`);
    expect(html).toContain(t.categoryLegend);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    const technical = /<input[^>]*value="technical"[^>]*>/.exec(html)?.[0] ?? "";
    expect(technical).toContain('checked=""');
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });

  it("labels the description field and ties the counter to it", () => {
    const field = /<textarea[^>]*>/.exec(html)?.[0] ?? "";
    const id = /id="([^"]+)"/.exec(field)?.[1];
    expect(html).toContain(`for="${id}"`);
    const hint = /aria-describedby="([^"]+)"/.exec(field)?.[1];
    expect(html).toContain(`id="${hint}"`);
    expect(html).toContain(t.counter.replace("{n}", "0").replace("{max}", String(PROBLEM_REPORT_DESCRIPTION_MAX)));
    expect(field).toContain('aria-invalid="false"');
  });

  it("asks for no name and lists what goes with the description", () => {
    expect(html).not.toMatch(/name="(?:ime|name|email|jmbag)"/i);
    for (const text of [t.attachedPage, t.attachedBrowser, t.noContent]) expect(html).toContain(text);
  });

  it("has a send button and a close button, nothing busy yet", () => {
    expect(html).toContain(`type="submit"`);
    expect(html).toContain(`>${t.send}</button>`);
    expect(html).toContain(`>${t.close}</button>`);
    expect(html).toContain('aria-busy="false"');
  });
});

describe("the opener", () => {
  it("is one button that announces a dialog, with the dialog closed", () => {
    const html = renderToStaticMarkup(createElement(ProblemReport, { buttonClassName: "x", session: null }));
    expect(html).toBe(`<button type="button" class="x" aria-haspopup="dialog">${t.open}</button>`);
  });

  it("is in the shell for every signed-in person, also beside a page's own sign-out", () => {
    const shell = read("src/components/shell/AppShell.tsx");
    expect(shell).toMatch(/offersProblemReport\(scope\) \? <ProblemReport /);
    expect(shell).not.toMatch(/place === "signOut" \? <ProblemReport /);
  });

  // Codex, #1967: the dialog follows the session the page was rendered under,
  // as every other part that sends this person's data (D-118).
  it("gets the shell's session and checks it right before sending", () => {
    const shell = read("src/components/shell/AppShell.tsx");
    expect(shell).toMatch(/<ProblemReport [^>]*session=\{session\.tag === null \? null : \{ tag: session\.tag, at: session\.at \}\}/);
    const dialog = read("src/components/support/ProblemReport.tsx");
    expect(dialog).toMatch(/<ProblemReportDialog session=\{session\}/);
    expect(dialog).toMatch(/watchSessionEnd\(tag === null \? null : \{ tag, at \}/);
    expect(dialog).toMatch(/const current = useCallback\(\(\) => !\(watchRef\.current\?\.ended\(\) \?\? false\), \[\]\)/);
    expect(dialog).toMatch(/void send\(body, current\)/);
    expect(dialog).toMatch(/sendProblemReport\(body, undefined, undefined, stillCurrent\)/);
    expect(dialog).toMatch(/setStep\(stillCurrent\(\) \? stepAfter\(outcome\) : endedAfter\(outcome\)\)/);
    expect(dialog).toMatch(/setDescription\(""\);\s*setStep\(endedFrom\);/);
    expect(dialog).toMatch(/\{endedMessage\(step\)\}/);
  });

  it("opens the dialog in <body>, so a hidden side bar does not hide it", () => {
    const opener = read("src/components/support/ProblemReport.tsx");
    expect(opener).toMatch(/open \? createPortal\(<ProblemReportDialog [^]*?, document\.body\)/);
  });
});
