import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { signIn } from "./support";

// DAN-292 (#747): the student removal route exists in the running app and
// refuses every caller who is not a teacher of the course. The teacher's
// success, the course of another institution and the student of another
// course are proved on the real database in
// tests/integration/student-removal-route.integration.test.ts; the demo stack
// has one institution, and the teacher role belongs to demo-flow.
const ORIGIN = "http://localhost:3000";
const path = (course: string, student: string) => `/api/institution/courses/${course}/students/${student}/removal`;

test("refuses an anonymous caller and a wrong Origin, uncached", async ({ request }) => {
  const anonymous = await request.post(path(randomUUID(), randomUUID()), { headers: { origin: ORIGIN }, data: {} });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["cache-control"]).toBe("no-store");
  expect(await anonymous.json()).toEqual({ error: "unauthorized" });

  const foreign = await request.post(path(randomUUID(), randomUUID()), { headers: { origin: "https://evil.example" }, data: {} });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toEqual({ error: "origin_mismatch" });
});

test("a signed-in student cannot remove anyone, and the body carries nothing", async ({ page }) => {
  await signIn(page, "/", "Demo studentica");
  const course = randomUUID(), student = randomUUID();
  const refused = await page.request.post(path(course, student), { headers: { origin: ORIGIN }, data: {} });
  expect(refused.status()).toBe(403);
  expect(refused.headers()["cache-control"]).toBe("no-store");
  expect(await refused.json()).toEqual({ error: "forbidden" });

  const missingOrigin = await page.request.post(path(course, student), { data: {} });
  expect(missingOrigin.status()).toBe(403);
  expect(await missingOrigin.json()).toEqual({ error: "origin_missing" });

  const extra = await page.request.post(path(course, student), { headers: { origin: ORIGIN }, data: { studentId: student } });
  expect(extra.status()).toBe(422);
  expect(await extra.json()).toEqual({ error: "invalid_input" });

  const malformed = await page.request.post(path(course, "not-a-student"), { headers: { origin: ORIGIN }, data: {} });
  expect(malformed.status()).toBe(422);
});
