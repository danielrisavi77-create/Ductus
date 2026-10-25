import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { CURRENT_KEY, ENDED_KEY, SESSION_END_CHANNEL } from "../../src/client/session-marks";
import { createTextAnchor } from "../../src/domain/collaboration";
import type { NodeId } from "../../src/domain/document";
import { REVISION_ZERO_JCS } from "../../src/domain/document/revision-zero";
import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { cleanUp, post, seed } from "./comment-seed";
import { appCookie, SESSION_COOKIE, sessionRow, signIn, signOutWithoutDialog } from "./support";

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
  const summaryCalls: string[] = [];
  await page.route("**/api/process-summary", (route) => {
    summaryCalls.push(route.request().url());
    return route.fulfill({ status: 401 });
  });
  await page.goto(PATH);
  await expect(page.getByText(t.signInFirst)).toBeVisible();
  await expect(page.getByRole("link", { name: t.signIn })).toHaveAttribute(
    "href", `/api/auth/login?returnTo=${encodeURIComponent(PATH)}`,
  );
  expect(calls).toHaveLength(0);
  expect(summaryCalls).toHaveLength(0);
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

test("a session ended in another tab before hydration sends no initial summary POST", async ({ page, context }) => {
  const logoutTab = await context.newPage();
  await signIn(logoutTab, "/rad", "Demo nastavnik");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await expect.poll(() => logoutTab.evaluate((key) => localStorage.getItem(key), CURRENT_KEY)).not.toBeNull();
  const mark = await logoutTab.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as { tag: string }, CURRENT_KEY);
  const lifecycle: string[] = [];
  const requests: string[] = [];
  const responses: number[] = [];
  const heldScripts: string[] = [];
  let releaseScripts = () => {};
  const hydrationGate = new Promise<void>((resolve) => { releaseScripts = resolve; });
  // Hold the target page's real Next scripts, not its session guard or API.
  // Its authenticated server-rendered card arrives before React can mount it.
  await page.route("**/_next/**", async (route) => {
    if (route.request().resourceType() === "script") {
      heldScripts.push(route.request().url());
      await hydrationGate;
    }
    await route.continue();
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/process-summary" && request.method() === "POST") {
      requests.push(request.postData() ?? "");
      lifecycle.push("summary-post");
    }
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/process-summary") responses.push(response.status());
  });
  try {
    const response = await page.goto(PATH, { waitUntil: "commit" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("button", { name: messagesHr.summaryCard.refresh })).toBeVisible();
    await expect.poll(() => heldScripts.length).toBeGreaterThan(0);
    lifecycle.push("authenticated-card-arrived-with-scripts-held");
    expect(requests).toEqual([]);

    // Real logout closes this session in the database and persists its end
    // in the shared browser storage while the other tab is still unhydrated.
    // The teacher's sheet holds nothing: no dialog (O1, #476 c.6396707923).
    await signOutWithoutDialog(logoutTab);
    expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
    expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
    expect(await page.evaluate(({ key, tag }) => {
      return (JSON.parse(localStorage.getItem(key) ?? "[]") as string[]).includes(tag);
    }, { key: ENDED_KEY, tag: mark.tag })).toBe(true);
    lifecycle.push("session-closed-and-end-persisted-before-hydration");
    expect(requests).toEqual([]);

    lifecycle.push("release-hydration");
    releaseScripts();
    await expect(page.getByRole("status").filter({ hasText: t.connection.signedOut })).toBeVisible();
    await expect(page.getByRole("button", { name: messagesHr.summaryCard.refresh })).toHaveCount(0);
    lifecycle.push("hydrated-view-observed-session-end");
    await page.waitForTimeout(250);
    expect(requests).toEqual([]);
  } finally {
    releaseScripts();
    await test.info().attach("summary-before-hydration-lifecycle", {
      body: Buffer.from(JSON.stringify({ lifecycle, heldScripts, requests, responses }, null, 2)),
      contentType: "application/json",
    });
    await logoutTab.close();
  }
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

  // Each non-ok response replaces a previously visible summary.
  for (const [code, line] of [[503, card.unavailable], [404, card.notFound], [401, card.signedOut]] as const) {
    status = code;
    const before = bodies.length;
    await page.getByRole("button", { name: card.refresh }).click();
    await expect(page.getByRole("status").filter({ hasText: line })).toBeVisible();
    await expect(page.getByText(s.sameForEveryone)).toHaveCount(0);
    expect(bodies).toHaveLength(before + 1);
    status = 200;
    await page.getByRole("button", { name: card.refresh }).click();
    await expect(region.getByText(s.sameForEveryone)).toBeVisible();
    expect(bodies).toHaveLength(before + 2);
  }

  // Another tab ending this browser session removes the card and stops reads.
  await page.evaluate(({ key, channelName }) => {
    const mark = JSON.parse(localStorage.getItem(key) ?? "null") as { tag: string } | null;
    if (!mark) throw new Error("The signed-in page must record its session mark");
    const channel = new BroadcastChannel(channelName);
    channel.postMessage(mark.tag);
    channel.close();
  }, { key: CURRENT_KEY, channelName: SESSION_END_CHANNEL });
  await expect(page.getByRole("status").filter({ hasText: t.connection.signedOut })).toBeVisible();
  await expect(region).toHaveCount(0);
  await expect(page.getByRole("button", { name: card.refresh })).toHaveCount(0);
  const endedAt = bodies.length;
  await page.waitForTimeout(1500);
  expect(bodies).toHaveLength(endedAt);
});

test.describe("comments from the live view", () => {
  test.afterEach(cleanUp);

  test("a comment listed before any text arrives is not called lost", async ({ page, browser }) => {
    const c = messagesHr.comments;
    const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";
    const start = TEXT.indexOf("mjesto");
    const anchor = createTextAnchor({
      nodeId: "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f" as NodeId, nodeText: TEXT, start, end: start + "mjesto".length,
    });
    // A clean local stack has no student identity until the first real sign-in.
    const student = await browser.newContext();
    try {
      await signIn(await student.newPage(), "/", "Demo studentica");
    } finally {
      await student.close();
    }
    await signIn(page, "/", "Demo nastavnik");
    await seed();
    expect((await post(page, "create", { documentId: LOCAL_DEMO_DOCUMENT_ID, body: "Dodaj izvor.", anchor })).status()).toBe(200);
    // The text never arrives: the connection keeps retrying while the list is already here.
    await page.route(`**/api/live/${LOCAL_DEMO_DOCUMENT_ID}`, (route) => route.fulfill({ status: 503 }));
    await page.goto(`/nastavnik/rad/${LOCAL_DEMO_DOCUMENT_ID}`);
    const card = page.getByRole("article", { name: c.number.replace("{n}", "1") });
    await expect(card).toContainText("„mjesto”");
    await expect(page.getByRole("status").filter({ hasText: t.connection.retrying })).toBeVisible();
    await expect(card.getByText(c.notPlaced)).toHaveCount(0);
  });

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
