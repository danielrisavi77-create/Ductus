import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// F-7: no course code is seeded until #313 and the enrollment route is the
// #314 proposal, so this shows the form never claims an enrollment it did
// not get, and that a code which can never match is not sent.
// Next.js keeps an empty route announcer with role="alert" outside the form.
const e = t.student.enroll;

test("anonymous visitor sees no enrollment form", async ({ page }) => {
  await page.goto("/upis");
  await expect(page.getByRole("heading", { name: e.title })).toBeVisible();
  await expect(page.getByText(e.signedOut)).toBeVisible();
  await expect(page.getByLabel(e.label)).toHaveCount(0);
});

test("signed-in student gets no enrollment without the server", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(new URL(request.url()).pathname); });

  await page.getByLabel(e.label).fill("12-34");
  await page.getByRole("button", { name: e.submit }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.malformed);
  expect(posts).toHaveLength(0);

  await page.getByLabel(e.label).fill("ab12-cd34-ef56-7890");
  await page.getByRole("button", { name: e.submit }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.unavailable);
  expect(posts).toEqual(["/api/institution/enrollments"]);
  await expect(page.getByText(e.enrolled)).toHaveCount(0);
});

test("a session the server closed offers sign-in again", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  // Stands in for the #314 route answering a cookie whose session has ended.
  await page.route("**/api/institution/enrollments", (route) => route.fulfill({ status: 401, body: "" }));

  await page.getByLabel(e.label).fill("ab12-cd34-ef56-7890");
  await page.getByRole("button", { name: e.submit }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.unauthorized);
  await expect(page.locator("form").getByRole("link", { name: t.student.signIn }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fupis");
  await expect(page.getByText(e.enrolled)).toHaveCount(0);
});
