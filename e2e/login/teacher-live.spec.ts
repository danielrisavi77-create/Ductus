import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { REVISION_ZERO_JCS } from "../../src/domain/document/revision-zero";
import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { cleanUp, seed } from "./comment-seed";
import { signIn } from "./support";

// DAN-86 step 2b: the teacher's live view of a work. The live route (GET
// /api/live/<id>, PR #496, BACKEND 4.12) is not on main yet, so the browser's
// requests to it are answered here, in the shape of its response table; the
// sign-in and the page are real. The works and their text are invented.

const t = messagesHr.liveView;
const DOC = "izmisljeni-rad-uzivo";
const PATH = `/nastavnik/rad/${DOC}`;

/** Revision zero with a heading and one invented paragraph, as exact JCS and its SHA-256. */
function work(sentence: string): { body: string; hash: string } {
  const doc = JSON.parse(REVISION_ZERO_JCS) as { nodes: Record<string, unknown>[] };
  const paragraph = doc.nodes[0]!;
  paragraph.children = [{ type: "text", text: sentence, marks: [] }];
  doc.nodes = [
    { type: "heading", level: 1, id: "3b0f6c1e-8a4d-4f2b-9c7e-1d2a3b4c5d6e", children: [{ type: "text", text: "Uvod", marks: [] }] },
    paragraph,
  ];
  const body = canonicalizeJcs(doc);
  return { body, hash: createHash("sha256").update(body, "utf8").digest("hex") };
}

/** Serves the live route from `next()`, which sees the If-None-Match the page sent. */
async function serveLive(page: Page, next: (ifNoneMatch: string | null) => { status: number; body?: string; etag?: string }) {
  const calls: (string | null)[] = [];
  await page.route(`**/api/live/${DOC}`, async (route: Route) => {
    const ifNoneMatch = route.request().headers()["if-none-match"] ?? null;
    calls.push(ifNoneMatch);
    const reply = next(ifNoneMatch);
    await route.fulfill({
      status: reply.status,
      body: reply.body,
      headers: {
        "cache-control": "no-store",
        ...(reply.body === undefined ? {} : { "content-type": "application/json; charset=utf-8" }),
        ...(reply.etag === undefined ? {} : { etag: `"${reply.etag}"` }),
      },
    });
  });
  return calls;
}

test("a visitor without a session is offered sign-in and no text is requested", async ({ page }) => {
  const calls = await serveLive(page, () => ({ status: 401, body: '{"error":"unauthorized"}' }));
  await page.goto(PATH);
  await expect(page.getByText(t.signInFirst)).toBeVisible();
  await expect(page.getByRole("link", { name: t.signIn })).toHaveAttribute(
    "href", `/api/auth/login?returnTo=${encodeURIComponent(PATH)}`,
  );
  expect(calls).toHaveLength(0);
});

test("the teacher sees the work as the student writes, with the limits of the record", async ({ page }) => {
  const first = work("Gradske knjižnice su mjesto susreta.");
  const second = work("Gradske knjižnice su mjesto susreta i učenja.");
  let current = first;
  const calls = await serveLive(page, (ifNoneMatch) =>
    ifNoneMatch === `"${current.hash}"` ? { status: 304, etag: current.hash } : { status: 200, body: current.body, etag: current.hash });

  await signIn(page, PATH, "Demo nastavnik");
  const text = page.getByRole("document", { name: t.documentLabel });
  await expect(text.getByText("Gradske knjižnice su mjesto susreta.")).toBeVisible();
  await expect(text.getByRole("heading", { level: 2, name: "Uvod" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: t.connection.live })).toBeVisible();
  await expect(page.getByText(t.note)).toBeVisible();
  await expect(page.getByRole("heading", { name: messagesHr.recordLimits.title })).toBeVisible();
  await expect(page.getByText(messagesHr.recordLimits.exampleB)).toBeVisible();
  await expect.poll(() => calls.length).toBeGreaterThan(1);
  expect(calls[0]).toBeNull();
  expect(calls[1]).toBe(`"${first.hash}"`);

  current = second;
  await expect(text.getByText("Gradske knjižnice su mjesto susreta i učenja.")).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  await test.info().attach("dan86-uzivo-sirok", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await test.info().attach("dan86-uzivo-mobitel", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("a body that is not the document its ETag names is never shown", async ({ page }) => {
  const shown = work("Ova rečenica se ne smije prikazati.");
  await serveLive(page, () => ({ status: 200, body: shown.body, etag: "a".repeat(64) }));
  await signIn(page, PATH, "Demo nastavnik");
  await expect(page.getByRole("status").filter({ hasText: t.connection.retrying })).toBeVisible();
  await expect(page.getByText("Ova rečenica se ne smije prikazati.")).toHaveCount(0);
});

test("a work this account may not read stops the view for good", async ({ page }) => {
  const calls = await serveLive(page, () => ({ status: 404, body: '{"error":"not_found"}' }));
  await signIn(page, PATH, "Demo nastavnik");
  await expect(page.getByRole("document", { name: t.documentLabel }).getByText(t.connection.notFound)).toBeVisible();
  // The reader would have asked again within a second; it does not.
  await page.waitForTimeout(2500);
  expect(calls).toHaveLength(1);
});

test("nothing published yet is said as such", async ({ page }) => {
  await serveLive(page, () => ({ status: 204 }));
  await signIn(page, PATH, "Demo nastavnik");
  await expect(page.getByText(t.empty)).toBeVisible();
  // The note speaks about a shown text; with none it would contradict the line above.
  await expect(page.getByText(t.note)).toHaveCount(0);
});

test("the teacher reads the process summary once, as the same view the student gets", async ({ page }) => {
  const s = messagesHr.summary;
  const card = messagesHr.summaryCard;
  const live = work("Gradske knjižnice su mjesto susreta.");
  await serveLive(page, () => ({ status: 200, body: live.body, etag: live.hash }));
  // Invented summary in the route's shape (ProcessSummaryV1, #515).
  const summary = {
    gaps: { evidenceKind: "observed", items: [] },
    pastes: {
      evidenceKind: "observed", listed: [{ at: { from: "2026-10-19T08:10:00.000Z", to: "2026-10-19T08:11:00.000Z" }, characters: 412, origin: "not_observed" }],
      listedAboveCharacters: 200, smallerCount: 2,
    },
    recordState: "complete",
    sessions: { breakAboveMinutes: 30, count: 1, evidenceKind: "observed", items: [{ from: "2026-10-19T08:00:00.000Z", to: "2026-10-19T08:41:00.000Z" }] },
    summaryFormat: "ductus-process-summary-v1",
  };
  const bodies: string[] = [];
  let status = 200;
  await page.route("**/api/process-summary", async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill(status === 200
      ? { status, body: canonicalizeJcs(summary), headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
      : { status, body: '{"error":"unavailable"}', headers: { "content-type": "application/json" } });
  });

  await signIn(page, PATH, "Demo nastavnik");
  const region = page.getByRole("region", { name: s.title });
  await expect(region).toBeVisible();
  await expect(region.getByText(s.sameForEveryone)).toBeVisible();
  await expect(page.getByRole("document", { name: t.documentLabel }).getByText("Gradske knjižnice su mjesto susreta.")).toBeVisible();
  // The live text keeps asking every second; the summary is read once.
  await page.waitForTimeout(2500);
  expect(bodies).toEqual([JSON.stringify({ documentId: DOC })]);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  await test.info().attach("f10-sazetak-nastavnik", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // A failed refresh never leaves the old summary on the page.
  status = 503;
  await page.getByRole("button", { name: card.refresh }).click();
  await expect(page.getByRole("status").filter({ hasText: card.unavailable })).toBeVisible();
  await expect(page.getByText(s.sameForEveryone)).toHaveCount(0);
  expect(bodies).toHaveLength(2);
});
test.describe("comments from the live view", () => {
  test.afterEach(cleanUp);

  test("the teacher marks a passage, comments, and the mark follows the text", async ({ browser }) => {
    const c = messagesHr.comments;
    const tc = messagesHr.teacherComments;
    const PARAGRAPH = "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f";
    const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";
    const QUOTE = "mjesto susreta";
    const BODY = "Dodaj izvor za ovu tvrdnju. <img src=x onerror=alert(1)>";
    const at = (sentence: string) => {
      const doc = JSON.parse(REVISION_ZERO_JCS) as { nodes: Record<string, unknown>[] };
      doc.nodes = [{ type: "paragraph", id: PARAGRAPH, children: [{ type: "text", text: sentence, marks: [] }] }];
      const body = canonicalizeJcs(doc);
      return { body, hash: createHash("sha256").update(body, "utf8").digest("hex") };
    };
    const teacher = await (await browser.newContext()).newPage();
    const student = await (await browser.newContext()).newPage();
    await signIn(student, "/");
    await signIn(teacher, "/", "Demo nastavnik");
    await seed();

    let current = at(TEXT);
    await teacher.route(`**/api/live/${LOCAL_DEMO_DOCUMENT_ID}`, (route) => {
      const known = route.request().headers()["if-none-match"];
      return known === `"${current.hash}"`
        ? route.fulfill({ status: 304, headers: { etag: `"${current.hash}"` } })
        : route.fulfill({ status: 200, body: current.body, headers: { etag: `"${current.hash}"`, "content-type": "application/json" } });
    });
    await teacher.goto(`/nastavnik/rad/${LOCAL_DEMO_DOCUMENT_ID}`);
    const text = teacher.getByRole("document", { name: t.documentLabel });
    await expect(text.getByText(TEXT)).toBeVisible();
    await expect(teacher.getByText(tc.hint)).toBeVisible();

    // Mark the passage as a reader would, then let the page hear the mouse up.
    await text.locator("p").evaluate((p, quote) => {
      const node = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!;
      const start = node.textContent!.indexOf(quote);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + quote.length);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    }, QUOTE);
    await text.dispatchEvent("mouseup");
    const form = teacher.getByRole("form", { name: tc.newTitle });
    await expect(form).toContainText(`„${QUOTE}”`);
    await form.getByRole("textbox", { name: tc.bodyLabel }).fill(BODY);
    await form.getByRole("button", { name: tc.publish }).click();

    const card = teacher.getByRole("article", { name: c.number.replace("{n}", "1") });
    await expect(card).toContainText(`„${QUOTE}”`);
    await expect(card.getByText(BODY, { exact: true })).toBeVisible();
    await expect(card.locator("img")).toHaveCount(0);
    await expect(card).toContainText(c.state.open);
    await expect(text.locator("mark")).toHaveText(QUOTE);
    await test.info().attach("dan86-komentar-nastavnika", { body: await teacher.screenshot({ fullPage: true }), contentType: "image/png" });

    // The student reads the same thread through the same function (PRODUCT §5 rule 5).
    const listed = await (await student.request.post("/api/comments/list", {
      headers: { origin: "http://localhost:3000" }, data: { documentId: LOCAL_DEMO_DOCUMENT_ID },
    })).json();
    expect(listed.comments.map((row: { authorRole: string; isOwn: boolean; body: string }) => [row.authorRole, row.isOwn, row.body]))
      .toEqual([["teacher", false, BODY]]);

    // The student writes before the passage: the mark moves with it.
    current = at(`Uvod. ${TEXT}`);
    await expect(text.getByText(`Uvod. ${TEXT}`)).toBeVisible();
    await expect(text.locator("mark")).toHaveText(QUOTE);

    // The passage is rewritten: the comment stays in the list, without a place.
    current = at("Gradske knjižnice su prostor za sve.");
    await expect(text.getByText("Gradske knjižnice su prostor za sve.")).toBeVisible();
    await expect(text.locator("mark")).toHaveCount(0);
    await expect(card).toContainText(c.notPlaced);

    await card.getByRole("button", { name: tc.resolve }).click();
    await expect(card).toContainText(c.state.resolved);
    await card.getByRole("button", { name: tc.reopen }).click();
    await expect(card).toContainText(c.state.open);
  });
});