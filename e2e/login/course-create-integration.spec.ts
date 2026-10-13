// TEMPORARY INTEGRATION PROBE, not a product release or canonical QA.
// This spec proves combined #311 + #313 + #315 with the real Next dev server,
// fake OIDC, local PostgreSQL, B-7 role check, and F-6a HTTP POST.
// Its branch MUST NOT be merged. Move a reviewed, isolated version of this
// test to the canonical K-4 suite only after the dependencies merge.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { createWithActor } from "../../src/server/db/with-actor";
import { appCookie, SESSION_COOKIE, signIn } from "./support";

const PATH = "/nastavnik/kolegiji";
const COURSE_NAME = "Integracijski kolegij F-6 (izmišljeno)";
const YEAR = "2026/2027";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DB_URL = process.env.APP_DATABASE_URL ??
  "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus";
const OPERATOR_SCRIPT = fileURLToPath(new URL("../../scripts/demo/provision-teacher.mjs", import.meta.url));

function grantLocalSyntheticRole() {
  return spawnSync(process.execPath, [OPERATOR_SCRIPT], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 128 * 1024,
  });
}

test("F-6 integrated: real teacher login, explicit grant, HTTP course creation and student refusal", async ({
  page, context, browser,
}) => {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
  const withActor = createWithActor(pool);
  const studentPage = await browser.newPage();

  try {
    let teacherToken = "";
    await test.step("1. Nastavnik se prijavljuje lažnim lokalnim OIDC-om", async () => {
      await signIn(page, PATH, "Demo nastavnik");
      teacherToken = (await appCookie(context, SESSION_COOKIE))?.value ?? "";
      expect(teacherToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await expect(page.getByRole("heading", { name: t.teacherCourses.title })).toBeVisible();
    });

    await test.step("2. Samo lokalni operator potvrđuje sintetičku ulogu", async () => {
      const grant = grantLocalSyntheticRole();
      expect(grant.error).toBeUndefined();
      expect(grant.status, "Local operator command did not confirm the demo teacher").toBe(0);
      await page.reload();
      await expect(page.getByRole("textbox", { name: t.teacherCourses.nameLabel })).toBeVisible();
      await expect(page.getByRole("button", { name: t.teacherCourses.submit })).toBeEnabled();
    });

    let courseId = "";
    await test.step("3. Stvarni preglednik stvara kolegij kroz POST i B-7 RPC", async () => {
      await page.getByRole("textbox", { name: t.teacherCourses.nameLabel }).fill(COURSE_NAME);
      await page.getByRole("textbox", { name: t.teacherCourses.yearLabel }).fill(YEAR);
      await page.getByRole("combobox", { name: t.teacherCourses.policyLabel }).selectOption("partially_allowed");

      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/institution/courses" &&
        response.request().method() === "POST",
      );
      await page.getByRole("button", { name: t.teacherCourses.submit }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toEqual({
        name: COURSE_NAME, academicYear: YEAR, aiPolicy: "partially_allowed",
      });
      const payload: unknown = await response.json();
      expect(payload && typeof payload === "object" && "id" in payload && payload.id).toMatch(UUID);
      courseId = (payload as { id: string }).id;
      await expect(page.getByRole("status")).toContainText(t.teacherCourses.created);
      await expect(page.getByRole("status")).toContainText(courseId);
    });

    await test.step("4. Poslužitelj stvarno bilježi isti kolegij u ustanovi nastavnika", async () => {
      const course = await withActor(teacherToken, async (tx) => {
        const rows = await tx.query<{
          id: string; own_institution: boolean; created_by_actor: boolean;
          name: string; ai_policy: string;
        }>(
          `SELECT id, institution_id = (SELECT app.current_institution_id()) AS own_institution,
                  created_by = (SELECT app.current_user_id()) AS created_by_actor,
                  name, ai_policy FROM institution.course WHERE id = $1::uuid`,
          [courseId],
        );
        const memberships = await tx.query<{ role: string }>(
          `SELECT role FROM institution.course_member
            WHERE course_id = $1::uuid AND user_id = (SELECT app.current_user_id())
              AND member_to IS NULL`,
          [courseId],
        );
        return { rows: rows.rows, memberships: memberships.rows };
      });
      expect(course.rows).toEqual([{
        id: courseId, own_institution: true, created_by_actor: true,
        name: COURSE_NAME, ai_policy: "partially_allowed",
      }]);
      expect(course.memberships).toEqual([{ role: "teacher" }]);
    });

    await test.step("5. Ponovljen POST vraća isti kolegij bez duplikata", async () => {
      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/institution/courses" &&
        response.request().method() === "POST",
      );
      await page.getByRole("button", { name: t.teacherCourses.submit }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ id: courseId });
      const count = await withActor(teacherToken, async (tx) => tx.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM institution.course WHERE id = $1::uuid",
        [courseId],
      ));
      expect(count.rows[0]?.count).toBe(1);
    });

    await test.step("6. Student ne vidi formu i ne može zaobići autorizaciju izravnim POST-om", async () => {
      await signIn(studentPage, PATH, "Demo studentica");
      await expect(studentPage.getByText(t.teacherCourses.denied)).toBeVisible();
      await expect(studentPage.getByRole("button", { name: t.teacherCourses.submit })).toHaveCount(0);
      const status = await studentPage.evaluate(async (body) => {
        const response = await fetch("/api/institution/courses", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return response.status;
      }, { name: "Studentova zabranjena prijava", academicYear: YEAR, aiPolicy: "prohibited" });
      expect(status).toBe(403);
    });
  } finally {
    await studentPage.close();
    await pool.end();
  }
});
