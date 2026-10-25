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
