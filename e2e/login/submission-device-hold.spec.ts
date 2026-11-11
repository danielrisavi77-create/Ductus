import { expect, test, type Page, type Request } from "@playwright/test";

import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { editorMounted, signIn } from "./support";
import { closeWork, seedWork } from "./work-seed";

// DAN-699 (#1876, contract #1836 c.6786016677, A13): the issue's steps. A
// paste with U+0000 on /rad reaches the server without it and the recorder
// keeps sending; and the submission page sends nothing while this device holds
// text of the work the server does not have. Every account, course,
// assignment and text is invented.

const t = messagesHr;
const OPEN = 30_000;
const COMMIT = "**/api/evidence/commit";
const NUL = String.fromCharCode(0);

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const submitOf = (page: Page) => page.getByRole("button", { name: t.submission.submit });
const isSubmission = (request: Request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/submission";

function recordSubmissions(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request) => { if (isSubmission(request)) bodies.push(request.postData() ?? ""); });
  return bodies;
}

async function openSheet(page: Page): Promise<string> {
  await signIn(page, "/rad");
  const assignment = await seedWork();
  await page.goto(`/rad?zadatak=${assignment}`);
  await page.getByRole("button", { name: t.workspace.startWork }).click();
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await editorMounted(page);
  return assignment;
}

async function type(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await editorOf(page).press("Control+End");
  await page.keyboard.type(text);
}

/** A paste event carrying `text` as plain text, as the browser hands a clipboard to the sheet. */
async function paste(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await editorOf(page).press("Control+End");
  await editorOf(page).evaluate((element, pasted) => {
    const data = new DataTransfer();
    data.setData("text/plain", pasted);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** Rows this device still owes the server, over every journal of the browser. */
async function owedRows(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const read = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let owed = 0;
    for (const { name } of await indexedDB.databases()) {
      if (!name?.startsWith("ductus-journal-v1-")) continue;
      const db = await read(indexedDB.open(name));
      try {
        if (db.objectStoreNames.contains("pending")) owed += await read(db.transaction("pending").objectStore("pending").count());
      } finally {
        db.close();
      }
    }
    return owed;
  });
}

/** Full page in both themes (the shell's own toggle) at 1440 and 400 px (docs/SESSIONS.md §6). */
async function shoot(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole("button", { name: t.shell.theme });
  const viewport = page.viewportSize();
  for (const width of [1440, 400]) {
    await page.setViewportSize({ width, height: 900 });
    for (let i = 0; i < 2; i += 1) {
      const theme = await page.locator("[data-theme]").first().getAttribute("data-theme");
      await test.info().attach(`dan699-${name}-${width}-${theme}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await toggle.click();
    }
  }
  if (viewport) await page.setViewportSize(viewport);
}

test.afterEach(closeWork);

test("A13: a paste with U+0000 reaches the server without it, and the submission is open", async ({ page }) => {
  const assignment = await openSheet(page);
  await type(page, "Izmišljeni odlomak prije lijepljenja. ");
  await paste(page, `Zalijepljeno${NUL} iz izmišljenog${NUL} izvora.`);
  await expect(editorOf(page)).toContainText("Zalijepljeno iz izmišljenog izvora.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  // The recorder did not stop: text typed after the paste reaches the server too.
  await type(page, " Nakon lijepljenja.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  await expect(page.getByText(t.editor.sendStopped)).toHaveCount(0);

  const bodies = recordSubmissions(page);
  await page.goto(`/rad/${assignment}/predaja`);
  const text = page.getByRole("document", { name: t.submission.textLabel });
  await expect(text).toContainText("Zalijepljeno iz izmišljenog izvora. Nakon lijepljenja.");
  await expect(submitOf(page)).toBeEnabled({ timeout: OPEN });
  await expect(page.getByText(t.submission.device.held)).toHaveCount(0);
  expect(bodies).toEqual([]);
});

test("#1876 negative: text the server does not have holds the submission, and no request is sent", async ({ page }) => {
  const assignment = await openSheet(page);
  await type(page, "Izmišljeni odlomak koji je stigao na poslužitelj.");
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  // The next text stays on the device: every send fails.
  await page.route(COMMIT, (route) => route.abort("internetdisconnected"));
  await type(page, " Izmišljena rečenica samo na uređaju.");
  await expect(editorOf(page)).toContainText("samo na uređaju");
  await expect(chipOf(page)).not.toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  // Leave only once the device really holds it: a page left before the local
  // save keeps nothing, and the submission is then right to be open.
  await expect.poll(() => owedRows(page), { timeout: OPEN }).toBeGreaterThan(0);

  const bodies = recordSubmissions(page);
  await page.goto(`/rad/${assignment}/predaja`);
  await expect(page.getByRole("document", { name: t.submission.textLabel })).toContainText("stigao na poslužitelj");
  await expect(page.getByRole("alert").filter({ hasText: t.submission.device.held })).toBeVisible({ timeout: OPEN });
  await expect(submitOf(page)).toBeDisabled();
  await submitOf(page).click({ force: true });
  await page.getByRole("button", { name: t.submission.device.recheck }).click();
  await expect(page.getByRole("alert").filter({ hasText: t.submission.device.held })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(bodies).toEqual([]);
  await shoot(page, "predaja-zadrzana");

  // Once the text reaches the server, the check on the click lets it through.
  await page.unroute(COMMIT);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(chipOf(page)).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  await page.goto(`/rad/${assignment}/predaja`);
  await expect(page.getByRole("document", { name: t.submission.textLabel })).toContainText("samo na uređaju");
  await expect(submitOf(page)).toBeEnabled({ timeout: OPEN });
  expect(bodies).toEqual([]);
});
