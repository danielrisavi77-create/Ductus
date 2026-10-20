import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { REVISION_ZERO_JCS } from "../../src/domain/document/revision-zero";
import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
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
