import { expect, test, type Page, type Request } from "@playwright/test";

import { DUCTUS_PROTOCOL_VERSION } from "../../src/domain/evidence/commit-envelope";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { closeWork, seedWork, workDocument } from "./assignment-work";
import { logoutDialogOf, signIn } from "./support";

// B-LIVE step 4 (DAN-216, contract #476 6275905316): the signed-in student's
// tab publishes the last state of the work with PUT /api/live/<id>
// (BACKEND 4.12 t. 7 and 8). It stops before the sign-out fence, starts again
// on "Ostani", and a student without a confirmed notice publishes nothing.
// Course, assignment and text are invented; the document is the student's own
// work of the assignment, made by the real open route (#711 F1).

const TOKEN = "33333333-3333-4333-8333-333333333333";
const LIVE = /^\/api\/live\/[^/]+$/;

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const isPut = (request: Request) => request.method() === "PUT" && LIVE.test(new URL(request.url()).pathname);

/** Every PUT to the live route with the time it left and its path. */
function recordPuts(page: Page): { at: number; path: string; body: string | null }[] {
  const puts: { at: number; path: string; body: string | null }[] = [];
  page.on("request", (request) => {
    if (isPut(request)) puts.push({ at: Date.now(), path: new URL(request.url()).pathname, body: request.postData() });
  });
  return puts;
}

test.afterEach(closeWork);

/** The live state as its owner reads it, through the same GET the teacher uses (rule 5). */
async function readLive(page: Page, documentId: string): Promise<{ status: number; body: string }> {
  return page.evaluate(async ({ url, protocol }) => {
    const response = await fetch(url, {
      cache: "no-store", headers: { "ductus-protocol": protocol },
    });
    return { status: response.status, body: response.status === 200 ? await response.text() : "" };
  }, { url: `/api/live/${encodeURIComponent(documentId)}`, protocol: DUCTUS_PROTOCOL_VERSION });
}

// F-121: the notice says nothing reaches the server before it is confirmed,
// so a page that has not read a confirmed notice sends no text at all, not
// even one request the route would refuse.
test("a student without a confirmed notice publishes nothing, not even once", async ({ page }) => {
  const puts = recordPuts(page);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await editorOf(page).click();
  await page.keyboard.type("Izmišljena rečenica.");
  await page.waitForTimeout(3000);
  await page.keyboard.type(" Još jedna.");
  await page.waitForTimeout(3000);
  expect(puts).toEqual([]);
});

test("the signed-in student's text reaches the live route as the exact document, one request at a time", async ({ page }) => {
  await signIn(page, "/rad");
  const assignment = await seedWork();
  await page.goto(`/rad?zadatak=${assignment}`);
  const puts = recordPuts(page);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
  const documentId = await workDocument(assignment);
  await editorOf(page).click();
  for (const word of ["Gradske ", "knjižnice ", "su ", "mjesto ", "susreta."]) {
    await page.keyboard.type(word);
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await readLive(page, documentId)).body, { timeout: 10_000 })
    .toContain("Gradske knjižnice su mjesto susreta.");
  // The route holds exactly the bytes of the last PUT: the whole JCS document.
  const live = await readLive(page, documentId);
  expect(live.status).toBe(200);
  expect(live.body).toBe(puts.at(-1)!.body);
  expect(JSON.parse(live.body)).toMatchObject({ schemaVersion: 1 });
  // At least a second between the starts of two requests (4.12 t. 7).
  for (let i = 1; i < puts.length; i += 1) expect(puts[i]!.at - puts[i - 1]!.at).toBeGreaterThanOrEqual(950);
  // Only the student's own document of the assignment, never a fixed id (#711 F1).
  expect(new Set(puts.map((p) => p.path))).toEqual(new Set([`/api/live/${documentId}`]));
});

test("publishing stops at Odjava, starts again on Ostani, and nothing goes out after the sign-out", async ({ page }) => {
  // The route's answers are the test's here: this test is about when requests leave.
  await page.route((url) => LIVE.test(url.pathname), (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ outcome: "accepted", token: TOKEN }) })
    : route.fallback());
  const puts = recordPuts(page);
  await signIn(page, "/rad");
  const assignment = await seedWork();
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
  const dialog = logoutDialogOf(page);

  for (let round = 0; round < 3; round += 1) {
    await editorOf(page).click();
    await page.keyboard.type(` krug ${round}`);
    const before = puts.length;
    await expect.poll(() => puts.length).toBeGreaterThan(before);

    await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
    await expect(dialog).toBeVisible();
    const stoppedAt = Date.now();
    await page.waitForTimeout(2500);
    expect(puts.filter((p) => p.at > stoppedAt)).toEqual([]);
    await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  }

  await editorOf(page).click();
  await page.keyboard.type(" zadnje");
  await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
  const fencedAt = Date.now();
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL("http://localhost:3000/");
  await page.waitForTimeout(2500);
  expect(puts.filter((p) => p.at > fencedAt)).toEqual([]);
});
