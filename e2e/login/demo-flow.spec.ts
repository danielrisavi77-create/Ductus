import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

import { createTextAnchor } from "../../src/domain/collaboration";
import type { NodeId } from "../../src/domain/document";
import type { JournalContents } from "../../src/domain/sync/journal-types";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { cleanUp, post, seed } from "./comment-seed";
import { appCookie, clickSignOut, SESSION_COOKIE, sessionRow, signIn } from "./support";

// K-4 (DAN-89; docs/PLAN-DEMO.md §1 points 1 to 5 and §7 t. 2, D-98): the demo
// walk-through as one test. The login config records its video in CI and the
// steps attach a screenshot each, so the playwright-report-login artifact of
// the run holds both. Chromium only (D-98 addition).
//
// The test grows with the demo: the steps below run what main already shows
// (F-5 sign-in and sign-out, local offline recovery and account isolation). The screens of
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

const TEXT = "Uvod: izmišljeni nacrt o gradskim knjižnicama.";
const OFFLINE_TEXT = " Dopuna napisana bez mreže.";
const DRAFT = TEXT + OFFLINE_TEXT;
const QUOTE = "gradskim knjižnicama";
const COMMENT = "Dodaj izvor za ovu tvrdnju.";

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");

/** Read-only evidence of the one journal, before a second account is opened. */
async function localCheckpoint(page: Page): Promise<JournalContents> {
  return page.evaluate(async (documentId) => {
    const names = (await indexedDB.databases()).filter(({ name }) => name?.startsWith("ductus-journal-v1-"));
    if (names.length !== 1) throw new Error("expected only the demo student's journal");
    const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await read(indexedDB.open(names[0]!.name!));
    try {
      const tx = db.transaction(["snapshots", "pending", "meta"], "readonly");
      const [snapshot, pending, meta] = await Promise.all([
        read(tx.objectStore("snapshots").get(documentId)),
        read(tx.objectStore("pending").getAll()),
        read(tx.objectStore("meta").get(documentId)),
      ]);
      return { snapshot, pending, meta };
    } finally {
      db.close();
    }
  }, LOCAL_DEMO_DOCUMENT_ID);
}

async function attachCheckpoint(name: string, value: JournalContents): Promise<void> {
  await test.info().attach(name, { body: JSON.stringify(value, null, 2), contentType: "application/json" });
}

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
  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");
  expect(await appCookie(page.context(), SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  await forgetProviderLogin(page.context());
}

const TEACHER_ID = "demo-teacher@demo.ductus.test";
const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
let roleGrantedByThisTest = false;

async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const ACTIVE_ROLE = `FROM institution.institution_role r JOIN identity.user_account u ON u.id = r.user_id
  WHERE u.hr_edu_person_unique_id = $1 AND r.role = 'teacher' AND r.revoked_at IS NULL`;

/** Whether the demo teacher holds a confirmed teacher role right now. */
const teacherRoleActive = () => withAdmin(async (client) =>
  (await client.query(`SELECT 1 ${ACTIVE_ROLE} AND r.confirmed_at IS NOT NULL`, [TEACHER_ID])).rowCount === 1);

// Removes the operator grant this test made, and only that one (a role that was there
// before the run stays), so the specs after it start from the state of a clean stack.
test.afterEach(async () => {
  if (!roleGrantedByThisTest) return;
  await withAdmin((client) => client.query(
    `UPDATE institution.institution_role SET revoked_at = now() WHERE id IN (SELECT r.id ${ACTIVE_ROLE} AND r.confirmed_by IS NULL)`,
    [TEACHER_ID]));
  roleGrantedByThisTest = false;
});

// Removes the comments, memberships and role the F-9 step opened (comment-seed.ts).
test.afterEach(cleanUp);

test("demo walk-through", async ({ browser, page, context }) => {
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
  await test.step("1. F-6: nastavnik stvara kolegij i zadatak; popisi uz čl. 8 su na ekranu", async () => {
    // A clean stack holds no teacher role: the screen refuses first (the boundary
    // demo-role.spec.ts proves in the database), and only then does the operator grant it.
    // The step takes the role away again afterwards, so demo-role.spec.ts still meets a clean stack.
    roleGrantedByThisTest = !(await teacherRoleActive());
    if (roleGrantedByThisTest) {
      await page.goto("/nastavnik/zadatak/novi");
      await expect(page.getByText(t.teacher.denied)).toBeVisible();
      await expect(page.getByRole("button", { name: t.teacher.course.submit })).toHaveCount(0);
    }
    await run("node", ["scripts/demo/provision-teacher.mjs"], { cwd: ROOT });
    await page.goto("/nastavnik/zadatak/novi");
    await expect(page.getByRole("heading", { name: t.teacher.title })).toBeVisible();

    await page.getByLabel(t.teacher.course.name).fill(COURSE_NAME);
    await page.getByRole("button", { name: t.teacher.course.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: t.teacher.course.created })).toBeVisible();
    // FE-D10: no enrolment code is invented while its route is missing.
    const code = page.getByText(t.teacher.course.code, { exact: false }).first();
    await expect(code).toContainText(t.workspace.soon);
    await expect(page.getByText(t.teacher.course.codeSoon)).toBeVisible();
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
    // The public home page's way in is the sign-in screen (FE-H1, FE-D3);
    // start at the login route its AAI@EduHr button links to.
    await page.goto(`/api/auth/login?returnTo=${encodeURIComponent("/rad")}`);
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
    await page.keyboard.type(TEXT);
    await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
    await snapshot(page, "2-spremljeno-na-uredaju");
  });

  // This is the local part of F-8 only. The signed server receipt below is
  // still a missing acceptance criterion, not inferred from a network return.
  await test.step("2. F-8 lokalno: prekid mreže, dopuna i oporavak nakon povratka", async () => {
    const before = await localCheckpoint(page);
    expect(before.snapshot?.document.nodes[0]?.children.map((child) => child.text).join("")).toBe(TEXT);
    await attachCheckpoint("2-prije-prekida.json", before);

    await context.setOffline(true);
    try {
      await expect(page.locator(".offline-chip")).toHaveText(t.network.offline);
      await editorOf(page).press("End");
      await page.keyboard.type(OFFLINE_TEXT);
      await expect(editorOf(page)).toHaveText(DRAFT);
      await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
      const saved = await localCheckpoint(page);
      expect(saved.meta!.localSeq).toBeGreaterThan(before.meta!.localSeq);
      expect(saved.pending.length).toBeGreaterThan(0);
      expect(saved.snapshot?.revision).toBe(before.snapshot?.revision);
      expect(saved.snapshot?.document.nodes[0]?.children.map((child) => child.text).join("")).toBe(DRAFT);
      await attachCheckpoint("2-potvrdeno-lokalno-bez-mreze.json", saved);
      await snapshot(page, "2-bez-mreze");

      await context.setOffline(false);
      await expect(page.locator(".offline-chip")).toHaveCount(0);
      await page.reload();
      await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
      await expect(editorOf(page)).toHaveText(DRAFT);
      await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
      const restored = await localCheckpoint(page);
      expect(restored).toEqual(saved);
      await attachCheckpoint("2-oporavljeno-nakon-reloada.json", restored);
      await snapshot(page, "2-nacrt-oporavljen");
    } finally {
      await context.setOffline(false);
    }
  });

  // F-9 (demo point 3), the comment: the teacher leaves a comment next to a
  // paragraph and it reaches the student. It runs here, while the student's
  // editor is open: the comment panel lives on /rad. Until B-11 gives the
  // teacher a screen to pick a paragraph, the teacher's step is the same POST
  // the page will send, with the teacher's own session (as comments.spec.ts);
  // the course and document come from the shared comment-seed helper, which
  // removes what it opened after the test.
  await test.step("3. F-9: nastavnik komentira odlomak, komentar stiže studentici", async () => {
    const teacher = await (await browser.newContext()).newPage();
    await signIn(teacher, "/", "Demo nastavnik");
    const nodeId = (await editorOf(page).locator("p[data-node-id]").first().getAttribute("data-node-id")) as NodeId;
    await seed();
    const start = TEXT.indexOf(QUOTE);
    const anchor = createTextAnchor({ nodeId, nodeText: DRAFT, start, end: start + QUOTE.length });
    const created = await post(teacher, "create", { documentId: LOCAL_DEMO_DOCUMENT_ID, body: COMMENT, anchor });
    expect(created.status()).toBe(200);

    await page.getByRole("button", { name: t.comments.refresh }).click();
    const card = page.getByRole("article", { name: t.comments.number.replace("{n}", "1") });
    await expect(card).toContainText(t.comments.teacher);
    await expect(card).toContainText(COMMENT);
    await expect(editorOf(page).locator(".comment-mark")).toHaveText(QUOTE);
    await snapshot(page, "3-komentar-kod-studentice");
    await teacher.context().close();
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

  await test.step("2. Drugi student u istom pregledniku ne vidi nacrt ni komentare studentice", async () => {
    await signIn(page, "/rad", "Demo student 2");
    token = (await appCookie(context, SESSION_COOKIE))!.value;
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(page)).toHaveText("");
    await expect(page.getByText(COMMENT, { exact: true })).toHaveCount(0);
    const listed = await post(page, "list", { documentId: LOCAL_DEMO_DOCUMENT_ID });
    expect(listed.status()).toBe(403);
    expect(await listed.json()).toEqual({ error: "forbidden" });
    await snapshot(page, "2-drugi-student-izoliran");
    await signOut(page, token);
  });

  await test.step("2. Ponovna prijava studentice vraća njezin lokalni nacrt i komentar", async () => {
    await signIn(page, "/rad", "Demo studentica");
    token = (await appCookie(context, SESSION_COOKIE))!.value;
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(page)).toHaveText(DRAFT);
    await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
    await expect(page.getByText(COMMENT, { exact: true })).toBeVisible();
    await snapshot(page, "2-vlasnica-nastavlja-nacrt");
    await signOut(page, token);
  });

  // The teacher's view of the saved work (B-11) is not on main, so the part of
  // F-9 where the teacher sees the saved state stays skipped, not simulated.
  await test.step.skip("3. F-9: nastavnik vidi spremljeno stanje rada, ne tipkanje uživo", async () => {});
  // F-10 (demo points 4 and 5): proves that the student submits, the server
  // reconstructs the work and the comparison matches, the student gets the
  // signed receipt, and student and teacher see the same process summary,
  // made by the same function, with no forbidden words and no percentages
  // (PRODUCT §5 rules 2, 5 and 11).
  await test.step.skip("4. i 5. F-10: predaja, potpisana potvrda i isti sažetak procesa za oba", async () => {});
});
