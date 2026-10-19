import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { appCookie, SESSION_COOKIE, sessionRow, signIn } from "./support";

// K-4 (DAN-89; docs/PLAN-DEMO.md §1 points 1 to 5 and §7 t. 2, D-98): the demo
// walk-through as one test. The login config records its video in CI and the
// steps attach a screenshot each, so the playwright-report-login artifact of
// the run holds both. Chromium only (D-98 addition).
//
// The test grows with the demo: the steps below run what main already shows
// (F-5 sign-in and sign-out, the editor saving on the device). The screens of
// F-6 to F-10 are prepared as skipped steps; each one is turned into a running
// step in the PR that lands its screen. A skipped step stands in the place of
// the demo it will take, so the running steps keep passing meanwhile.
// test.fixme() would abort the whole test, so the steps use test.step.skip.
//
// Accounts, course and text are invented (K-3, infra/fake-oidc).

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// A fixed invented name: an identical repeat returns the same course (create_course).
const COURSE_NAME = "Izmišljeni kolegij K-4";

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const logoutOf = (page: Page) => page.getByRole("button", { name: t.auth.logout });

/** A screenshot in the report, next to the video. */
async function snapshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

/** The fake provider remembers who signed in; forgetting it shows the account choice again. */
async function forgetProviderLogin(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: /^_session/ });
}

/** Signs out through the button on the writing page and checks that the session is closed. */
async function signOut(page: Page, token: string): Promise<void> {
  if (!page.url().endsWith("/rad")) await page.goto("/rad");
  await logoutOf(page).click();
  await page.waitForURL("http://localhost:3000/");
  expect(await appCookie(page.context(), SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  await forgetProviderLogin(page.context());
}

test("demo walk-through", async ({ page, context }) => {
  let token = "";

  await test.step("1. Nastavnik se prijavljuje demo računom", async () => {
    await signIn(page, "/", "Demo nastavnik");
    await expect(page.getByRole("heading", { level: 1, name: t.app.name })).toBeVisible();
    await expect(page.locator(".demo-badge")).toHaveText(t.shell.demoBadge);

    const session = await appCookie(context, SESSION_COOKIE);
    expect(session).toBeDefined();
    token = session!.value;
    expect(await sessionRow(token)).toEqual({
      institution: "demo-fakultet",
      unique_id: "demo-teacher@demo.ductus.test",
      closed_at: null,
      close_reason: null,
    });
    await snapshot(page, "1-nastavnik-prijavljen");
  });

  // F-6 (demo point 1): the teacher creates a course and an assignment; the
  // permitted and forbidden uses quoted from FPZG art. 8 (D-80) are on the same
  // screen. The teacher role comes from the explicit local operator command of
  // K-3a (#313), run as the demo run runs it, after the teacher's first
  // sign-in; this test seeds nothing itself.
  await test.step("1. F-6: nastavnik stvara kolegij i zadatak s obaviješću S3 i čl. 8", async () => {
    await run("node", ["scripts/demo/provision-teacher.mjs"], { cwd: ROOT });
    await page.goto("/nastavnik/kolegiji");
    await expect(page.getByRole("heading", { name: t.teacher.title })).toBeVisible();

    await page.getByLabel(t.teacher.course.name).fill(COURSE_NAME);
    await page.getByRole("button", { name: t.teacher.course.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: t.teacher.course.created })).toBeVisible();
    await snapshot(page, "1-kolegij-stvoren");

    await page.getByLabel(t.teacher.assignment.title).fill("Izmišljeni zadatak o gradskim knjižnicama");
    await page.getByLabel(t.teacher.assignment.opensAt).fill("2026-11-02T09:00");
    await page.getByLabel(t.teacher.assignment.dueAt).fill("2026-12-15T09:00");
    await page.getByLabel(t.teacher.assignment.instructions).fill("Napiši kratak izmišljeni rad o gradskim knjižnicama.");
    // Art. 8 lists and their source stay on the screen before anything is published.
    await expect(page.getByText(t.teacher.tools.source).first()).toBeVisible();
    await expect(page.getByText(t.teacher.assignment.studentsNotified)).toBeVisible();
    await page.getByRole("button", { name: t.teacher.assignment.publish }).click();
    await expect(page.getByRole("status").filter({ hasText: t.teacher.assignment.publishedNotice })).toBeVisible();
    await snapshot(page, "1-zadatak-objavljen");
  });

  await test.step("1. Nastavnik se odjavljuje", async () => {
    await signOut(page, token);
    await snapshot(page, "1-nastavnik-odjavljen");
  });

  await test.step("2. Studentica se prijavljuje demo računom", async () => {
    await page.getByRole("link", { name: t.auth.signIn }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Demo prijava" })).toBeVisible();
    await page.getByRole("button", { name: "Demo studentica" }).click();
    await page.waitForURL("http://localhost:3000/rad");
    token = (await appCookie(context, SESSION_COOKIE))!.value;
    expect(await sessionRow(token)).toMatchObject({
      institution: "demo-fakultet",
      unique_id: "demo-student@demo.ductus.test",
      closed_at: null,
    });
    await snapshot(page, "2-studentica-prijavljena");
  });

  // F-7 stays skipped: no route or screen hands the enrolment code to a
  // person yet (create_enrollment_code returns it once, to a database call
  // only), so the step needs the K-3 seed (DAN-88, Backend); it is not built here.
  // F-7 (demo point 1, the student's side): proves enrolment by code, the
  // assignment's first screen with the notice and art. 8, and the student's
  // confirmation; before the confirmation nothing goes to the server.
  await test.step.skip("2. F-7: studentica se upisuje kodom i potvrđuje obavijest", async () => {});

  await test.step("2. Studentica piše, a tekst je spremljen na uređaju", async () => {
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await editorOf(page).click();
    await page.keyboard.type("Uvod: izmišljeni nacrt o gradskim knjižnicama.");
    await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
    await snapshot(page, "2-spremljeno-na-uredaju");
  });

  // F-8 (demo point 2): proves headings, a citation and a bibliography in the
  // FPZG style (plain text in the demo, D-98 addition), the real "spremljeno
  // na uređaju" and "spremljeno na poslužitelju" states, and work without the
  // network: the connection drops, writing goes on, nothing is lost, and the
  // offline mark stays after the return (PRODUCT §5 rule 10).
  await test.step.skip("2. F-8: naslovi, citat i bibliografija; rad bez mreže i povratak s oznakom", async () => {});

  await test.step("2. Studentica se odjavljuje", async () => {
    await signOut(page, token);
    await snapshot(page, "2-studentica-odjavljena");
  });

  // F-9 follows in its own PR: the teacher's comment is covered by
  // e2e/login/comments.spec.ts, which writes its course and document through
  // the admin login; carrying that into this walk-through is a separate step.
  // F-9 (demo point 3): proves that the teacher sees the saved state of the
  // work, not live typing (PRODUCT §5 rule 7), leaves a comment next to a
  // paragraph, and the comment reaches the student.
  await test.step.skip("3. F-9: nastavnik vidi spremljeno stanje i komentira odlomak", async () => {});

  // F-10 (demo points 4 and 5): proves that the student submits, the server
  // reconstructs the work and the comparison matches, the student gets the
  // signed receipt, and student and teacher see the same process summary,
  // made by the same function, with no forbidden words and no percentages
  // (PRODUCT §5 rules 2, 5 and 11).
  await test.step.skip("4. i 5. F-10: predaja, potpisana potvrda i isti sažetak procesa za oba", async () => {});
});
