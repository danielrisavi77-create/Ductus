import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { appCookie, SESSION_COOKIE, sessionRow, signIn } from "./support";

// K-4 (docs/PLAN-DEMO.md §1 and §7 t. 2, D-98): the demo walk-through as one
// test with video. It grows by one step with each task from F-6 to F-10 that
// lands; a step is added only when it can pass, never as a placeholder.
test("demo walk-through", async ({ page, context }) => {
  await test.step("1. Nastavnik se prijavljuje", async () => {
    await signIn(page, "/", "Demo nastavnik");
    await expect(page.getByRole("heading", { level: 1, name: t.app.name })).toBeVisible();

    const session = await appCookie(context, SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(await sessionRow(session!.value)).toEqual({
      institution: "demo-fakultet",
      unique_id: "demo-teacher@demo.ductus.test",
      closed_at: null,
      close_reason: null,
    });
  });
});
