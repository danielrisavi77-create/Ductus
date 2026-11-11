import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { sessionTag } from "../../src/server/auth/principal";
import { localAdminUrl } from "./local-db-url";
import { SESSION_COOKIE, appCookie, sessionRow, signIn } from "./support";

// DAN-99, finding (1) on #1836 (contract c.6797869472): after a sign-out the
// route did not answer, the page's script leaves the mark of the session
// (ductus-ended-<tag>). The teacher's and the administrator's screens read it
// on the server and show the sign-in card, while the session row and its
// cookie stay as they were: nothing is closed by reading a mark (DAN-511b).
// The mark is written the way endSessionsInCookie writes it, from the page.
// The teacher role and the administrator appointment come from the local
// operator procedures and are taken away again; every account is invented.

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TEACHER_ID = "demo-teacher@demo.ductus.test";
const ACTIVE_ROLE = `FROM institution.institution_role r JOIN identity.user_account u ON u.id = r.user_id
  WHERE u.hr_edu_person_unique_id = $1 AND r.role = 'teacher' AND r.revoked_at IS NULL`;
const REQUEST = "Zahtjev e2e DAN-99/2026";
let roleGrantedByThisTest = false;

async function asAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const teacherRoleActive = () => asAdmin(async (client) =>
  (await client.query(`SELECT 1 ${ACTIVE_ROLE} AND r.confirmed_at IS NOT NULL`, [TEACHER_ID])).rowCount === 1);

test.afterEach(async () => {
  if (!roleGrantedByThisTest) return;
  await asAdmin((client) => client.query(
    `UPDATE institution.institution_role SET revoked_at = now() WHERE id IN (SELECT r.id ${ACTIVE_ROLE} AND r.confirmed_by IS NULL)`,
    [TEACHER_ID]));
  roleGrantedByThisTest = false;
});

/** Signs in as the invented teacher with a confirmed role; returns the session token. */
async function asTeacher(page: Page): Promise<string> {
  await signIn(page, "/", "Demo nastavnik");
  roleGrantedByThisTest = !(await teacherRoleActive());
  await run("node", ["scripts/local/provision-teacher.mjs"], { cwd: ROOT });
  return token(page);
}

async function token(page: Page): Promise<string> {
  const value = (await appCookie(page.context(), SESSION_COOKIE))?.value;
  expect(value).toBeDefined();
  return value!;
}

/** Appoints or revokes the person behind the session cookie as administrator. */
async function operator(sessionToken: string, procedure: "appoint" | "revoke"): Promise<void> {
  await asAdmin(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT s.user_id AS id FROM identity.session s WHERE s.token_hash = $1",
      [createHash("sha256").update(sessionToken, "utf8").digest()]);
    expect(rows).toHaveLength(1);
    await client.query(`SELECT institution.${procedure}_institution_admin($1, $2)`, [rows[0]!.id, REQUEST]);
  });
}

/** The mark of an ended session, written by the page's script as endSessionsInCookie does. */
async function markEnded(page: Page, sessionToken: string): Promise<string> {
  const tag = sessionTag(sessionToken);
  expect(tag).not.toBeNull();
  await page.evaluate((value) => {
    document.cookie = `ductus-ended-${value}=1; Path=/; Max-Age=86400; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, tag!);
  expect(await appCookie(page.context(), `ductus-ended-${tag}`)).toBeDefined();
  return tag!;
}

/** The screen shows the sign-in card and nothing of the session behind the cookie. */
async function expectSignedOutCard(page: Page, path: string, title: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: t.access.signedOutTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: t.prijava.button }))
    .toHaveAttribute("href", `/api/auth/login?returnTo=${encodeURIComponent(path)}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.shell.signOut })).toHaveCount(0);
}

/** Reading the mark closed nothing: the row is open and the cookie is still the same one. */
async function expectSessionUntouched(page: Page, sessionToken: string): Promise<void> {
  expect((await sessionRow(sessionToken))?.closed_at).toBeNull();
  expect((await appCookie(page.context(), SESSION_COOKIE))?.value).toBe(sessionToken);
}

test("the teacher's screens and course list read the mark of an ended session, and close nothing", async ({ page }) => {
  const session = await asTeacher(page);
  await page.goto("/nastavnik");
  await expect(page.getByRole("heading", { level: 1, name: t.teacherCourses.title })).toBeVisible();
  expect((await page.request.get("/api/teacher/courses")).status()).toBe(200);

  await markEnded(page, session);
  for (const [path, title] of [
    ["/nastavnik", t.teacherCourses.title],
    ["/nastavnik/zadatak/novi", t.teacherCourses.title],
    ["/nastavnik/mentorstva", t.teacherCourses.title],
    ["/nastavnik/brz-put", t.fastPath.title],
  ] as const) {
    await expectSignedOutCard(page, path, title);
  }
  const courses = await page.request.get("/api/teacher/courses");
  expect(courses.status()).toBe(401);
  expect(JSON.stringify(await courses.json())).not.toContain("Izmišljeni kolegij");
  await expectSessionUntouched(page, session);
});

test("the administrator's overview reads the mark of an ended session, and closes nothing", async ({ page }) => {
  await signIn(page, "/zadaci", "Ustanova B: nastavnica");
  const session = await token(page);
  await operator(session, "appoint");
  try {
    await page.goto("/ustanova");
    await expect(page.getByRole("heading", { level: 1, name: t.institutionOverview.title })).toBeVisible();

    await markEnded(page, session);
    for (const [path, title] of [
      ["/ustanova", t.institutionOverview.title],
      ["/ustanova/korisnici", t.institutionOverview.title],
      ["/ustanova/pravila", t.facultyRuleVersions.title],
    ] as const) {
      await expectSignedOutCard(page, path, title);
    }
    await expect(page.getByRole("link", { name: t.shell.nav.institutionCourses })).toHaveCount(0);
    await expectSessionUntouched(page, session);
  } finally {
    await operator(session, "revoke");
  }
});

// Istodobnost: session A ended without an answer and left its mark; session B
// then signs in in the same browser. The mark of A never hides B.
test("a newer session in the same browser keeps its screens beside the mark of the ended one", async ({ page }) => {
  await asTeacher(page);
  await signIn(page, "/zadaci", "Ustanova B: nastavnica");
  const ended = await token(page);
  const tagA = await markEnded(page, ended);

  await signIn(page, "/nastavnik", "Demo nastavnik");
  const live = await token(page);
  expect(live).not.toBe(ended);
  expect(sessionTag(live)).not.toBe(tagA);
  expect(await appCookie(page.context(), `ductus-ended-${tagA}`)).toBeDefined();

  await expect(page.getByRole("heading", { level: 1, name: t.teacherCourses.title })).toBeVisible();
  await expect(page.getByRole("button", { name: t.shell.signOut })).toBeVisible();
  expect((await page.request.get("/api/teacher/courses")).status()).toBe(200);
  expect((await sessionRow(live))?.closed_at).toBeNull();
});
