import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import pg from "pg";

import { AI_PURPOSES } from "../../src/components/teacher/assignment-create";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";
import { localAdminUrl } from "./local-db-url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TEACHER = "demo-teacher@demo.ductus.test";
const tools = t.teacher.tools;

// DAN-345 (demo dry run of 26 Oct 2026): the teacher's assignment form had an
// empty "Nije dopušteno" list in the page structure when every purpose was
// allowed. No list on the form or in its preview is ever empty.
test("the assignment form shows no empty tools list, all allowed or none", async ({ page }) => {
  const db = new pg.Client({ connectionString: localAdminUrl() });
  await db.connect();
  let grantedHere = false;
  try {
    await signIn(page, "/nastavnik/zadatak/novi", "Demo nastavnik");
    const role = await db.query<{ active: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM institution.institution_role r
        JOIN identity.user_account u ON u.id = r.user_id
        WHERE u.hr_edu_person_unique_id = $1 AND r.role = 'teacher'
          AND r.revoked_at IS NULL AND r.confirmed_at IS NOT NULL) AS active`, [TEACHER]);
    grantedHere = !role.rows[0]!.active;
    const grant = spawnSync(process.execPath, ["scripts/demo/provision-teacher.mjs"], {
      cwd: ROOT, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    expect(grant.error).toBeUndefined();
    expect(grant.status, grant.stderr).toBe(0);
    await page.reload();

    const main = page.getByRole("main");
    const form = main.getByRole("group", { name: tools.heading });
    const preview = main.getByRole("complementary");
    const emptyLists = main.locator("ul:not(:has(li))");

    // Every purpose allowed (the form's default): a sentence, not an empty list.
    await expect(form.getByText(tools.bannedNone)).toBeVisible();
    await expect(emptyLists).toHaveCount(0);
    await test.info().attach("nastavnik-alati-sve-dopusteno", {
      body: await page.screenshot({ fullPage: true }), contentType: "image/png",
    });

    // Nothing allowed: the preview reads as the student's notice does.
    for (const purpose of AI_PURPOSES) await form.getByLabel(tools.purposes[purpose]).uncheck();
    await expect(form.getByText(tools.bannedNone)).toHaveCount(0);
    await expect(preview.getByText(t.student.noTools)).toBeVisible();
    await expect(emptyLists).toHaveCount(0);
    await test.info().attach("nastavnik-alati-nista-dopusteno", {
      body: await page.screenshot({ fullPage: true }), contentType: "image/png",
    });
  } finally {
    if (grantedHere) await db.query(
      `UPDATE institution.institution_role SET revoked_at = now() WHERE id IN (
        SELECT r.id FROM institution.institution_role r JOIN identity.user_account u ON u.id = r.user_id
        WHERE u.hr_edu_person_unique_id = $1 AND r.role = 'teacher'
          AND r.revoked_at IS NULL AND r.confirmed_by IS NULL)`, [TEACHER]);
    await db.end();
  }
});
