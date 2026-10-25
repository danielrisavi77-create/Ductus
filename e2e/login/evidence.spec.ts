import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { flipSignatureByte, stackCheckpoint } from "./evidence-receipt";
import { clickSignOut, signIn } from "./support";
import { admin, closeWork, seedWork, workDocument } from "./work-seed";

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

for (const [status, body, notice] of [
  [413, { status: "too_large" }, true],
  [426, { status: "upgrade_required" }, false],
] as const) {
  test(`3d-2c2: ${status} is not retried in a loop`, async ({ page }) => {
    await openSheet(page);
    const requests = recordRequests(page);
    await page.route(COMMIT, (route) => route.fulfill({ status, json: body }));
    await type(page, `Tekst koji poslužitelj odbija (${status}).`);
    await expect(chipOf(page)).toHaveAttribute("data-state", "ERROR", { timeout: OPEN });
    await networkBack(page);
    await page.waitForTimeout(10_000);
    expect(commitsOf(requests)).toHaveLength(1);
    // The notice names a refusal for good (`refusedLocalSeq`); a 426 is not
    // one the journal records as final, so it shows only the chip.
    await expect(page.getByRole("alert").filter({ hasText: t.editor.sendRefused })).toHaveCount(notice ? 1 : 0);
    if (notice) await shoot(page, "3d-2c2-posluzitelj-nije-primio");
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
