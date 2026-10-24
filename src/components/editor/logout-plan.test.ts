import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { copyText, logoutText, nextDiscardStep, type DiscardEvent, type DiscardStep } from "./logout-plan";

const t = messagesHr.auth;

describe("sign-out dialog text (FE-D7, D-118)", () => {
  it.each([
    [1, "1 izmjena postoji samo na ovom uređaju."],
    [2, "2 izmjene postoje samo na ovom uređaju."],
    [4, "4 izmjene postoje samo na ovom uređaju."],
    [5, "5 izmjena postoji samo na ovom uređaju."],
    [11, "11 izmjena postoji samo na ovom uređaju."],
    [21, "21 izmjena postoji samo na ovom uređaju."],
    [112, "112 izmjena postoji samo na ovom uređaju."],
  ])("names %i saved steps in agreeing Croatian", (pending, sentence) => {
    const shown = logoutText({ unsaved: false, pending });
    expect(shown.text).toBe(`${sentence} Odjava zatvara sesiju.`);
    expect(shown.note).toBe(t.logoutKept);
    expect(shown.offerExport).toBe(false);
  });

  it("shows no number when nothing is owed or the count is not known", () => {
    for (const pending of [0, null]) {
      expect(logoutText({ unsaved: false, pending })).toEqual({ text: t.logoutPlain, note: null, offerExport: false });
    }
  });

  it("says that unstored text would be lost and offers the export", () => {
    expect(logoutText({ unsaved: true, pending: null })).toEqual({ text: t.logoutUnsaved, note: null, offerExport: true });
    expect(logoutText({ unsaved: true, pending: 3 })).toMatchObject({ note: t.logoutKept, offerExport: true });
  });

  // I4: the app sends nothing yet, so the dialog speaks only of this device.
  it("never claims anything reached or will reach the server", () => {
    const texts = [t.logoutPlain, t.logoutKept, t.logoutUnsaved, ...Object.values(t.logoutPending)];
    for (const text of texts) {
      expect(text).not.toMatch(/poslužitelj|šalje|poslan|sinkron/i);
      expect(findForbiddenTerms(text), text).toEqual([]);
    }
  });
});

describe("copy kept outside the work (3d-2c, P3 and P4 a)", () => {
  it.each([
    [1, "Na ovom uređaju čuva se 1 kopija teksta koja nije u radu."],
    [2, "Na ovom uređaju čuvaju se 2 kopije teksta koje nisu u radu."],
    [4, "Na ovom uređaju čuvaju se 4 kopije teksta koje nisu u radu."],
    [5, "Na ovom uređaju čuva se 5 kopija teksta koje nisu u radu."],
    [11, "Na ovom uređaju čuva se 11 kopija teksta koje nisu u radu."],
    [21, "Na ovom uređaju čuva se 21 kopija teksta koja nije u radu."],
  ])("names %i copies in agreeing Croatian", (copies, sentence) => {
    const shown = copyText(copies);
    expect(shown?.text).toBe(sentence);
    expect(shown?.note).toBe(t.logoutCopyKept);
    expect(shown?.newestOnly).toBe(copies > 1 ? t.copyNewestOnly : null);
  });

  it("shows no copy part without a copy or with a count that is not a count", () => {
    for (const copies of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(copyText(copies)).toBeNull();
    }
  });

  // P4 (a), D-118: sign-out closes the session and never deletes the copy.
  it("says that sign-out keeps the copy, tied to the student on this device", () => {
    expect(t.logoutCopyKept).toMatch(/ne briše/);
    expect(t.logoutCopyKept).toMatch(/vezana uz tebe na ovom uređaju/);
  });

  it("never claims anything about the server and uses no forbidden term", () => {
    const texts = [
      ...Object.values(t.logoutCopy),
      t.logoutCopyKept,
      t.copyTitle,
      t.copyNewestOnly,
      t.copyRestore,
      t.copyDiscard,
      t.copyDiscardAsk,
      t.copyDiscardConfirm,
      t.copyKeep,
      t.copyDiscardFailed,
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/poslužitelj|šalje|poslan|sinkron/i);
      expect(findForbiddenTerms(text), text).toEqual([]);
    }
  });
});

describe("discarding a copy takes two clicks (P3)", () => {
  const steps: DiscardStep[] = ["idle", "confirm", "working", "failed"];
  const events: DiscardEvent[] = ["ask", "keep", "confirm", "done", "error"];
  const run = (...sequence: DiscardEvent[]) => sequence.reduce<DiscardStep>(nextDiscardStep, "idle");

  it("discards only after asking and then confirming", () => {
    expect(run("ask")).toBe("confirm");
    expect(run("ask", "confirm")).toBe("working");
    expect(run("ask", "confirm", "done")).toBe("idle");
  });

  it("never starts a discard from one click", () => {
    expect(run("confirm")).toBe("idle");
    expect(run("confirm", "confirm")).toBe("idle");
    expect(run("ask", "keep", "confirm")).toBe("idle");
  });

  it("keeps the copy on Escape or Zadrži, and after a failure asks again", () => {
    expect(run("ask", "keep")).toBe("idle");
    expect(run("ask", "confirm", "error")).toBe("failed");
    expect(run("ask", "confirm", "error", "confirm")).toBe("failed");
    expect(run("ask", "confirm", "error", "ask")).toBe("confirm");
  });

  it("reaches working only from confirm, for every step and event", () => {
    for (const from of steps) {
      for (const event of events) {
        const to = nextDiscardStep(from, event);
        expect(steps).toContain(to);
        if (to === "working" && from !== "working") {
          expect([from, event]).toEqual(["confirm", "confirm"]);
        }
      }
    }
  });

  it("ignores a second confirm or ask while the discard runs", () => {
    for (const event of ["ask", "keep", "confirm"] as const) {
      expect(nextDiscardStep("working", event)).toBe("working");
    }
  });
});
