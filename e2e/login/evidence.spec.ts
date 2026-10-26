import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import { pluralHr } from "../../src/lib/i18n/hr";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { flipSignatureByte, stackCheckpoint } from "./evidence-receipt";
import { clickSignOut, editorMounted, signIn } from "./support";
import { admin, closeWork, seedSubmission, seedWork, workDocument } from "./work-seed";

// F-8 3d-2c2 (contract #476 c.6391714810 §6 e2e 1-12, G2 and G3
// c.6393716541, 3d-2c2a §4): the sheet of `/rad?zadatak=` records, chains and
// sends the evidence, and "Spremljeno na poslužitelju" comes only from a
// receipt the browser verified. The oracle for the server is the database's
// checkpoint of the document. Every account, course, assignment and text is
// invented.

const t = messagesHr;
const OPEN = 30_000;
const COMMIT = "**/api/evidence/commit";

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const pathOf = (request: Request) => new URL(request.url()).pathname;

function recordRequests(page: Page, pattern = /^\/api\/evidence\//): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (pattern.test(pathOf(request))) requests.push(request);
  });
  return requests;
}
const commitsOf = (requests: Request[]) => requests.filter((r) => pathOf(r) === "/api/evidence/commit");

/** A writable sheet of a new invented assignment; returns its document id. */
async function openSheet(page: Page): Promise<{ assignment: string; documentId: string }> {
  await signIn(page, "/rad");
  const assignment = await seedWork();
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  // The first opening refreshes the render into a freshly mounted editor (#731).
  await editorMounted(page);
  return { assignment, documentId: await workDocument(assignment) };
}

async function type(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await editorOf(page).press("Control+End");
  await page.keyboard.type(text);
}

type Local = { snapshot?: { document: unknown; revision?: number }; pending: { tx: Record<string, unknown> }[]; meta?: Record<string, unknown> };

/** What this browser's journal holds for the document. */
async function localOf(page: Page, documentId: string): Promise<Local> {
  return page.evaluate(async (id) => {
    const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const { name } of await indexedDB.databases()) {
      if (!name?.startsWith("ductus-journal-v1-")) continue;
      const db = await read(indexedDB.open(name));
      try {
        const tx = db.transaction(["snapshots", "pending", "meta"], "readonly");
        const [snapshot, pending, meta] = await Promise.all([
          read(tx.objectStore("snapshots").get(id)),
          read(tx.objectStore("pending").getAll()),
          read(tx.objectStore("meta").get(id)),
        ]);
        if (meta) return { snapshot, pending: (pending as { documentId?: string }[]).filter((row) => row.documentId === id), meta };
      } finally {
        db.close();
      }
    }
    return { pending: [] };
  }, documentId) as Promise<Local>;
}

const serverOf = (documentId: string) => admin((client) => stackCheckpoint(client, documentId));

/** The server and this browser hold the same text. */
async function sameOnServer(page: Page, documentId: string): Promise<void> {
  const local = await localOf(page, documentId);
  await expect.poll(async () => (await serverOf(documentId))?.body).toBe(canonicalizeJcs(local.snapshot!.document as never));
}

/** The chip never shows SYNCED during `ms`. */
async function neverSynced(page: Page, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    expect(await chipOf(page).getAttribute("data-state")).not.toBe("SYNCED");
    await page.waitForTimeout(200);
  }
}

/** The browser's `online` event, which starts the drain (G2). */
async function networkBack(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.context().setOffline(false);
}

/** Screenshots at 1440 and 375 px (docs/SESSIONS.md §6), each with axe. */
async function shoot(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await test.info().attach(`${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  if (viewport) await page.setViewportSize(viewport);
}

test.afterEach(closeWork);

test('3d-2c2: typing reaches "Spremljeno na poslužitelju" only with the server\'s signed receipt', async ({ page }) => {
  const { documentId } = await openSheet(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(COMMIT, async (route) => {
    await held;
    await route.continue();
  }, { times: 1 });
  await type(page, "Izmišljena prva rečenica.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCING", { timeout: OPEN });
  await neverSynced(page, 2000);
  release();
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  await expect(chipOf(page)).toHaveText(/Spremljeno na poslužitelju/);
  await sameOnServer(page, documentId);
  await shoot(page, "3d-2c2-spremljeno-na-posluzitelju");
});

test("3d-2c2: a reload continues the chain", async ({ page }) => {
  const { documentId } = await openSheet(page);
  const answers: number[] = [];
  page.on("response", (response) => {
    if (pathOf(response.request()) === "/api/evidence/commit") answers.push(response.status());
  });
  await type(page, "Prije osvježavanja.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  const first = (await serverOf(documentId))!.revision;
  await page.reload();
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  // G3: a reload never shows SYNCED from what was stored.
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
  await type(page, " Nakon osvježavanja.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  expect(answers.every((status) => status === 200)).toBe(true);
  expect((await serverOf(documentId))!.revision).toBeGreaterThan(first);
  await sameOnServer(page, documentId);
});

test("3d-2c2: offline text is sent after the network returns", async ({ page }) => {
  const { documentId } = await openSheet(page);
  await page.route(COMMIT, (route) => route.abort("internetdisconnected"));
  await type(page, "Tekst dok veza ne radi.");
  await neverSynced(page, 3000);
  expect((await localOf(page, documentId)).pending.length).toBeGreaterThan(0);
  await page.unroute(COMMIT);
  await networkBack(page);
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  await sameOnServer(page, documentId);
});

test("3d-2c2: a forged receipt never shows server-saved", async ({ page }) => {
  const { documentId } = await openSheet(page);
  await page.route(COMMIT, async (route: Route) => {
    const response = await route.fetch();
    const answer = await response.json() as { receipt?: { signedReceipt?: { signature?: { signatureBase64Url?: string } } } };
    const signature = answer.receipt?.signedReceipt?.signature;
    if (typeof signature?.signatureBase64Url === "string") signature.signatureBase64Url = flipSignatureByte(signature.signatureBase64Url);
    await route.fulfill({ response, json: answer });
  });
  const answered = page.waitForResponse((r) => pathOf(r.request()) === "/api/evidence/commit", { timeout: OPEN });
  await type(page, "Tekst s krivotvorenom potvrdom.");
  await answered;
  await neverSynced(page, 5000);
  expect((await localOf(page, documentId)).pending.length).toBeGreaterThan(0);
});

test("3d-2c2: a 503 is retried with the same key and bytes", async ({ page }) => {
  await openSheet(page);
  const bodies: string[] = [];
  let failures = 2;
  await page.route(COMMIT, async (route) => {
    bodies.push(route.request().postData() ?? "");
    if (failures > 0) {
      failures -= 1;
      await route.fulfill({ status: 503, json: {} });
      return;
    }
    await route.continue();
  });
  await type(page, "Tekst koji poslužitelj prvo ne primi.");
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect.poll(() => bodies.length, { timeout: OPEN }).toBeGreaterThan(attempt);
    await networkBack(page);
  }
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  expect(bodies.length).toBeGreaterThanOrEqual(3);
  expect(new Set(bodies.slice(0, 3)).size).toBe(1);
});

test("3d-2c2: a 409 conflict stops sending and makes the sheet read-only", async ({ page }) => {
  await openSheet(page);
  const requests = recordRequests(page);
  await page.route(COMMIT, (route) => route.fulfill({ status: 409, json: { status: "stale_base", currentRevision: 7 } }));
  await type(page, "Tekst prije sukoba.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "CONFLICT", { timeout: OPEN });
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("alert").filter({ hasText: t.editor.evidenceConflict })).toBeVisible();
  const sent = commitsOf(requests).length;
  await networkBack(page);
  await page.waitForTimeout(5000);
  expect(commitsOf(requests)).toHaveLength(sent);
  await shoot(page, "3d-2c2-sukob");
});

// Review #811 (c.6418056374, 1): a reload keeps the conflict's notice and
// chip; the local record was read, so the recovery text is not shown.
test("3d-2c2: after a 409 conflict a reload stays read-only with the conflict notice", async ({ page }) => {
  await openSheet(page);
  const requests = recordRequests(page);
  await page.route(COMMIT, (route) => route.fulfill({ status: 409, json: { status: "stale_base", currentRevision: 7 } }));
  const TEXT = "Tekst prije sukoba i osvježavanja.";
  await type(page, TEXT);
  await expect(chipOf(page)).toHaveAttribute("data-state", "CONFLICT", { timeout: OPEN });
  const sent = commitsOf(requests).length;
  await page.reload();
  await expect(editorOf(page)).toContainText(TEXT, { timeout: OPEN });
  await expect(page.getByRole("alert").filter({ hasText: t.editor.evidenceConflict })).toBeVisible({ timeout: OPEN });
  await expect(page.getByRole("alert").filter({ hasText: t.editor.recovery })).toHaveCount(0);
  await expect(chipOf(page)).toHaveAttribute("data-state", "CONFLICT");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
  await networkBack(page);
  await page.waitForTimeout(3000);
  expect(commitsOf(requests)).toHaveLength(sent);
  await shoot(page, "3d-2c2-sukob-nakon-osvjezavanja");
});

// 3d-2c2 §3 and e2e t. 7: a refusal for good (413), a 426 and an unreadable
// answer are never sent again by themselves; the chip says "Greška" and the
// notice `sendRefused` says a reload sends the text again.
for (const [name, status, body] of [
  ["413", 413, { status: "too_large" }],
  ["426", 426, { status: "upgrade_required" }],
  ["an unreadable answer", 200, { status: "nepoznato" }],
] as const) {
  test(`3d-2c2: ${name} is not retried in a loop`, async ({ page }) => {
    await openSheet(page);
    const requests = recordRequests(page);
    await page.route(COMMIT, (route) => route.fulfill({ status, json: body }));
    await type(page, `Tekst koji poslužitelj odbija (${name}).`);
    await expect(chipOf(page)).toHaveAttribute("data-state", "ERROR", { timeout: OPEN });
    await networkBack(page);
    await page.waitForTimeout(10_000);
    expect(commitsOf(requests)).toHaveLength(1);
    await expect(chipOf(page)).toHaveAttribute("data-state", "ERROR");
    await expect(page.getByRole("alert").filter({ hasText: t.editor.sendRefused })).toHaveCount(1);
    if (status === 413) await shoot(page, "3d-2c2-posluzitelj-nije-primio");
    // Review #811 (c.6419592134, 1): typing on keeps the notice while the
    // same row is held, and still sends nothing.
    await type(page, " Nastavak nakon odbijanja.");
    await expect(chipOf(page)).toHaveAttribute("data-state", /^(LOCAL_DURABLE|ERROR)$/, { timeout: OPEN });
    await page.waitForTimeout(5000);
    await expect(page.getByRole("alert").filter({ hasText: t.editor.sendRefused })).toHaveCount(1);
    expect(commitsOf(requests)).toHaveLength(1);
  });
}

test("3d-2c2: a real paste is recorded as paste", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSheet(page);
  const PASTED = "Izmišljeni zalijepljeni odlomak.";
  const segments: { events: { source: string; steps: unknown[] }[] }[] = [];
  await page.route(COMMIT, async (route) => {
    const sent = route.request().postDataJSON() as { segments: string[] };
    for (const segment of sent.segments) segments.push(JSON.parse(Buffer.from(segment, "base64").toString("utf8")));
    await route.continue();
  });
  await type(page, "Prije lijepljenja. ");
  await page.evaluate((text) => navigator.clipboard.writeText(text), PASTED);
  await page.keyboard.press("Control+V");
  await expect(editorOf(page)).toContainText(PASTED);
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  const events = segments.flatMap((segment) => segment.events);
  const carrying = events.filter((event) => JSON.stringify(event.steps).includes(PASTED));
  expect(carrying.length).toBeGreaterThan(0);
  for (const event of carrying) expect(event.source).toBe("paste");
});

test("3d-2c2: sign-out within 400 ms keeps every typed character", async ({ page }) => {
  const { assignment, documentId } = await openSheet(page);
  const TEXT = "Svaki znak prije odjave.";
  await type(page, TEXT);
  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");
  await page.context().clearCookies({ name: /^_session/ });
  await signIn(page, `/rad?zadatak=${assignment}`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await expect(editorOf(page)).toContainText(TEXT);
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  expect((await serverOf(documentId))!.body).toContain(TEXT);
});

test("3d-2c2: a second tab sends nothing", async ({ page, context }) => {
  const { assignment } = await openSheet(page);
  const second = await context.newPage();
  const requests = recordRequests(second);
  await second.goto(`/rad?zadatak=${assignment}`);
  await expect(second.getByText(t.editor.blockedHint)).toBeVisible({ timeout: OPEN });
  await type(page, "Piše samo prva kartica.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  await second.waitForTimeout(2000);
  expect(requests.map(pathOf)).toEqual([]);
  await second.close();
});

test("3d-2c2: /rad without an assignment sends no evidence", async ({ page }) => {
  const requests = recordRequests(page);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await type(page, "Slobodni nacrt bez zadatka.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
  await page.waitForTimeout(3000);
  expect(requests.map(pathOf)).toEqual([]);
});

test("3d-2c2a §4: a submission's 409 not_accepting makes the sheet read-only with its notice", async ({ page }) => {
  const { documentId } = await openSheet(page);
  await page.route(COMMIT, (route) => route.fulfill({ status: 409, json: { status: "not_accepting" } }));
  await type(page, "Tekst nakon predaje.");
  await expect(page.getByRole("status").filter({ hasText: t.editor.submittedReadOnly })).toBeVisible({ timeout: OPEN });
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
  // The refused row stays on the device; nothing is deleted (3d-2c2a §4).
  expect((await localOf(page, documentId)).pending.length).toBeGreaterThan(0);
  await shoot(page, "3d-2c2-predano");
});

/** The submitted sheet with rows after the submission, and the open sign-out dialog. */
async function submittedWithRows(page: Page): Promise<{ documentId: string; held: number }> {
  const { documentId } = await openSheet(page);
  await page.route(COMMIT, (route) => route.fulfill({ status: 409, json: { status: "not_accepting" } }));
  await type(page, "Tekst nakon predaje.");
  await expect(page.getByRole("status").filter({ hasText: t.editor.submittedReadOnly })).toBeVisible({ timeout: OPEN });
  const held = (await localOf(page, documentId)).pending.length;
  expect(held).toBeGreaterThan(0);
  await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
  return { documentId, held };
}

// F-154 (owner decision 1.3): what was written after the submission stays on
// sign-out (D-118) and goes only on the second click of its own button.
test("F-154: after a submission the dialog names its own rows, offers the export, and deletes only on the second click", async ({ page }) => {
  const { documentId, held } = await submittedWithRows(page);
  const dialog = page.getByRole("dialog");
  const forms = t.auth.logoutAfterSubmission;
  const after = pluralHr(held, forms.one, forms.few, forms.many);
  await expect(dialog).toContainText(after.replace("{n}", String(held)));
  await expect(dialog.getByRole("button", { name: t.editor.exportText })).toBeVisible();
  await shoot(page, "f154-odjava-nakon-predaje");

  // The first click only asks; Escape and "Zadrži izmjene" take it back.
  await dialog.getByRole("button", { name: t.auth.afterSubmissionDiscard }).click();
  await expect(dialog).toContainText(t.auth.afterSubmissionDiscardAsk);
  await expect(dialog.getByRole("button", { name: t.auth.afterSubmissionKeep })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: t.auth.afterSubmissionDiscard })).toBeVisible();
  await dialog.getByRole("button", { name: t.auth.afterSubmissionDiscard }).click();
  await dialog.getByRole("button", { name: t.auth.afterSubmissionKeep }).click();
  expect((await localOf(page, documentId)).pending).toHaveLength(held);

  // The second click deletes this document's rows and nothing else.
  await dialog.getByRole("button", { name: t.auth.afterSubmissionDiscard }).click();
  await dialog.getByRole("button", { name: t.auth.afterSubmissionDiscardConfirm }).click();
  await expect(dialog.getByRole("button", { name: t.auth.afterSubmissionDiscard })).toHaveCount(0);
  expect(await localOf(page, documentId)).toEqual({ pending: [] });
  await shoot(page, "f154-odjava-nakon-brisanja");
});

test("F-154: without the second click sign-out keeps the rows after the submission (D-118)", async ({ page }) => {
  const { documentId, held } = await submittedWithRows(page);
  await page.getByRole("dialog").getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL("http://localhost:3000/");
  expect((await localOf(page, documentId)).pending).toHaveLength(held);
});

test("O2 (DAN-289): a submitted work opens read-only and sends nothing after the opening", async ({ page }) => {
  const { assignment, documentId } = await openSheet(page);
  const TEXT = "Izmišljeni predani tekst.";
  await type(page, TEXT);
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  await seedSubmission(documentId);

  const requests = recordRequests(page);
  // A submitted work publishes nothing to the live view, not even its opened text.
  const live = recordRequests(page, /^\/api\/live\//);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(page.getByRole("status").filter({ hasText: t.editor.submittedReadOnly })).toBeVisible({ timeout: OPEN });
  await expect(editorOf(page)).toContainText(TEXT);
  // The opening alone tells the sheet the work is submitted; nothing follows it for 5 s.
  const opened = requests.length;
  for (let waited = 0; waited < 5000; waited += 250) {
    expect(await editorOf(page).getAttribute("contenteditable")).toBe("false");
    await page.waitForTimeout(250);
  }
  expect(requests.slice(opened).map(pathOf)).toEqual([]);
  expect(requests.map(pathOf)).toEqual(["/api/evidence/open"]);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
  // Typing changes nothing on the sheet or in the journal.
  const before = await localOf(page, documentId);
  await editorOf(page).click();
  await page.keyboard.type("Nakon predaje.");
  await expect(editorOf(page)).not.toContainText("Nakon predaje.");
  expect((await localOf(page, documentId)).meta?.localSeq).toBe(before.meta?.localSeq);
  expect(requests.map(pathOf)).toEqual(["/api/evidence/open"]);
  expect(live.map(pathOf)).toEqual([]);
  await shoot(page, "o2-predani-rad");
});
