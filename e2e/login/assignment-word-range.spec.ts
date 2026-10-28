import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { fillCodeDeadline, signIn } from "./support";
import { localAdminUrl } from "./local-db-url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TEACHER = "demo-teacher@demo.ductus.test";

test("teacher form keeps the committed request key for an equivalent range", async ({ page }) => {
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

    const courseName = `Sintetički kolegij raspona ${randomUUID()}`;
    const title = `Sintetički zadatak raspona ${randomUUID()}`;
    await page.getByLabel(t.teacher.course.name).fill(courseName);
    await fillCodeDeadline(page);
    await page.getByRole("button", { name: t.teacher.course.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: t.teacher.course.created })).toBeVisible();

    await page.getByLabel(t.teacher.assignment.title).fill(title);
    await page.getByLabel(t.teacher.assignment.opensAt).fill("2026-11-02T09:00");
    await page.getByLabel(t.teacher.assignment.dueAt).fill("2026-12-15T09:00");
    await page.getByLabel(t.teacher.assignment.wordMin).fill("1200");
    await page.getByLabel(t.teacher.assignment.wordMax).fill("2500");
    const preview = page.getByRole("main").getByRole("complementary");
    await expect(preview).toContainText(/1\s200–2\s500 riječi/u);
    await page.getByLabel(t.teacher.assignment.wordMin).fill("2501");
    await expect(preview).not.toContainText(/2\s501–2\s500 riječi/u);
    await page.getByRole("button", { name: t.teacher.assignment.publish }).click();
    await expect(page.getByRole("alert").filter({ hasText: t.teacher.assignment.errors.invalid })).toBeVisible();
    await page.getByLabel(t.teacher.assignment.wordMin).fill("1200");
    await expect(preview).toContainText(/1\s200–2\s500 riječi/u);

    const keys: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    let committedId: string | null = null;
    await page.route("**/api/institution/courses/*/assignments", async (route) => {
      const request = route.request();
      keys.push(request.headers()["idempotency-key"]!);
      bodies.push(request.postDataJSON());
      if (keys.length <= 2) {
        await route.abort("failed");
      } else if (keys.length === 3) {
        const response = await route.fetch(); // POST reaches the real server.
        expect(response.status()).toBe(201);
        committedId = (await response.json() as { id: string }).id;
        const committed = await db.query<{ id: string; word_min: number; word_max: number }>(
          `SELECT a.id, v.word_min, v.word_max FROM institution.assignment a
            JOIN institution.assignment_version v ON v.assignment_id = a.id
            WHERE v.title = $1`, [title]);
        expect(committed.rows).toEqual([{ id: committedId, word_min: 1, word_max: 2500 }]);
        await route.abort("failed"); // Only the browser response is lost after DB commit.
      } else {
        await route.continue();
      }
    });

    const publish = page.getByRole("button", { name: t.teacher.assignment.publish });
    await publish.click();
    await expect(page.getByRole("alert").filter({ hasText: t.teacher.assignment.errors.unavailable })).toBeVisible();
    await publish.click(); // Unchanged retry preserves its key.
    await expect(page.getByRole("alert").filter({ hasText: t.teacher.assignment.errors.unavailable })).toBeVisible();
    await page.getByLabel(t.teacher.assignment.wordMin).fill("001");
    await publish.click();
    await expect(page.getByRole("alert").filter({ hasText: t.teacher.assignment.errors.unavailable })).toBeVisible();
    await page.getByLabel(t.teacher.assignment.wordMin).fill("1");
    const replay = page.waitForResponse((response) =>
      response.url().endsWith("/assignments") && response.request().method() === "POST");
    await publish.click();
    const replayResponse = await replay;
    expect(replayResponse.status()).toBe(201);
    expect((await replayResponse.json() as { id: string }).id).toBe(committedId);
    await expect(page.getByRole("status").filter({ hasText: t.teacher.assignment.publishedNotice })).toBeVisible();

    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[1]).not.toBe(keys[2]);
    expect(keys[2]).toBe(keys[3]);
    expect(bodies[2]).toEqual(bodies[3]);
    expect(bodies[3]).toMatchObject({ wordMin: 1, wordMax: 2500 });
    const stored = await db.query<{ id: string; word_min: number; word_max: number }>(
      `SELECT a.id, v.word_min, v.word_max FROM institution.assignment a
        JOIN institution.assignment_version v ON v.assignment_id = a.id
        WHERE v.title = $1`, [title]);
    expect(stored.rows).toEqual([{ id: committedId, word_min: 1, word_max: 2500 }]);
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
