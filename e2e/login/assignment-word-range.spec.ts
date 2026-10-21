import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DATABASE_URL = process.env.E2E_ADMIN_DATABASE_URL ??
  "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const TEACHER = "demo-teacher@demo.ductus.test";

test("teacher form persists word range and edits rotate only the changed retry key", async ({ page }) => {
  const db = new pg.Client({ connectionString: DATABASE_URL });
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

    const courseName = `Sintetički kolegij raspona ${randomUUID()}`;
    const title = `Sintetički zadatak raspona ${randomUUID()}`;
    await page.getByLabel(t.teacher.course.name).fill(courseName);
    await page.getByRole("button", { name: t.teacher.course.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: t.teacher.course.created })).toBeVisible();

    await page.getByLabel(t.teacher.assignment.title).fill(title);
    await page.getByLabel(t.teacher.assignment.opensAt).fill("2026-11-02T09:00");
    await page.getByLabel(t.teacher.assignment.dueAt).fill("2026-12-15T09:00");
    await page.getByLabel(t.teacher.assignment.wordMin).fill("1200");
    await page.getByLabel(t.teacher.assignment.wordMax).fill("2500");

    const keys: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/institution/courses/*/assignments", async (route) => {
      const request = route.request();
      keys.push(request.headers()["idempotency-key"]!);
      bodies.push(request.postDataJSON());
      if (keys.length <= 2) await route.abort("failed");
      else await route.continue(); // The accepted request reaches the real POST and database.
    });

    const publish = page.getByRole("button", { name: t.teacher.assignment.publish });
    await publish.click();
    await expect(page.getByRole("alert").filter({ hasText: t.teacher.assignment.errors.unavailable })).toBeVisible();
    await page.getByLabel(t.teacher.assignment.wordMin).fill("1500");
    await publish.click();
    await expect(page.getByRole("alert").filter({ hasText: t.teacher.assignment.errors.unavailable })).toBeVisible();
    await publish.click();
    await expect(page.getByRole("status").filter({ hasText: t.teacher.assignment.publishedNotice })).toBeVisible();

    expect(keys).toHaveLength(3);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
    expect(bodies[2]).toMatchObject({ wordMin: 1500, wordMax: 2500 });
    const stored = await db.query<{ word_min: number; word_max: number }>(
      `SELECT v.word_min, v.word_max FROM institution.assignment_version v
        WHERE v.title = $1`, [title]);
    expect(stored.rows).toEqual([{ word_min: 1500, word_max: 2500 }]);
    await test.info().attach("nastavnik-raspon-rijeci", {
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
