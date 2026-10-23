import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// F-6: the demo teacher holds no confirmed institution role until the local
// provisioning (#313) lands, so this tests denial, not a mocked success. The
// K-4 step "nastavnik stvara zadatak" follows with #313 and the assignment
// route (#363).
test("anonymous visitor never sees the teacher-only course and assignment form", async ({ page }) => {
  await page.goto("/nastavnik/zadatak/novi");
  await expect(page.getByRole("heading", { name: t.teacher.title })).toBeVisible();
  await expect(page.getByText(t.teacher.signedOut)).toBeVisible();
  await expect(page.getByRole("button", { name: t.teacher.course.submit })).toHaveCount(0);
});

// Z3 (A): the teacher's entry is /nastavnik; the old address forwards there.
test("the old teacher address forwards to the course list, signed in or not", async ({ page }) => {
  await page.goto("/nastavnik/kolegiji");
  await expect(page).toHaveURL("http://localhost:3000/nastavnik");
  await expect(page.getByText(t.teacher.signedOut)).toBeVisible();

  await signIn(page, "/", "Demo studentica");
  await page.goto("/nastavnik/kolegiji");
  await expect(page).toHaveURL("http://localhost:3000/nastavnik");
  await expect(page.getByText(t.teacherCourses.empty)).toBeVisible();
});

test("signed-in demo student cannot create a course", async ({ page }) => {
  await signIn(page, "/nastavnik/zadatak/novi", "Demo studentica");
  await expect(page.getByText(t.teacher.denied)).toBeVisible();
  await expect(page.getByRole("button", { name: t.teacher.course.submit })).toHaveCount(0);
});

test("does not start the OIDC login without a click", async ({ page }) => {
  const loginRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === "http://localhost:3000" && url.pathname === "/api/auth/login") {
      loginRequests.push(request.url());
    }
  });
  await page.goto("/nastavnik/zadatak/novi");
  await expect(page.getByText(t.teacher.signedOut)).toBeVisible();
  const login = page.getByRole("link", { name: t.teacher.signIn });
  await expect(login).toBeVisible();
  expect(loginRequests).toHaveLength(0);

  // A real anchor navigation starts the login only after a deliberate click.
  await login.click();
  await expect(page).toHaveURL(/^http:\/\/localhost:8090\/interaction\//);
  expect(loginRequests).toHaveLength(1);
});
