import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// F-7: the screens without a notice, and (DAN-227, #476 row 1) the notice a
// student of the course reads before the first sentence, with the text of
// D-142 and D-143. No route creates a course for the demo student yet, so the
// invented course, assignment and membership are written through the admin
// login of the compose database, as in comments.spec.ts. Assignment versions
// are immutable, so they stay; the membership is closed afterwards.
const PATH = "/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const STUDENT = "demo-student@demo.ductus.test";

/** The seed writes as the database owner, so it never runs against a database off this machine. */
function localAdminUrl(url: string): string {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("the e2e seed runs only against a local database");
  return url;
}

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl(ADMIN_DATABASE_URL) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * FE-D8: where the assignment stands in time (SQL intervals from now) and
 * whether the student has already confirmed its notice.
 */
interface Seed {
  opens?: string;
  due?: string;
  acknowledged?: boolean;
}

/** An invented course and assignment the demo student is a student of. */
async function seedAssignment(seed: Seed = {}): Promise<{ assignment: string; course: string; courseName: string }> {
  const { opens = "0 seconds", due = "30 days", acknowledged = false } = seed;
  return admin(async (client) => {
    await client.query("BEGIN");
    const { rows: [me] } = await client.query<{ id: string; institution: string }>(
      "SELECT id, institution_id AS institution FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [STUDENT]);
    if (!me) throw new Error("the demo student must have signed in");
    const suffix = Date.now().toString(36);
    const courseName = `Izmišljeni kolegij S3 ${suffix}`;
    const { rows: [course] } = await client.query<{ id: string }>(
      `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, '2026/2027', 'prohibited', $3) RETURNING id`, [me.institution, courseName, me.id]);
    const { rows: [assignment] } = await client.query<{ id: string }>(
      `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, 1, $3) RETURNING id`, [course!.id, me.institution, me.id]);
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmišljeni zadatak S3', 'Upute za izmišljeni zadatak.', 'essay', now() + $3::interval,
         now() + $4::interval, 'prohibited', '{}', 'basic', false, $2)`, [assignment!.id, me.id, opens, due]);
    await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
      [course!.id, me.institution, me.id]);
    if (acknowledged) {
      await client.query(
        `INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
         VALUES ($1, 1, $2, $3)`, [assignment!.id, me.id, me.institution]);
    }
    await client.query("COMMIT");
    return { assignment: assignment!.id, course: course!.id, courseName };
  });
}

test("the seed refuses a database that is not local", () => {
  expect(localAdminUrl("postgres://u:p@127.0.0.1:54329/ductus")).toContain("127.0.0.1");
  expect(localAdminUrl("postgres://u:p@localhost:5432/ductus")).toContain("localhost");
  for (const url of ["postgres://u:p@db.example.test:5432/ductus", "postgres://u:p@127.0.0.1.example.test/ductus",
    "postgres://u:p@10.0.0.5/ductus"]) {
    expect(() => localAdminUrl(url)).toThrow("only against a local database");
  }
});

test("anonymous visitor sees no notice and no confirmation", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(request.url()); });
  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: t.student.title })).toBeVisible();
  await expect(page.getByText(t.student.signedOut)).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test("signed-in student outside the course sees no notice", async ({ page }) => {
  await signIn(page, PATH, "Demo studentica");
  await expect(page.getByText(t.student.notFound)).toBeVisible();
  await expect(page.getByRole("button", { name: t.student.confirm })).toHaveCount(0);
});

test("a student of the course reads the live view and the replay of D-154 before the first sentence", async ({ page }) => {
  // The account exists once it has signed in; the notice is not there yet.
  await signIn(page, PATH, "Demo studentica");
  const seeded = await seedAssignment();
  try {
    await page.goto(`/zadatak/${seeded.assignment}`);
    await expect(page.getByRole("heading", { name: t.student.teacherHeading })).toBeVisible();
    for (const text of [t.student.recorded.live, t.student.notRecorded.inputs, t.student.teacher.state,
      t.student.teacher.replay, t.student.teacher.purpose]) {
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(t.student.checkbox)).toBeVisible();
    await expect(page.getByText("Pojedinačni unosi")).toHaveCount(0);
    await expect(page.getByText("reprodukciju ne vidiš")).toHaveCount(0);
    await test.info().attach("s3-obavijest-d142-d143", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally {
    await admin((client) => client.query(
      "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [seeded.course]));
  }
});

// FE-D8 (#476 row 05): the Ductura layout of the notice and its states.
const s = t.student;

async function withSeed(seed: Seed, page: Page, work: (path: string) => Promise<void>) {
  await signIn(page, PATH, "Demo studentica");
  const seeded = await seedAssignment(seed);
  try {
    await work(`/zadatak/${seeded.assignment}`);
  } finally {
    await admin((client) => client.query(
      "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [seeded.course]));
  }
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
}

/** The check of e2e/shell.spec.ts: no visible text below `limit` px. */
async function smallText(page: Page, limit: number): Promise<string[]> {
  return page.evaluate((min) => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim()) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < min) found.push(`${size}px: ${node.textContent.trim()}`);
    }
    return found;
  }, limit);
}

/** Full-page shot at 1440 and 390 px; at 390 the text is then checked against 13 px. */
async function shoot(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: test.info().outputPath(`fe-d8-${name}-${width}.png`), fullPage: true });
  }
  expect(await smallText(page, 13)).toEqual([]);
}

test("FE-D8: the open notice asks for the confirmation and passes axe", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await withSeed({}, page, async (path) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Izmišljeni zadatak S3" })).toBeVisible();
    await expect(page.getByText(s.step)).toBeVisible();
    await expect(page.getByRole("heading", { name: s.recordedHeading })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /otvara|prošao/ })).toHaveCount(0);
    const confirm = page.getByRole("button", { name: s.confirm });
    await expect(confirm).toBeDisabled();
    await page.getByRole("checkbox", { name: s.checkbox }).check();
    await expect(confirm).toBeEnabled();
    await axe(page);
    await shoot(page, "obavijest");
  });
});

test("FE-D8: a confirmation the server records leads on to writing", async ({ page }) => {
  await withSeed({}, page, async (path) => {
    await page.goto(path);
    // Models the existing acknowledgment contract; #541 is not on main yet.
    await page.route("**/api/institution/assignments/*/acknowledgment", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ acknowledgedAt: "2026-10-19T09:14:00.000Z" }),
    }));
    await page.getByRole("checkbox", { name: s.checkbox }).check();
    await page.getByRole("button", { name: s.confirm }).click();
    await expect(page.getByRole("status").filter({ hasText: "Potvrđeno" })).toBeVisible();
    await expect(page.getByRole("link", { name: s.openEditor })).toHaveAttribute("href", `/rad?zadatak=${path.slice("/zadatak/".length)}`);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
});

test("FE-D8: an earlier confirmation puts the way on to writing first", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await withSeed({ acknowledged: true }, page, async (path) => {
    await page.goto(path);
    const open = page.getByRole("link", { name: s.openEditor });
    await expect(open).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    const [link, tools] = await Promise.all([
      open.boundingBox(), page.getByRole("heading", { name: s.toolsHeading }).boundingBox()]);
    expect(link!.y).toBeLessThan(tools!.y);
    await axe(page);
    await shoot(page, "potvrdeno");
  });
});

test("FE-D8: before the assignment opens the notice is shown without the confirmation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await withSeed({ opens: "2 days" }, page, async (path) => {
    await page.goto(path);
    await expect(page.getByRole("status").filter({ hasText: "Zadatak se otvara" })).toBeVisible();
    await expect(page.getByRole("heading", { name: s.teacherHeading })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: s.confirm })).toHaveCount(0);
    await expect(page.getByRole("link", { name: s.openEditor })).toHaveCount(0);
    await axe(page);
    await shoot(page, "nije-otvoren");
  });
});

test("FE-D8: past the due date the notice says so and keeps the confirmation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await withSeed({ opens: "-10 days", due: "-1 day" }, page, async (path) => {
    await page.goto(path);
    await expect(page.getByRole("status").filter({ hasText: "Rok zadatka je prošao" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: s.checkbox })).toBeVisible();
    await axe(page);
    await shoot(page, "rok-prosao");
  });
});

test("FE-D8: the notice shows a loading state while the server reads it", async ({ page }) => {
  await withSeed({}, page, async (path) => {
    // Holds the read of the version until the loading state has been seen.
    const client = new pg.Client({ connectionString: localAdminUrl(ADMIN_DATABASE_URL) });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE institution.assignment_version IN ACCESS EXCLUSIVE MODE");
      await page.goto(path, { waitUntil: "commit" });
      await expect(page.getByRole("status").filter({ hasText: s.loading })).toBeVisible();
      await client.query("COMMIT");
    } finally {
      await client.end();
    }
    await expect(page.getByRole("heading", { level: 1, name: "Izmišljeni zadatak S3" })).toBeVisible();
    await expect(page.getByText(s.loading)).toHaveCount(0);
  });
});

test("FE-D8: without a session the error offers sign-in and passes axe", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(PATH);
  await expect(page.getByRole("status").filter({ hasText: s.signedOut })).toBeVisible();
  await expect(page.getByRole("link", { name: s.signIn }))
    .toHaveAttribute("href", `/api/auth/login?returnTo=${encodeURIComponent(PATH)}`);
  await axe(page);
  await shoot(page, "bez-prijave");
});

// #476 contract 6280487079: the notice leads to /rad?zadatak=<id>, and the top
// bar names the course and the assignment only from that read, once the
// student has acknowledged the notice.
test("the notice leads to /rad of its assignment, whose top bar names it", async ({ page }) => {
  await signIn(page, PATH, "Demo studentica");
  const context = page.locator(".workspace__bar .brand-line__context");
  // Not a student of this assignment, or no id at all: no course, no assignment.
  for (const path of [`/rad?zadatak=${PATH.slice("/zadatak/".length)}`, "/rad", "/rad?zadatak=nije-id"]) {
    await page.goto(path);
    await expect(page.locator(".workspace__bar")).toBeVisible();
    await expect(context).toHaveCount(0);
  }
  // PRODUCT §5 rule 6: before the current notice is acknowledged, /rad of the
  // assignment opens its notice instead of the workspace.
  const unread = await seedAssignment();
  try {
    await page.goto(`/rad?zadatak=${unread.assignment}`);
    await page.waitForURL(`**/zadatak/${unread.assignment}`);
    await expect(page.getByText(t.student.checkbox)).toBeVisible();
    await expect(page.locator(".workspace__bar")).toHaveCount(0);
  } finally {
    await admin((client) => client.query(
      "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [unread.course]));
  }
  const seeded = await seedAssignment({ acknowledged: true });
  try {
    await page.goto(`/zadatak/${seeded.assignment}`);
    await page.getByRole("link", { name: t.student.openEditor }).click();
    await page.waitForURL(`**/rad?zadatak=${seeded.assignment}`);
    await expect(context).toHaveText(`${seeded.courseName} / Izmišljeni zadatak S3`);
    await expect(page.locator(".workspace__bar")).not.toContainText("Kolegij A");
    // Upute shows the same read: the task, its due date, no allowed uses.
    const panel = page.getByRole("complementary", { name: t.workspace.sidePanel });
    await panel.getByRole("tab", { name: t.workspace.tabInstructions }).click();
    const upute = panel.getByRole("tabpanel");
    await expect(upute.getByRole("heading", { name: t.workspace.upute.task })).toBeVisible();
    await expect(upute).toContainText("Izmišljeni zadatak S3");
    await expect(upute).toContainText("Upute za izmišljeni zadatak.");
    await expect(upute).toContainText("Rok: ");
    await expect(upute).toContainText(t.workspace.upute.toolsNone);
    await expect(upute.getByRole("heading", { name: /Provjera oblika/ })).toContainText("uskoro");
    await test.info().attach("rad-gornja-traka-zadatak", { body: await page.screenshot(), contentType: "image/png" });
  } finally {
    await admin((client) => client.query(
      "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [seeded.course]));
  }
});

// The error replies model the existing transport contract, not a real ack API.
for (const [status, error] of [[401, "unauthorized"], [403, "forbidden"], [409, "stale"], [503, "unavailable"]] as const) {
  test(`FE-D8: HTTP ${status} leaves the notice closed to the editor`, async ({ page }) => {
    await withSeed({}, page, async (path) => {
      await page.goto(path);
      await page.route("**/api/institution/assignments/*/acknowledgment", (route) => route.fulfill({
        status, contentType: "application/json", body: JSON.stringify({ error: "synthetic refusal" }),
      }));
      await page.getByRole("checkbox", { name: s.checkbox }).check();
      await page.getByRole("button", { name: s.confirm }).click();
      await expect(page.getByRole("article").getByRole("alert")).toHaveText(s.errors[error]);
      await expect(page.getByRole("link", { name: s.openEditor })).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: s.checkbox })).toBeChecked();
    });
  });
}

test("FE-D8: an earlier confirmation cannot open the editor before opens_at", async ({ page }) => {
  await withSeed({ opens: "2 days", acknowledged: true }, page, async (path) => {
    await page.goto(path);
    await expect(page.getByRole("status").filter({ hasText: "Potvrđeno" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Zadatak se otvara" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: s.confirm })).toHaveCount(0);
    await expect(page.getByRole("link", { name: s.openEditor })).toHaveCount(0);
  });
});
