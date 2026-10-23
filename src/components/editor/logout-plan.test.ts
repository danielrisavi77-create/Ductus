import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { logoutText } from "./logout-plan";

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
