import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { signIn } from "./support";

// DAN-292 (#747): the teacher role revocation route exists in the running app
// and refuses every caller who is not an institution administrator. The
// administrator's success, the other institution's administrator and the
// revoked teacher's next refused request are proved on the real database in
// tests/integration/teacher-role-revocation-route.integration.test.ts; the
// demo stack has no administrator account.
const ORIGIN = "http://localhost:3000";
const path = (teacher: string) => `/api/institution/teachers/${teacher}/role-revocation`;

test("refuses an anonymous caller and a wrong Origin, uncached", async ({ request }) => {
  const anonymous = await request.post(path(randomUUID()), { headers: { origin: ORIGIN }, data: {} });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["cache-control"]).toBe("no-store");
  expect(await anonymous.json()).toEqual({ error: "unauthorized" });

  const foreign = await request.post(path(randomUUID()), { headers: { origin: "https://evil.example" }, data: {} });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toEqual({ error: "origin_mismatch" });
});

test("a signed-in student cannot revoke anyone, and the body carries nothing", async ({ page }) => {
  await signIn(page, "/", "Demo studentica");
  const teacher = randomUUID();
  const refused = await page.request.post(path(teacher), { headers: { origin: ORIGIN }, data: {} });
  expect(refused.status()).toBe(403);
  expect(refused.headers()["cache-control"]).toBe("no-store");
  expect(await refused.json()).toEqual({ error: "forbidden" });

  const missingOrigin = await page.request.post(path(teacher), { data: {} });
  expect(missingOrigin.status()).toBe(403);
  expect(await missingOrigin.json()).toEqual({ error: "origin_missing" });

  const extra = await page.request.post(path(teacher), { headers: { origin: ORIGIN }, data: { teacherId: teacher } });
  expect(extra.status()).toBe(422);
  expect(await extra.json()).toEqual({ error: "invalid_input" });

  const malformed = await page.request.post(path("not-a-teacher"), { headers: { origin: ORIGIN }, data: {} });
  expect(malformed.status()).toBe(422);
  expect(malformed.headers()["cache-control"]).toBe("no-store");
  expect(await malformed.json()).toEqual({ error: "invalid_input" });
});
