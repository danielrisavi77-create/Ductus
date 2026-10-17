import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// F-7: there is no seeded course membership or assignment until #313, so this
// covers the screens without a notice. The notice itself is covered by the
// unit and property tests of the gate.
const PATH = "/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
