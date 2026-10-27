import { createHash } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { REVISION_ZERO_JCS } from "../../src/domain/document/revision-zero";
import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { cleanUpAssignmentWork, openAssignmentWork } from "./assignment-work";
import { type DemoAccount, signIn } from "./support";

// F2 (#711, DAN-89): the teacher reaches a student's work from /nastavnik by
// a link, without typing an id. The work is the student's own document of an
// invented assignment, opened by the real open route; the live text is real.
// Another course's teacher, another student and an unknown id all get the
// same refusal on the live view.

const t = messagesHr.liveView;
const SENTENCE = "Gradske knjižnice su mjesto susreta i učenja.";

/** Revision zero with one invented paragraph, as exact JCS and its SHA-256. */
function work(sentence: string): { body: string; hash: string } {
  const doc = JSON.parse(REVISION_ZERO_JCS) as { nodes: Record<string, unknown>[] };
  doc.nodes[0]!.children = [{ type: "text", text: sentence, marks: [] }];
  const body = canonicalizeJcs(doc);
  return { body, hash: createHash("sha256").update(body, "utf8").digest("hex") };
}

async function pageOf(browser: Browser, account: DemoAccount): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "/", account);
  return page;
}

/** The text the live view's document region shows for `documentId`, once it has settled on the refusal. */
async function refusalOn(page: Page, documentId: string): Promise<string> {
  await page.goto(`/nastavnik/rad/${encodeURIComponent(documentId)}`);
  const region = page.getByRole("document", { name: t.documentLabel });
  await expect(region.getByText(t.connection.notFound)).toBeVisible();
  await expect(page.getByText(SENTENCE)).toHaveCount(0);
  return (await region.innerText()).trim();
}

test.describe("teacher reaches a work by navigation", () => {
  test.afterEach(cleanUpAssignmentWork);

  test("the course's teacher opens the work from /nastavnik; others and an unknown id get one refusal", async ({ browser }) => {
    const student = await pageOf(browser, "Demo studentica");
    const teacher = await pageOf(browser, "Demo nastavnik");
    const { documentId } = await openAssignmentWork(student);
    const live = work(SENTENCE);
    const put = await student.request.put(`/api/live/${documentId}`, {
      headers: { origin: "http://localhost:3000", "content-type": "application/json", "if-none-match": "*" }, data: live.body,
    });
    expect(put.status()).toBe(200);

    // The teacher types no id: the link on /nastavnik leads to the work.
    await teacher.goto("/nastavnik");
    const href = `/nastavnik/rad/${encodeURIComponent(documentId)}`;
    const link = teacher.getByRole("list", { name: messagesHr.teacherCourses.worksLabel }).locator(`a[href="${href}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(/^Rad \d+$/);
    // DAN-332 PR 4 (#826): beside the link, the state of its submission from the same read.
    const courses = messagesHr.teacherCourses;
    await expect(teacher.getByRole("list", { name: courses.worksLabel }).getByRole("listitem").filter({ has: teacher.locator(`a[href="${href}"]`) }))
      .toHaveText(new RegExp(`^${courses.work} \\d+ · ${courses.submission.none}$`));
    await link.click();
    await expect(teacher).toHaveURL(href);
    await expect(teacher.getByRole("document", { name: t.documentLabel }).getByText(SENTENCE)).toBeVisible();

    // Another course's teacher has no such link and, like another student, is refused
    // exactly as for an id that does not exist.
    const other = await pageOf(browser, "Demo nastavnica");
    await other.goto("/nastavnik");
    await expect(other.locator(`a[href="${href}"]`)).toHaveCount(0);
    const unknown = `e2e-nepostojeci-rad-${Date.now().toString(36)}`;
    const refusals = [
      await refusalOn(other, documentId),
      await refusalOn(await pageOf(browser, "Demo student 2"), documentId),
      await refusalOn(other, unknown),
    ];
    expect(new Set(refusals).size).toBe(1);
  });
});
