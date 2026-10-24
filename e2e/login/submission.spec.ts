import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import pg from "pg";

import { RECEIPT } from "../../src/client/submission.fixture";
import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { clickSignOut, signIn } from "./support";

// F-10 (#476 contract 6384297464): the student's submission page. The course,
// assignment, membership and acknowledgment are invented and written through
// the admin login of the compose database (as assignment-notice.spec.ts);
// the work itself is made by the real open route. Until the drain is wired
// (3d-2) the server holds revision 0, so the real path ends in `no_evidence`;
// the other answers of the submission route are the test's (page.route).

const t = messagesHr.submission;
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

const seeded: string[] = [];

/** An invented assignment the demo student is a student of, its notice acknowledged or not. */
async function seedAssignment(acknowledged: boolean): Promise<string> {
  return admin(async (client) => {
    await client.query("BEGIN");
    const { rows: [me] } = await client.query<{ id: string; institution: string }>(
      "SELECT id, institution_id AS institution FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [STUDENT]);
    if (!me) throw new Error("the demo student must have signed in");
    const suffix = Date.now().toString(36);
    const { rows: [course] } = await client.query<{ id: string }>(
      `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, '2026/2027', 'prohibited', $3) RETURNING id`, [me.institution, `Izmišljeni kolegij F-10 ${suffix}`, me.id]);
    const { rows: [assignment] } = await client.query<{ id: string }>(
      `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, 1, $3) RETURNING id`, [course!.id, me.institution, me.id]);
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmišljeni zadatak F-10', 'Upute za izmišljeni zadatak.', 'essay', now(),
         now() + interval '30 days', 'prohibited', '{}', 'basic', false, $2)`, [assignment!.id, me.id]);
    await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
      [course!.id, me.institution, me.id]);
    if (acknowledged) {
      await client.query(
        `INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
         VALUES ($1, 1, $2, $3)`, [assignment!.id, me.id, me.institution]);
    }
    await client.query("COMMIT");
    seeded.push(course!.id);
    return assignment!.id;
  });
}

test.afterEach(async () => {
  const courses = seeded.splice(0);
  if (courses.length === 0) return;
  await admin((client) => client.query(
    "UPDATE institution.course_member SET member_to = now() WHERE course_id = ANY($1::uuid[]) AND member_to IS NULL", [courses]));
});

const pathOf = (assignment: string) => `/rad/${assignment}/predaja`;
const isSubmission = (request: Request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/submission";

function recordSubmissions(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request) => { if (isSubmission(request)) bodies.push(request.postData() ?? ""); });
  return bodies;
}

// An invented text, as exact JCS bytes with their hash, standing for a revision the drain would have committed.
const TEXT_DOC = {
  schemaVersion: 1,
  nodes: [
    { id: "11111111-1111-4111-8111-111111111111", type: "heading", level: 1, children: [{ type: "text", text: "Gradske knjižnice", marks: [] }] },
    { id: "22222222-2222-4222-8222-222222222222", type: "paragraph", children: [{ type: "text", text: "Izmišljeni nacrt o gradskim knjižnicama kao mjestu susreta.", marks: [] }] },
  ],
};
const TEXT_BYTES = Buffer.from(canonicalizeJcs(TEXT_DOC), "utf8");
const TEXT_HASH = createHash("sha256").update(TEXT_BYTES).digest("hex");

/** The real open answer, with revision 3 and the invented text in place of revision 0. */
async function withText(page: Page): Promise<{ documentId: () => string }> {
  let documentId = "";
  await page.route("**/api/evidence/open", async (route: Route) => {
    const response = await route.fetch();
    const body = await response.json() as Record<string, unknown>;
    if (response.status() === 200) {
      documentId = body.documentId as string;
      Object.assign(body, { currentRevision: 3, document: TEXT_BYTES.toString("base64"), documentHash: TEXT_HASH });
    }
    await route.fulfill({ response, json: body });
  });
  return { documentId: () => documentId };
}

function receiptFor(documentId: string, changes: Partial<typeof RECEIPT.payload> = {}) {
  return { ...RECEIPT, payload: { ...RECEIPT.payload, documentId, revision: 3, ...changes } };
}

async function shoot(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await test.info().attach(`f10-${name}-${colorScheme}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }
}

test("without an acknowledged notice the page leads to the notice and sends nothing (criterion 6)", async ({ page }) => {
  await signIn(page, "/rad");
  const assignment = await seedAssignment(false);
  const bodies = recordSubmissions(page);
  await page.goto(pathOf(assignment));
  await page.waitForURL(`**/zadatak/${assignment}`);
  expect(bodies).toEqual([]);
});

test("with no text on the server it says so and sends nothing to the submission route (criterion 4)", async ({ page }) => {
  await signIn(page, "/rad");
  const assignment = await seedAssignment(true);
  const bodies = recordSubmissions(page);
  await page.goto(pathOf(assignment));
  await expect(page.getByText(t.noEvidence)).toBeVisible();
  await expect(page.getByRole("button", { name: t.submit })).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(bodies).toEqual([]);
  await shoot(page, "bez-teksta");
});

test("one click submits exactly the shown revision once and shows the receipt (criteria 1, 2, 3)", async ({ page }) => {
  await signIn(page, "/rad");
  const assignment = await seedAssignment(true);
  const open = await withText(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/submission", async (route) => {
    await held;
    await route.fulfill({ status: 200, json: { status: "submitted", receipt: receiptFor(open.documentId()) } });
  });
  const bodies = recordSubmissions(page);
  await page.goto(pathOf(assignment));
  await expect(page.getByRole("document", { name: t.textLabel })).toContainText("gradskim knjižnicama kao mjestu susreta");
  await shoot(page, "provjera");
  const button = page.getByRole("button", { name: t.submit });
  await button.dblclick();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: t.sending })).toBeDisabled();
  release();
  await expect(page.getByRole("heading", { name: t.receiptTitle })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]!)).toEqual({ documentId: open.documentId(), revision: 3 });
  await expect(page.getByText(RECEIPT.payload.artifactSha256)).toBeVisible();
  await expect(page.getByText(t.receiptNote)).toBeVisible();
  await expect(page.getByRole("button", { name: t.submit })).toHaveCount(0);
  // #385 H8: the outcome has the focus, and the page passes axe.
  await expect(page.locator("#submission-outcome")).toBeFocused();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await shoot(page, "potvrda");
});

test("without a network the button waits and nothing is sent (#385 H7)", async ({ page, context }) => {
  await signIn(page, "/rad");
  const assignment = await seedAssignment(true);
  await withText(page);
  const bodies = recordSubmissions(page);
  await page.goto(pathOf(assignment));
  await expect(page.getByRole("button", { name: t.submit })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByText(t.offline)).toBeVisible();
  await expect(page.getByRole("button", { name: t.submit })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: t.submit })).toBeEnabled();
  expect(bodies).toEqual([]);
});

test("a receipt for another revision is never shown", async ({ page }) => {
  await signIn(page, "/rad");
  const assignment = await seedAssignment(true);
  const open = await withText(page);
  await page.route("**/api/submission", (route) =>
    route.fulfill({ status: 200, json: { status: "submitted", receipt: receiptFor(open.documentId(), { revision: 2 }) } }));
  await page.goto(pathOf(assignment));
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.getByText(t.outcome.unavailable)).toBeVisible();
  await expect(page.getByRole("heading", { name: t.receiptTitle })).toHaveCount(0);
});

for (const [name, status, body, text] of [
  ["neslaganje", 409, { status: "blocked", reason: "record_mismatch" }, t.outcome.recordMismatch],
  ["novija-verzija", 409, { status: "stale_revision", currentRevision: 4 }, t.outcome.staleRevision],
  ["nedostupno", 503, { status: "unavailable", stage: "signing" }, t.outcome.unavailable],
] as const) {
  test(`the answer ${name} shows its own text and no receipt (criteria 3 and 8)`, async ({ page }) => {
    await signIn(page, "/rad");
    const assignment = await seedAssignment(true);
    await withText(page);
    await page.route("**/api/submission", (route) => route.fulfill({ status, json: body }));
    await page.goto(pathOf(assignment));
    await page.getByRole("button", { name: t.submit }).click();
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByRole("heading", { name: t.receiptTitle })).toHaveCount(0);
    await expect(page.getByText(/predano/i)).toHaveCount(0);
    if (name === "neslaganje") await shoot(page, name);
  });
}

test("after a sign-out in another tab the work leaves the page and nothing is sent (criterion 7)", async ({ page, context }) => {
  await signIn(page, "/rad");
  const assignment = await seedAssignment(true);
  await withText(page);
  const bodies = recordSubmissions(page);
  await page.goto(pathOf(assignment));
  await expect(page.getByRole("button", { name: t.submit })).toBeVisible();
  const other = await context.newPage();
  await other.goto("/rad");
  await clickSignOut(other);
  await expect(page.getByText(t.outcome.signedOut)).toBeVisible();
  await expect(page.getByRole("document", { name: t.textLabel })).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.submit })).toHaveCount(0);
  expect(bodies).toEqual([]);
});
