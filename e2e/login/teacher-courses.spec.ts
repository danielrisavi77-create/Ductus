import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// This PR is independent of the pending F-6a POST endpoint (#311) and the
// local operator bootstrap (#313). Test denial now, not a mocked course
// success. Full positive K-4 coverage follows when those PRs are accepted.
test("anonymous visitor never sees the teacher-only course form", async ({ page }) => {
  await page.goto("/nastavnik/kolegiji");
  await expect(page.getByRole("heading", { name: t.teacherCourses.title })).toBeVisible();
  await expect(page.getByText(t.teacherCourses.denied)).toBeVisible();
  await expect(page.getByRole("button", { name: t.teacherCourses.submit })).toHaveCount(0);
});

test("signed-in demo student cannot create a course", async ({ page }) => {
  await signIn(page, "/nastavnik/kolegiji", "Demo studentica");
  await expect(page.getByText(t.teacherCourses.denied)).toBeVisible();
  await expect(page.getByRole("button", { name: t.teacherCourses.submit })).toHaveCount(0);
});


test("does not start the OIDC login without a click", async ({ page }) => {
  const loginRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === "http://localhost:3000" && url.pathname === "/api/auth/login") {
      loginRequests.push(request.url());
    }
  });
  await page.goto("/nastavnik/kolegiji");
  await expect(page.getByText(t.teacherCourses.denied)).toBeVisible();
  const login = page.getByRole("link", { name: t.teacherCourses.signIn });
  await expect(login).toBeVisible();
  expect(loginRequests).toHaveLength(0);

  // A real anchor navigation starts the login only after a deliberate click.
  await login.click();
  await expect(page).toHaveURL(/^http:\/\/localhost:8090\/interaction\//);
  expect(loginRequests).toHaveLength(1);
});
