import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";

import { copyPart } from "./logout-plan";

// D-118 sign-out dialog (#476 c.6396619831 §3, U4): on a page without the
// editor the copies are named but nothing can be done with them there.
// The dialog is JSX, which the unit project does not render; its copy part
// comes from `copyPart`, and the source is checked to use only that.
const t = messagesHr.auth;

describe("copies in the sign-out dialog", () => {
  it("without the actions names the copies, keeps the note, and says nothing about actions", () => {
    expect(copyPart(2, false)).toEqual({
      text: t.logoutCopy.few.replace("{n}", "2"), note: t.logoutCopyKept, newestOnly: null, actions: false,
    });
  });

  it("with the actions is as before: the newest-only note for more than one copy", () => {
    expect(copyPart(2, true)).toEqual({
      text: t.logoutCopy.few.replace("{n}", "2"), note: t.logoutCopyKept, newestOnly: t.copyNewestOnly, actions: true,
    });
    expect(copyPart(1, true)?.newestOnly).toBeNull();
  });

  it("without copies there is no copy part", () => {
    expect(copyPart(0, true)).toBeNull();
    expect(copyPart(0, false)).toBeNull();
  });

  it("the dialog offers the copy buttons only with both actions", () => {
    const source = readFileSync(join(process.cwd(), "src/components/editor/LogoutDialog.tsx"), "utf8");
    expect(source).toContain("copyPart(copies, Boolean(onRestoreCopy && onDiscardCopy))");
    expect(source).toContain("{!copy.actions ? null : asking ? (");
    expect(source).not.toMatch(/copyText\(/);
  });
});

// F-154 (owner decision 1.3): the dialog is JSX, so its wiring is read from
// the source; the two clicks are `nextDiscardStep`, tested in logout-plan.
describe("what was written after the submission, in the sign-out dialog", () => {
  const source = readFileSync(join(process.cwd(), "src/components/editor/LogoutDialog.tsx"), "utf8");
  const local = readFileSync(join(process.cwd(), "src/components/editor/LocalDocument.tsx"), "utf8");

  it("is offered only through afterSubmissionPart with the action", () => {
    expect(source).toContain("afterSubmissionPart(plan, Boolean(onDiscardAfterSubmission))");
  });

  it("deletes only from the second click, after the question, through settleDiscard", () => {
    expect(source).toContain('if (!onDiscardAfterSubmission || afterDiscard !== "confirm") return;');
    expect(source).toContain("settleDiscard(onDiscardAfterSubmission)");
    expect(source.match(/onDiscardAfterSubmission\(/g) ?? []).toHaveLength(0);
    // The first click only asks; the confirm button exists only while asking.
    expect(source).toContain("onAsk={askAfter}");
    expect(source).toContain("onConfirm={confirmAfter}");
    expect(source).toContain("asking={askingAfter}");
  });

  it("Escape takes the question back, never deletes", () => {
    expect(source).toContain("else if (askingAfter) keepAfter();");
  });

  it("sign-out itself never deletes it: only clear() runs on sign-out, and discard checks the submission", () => {
    expect(local).toContain('if (saver.snapshot().closedBy !== "submission") throw new Error("not_submitted");');
    const start = local.indexOf("const signOut = async");
    const signOut = local.slice(start, local.indexOf("const value: LocalDocumentValue", start));
    expect(signOut.length).toBeGreaterThan(0);
    expect(signOut).not.toMatch(/discard/i);
  });
});
