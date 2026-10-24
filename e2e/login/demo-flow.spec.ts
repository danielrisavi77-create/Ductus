import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import pg from "pg";

import { DUCTUS_PROTOCOL_VERSION } from "../../src/domain/evidence/commit-envelope";
import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
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

// Chromium draws a native date field in the language of the browser, not of the
// context `locale` (hr-HR in the config): on the Linux CI runner the teacher's
// form showed "mm/dd/yyyy" and "11/02/2026, 09:00 AM". The browser of this file
// starts in Croatian, as a Croatian teacher's browser would, so the demo
// screenshots show the dates as the teacher sees them.
const BROWSER_ENV = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
test.use({
  launchOptions: { args: ["--lang=hr-HR"], env: { ...BROWSER_ENV, LANG: "hr_HR.UTF-8", LANGUAGE: "hr" } },
});

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// A fixed invented name: an identical repeat returns the same course (create_course).
const COURSE_NAME = "Izmišljeni kolegij K-4";

const TEXT = "Uvod: izmišljeni nacrt o gradskim knjižnicama.";
const OFFLINE_TEXT = " Dopuna napisana bez mreže.";
const DRAFT = TEXT + OFFLINE_TEXT;
const QUOTE = "gradskim knjižnicama";
const COMMENT = "Dodaj izvor za ovu tvrdnju.";
const LIVE_PATH = `/api/live/${LOCAL_DEMO_DOCUMENT_ID}`;
const LIVE_READ_HEADERS = { "ductus-protocol": DUCTUS_PROTOCOL_VERSION };

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
  if (!["127.0.0.1", "localhost"].includes(new URL(ADMIN_DATABASE_URL).hostname)) {
    throw new Error("the K-4 fixture runs only against a local database");
  }
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

// The live state is an invented fixture, separate from the evidence journal.
const clearLiveFixture = () => withAdmin((client) => client.query(
  "DELETE FROM collaboration.live_state WHERE document_id = $1", [LOCAL_DEMO_DOCUMENT_ID]));
test.afterEach(clearLiveFixture);

// Only the reserved synthetic document's owner acknowledgment, so every run
// exercises the real confirmation UI rather than inheriting an earlier one.
const clearNoticeFixture = () => withAdmin((client) => client.query(
  `DELETE FROM institution.notice_acknowledgment n USING evidence.document d, evidence.project p
   WHERE d.id = $1 AND p.id = d.project_id AND n.assignment_id = p.assignment_id AND n.student_id = d.principal_id`,
  [LOCAL_DEMO_DOCUMENT_ID]));
test.afterEach(clearNoticeFixture);

// K-4b (#655): F-7 enrollment by code into the F-6 course. Until the teacher
// screen shows the code (#576), the test takes it from the real teacher HTTP
// route; that request is test input, not a step of the teacher's screen.
const STUDENT_ID = "demo-student@demo.ductus.test";
const ASSIGNMENT_TITLE = "Izmišljeni zadatak o gradskim knjižnicama";
let enrollmentCode: string | null = null;
let enrolledCourse: string | null = null;

/** The F-6 course of the demo teacher and its assignments, read as the local admin. */
const k4Course = () => withAdmin(async (client) => {
  const { rows } = await client.query<{ course: string; assignment: string | null }>(
    `SELECT c.id AS course, a.id AS assignment FROM institution.course c
       JOIN identity.user_account u ON u.id = c.created_by
       LEFT JOIN institution.assignment a ON a.course_id = c.id
      WHERE c.name = $1 AND u.hr_edu_person_unique_id = $2`, [COURSE_NAME, TEACHER_ID]);
  const courses = new Set(rows.map((row) => row.course));
  if (courses.size !== 1) throw new Error("expected exactly one K-4 course of the demo teacher");
  return { course: rows[0]!.course, assignments: rows.flatMap((row) => (row.assignment ? [row.assignment] : [])) };
});

// Closes only the demo student's membership in the K-4 course, so the next run enrolls again.
test.afterEach(async () => {
  if (enrolledCourse) {
    await withAdmin((client) => client.query(
      `UPDATE institution.course_member m SET member_to = now() FROM identity.user_account u
        WHERE m.course_id = $1 AND m.user_id = u.id AND u.hr_edu_person_unique_id = $2
          AND m.role = 'student' AND m.member_to IS NULL`, [enrolledCourse, STUDENT_ID]));
  }
  enrolledCourse = null;
  enrollmentCode = null;
});

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

  // Test input until #576: the teacher screen does not show the code yet, so the
  // signed-in teacher's own session asks the real route for it (#575).
  await test.step("1. Testni ulaz do #576: nastavnik izdaje šifru za upis kroz stvarnu rutu", async () => {
    const { course } = await k4Course();
    const validUntil = new Date(Date.now() + 10 * 60_000).toISOString();
    const issued = await page.request.post(`/api/institution/courses/${course}/enrollment-code`, {
      headers: { origin: "http://localhost:3000", "content-type": "application/json" }, data: { validUntil },
    });
    expect(issued.status()).toBe(200);
    expect(issued.headers()["cache-control"]).toBe("no-store");
    const { code } = await issued.json() as { code: string };
    expect(code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    enrollmentCode = code;
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

  // F-7 (demo point 2): the student enrolls with the teacher's code through the
  // real form and route (#542) and lands on the notice of the F-6 assignment.
  // Nothing goes to the evidence, live or submission routes on the way.
  await test.step("2. F-7: studentica se upisuje kodom i stiže na obavijest zadatka iz koraka 1", async () => {
    expect(enrollmentCode).not.toBeNull();
    const { course, assignments } = await k4Course();
    const evidenceRequests: string[] = [];
    const observe = (request: Request) => {
      const path = new URL(request.url()).pathname;
      if (/^\/api\/(evidence|live|submission)(\/|$)/.test(path)) evidenceRequests.push(path);
    };
    await page.goto("/upis");
    page.on("request", observe);
    try {
      await page.getByLabel(t.student.enroll.label).fill(enrollmentCode!.toLowerCase());
      const response = page.waitForResponse((r) =>
        new URL(r.url()).pathname === "/api/institution/enrollments" && r.request().method() === "POST");
      await page.getByRole("button", { name: t.student.enroll.submit }).click();
      const enrolled = await response;
      enrolledCourse = course;
      expect(enrolled.status()).toBe(200);
      expect(enrolled.request().postDataJSON()).toEqual({ code: enrollmentCode!.replaceAll("-", "") });
      expect(await enrolled.json()).toEqual({ courseId: course });

      await page.waitForURL(/\/zadatak\/[0-9a-f-]{36}$/);
      const assignmentId = new URL(page.url()).pathname.split("/").pop()!;
      expect(assignments).toContain(assignmentId);
      await expect(page.getByRole("heading", { level: 1, name: ASSIGNMENT_TITLE })).toBeVisible();
      await expect(page.getByRole("heading", { name: t.student.teacherHeading })).toBeVisible();
      await expect(editorOf(page)).toHaveCount(0);
      // F-6 opens the assignment on 2 Nov 2026; before then the notice has no confirmation (FE-D8).
      const { rows: [state] } = await withAdmin((client) => client.query<{ members: string; open: boolean }>(
        `SELECT (SELECT count(*) FROM institution.course_member m JOIN identity.user_account u ON u.id = m.user_id
                  WHERE m.course_id = $1 AND u.hr_edu_person_unique_id = $2 AND m.role = 'student'
                    AND m.member_to IS NULL) AS members,
                (SELECT v.opens_at <= now() FROM institution.assignment a JOIN institution.assignment_version v
                  ON v.assignment_id = a.id AND v.version_no = a.current_version WHERE a.id = $3) AS open`,
        [course, STUDENT_ID, assignmentId]));
      expect(Number(state!.members)).toBe(1);
      await expect(page.getByRole("checkbox", { name: t.student.checkbox })).toHaveCount(state!.open ? 1 : 0);
      expect(evidenceRequests).toEqual([]);
      await snapshot(page, "2-upis-kodom-obavijest-zadatka");
    } finally {
      page.off("request", observe);
    }
  });

  // The rest of F-7 on the F-6 assignment: confirming its notice (possible from
  // its opening on 2 Nov) and writing in its own document, which waits for the
  // editor to follow the assignment (F-113). The step below confirms the notice
  // of the synthetic fixture instead.
  await test.step.skip("2. F-7: potvrda obavijesti zadatka iz koraka 1 i pisanje u njegovom dokumentu", async () => {});

  await test.step("2. F-7 djelomično: studentica potvrđuje obavijest kroz stvarno sučelje", async () => {
    await seed();
    await clearNoticeFixture();
    const { rows: [assignment] } = await withAdmin((client) => client.query<{ id: string; version: number }>(
      `SELECT a.id, a.current_version AS version FROM evidence.document d
       JOIN evidence.project p ON p.id = d.project_id JOIN institution.assignment a ON a.id = p.assignment_id
       WHERE d.id = $1`, [LOCAL_DEMO_DOCUMENT_ID]));
    expect(assignment).toBeDefined();
    const noticePath = `/zadatak/${assignment!.id}`;
    const acknowledgmentPath = `/api/institution/assignments/${assignment!.id}/acknowledgment`;
    const evidenceRequests: string[] = [];
    const observe = (request: Request) => {
      const path = new URL(request.url()).pathname;
      if (/^\/api\/(evidence|live|submission)(\/|$)/.test(path)) evidenceRequests.push(path);
    };
    // First unmount the unscoped editor; observe only this notice's requests.
    await page.goto(noticePath);
    page.on("request", observe);
    try {
      await page.goto(`/rad?zadatak=${assignment!.id}`);
      await page.waitForURL(`http://localhost:3000${noticePath}`);
      await expect(page.getByRole("heading", { name: t.student.recordedHeading })).toBeVisible();
      await expect(editorOf(page)).toHaveCount(0);
      const confirm = page.getByRole("button", { name: t.student.confirm });
      await expect(confirm).toBeDisabled();
      await snapshot(page, "2-obavijest-prije-potvrde");
      expect(evidenceRequests).toEqual([]);

      await page.getByRole("checkbox", { name: t.student.checkbox }).check();
      await expect(confirm).toBeEnabled();
      const acknowledged = page.waitForResponse((response) => new URL(response.url()).pathname === acknowledgmentPath);
      await confirm.click();
      const response = await acknowledged;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toEqual({ versionNo: assignment!.version });
      const body = await response.json() as { acknowledgedAt: string };
      const { rows } = await withAdmin((client) => client.query<{ version_no: number; acknowledged_at: Date }>(
        `SELECT n.version_no, n.acknowledged_at FROM institution.notice_acknowledgment n
         JOIN evidence.document d ON d.principal_id = n.student_id JOIN evidence.project p ON p.id = d.project_id
         WHERE d.id = $1 AND n.assignment_id = p.assignment_id`, [LOCAL_DEMO_DOCUMENT_ID]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.version_no).toBe(assignment!.version);
      expect(rows[0]!.acknowledged_at.toISOString()).toBe(body.acknowledgedAt);
      expect(evidenceRequests).toEqual([]);
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await snapshot(page, "2-obavijest-potvrdena-u-bazi");
      await test.info().attach("2-stvarna-potvrda-obavijesti.json", {
        body: JSON.stringify({ assignmentId: assignment!.id, versionNo: rows[0]!.version_no, ...body, evidenceRequests }, null, 2),
        contentType: "application/json",
      });
    } finally {
      page.off("request", observe);
    }
    await page.getByRole("link", { name: t.student.openEditor }).click();
    await page.waitForURL(`http://localhost:3000/rad?zadatak=${assignment!.id}`);
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await snapshot(page, "2-editor-nakon-potvrde");
  });

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

  // F-9: actual owner PUT -> actual teacher GET -> selection and comment UI.
  // The explicit PUT is test input while the editor publisher (#522) is pending;
  // it proves neither automatic publication nor a signed evidence receipt.
  // Course/document permissions use the existing synthetic comment fixture.
  await test.step("3. F-9: nastavnik komentira odlomak, komentar stiže studentici", async () => {
    const teacher = await (await browser.newContext()).newPage();
    try {
      await signIn(teacher, "/", "Demo nastavnik");
      await clearLiveFixture();
      // The notice was acknowledged by the actual student UI before writing.
      const body = canonicalizeJcs((await localCheckpoint(page)).snapshot!.document);
      const etag = `"${createHash("sha256").update(body, "utf8").digest("hex")}"`;
      const published = await page.request.put(LIVE_PATH, {
        headers: { origin: "http://localhost:3000", "content-type": "application/json", "if-none-match": "*" }, data: body,
      });
      expect(published.status()).toBe(200);
      expect(await published.json()).toMatchObject({ outcome: "accepted" });
      const ownerRead = await page.request.get(LIVE_PATH, { headers: LIVE_READ_HEADERS });
      expect(ownerRead.status()).toBe(200);
      expect(await ownerRead.text()).toBe(body);
      expect(ownerRead.headers().etag).toBe(etag);

      const liveRead = teacher.waitForResponse((response) => new URL(response.url()).pathname === LIVE_PATH && response.status() === 200);
      await teacher.goto(`/nastavnik/rad/${LOCAL_DEMO_DOCUMENT_ID}`);
      const shown = await liveRead;
      expect(await shown.text()).toBe(body);
      expect(shown.headers().etag).toBe(etag);
      const text = teacher.getByRole("document", { name: t.liveView.documentLabel });
      await expect(text).toHaveText(DRAFT);
      await snapshot(teacher, "3-nastavnik-vidi-objavljeni-nacrt");

      await text.locator("p").evaluate((paragraph, quote) => {
        const node = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode()!;
        const start = node.textContent!.indexOf(quote);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + quote.length);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      }, QUOTE);
      await text.dispatchEvent("mouseup");
      const form = teacher.getByRole("form", { name: t.teacherComments.newTitle });
      await expect(form).toContainText(`„${QUOTE}”`);
      await form.getByRole("textbox", { name: t.teacherComments.bodyLabel }).fill(COMMENT);
      const created = teacher.waitForResponse((response) => new URL(response.url()).pathname === "/api/comments/create" && response.request().method() === "POST");
      await form.getByRole("button", { name: t.teacherComments.publish }).click();
      expect((await created).status()).toBe(200);
      await expect(teacher.getByRole("article", { name: t.comments.number.replace("{n}", "1") })).toContainText(COMMENT);
      await expect(text.locator("mark")).toHaveText(QUOTE);
      await snapshot(teacher, "3-komentar-iz-nastavnickog-sucelja");
      await test.info().attach("3-stvarni-live-prikaz.json", {
        body: JSON.stringify({ document: JSON.parse(body), etag, ownerStatus: ownerRead.status(), teacherStatus: shown.status() }, null, 2),
        contentType: "application/json",
      });

      await page.getByRole("button", { name: t.comments.refresh }).click();
      const card = page.getByRole("article", { name: t.comments.number.replace("{n}", "1") });
      await expect(card).toContainText(t.comments.teacher);
      await expect(card).toContainText(COMMENT);
      await expect(editorOf(page).locator(".comment-mark")).toHaveText(QUOTE);
      await expect(editorOf(page)).toHaveText(DRAFT);
      await snapshot(page, "3-komentar-kod-studentice");
    } finally {
      await teacher.context().close();
    }
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
    const live = await page.request.get(LIVE_PATH, { headers: LIVE_READ_HEADERS });
    expect(live.status()).toBe(404);
    expect(await live.json()).toEqual({ error: "not_found" });
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

  // D-142: the teacher UI reads the published live state above; automatic
  // publication from the connected editor still waits for #522 and F-8.
  await test.step.skip("3. F-9: nastavnik prima promjene iz povezanog editora uživo", async () => {});
  // F-10 (demo points 4 and 5): proves that the student submits, the server
  // reconstructs the work and the comparison matches, the student gets the
  // signed receipt, and student and teacher see the same process summary,
  // made by the same function, with no forbidden words and no percentages
  // (PRODUCT §5 rules 2, 5 and 11).
  await test.step.skip("4. i 5. F-10: predaja, potpisana potvrda i isti sažetak procesa za oba", async () => {});
});
