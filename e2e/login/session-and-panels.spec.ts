import { expect, test, type Page } from "@playwright/test";

import { DEMO_WORK } from "../../src/lib/i18n/demo-work.hr";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// F-113 t.1 and F-110 t.1. Every test runs in a fresh browser context; the
// accounts are the invented demo accounts of the fake provider, the text is
// invented.

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const phaseOf = (page: Page) => page.locator(".editor-surface");

test("a sign-in that returns to a plain screen ends the earlier person's writing tab (F-113 t.1)", async ({ page, context }) => {
  await signIn(page, "/rad");
  const editor = editorOf(page);
  // The first visit of /rad in a run compiles the page on `next dev` (#431).
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("Nacrt C: zelena mapa");
  await expect(page.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");

  // Another person signs in at this browser and lands on the enrolment page,
  // which has no editor of its own.
  await context.clearCookies({ name: /^_session/ });
  const second = await context.newPage();
  await signIn(second, "/upis", "Demo student 2");

  await expect(phaseOf(page)).toHaveAttribute("data-phase", "signed-out");
  await expect(editor).toHaveText("");
  await expect(editor).toHaveAttribute("contenteditable", "false");
});

test("a signed-in person sees the empty Upute and Rad, never the invented ones (F-110 t.1)", async ({ page }) => {
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
  const panel = page.getByRole("complementary", { name: "Upute, literatura i komentari" });
  const list = panel.getByRole("tablist", { name: "Bočni panel" });

  await list.getByRole("tab", { name: t.workspace.tabWork }).click();
  await expect(panel.getByRole("tabpanel")).toHaveText(t.workspace.workEmpty);
  await expect(panel).not.toContainText(DEMO_WORK.stages[0]!.name);

  await list.getByRole("tab", { name: t.workspace.tabInstructions }).click();
  await expect(panel.getByRole("tabpanel")).toHaveText(t.workspace.instructionsEmpty);
});
