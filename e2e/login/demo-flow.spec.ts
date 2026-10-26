import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import pg from "pg";

import { formatBibliographyEntry, formatInText } from "../../src/domain/citation/format";
import { parseCitationStyle } from "../../src/domain/citation/style";
import { findForbiddenTerms } from "../../scripts/forbidden-terms/terms";
import type { BookSource } from "../../src/domain/citation/types";
import type { CanonicalDocument } from "../../src/domain/document";
import { DUCTUS_PROTOCOL_VERSION } from "../../src/domain/evidence/commit-envelope";
import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import { verifySignedSubmissionReceiptV2 } from "../../src/domain/forensics/submission-receipt-verifier-v2";
import type { JournalContents } from "../../src/domain/sync/journal-types";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { workDocument } from "./work-seed";
import { cleanUp, post, seed } from "./comment-seed";
import {
  loseNextCommitAnswer, replayFirstReceipt, stackCheckpoint, stackKeysOfDomain, stackReceiptKeys, tamperNextReceipt, verifyWithStackKeys,
} from "./evidence-receipt";
import {
  appCookie, editorMounted, fillCodeDeadline, ROLE_HOME, SAVED_HERE, SESSION_COOKIE, sessionRow, signIn,
  signOutHoweverHeld, signOutWithoutDialog,
} from "./support";
import { localAdminUrl } from "./local-db-url";

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
// E2E_DEMO_NATIVE=1 runs this walk-through against the native demo runner
// (docs/DEMO-UP.md, "Bez Dockera"); the provision script reads no variable itself.
const NATIVE_PROVISION = process.env.E2E_DEMO_NATIVE === "1" ? ["--native"] : [];
// A fixed invented name: an identical repeat returns the same course (create_course).
const COURSE_NAME = "Izmišljeni kolegij K-4";

const TEXT = "Uvod: izmišljeni nacrt o gradskim knjižnicama.";
const OFFLINE_TEXT = " Dopuna napisana bez mreže.";
const DRAFT = TEXT + OFFLINE_TEXT;
const QUOTE = "gradskim knjižnicama";
const COMMENT = "Dodaj izvor za ovu tvrdnju.";
const LIVE_TEXT = "Rečenica dopisana dok nastavnik gleda.";
// #711 F1: the student writes into her own work of the K-4 assignment, made
// by the real open route when she first opens it (step 2, K-4e); its id is
// read from the database, never the fixed local id.
let k4Document: string | null = null;
const livePath = () => `/api/live/${k4Document!}`;
const LIVE_READ_HEADERS = { "ductus-protocol": DUCTUS_PROTOCOL_VERSION };

// F-8 (K-4c-1): an invented source; the citation and the entry are the FPZG
// style's output for it (src/domain/citation), never copied strings.
const FPZG = parseCitationStyle(JSON.parse(readFileSync(new URL("../../config/faculties/fpzg/citation.json", import.meta.url), "utf8")));
const SOURCE: BookSource = {
  type: "book", authors: [{ kind: "person", family: "Primjerić", given: "Iva" }], year: 2019,
  title: "Izmišljene gradske knjižnice", place: "Zagreb", publisher: "Naklada Primjer",
};
const PAGES = "12-14";
type Block = { type: "paragraph" } | { type: "heading"; level: number };
const BLOCKS: readonly (Block & { text: string })[] = [
  { type: "paragraph", text: DRAFT },
  { type: "heading", level: 1, text: "Knjižnice kao javni prostor" },
  { type: "paragraph", text: `Knjižnice su izmišljenog grada otvorene svima ${formatInText(SOURCE, FPZG, PAGES)}.` },
  { type: "heading", level: 1, text: "Literatura" },
  { type: "paragraph", text: formatBibliographyEntry(SOURCE, FPZG) },
];
const EXPECTED_TEXT = BLOCKS.map((block) => block.text).join("");
const SYNC_PATH = /^\/api\/(evidence|live|submission)(\/|$)/;
const isSyncUrl = (url: URL) => SYNC_PATH.test(url.pathname);

/** Type, level and exact text of each block in the journal's snapshot. */
const blocksOf = (contents: JournalContents) => contents.snapshot!.document.nodes.map((node) => ({
  type: node.type, ...(node.type === "heading" ? { level: node.level } : {}),
  text: node.children.map((child) => child.text).join(""),
}));

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");

/** "Naslov 1" from the toolbar; the button keeps the selection in the sheet (EditorToolbar). */
const heading1Of = (page: Page) =>
  page.getByRole("toolbar", { name: t.toolbar.label }).getByRole("button", { name: t.toolbar.heading1, exact: true });

/** Read-only evidence of the one journal, before a second account is opened. */
async function localCheckpoint(page: Page, documentId: string = k4Document!): Promise<JournalContents> {
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
  }, documentId);
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

/**
 * Signs out through the button on the writing page and checks that the
 * session is closed. With nothing of this person on the device there is no
 * dialog (O1, #476 c.6396707923); `held` false says none may open. With the
 * student's work, whether its receipt came before the click decides (3d-2c2b).
 */
async function signOut(page: Page, token: string, held = true): Promise<void> {
  if (!page.url().endsWith("/rad")) await page.goto("/rad");
  if (held) await signOutHoweverHeld(page);
  else await signOutWithoutDialog(page);
  await page.waitForURL("http://localhost:3000/");
  expect(await appCookie(page.context(), SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  await forgetProviderLogin(page.context());
}

const TEACHER_ID = "demo-teacher@demo.ductus.test";
let roleGrantedByThisTest = false;

async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
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

// The live state is separate from the evidence journal: the fixture's and the K-4 work's.
const clearLiveFixture = () => withAdmin((client) => client.query(
  "DELETE FROM collaboration.live_state WHERE document_id = ANY($1::text[])",
  [[LOCAL_DEMO_DOCUMENT_ID, ...(k4Document ? [k4Document] : [])]]));
test.afterEach(clearLiveFixture);

// Only the reserved synthetic document's owner acknowledgment, so every run
// exercises the real confirmation UI rather than inheriting an earlier one.
const clearNoticeFixture = () => withAdmin((client) => client.query(
  `DELETE FROM institution.notice_acknowledgment n USING evidence.document d, evidence.project p
   WHERE d.id = $1 AND p.id = d.project_id AND n.assignment_id = p.assignment_id AND n.student_id = d.principal_id`,
  [LOCAL_DEMO_DOCUMENT_ID]));
test.afterEach(clearNoticeFixture);

// K-4b (#655): F-7 enrollment by code into the F-6 course. Since DAN-36 (#576)
// the code is the one the teacher's screen shows after "Stvori kolegij".
const STUDENT_ID = "demo-student@demo.ductus.test";
const ASSIGNMENT_TITLE = "Izmišljeni zadatak o gradskim knjižnicama";
let enrollmentCode: string | null = null;
let enrolledCourse: string | null = null;
let k4Assignment: string | null = null;

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

// K-4c-2 (#655, contract c.6386610626): the server part of F-8.
const SERVER_TEXT = "Izmišljeni rad o gradskim čitaonicama.";
const SERVER_OFFLINE_TEXT = " Dopuna bez mreže.";
const COMMIT_PATH = "/api/evidence/commit";
const COMMIT_ROUTE = `**${COMMIT_PATH}`;
const SYNCED_WAIT = { timeout: 30_000 };

/** The one evidence document of the demo student's work on the assignment (open_student_work). */
const workDocumentOf = (assignmentId: string) => withAdmin(async (client) => {
  const { rows } = await client.query<{ id: string }>(
    `SELECT d.id FROM evidence.document d JOIN evidence.project p ON p.id = d.project_id
       JOIN identity.user_account u ON u.id = p.principal_id
      WHERE p.assignment_id = $1 AND u.hr_edu_person_unique_id = $2`, [assignmentId, STUDENT_ID]);
  if (rows.length !== 1) throw new Error(`expected one document of the student's work, found ${rows.length}`);
  return rows[0]!.id;
});

const textOf = (contents: JournalContents) => blocksOf(contents).map((block) => block.text).join("");
const pendingOf = (contents: JournalContents, documentId: string) =>
  contents.pending.filter((row) => row.documentId === documentId);
const isCommit = (request: Request) => request.method() === "POST" && new URL(request.url()).pathname === COMMIT_PATH;

/** One commit as the page sent it, with the answer the page got (null when none came). */
type Commit = { clientTransactionId: string; segmentHash: string; body: string; document: string; status: number | null; answer: unknown };

/** Every commit the page sends from now on, read from the request itself, never from the app. */
function watchCommits(page: Page) {
  const commits: Promise<Commit>[] = [];
  const onRequest = (request: Request) => {
    if (!isCommit(request)) return;
    commits.push((async () => {
      const body = request.postData() ?? "";
      const sent = JSON.parse(body) as { clientTransactionId: string; segments: string[]; document: string };
      const response = await request.response().catch(() => null);
      return {
        clientTransactionId: sent.clientTransactionId,
        segmentHash: createHash("sha256").update(Buffer.from(sent.segments[0]!, "base64")).digest("hex"),
        body, document: Buffer.from(sent.document, "base64").toString("utf8"),
        status: response?.status() ?? null, answer: response ? await response.json().catch(() => undefined) : undefined,
      };
    })());
  };
  page.on("request", onRequest);
  return { all: () => Promise.all(commits), stop: () => page.off("request", onRequest) };
}

type ChipRecord = { chipStates: string[]; chipBefore?: string | null };
const CHIP = ".workspace__status .sync-chip";

/**
 * In the page: every state the sync chip changes to, so that a flash between
 * two checks is not missed. A state is noted only when it differs from the
 * one before it, so the state the chip already had at the last reset is not
 * noted again by the next unrelated DOM change.
 */
function recordChipStates() {
  const record = window as unknown as ChipRecord;
  record.chipStates = [];
  const note = () => {
    const state = document.querySelector(".workspace__status .sync-chip")?.getAttribute("data-state");
    const before = record.chipStates.at(-1) ?? record.chipBefore;
    if (state && before !== state) record.chipStates.push(state);
  };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
}
/** The chip's states since the last call (or the page load), then forgets them and keeps the current one as the baseline. */
const chipStates = (page: Page) => page.evaluate((chip) => {
  const record = window as unknown as ChipRecord;
  const seen = record.chipStates.splice(0);
  record.chipBefore = document.querySelector(chip)?.getAttribute("data-state");
  return seen;
}, CHIP);

/**
 * The server holds exactly the journal's text: the last answered commit's
 * receipt verifies under the stack's registered key for the database's
 * checkpoint, whose text is the journal snapshot's, and nothing is pending.
 */
async function expectServerHolds(page: Page, documentId: string, commits: Commit[], text: string) {
  const local = await localCheckpoint(page, documentId);
  expect(textOf(local)).toBe(text);
  expect(pendingOf(local, documentId)).toEqual([]);
  const { checkpoint, stack } = await withAdmin(async (client) => ({
    checkpoint: await stackCheckpoint(client, documentId), stack: await stackReceiptKeys(client, documentId),
  }));
  expect(checkpoint).not.toBeNull();
  expect(checkpoint!.body).toBe(canonicalizeJcs(local.snapshot!.document));
  const last = commits.filter((commit) => commit.status === 200).at(-1);
  expect(last?.document).toBe(checkpoint!.body);
  const signed = (last!.answer as { receipt?: { signedReceipt?: unknown } } | undefined)?.receipt?.signedReceipt;
  const check = await verifyWithStackKeys(signed, { documentId, ...last! }, checkpoint!, stack);
  expect(check).toMatchObject({ ok: true });
  return checkpoint!;
}

/** For the whole window the chip never shows the server state and the row stays in the journal. */
async function expectHeldLocally(page: Page, documentId: string, ms = 5_000) {
  await page.waitForTimeout(ms);
  expect(await chipStates(page)).not.toContain("SYNCED");
  await expect(chipOf(page)).not.toHaveAttribute("data-state", "SYNCED");
  expect(pendingOf(await localCheckpoint(page, documentId), documentId).length).toBeGreaterThan(0);
}

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
  k4Assignment = null;
  k4Document = null;
});

test("demo walk-through", async ({ browser, page, context }) => {
  let token = "";
  // The whole text of the K-4 work as the steps leave it: EXPECTED_TEXT until
  // the server step of F-8 writes on.
  let workText = EXPECTED_TEXT;

  await test.step("1. Nastavnik se prijavljuje demo računom", async () => {
    // "/" sends the signed-in person on to their own page (DAN-325); its shell still says demo.
    await signIn(page, "/", "Demo nastavnik");
    await expect(page).toHaveURL(ROLE_HOME);
    await expect(page.getByText(t.shell.demoBadge, { exact: true }).filter({ visible: true }).first()).toBeVisible();

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
    // DAN-346: against `pnpm demo:up:native` the same command uses the native
    // runner's socket instead of the Compose container.
    await run("node", ["scripts/demo/provision-teacher.mjs", ...NATIVE_PROVISION], { cwd: ROOT });
    await page.goto("/nastavnik/zadatak/novi");
    await expect(page.getByRole("heading", { name: t.teacher.title })).toBeVisible();

    await page.getByLabel(t.teacher.course.name).fill(COURSE_NAME);
    await fillCodeDeadline(page);
    // DAN-36 (#576): one click creates the course, then asks the real route (#575) for its code.
    const reply = page.waitForResponse((response) =>
      /\/api\/institution\/courses\/[^/]+\/enrollment-code$/.test(new URL(response.url()).pathname)
      && response.request().method() === "POST");
    await page.getByRole("button", { name: t.teacher.course.submit }).click();
    const issued = await reply;
    expect(issued.status()).toBe(200);
    expect(issued.headers()["cache-control"]).toBe("no-store");
    const { code } = await issued.json() as { code: string };
    expect(code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    await expect(page.getByRole("status").filter({ hasText: t.teacher.course.created })).toBeVisible();
    // FE-D10: the screen shows exactly the code the route returned, never an invented one.
    await expect(page.locator("form[aria-labelledby=kolegij] code")).toHaveText(code);
    const { course } = await k4Course();
    expect(new URL(issued.url()).pathname).toBe(`/api/institution/courses/${course}/enrollment-code`);
    enrollmentCode = code;
    await snapshot(page, "1-kolegij-stvoren");

    await page.getByLabel(t.teacher.assignment.title).fill("Izmišljeni zadatak o gradskim knjižnicama");
    // K-4e (#655): opened an hour ago, so the student can confirm this very
    // assignment in step 2; the form reads the value in the browser's time zone.
    const opened = await page.evaluate(() => {
      const at = new Date(Date.now() - 3_600_000);
      const two = (n: number) => String(n).padStart(2, "0");
      return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
    });
    await page.getByLabel(t.teacher.assignment.opensAt).fill(opened);
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
    await signOut(page, token, false);
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
      // F-6 opened the assignment an hour ago, so its notice can be confirmed (FE-D8).
      const { rows: [state] } = await withAdmin((client) => client.query<{ members: string; open: boolean }>(
        `SELECT (SELECT count(*) FROM institution.course_member m JOIN identity.user_account u ON u.id = m.user_id
                  WHERE m.course_id = $1 AND u.hr_edu_person_unique_id = $2 AND m.role = 'student'
                    AND m.member_to IS NULL) AS members,
                (SELECT v.opens_at <= now() FROM institution.assignment a JOIN institution.assignment_version v
                  ON v.assignment_id = a.id AND v.version_no = a.current_version WHERE a.id = $3) AS open`,
        [course, STUDENT_ID, assignmentId]));
      expect(Number(state!.members)).toBe(1);
      expect(state!.open).toBe(true);
      await expect(page.getByRole("checkbox", { name: t.student.checkbox })).toHaveCount(1);
      expect(evidenceRequests).toEqual([]);
      k4Assignment = assignmentId;
      await snapshot(page, "2-upis-kodom-obavijest-zadatka");
    } finally {
      page.off("request", observe);
    }
  });

  // K-4e (#655): the student confirms the notice of the very assignment the
  // teacher published in step 1 and opens it in the workspace, which names its
  // course and title. The page opens her own work of it with one POST (#711
  // F1); every later step writes, publishes and is commented in that document.
  await test.step("2. F-7: studentica potvrđuje obavijest zadatka iz koraka 1 i otvara ga u radu", async () => {
    expect(k4Assignment).not.toBeNull();
    const id = k4Assignment!;
    await expect(page).toHaveURL(`http://localhost:3000/zadatak/${id}`);
    const { rows: [current] } = await withAdmin((client) => client.query<{ version: number }>(
      "SELECT current_version AS version FROM institution.assignment WHERE id = $1", [id]));
    const confirm = page.getByRole("button", { name: t.student.confirm });
    await expect(confirm).toBeDisabled();
    await page.getByRole("checkbox", { name: t.student.checkbox }).check();
    const acknowledged = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/institution/assignments/${id}/acknowledgment`);
    await confirm.click();
    const response = await acknowledged;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ versionNo: current!.version });
    const { rows } = await withAdmin((client) => client.query<{ version_no: number }>(
      `SELECT n.version_no FROM institution.notice_acknowledgment n JOIN identity.user_account u ON u.id = n.student_id
        WHERE n.assignment_id = $1 AND u.hr_edu_person_unique_id = $2`, [id, STUDENT_ID]));
    expect(rows).toEqual([{ version_no: current!.version }]);
    await page.getByRole("link", { name: t.student.openEditor }).click();
    await page.waitForURL(`http://localhost:3000/rad?zadatak=${id}`);
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
    await expect(page.locator(".brand-line__context")).toHaveText(`${COURSE_NAME} / ${ASSIGNMENT_TITLE}`);
    k4Document = await workDocument(id);
    expect(k4Document).not.toBe(LOCAL_DEMO_DOCUMENT_ID);
    await snapshot(page, "2-rad-na-zadatku-iz-koraka-1");
  });

  await test.step("2. F-7 djelomično: studentica potvrđuje obavijest kroz stvarno sučelje", async () => {
    await seed();
    await clearNoticeFixture();
    const { rows: [assignment] } = await withAdmin((client) => client.query<{ id: string; version: number; title: string }>(
      `SELECT a.id, a.current_version AS version, v.title FROM evidence.document d
       JOIN evidence.project p ON p.id = d.project_id JOIN institution.assignment a ON a.id = p.assignment_id
       JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
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
    // #711 F1: the fixture's document has the fixed local id, which a signed-in
    // student never writes into: the same neutral sheet as any other refusal.
    await expect(page.locator(".sheet-area")).toContainText(t.workspace.unavailable);
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    expect(await page.content()).not.toContain(LOCAL_DEMO_DOCUMENT_ID);
    // Back to her own work of the K-4 assignment; F-8 point 5: the sheet heading names it.
    await page.goto(`/rad?zadatak=${k4Assignment!}`);
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
    // The first opening refreshes the render into a freshly mounted editor (#731).
    await editorMounted(page);
    await expect(page.locator("h1.manuscript__title")).toHaveText(ASSIGNMENT_TITLE);
    await snapshot(page, "2-editor-nakon-potvrde");
  });

  await test.step("2. Studentica piše, a tekst je spremljen na uređaju", async () => {
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await editorOf(page).click();
    await page.keyboard.type(TEXT);
    await expect(chipOf(page)).toHaveAttribute("data-state", SAVED_HERE);
    await snapshot(page, "2-spremljeno-na-uredaju");
  });

  // This is the local part of F-8 only. The signed server receipt below is
  // still a missing acceptance criterion, not inferred from a network return.
  await test.step("2. F-8 lokalno: prekid mreže, dopuna i oporavak nakon povratka", async () => {
    // The receipt for the text above moves the revision (3d-2c2b): the
    // checkpoint is read after it, so going offline is all that changes.
    await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: 30_000 });
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
      // Online again, the evidence session sends what waited (3d-2c2), so the
      // rows and the meta move on; the text on the device does not (G2).
      await expect(chipOf(page)).toHaveAttribute("data-state", SAVED_HERE);
      const restored = await localCheckpoint(page);
      expect(restored.snapshot?.document).toEqual(saved.snapshot?.document);
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
      const published = await page.request.put(livePath(), {
        headers: { origin: "http://localhost:3000", "content-type": "application/json", "if-none-match": "*" }, data: body,
      });
      expect(published.status()).toBe(200);
      expect(await published.json()).toMatchObject({ outcome: "accepted" });
      const ownerRead = await page.request.get(livePath(), { headers: LIVE_READ_HEADERS });
      expect(ownerRead.status()).toBe(200);
      expect(await ownerRead.text()).toBe(body);
      expect(ownerRead.headers().etag).toBe(etag);

      const liveRead = teacher.waitForResponse((response) => new URL(response.url()).pathname === livePath() && response.status() === 200);
      await teacher.goto(`/nastavnik/rad/${k4Document!}`);
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

  // F-8 text part (K-4c-1, #655): a heading from the toolbar, a citation and a
  // bibliography in the FPZG style as plain text (D-98 addition), all written
  // without the network. It claims only "spremljeno na uređaju": nothing in it
  // reaches the server, and no server state is asserted.
  await test.step("2. F-8: naslovi, citat i bibliografija bez mreže, spremljeni na uređaju", async () => {
    const before = await localCheckpoint(page);
    expect(blocksOf(before)).toEqual(BLOCKS.slice(0, 1));
    const viewport = page.viewportSize();
    // (b) Any request to the sync routes in this step fails it.
    const syncRequests: string[] = [];
    const observe = (request: Request) => {
      const url = new URL(request.url());
      if (isSyncUrl(url)) syncRequests.push(url.pathname);
    };
    page.on("request", observe);
    await context.setOffline(true);
    try {
      await expect(page.locator(".offline-chip")).toHaveText(t.network.offline);
      // The observer sees a request that the outage stops: an empty list below is not vacuous.
      expect(await page.evaluate(() => fetch("/api/evidence/commit", { method: "POST" }).then(() => "sent", () => "failed"))).toBe("failed");
      expect(syncRequests).toEqual(["/api/evidence/commit"]);
      syncRequests.length = 0;

      // At 1440 px every tool fits in the toolbar (toolbar-menus.spec.ts), none in "Više".
      // The default viewport comes back in `finally`, so later steps keep their layout.
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(heading1Of(page)).toBeVisible();
      await editorOf(page).click();
      await editorOf(page).press("Control+End");
      for (const block of BLOCKS.slice(1)) {
        await page.keyboard.press("Enter");
        if (block.type === "heading") await heading1Of(page).click();
        await page.keyboard.type(block.text);
      }
      await expect(editorOf(page)).toHaveText(EXPECTED_TEXT);
      await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
      const saved = await localCheckpoint(page);
      expect(blocksOf(saved)).toEqual(BLOCKS);
      expect(saved.meta!.localSeq).toBeGreaterThan(before.meta!.localSeq);
      expect(saved.snapshot?.revision).toBe(before.snapshot?.revision);
      // (a) The editor holds the function's output; a source one character off is not in it.
      const [citationBlock, , entryBlock] = blocksOf(saved).slice(2);
      expect(citationBlock!.text).not.toContain(formatInText({ ...SOURCE, year: SOURCE.year + 1 }, FPZG, PAGES));
      expect(entryBlock!.text).not.toBe(formatBibliographyEntry({ ...SOURCE, year: SOURCE.year + 1 }, FPZG));
      // The chapter heading uses the sheet type, not the browser's h1 (~33 px,
      // synthetic bold): below 20 px, no larger than the sheet title, weight 500.
      const typeOf = (locator: ReturnType<Page["locator"]>) =>
        locator.evaluate((el) => {
          const style = getComputedStyle(el);
          return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
        });
      const chapter = await typeOf(editorOf(page).locator("h1").first());
      const title = await typeOf(page.locator(".manuscript__title"));
      expect(chapter.size).toBeLessThan(20);
      expect(chapter.size).toBeLessThanOrEqual(title.size);
      expect(chapter.weight).toBeLessThanOrEqual(500);
      await attachCheckpoint("2-f8-tekst-bez-mreze.json", saved);
      await snapshot(page, "2-f8-naslovi-citat-literatura-bez-mreze");

      // (b) Nothing went to the server during the outage.
      expect(syncRequests).toEqual([]);

      // (c) A reload while the server is still out of reach. The page itself
      // needs the network to load (no service worker), so only it gets the
      // network back; every sync route stays cut off. With the network back the
      // live publisher (#522, BACKEND 4.12 t. 8) may send the last state: it is
      // not evidence, and it must be exactly the saved text. Nothing else goes.
      const livePuts: (string | null)[] = [];
      await page.route(isSyncUrl, (route) => {
        if (route.request().method() === "PUT" && route.request().url().endsWith(livePath())) livePuts.push(route.request().postData());
        return route.abort("internetdisconnected");
      });
      await context.setOffline(false);
      await page.reload();
      await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
      await expect(editorOf(page)).toHaveText(EXPECTED_TEXT);
      // The network's return may let the session try the owed rows before the
      // reload (3d-2c2b); the cut route fails that try, and a failed send shows
      // "Greška" (3d-2c2 O2). Either way the text is on the device, never SYNCED.
      await expect(chipOf(page)).toHaveAttribute("data-state", /^(LOCAL_DURABLE|ERROR)$/);
      const restored = await localCheckpoint(page);
      expect(restored.snapshot).toEqual(saved.snapshot);
      expect(restored.pending).toEqual(saved.pending);
      expect(restored.meta!.localSeq).toBe(saved.meta!.localSeq);
      expect(restored.meta!.evidenceHead).toEqual(saved.meta!.evidenceHead);
      // The evidence session asks for the work once on load, and may try a
      // commit; the route cuts both off, so nothing reaches the server (3d-2c2 §2 t. 4).
      expect(syncRequests.filter((path) =>
        path !== livePath() && path !== "/api/evidence/open" && path !== "/api/evidence/commit")).toEqual([]);
      const savedBody = canonicalizeJcs(saved.snapshot!.document);
      for (const body of livePuts) expect(body).toBe(savedBody);
      await attachCheckpoint("2-f8-oporavljeno-nakon-reloada.json", restored);
      await snapshot(page, "2-f8-oporavljeno-nakon-reloada");
    } finally {
      page.off("request", observe);
      await page.unroute(isSyncUrl);
      await context.setOffline(false);
      if (viewport) await page.setViewportSize(viewport);
    }
  });

  // The server part of F-8 (K-4c-2 in #655), on the evidence session of
  // 3d-2c2b (#811): "Spremljeno na poslužitelju" only after a signed receipt
  // that verifies under the stack's key for the database's checkpoint, and the
  // offline text on the server after the return. The step goes on writing at
  // the end of the K-4 work from the steps above (open_student_work made it
  // with its package), so the later steps expect `workText`, the whole text.
  // The Node checks are in evidence-receipt.ts.
  // Criterion 5 of #655 (the offline mark after sync, PRODUCT §5 rule 10) has
  // no carrier yet: neither segment v2, receipt v2 nor the chip keeps it
  // (c.6386046693). It stays a named gap of the GO record; nothing here stands in for it.
  await test.step("2. F-8 na poslužitelju: potpisana potvrda i tekst bez mreže na poslužitelju (3d-2c2)", async () => {
    test.info().setTimeout(test.info().timeout + 120_000);
    expect(k4Assignment).not.toBeNull();
    const workPath = `/rad?zadatak=${k4Assignment}`;
    // Only records; it stays in the page for the later steps and changes nothing there.
    await page.addInitScript(recordChipStates);
    const commits = watchCommits(page);
    try {
      await page.goto(workPath);
      await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
      await expect(editorOf(page)).toHaveText(EXPECTED_TEXT);
      const documentId = await workDocumentOf(k4Assignment!);
      expect(documentId).toBe(k4Document);
      // The seeded document of the earlier steps opens like any work (#727):
      // one package, in the one evidence domain whose receipt key the stack registered.
      await withAdmin(async (client) => {
        const { rows } = await client.query("SELECT 1 FROM evidence.package WHERE document_id = $1", [LOCAL_DEMO_DOCUMENT_ID]);
        expect(rows).toHaveLength(1);
        await stackReceiptKeys(client, LOCAL_DEMO_DOCUMENT_ID);
      });

      // 1. Typing reaches the server state only with a receipt that verifies
      // under the stack's key for the checkpoint, whose text is the journal's.
      // The rows the cut routes above held go first (the drain), then this text.
      await editorOf(page).click();
      await editorOf(page).press("Control+End");
      await page.keyboard.type(SERVER_TEXT);
      let text = EXPECTED_TEXT + SERVER_TEXT;
      await expect(editorOf(page)).toHaveText(text);
      await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", SYNCED_WAIT);
      const online = await expectServerHolds(page, documentId, await commits.all(), text);
      await attachCheckpoint("2-f8-poruka-potvrdena-na-posluzitelju.json", await localCheckpoint(page, documentId));
      await snapshot(page, "2-f8-spremljeno-na-posluzitelju");

      // 2. Without a network: the text stays on the device, no commit reaches
      // the server and the database keeps the checkpoint from before the outage.
      const reached: string[] = [];
      const onFinished = (request: Request) => { if (isCommit(request)) reached.push(request.url()); };
      await chipStates(page);
      await context.setOffline(true);
      page.on("requestfinished", onFinished);
      try {
        await expect(page.locator(".offline-chip")).toHaveText(t.network.offline);
        await editorOf(page).press("Control+End");
        await page.keyboard.type(SERVER_OFFLINE_TEXT);
        text += SERVER_OFFLINE_TEXT;
        await expect(editorOf(page)).toHaveText(text);
        await expect.poll(async () => textOf(await localCheckpoint(page, documentId))).toBe(text);
        await expectHeldLocally(page, documentId, 3_000);
        expect(reached).toEqual([]);
        expect(await withAdmin((client) => stackCheckpoint(client, documentId))).toEqual(online);
        await snapshot(page, "2-f8-bez-mreze-na-uredaju");
      } finally {
        page.off("requestfinished", onFinished);
        await context.setOffline(false);
      }
      // After the return the offline text is on the server under a new revision.
      await expect(page.locator(".offline-chip")).toHaveCount(0);
      await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", SYNCED_WAIT);
      const returned = await expectServerHolds(page, documentId, await commits.all(), text);
      expect(returned.revision).toBeGreaterThan(online.revision);
      await snapshot(page, "2-f8-tekst-bez-mreze-na-posluzitelju");

      // (a) The answer is lost on the way back: the text stays local, and the
      // retry sends the same key with the same bytes and gets the receipt.
      await loseNextCommitAnswer(page);
      const beforeLost = (await commits.all()).length;
      const lost = page.waitForEvent("requestfailed", isCommit);
      await page.keyboard.type(" Prvi dio.");
      text += " Prvi dio.";
      await lost;
      expect(pendingOf(await localCheckpoint(page, documentId), documentId).length).toBeGreaterThan(0);
      await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", SYNCED_WAIT);
      const tries = (await commits.all()).slice(beforeLost);
      expect(tries[0]!.status).toBeNull();
      const retry = tries.find((commit) => commit.status === 200 && commit.clientTransactionId === tries[0]!.clientTransactionId);
      expect(retry?.body).toBe(tries[0]!.body);
      await expectServerHolds(page, documentId, tries, text);

      // (b) A receipt with one changed signature byte is never the server
      // state; the row stays until a reload sends the same key again.
      await tamperNextReceipt(page);
      const forged = page.waitForResponse((response) => isCommit(response.request()));
      await chipStates(page);
      await page.keyboard.type(" Drugi dio.");
      text += " Drugi dio.";
      await forged;
      await expectHeldLocally(page, documentId);
      await snapshot(page, "2-f8-krivotvorena-potvrda-nije-na-posluzitelju");
      await page.unroute(COMMIT_ROUTE);
      await page.reload();
      await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", SYNCED_WAIT);
      await expectServerHolds(page, documentId, await commits.all(), text);

      // (c) The stack's own receipt for an earlier segment is not an ACK.
      await replayFirstReceipt(page);
      await editorOf(page).click();
      await editorOf(page).press("Control+End");
      await page.keyboard.type(" Treći.");
      text += " Treći.";
      await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", SYNCED_WAIT);
      const replayed = page.waitForResponse((response) => isCommit(response.request()));
      await chipStates(page);
      await page.keyboard.type(" Četvrti.");
      text += " Četvrti.";
      await replayed;
      await expectHeldLocally(page, documentId);
      await page.unroute(COMMIT_ROUTE);
      await page.reload();
      await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", SYNCED_WAIT);
      await expectServerHolds(page, documentId, await commits.all(), text);

      // (d) After sign-out and a new sign-in nothing is the server state
      // until this session gets a receipt of its own. Whether the dialog
      // opens depends on the receipt's timing (3d-2c2b), so either way is fine.
      await signOutHoweverHeld(page);
      expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
      await forgetProviderLogin(context);
      const beforeSignIn = (await commits.all()).length;
      await signIn(page, workPath, "Demo studentica");
      token = (await appCookie(context, SESSION_COOKIE))!.value;
      await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
      await expect(editorOf(page)).toHaveText(text);
      await page.waitForTimeout(3_000);
      expect(await chipStates(page)).not.toContain("SYNCED");
      expect((await commits.all()).slice(beforeSignIn)).toEqual([]);
      await editorOf(page).click();
      await editorOf(page).press("Control+End");
      await page.keyboard.type(" Nakon prijave.");
      text += " Nakon prijave.";
      await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", SYNCED_WAIT);
      await expectServerHolds(page, documentId, (await commits.all()).slice(beforeSignIn), text);
      await snapshot(page, "2-f8-nova-potvrda-nakon-prijave");
      workText = text;
    } finally {
      commits.stop();
      await page.unroute(COMMIT_ROUTE);
      await context.setOffline(false);
    }
  });

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
    const listed = await post(page, "list", { documentId: k4Document! });
    expect(listed.status()).toBe(403);
    expect(await listed.json()).toEqual({ error: "forbidden" });
    const live = await page.request.get(livePath(), { headers: LIVE_READ_HEADERS });
    expect(live.status()).toBe(404);
    expect(await live.json()).toEqual({ error: "not_found" });
    await snapshot(page, "2-drugi-student-izoliran");
    await signOut(page, token, false);
  });

  await test.step("2. Ponovna prijava studentice vraća njezin lokalni nacrt i komentar", async () => {
    await signIn(page, `/rad?zadatak=${k4Assignment!}`, "Demo studentica");
    token = (await appCookie(context, SESSION_COOKIE))!.value;
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(page)).toHaveText(workText);
    // A send cut off in the step above may have left "Greška"; the drain sends
    // the owed rows again now that the routes are back (3d-2c2b).
    await expect(chipOf(page)).toHaveAttribute("data-state", SAVED_HERE, { timeout: 30_000 });
    await expect(page.getByText(COMMENT, { exact: true })).toBeVisible();
    await snapshot(page, "2-vlasnica-nastavlja-nacrt");
    await signOut(page, token);
  });

  // D-142 (K-4d, #655): the test sends nothing to the live route here. The
  // student's own tab publishes from the editor (LocalDocument, BACKEND 4.12
  // t. 7 and 8) and the teacher's open view takes the new state by itself,
  // without a reload. The live state is not the evidence and claims no receipt.
  await test.step("3. F-9: nastavnik uživo vidi stanje studentova rada", async () => {
    await signIn(page, `/rad?zadatak=${k4Assignment!}`, "Demo studentica");
    token = (await appCookie(context, SESSION_COOKIE))!.value;
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
    await expect(editorOf(page)).toHaveText(workText);
    const puts: (string | null)[] = [];
    const onPut = (request: Request) => {
      if (request.method() === "PUT" && new URL(request.url()).pathname === livePath()) puts.push(request.postData());
    };
    page.on("request", onPut);
    const teacher = await (await browser.newContext()).newPage();
    try {
      await signIn(teacher, "/", "Demo nastavnik");
      await teacher.goto(`/nastavnik/rad/${k4Document!}`);
      const text = teacher.getByRole("document", { name: t.liveView.documentLabel });
      await expect(text).toContainText(QUOTE);
      await expect(text).not.toContainText(LIVE_TEXT);
      let navigations = 0;
      teacher.on("framenavigated", (frame) => { if (frame === teacher.mainFrame()) navigations += 1; });
      await snapshot(teacher, "3-nastavnik-otvara-rad-uzivo");

      // The caret goes to the end of the last block before typing: in CI a
      // click and Control+End once left it at the end of the citation paragraph.
      await editorOf(page).locator("p").last().click();
      await editorOf(page).evaluate((editor) => {
        const range = document.createRange();
        range.selectNodeContents(editor.lastElementChild!);
        range.collapse(false);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      });
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type(LIVE_TEXT);
      // A new paragraph: the editor's text joins the blocks without a separator.
      workText += LIVE_TEXT;
      await expect(editorOf(page)).toHaveText(workText);
      await expect(text).toContainText(LIVE_TEXT, { timeout: 15_000 });
      expect(navigations).toBe(0);
      // What the teacher reads is the editor's own last PUT, the journal's exact state.
      const body = canonicalizeJcs((await localCheckpoint(page)).snapshot!.document);
      await expect.poll(() => puts.at(-1)).toBe(body);
      const read = await teacher.request.get(livePath(), { headers: LIVE_READ_HEADERS });
      expect(read.status()).toBe(200);
      expect(await read.text()).toBe(body);
      await snapshot(teacher, "3-nastavnik-vidi-promjenu-uzivo");
      await snapshot(page, "3-studentica-pise-dok-nastavnik-gleda");
    } finally {
      page.off("request", onPut);
      await teacher.context().close();
    }
    await signOut(page, token);
  });
  // F-10 (demo points 4 and 5): proves that the student submits, the server
  // reconstructs the work and the comparison matches, the student gets the
  // signed receipt, and student and teacher see the same process summary,
  // made by the same function, with no forbidden words and no percentages
  // (PRODUCT §5 rules 2, 5 and 11).
  //
  // Runs only once 3d-2c2b (#811, DAN-37) is in main: before it the server
  // holds revision 0 of the work, so the page shows `noEvidence` and no button.
  // Every locator here is a role, label or visible text (the layout is being
  // redesigned). The oracle for the server is the database's checkpoint.
  await test.step("4. i 5. F-10: predaja, potpisana potvrda i isti sažetak procesa za oba", async () => {
    const s = t.submission;
    await signIn(page, `/rad?zadatak=${k4Assignment!}`, "Demo studentica");
    await expect(editorOf(page)).toHaveText(workText, { timeout: 30_000 });
    // The drain has sent every owed row: the server's text is the whole draft.
    const checkpoint = () => withAdmin((client) => stackCheckpoint(client, k4Document!));
    await expect.poll(async () => {
      const held = await checkpoint();
      return held && (JSON.parse(held.body) as CanonicalDocument).nodes
        .flatMap((node) => node.children.map((child) => child.text)).join("");
    }, { timeout: 30_000 }).toBe(workText);
    const server = (await checkpoint())!;

    // Demo point 4: the way in is the workspace's own link.
    await page.getByRole("link", { name: t.workspace.submitLink, exact: true }).click();
    await page.waitForURL(`http://localhost:3000/rad/${k4Assignment!}/predaja`);
    await expect(page.getByRole("heading", { level: 1, name: s.title })).toBeVisible();
    const steps = page.getByRole("list", { name: s.title });
    await expect(steps.getByRole("listitem").filter({ hasText: s.steps.submit })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("document", { name: s.textLabel })).toHaveText(workText);
    await expect(page.getByText(s.serverNote)).toBeVisible();
    await snapshot(page, "4-predaja-provjera");

    const sent: string[] = [];
    const observe = (request: Request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/submission") sent.push(request.postData() ?? "");
    };
    page.on("request", observe);
    let receipt!: { payload: Record<string, unknown> & { evidenceDomainId: string } };
    try {
      const answered = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/submission" && response.request().method() === "POST");
      await page.getByRole("button", { name: s.submit }).click();
      const response = await answered;
      expect(response.status()).toBe(200);
      const body = await response.json() as { status: string; receipt: typeof receipt };
      expect(body.status).toBe("submitted");
      receipt = body.receipt;
      // Exactly the revision the server holds, of this work, once (QA criteria 1 and 2).
      await expect(page.getByRole("heading", { name: s.receiptTitle })).toBeVisible();
      expect(sent.map((data) => JSON.parse(data))).toEqual([{ documentId: k4Document!, revision: server.revision }]);
    } finally {
      page.off("request", observe);
    }
    expect(receipt.payload).toMatchObject({
      documentId: k4Document!, assignmentId: k4Assignment!, revision: server.revision, artifactSha256: server.contentHash,
    });
    // Signed under the stack's registered keys, never a key the answer names (as evidence-receipt.ts).
    const expected = Object.fromEntries(Object.entries({
      ...receipt.payload, documentId: k4Document!, assignmentId: k4Assignment!, revision: server.revision, artifactSha256: server.contentHash,
    }).filter(([name]) => name !== "receiptSchema" && name !== "signedAt"));
    const stack = await withAdmin((client) => stackKeysOfDomain(client, receipt.payload.evidenceDomainId));
    expect(await verifySignedSubmissionReceiptV2(receipt, expected, stack.keys)).toMatchObject({ ok: true });
    await expect(page.getByText(server.contentHash, { exact: true })).toBeVisible();
    await expect(page.getByText(s.receiptNote)).toBeVisible();
    await expect(steps.getByRole("listitem").filter({ hasText: s.steps.receipt })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: s.submit })).toHaveCount(0);
    await snapshot(page, "4-potvrda-o-predaji");

    // Demo point 5: the same summary, drawn by the same view, for both roles
    // (PRODUCT §5 rules 2, 5 and 11): no forbidden words and no percentages.
    const summaryOf = (where: Page) => where.getByRole("region", { name: t.summary.title });
    await page.getByRole("button", { name: t.summaryCard.refresh }).click();
    await expect(summaryOf(page).getByText(t.summary.sameForEveryone)).toBeVisible();
    const studentSummary = await summaryOf(page).textContent();
    const teacher = await (await browser.newContext()).newPage();
    try {
      await signIn(teacher, "/", "Demo nastavnik");
      // DAN-332 PR 4 (#826): the teacher's list says the work was submitted, before the deadline (15. 12.).
      await teacher.goto("/nastavnik");
      const k4Link = teacher.locator(`a[href="/nastavnik/rad/${encodeURIComponent(k4Document!)}"]`);
      await expect(teacher.getByRole("list", { name: t.teacherCourses.worksLabel }).getByRole("listitem").filter({ has: k4Link }))
        .toHaveText(new RegExp(`^${t.teacherCourses.work} \\d+ · ${t.teacherCourses.submission.onTime}$`));
      await teacher.goto(`/nastavnik/rad/${k4Document!}`);
      await expect(summaryOf(teacher).getByText(t.summary.sameForEveryone)).toBeVisible({ timeout: 30_000 });
      expect(await summaryOf(teacher).textContent()).toBe(studentSummary);
      await snapshot(teacher, "5-sazetak-kod-nastavnika");
    } finally {
      await teacher.context().close();
    }
    expect(studentSummary).not.toContain("%");
    expect(findForbiddenTerms(studentSummary!)).toEqual([]);
    await snapshot(page, "5-sazetak-kod-studentice");
  });
});
