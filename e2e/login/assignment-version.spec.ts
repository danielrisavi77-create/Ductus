import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { signIn } from "./support";

// DAN-292 (#747): the new assignment version route exists in the running app
// and refuses every caller who is not a teacher of the assignment. The
// teacher's success, the stale version, the other institution and two
// requests at once are proved on the real database in
// tests/integration/assignment-version-route.integration.test.ts; the demo
// stack has one institution, and the teacher role belongs to demo-flow.
const ORIGIN = "http://localhost:3000";
const path = (assignment: string) => `/api/institution/assignments/${assignment}/versions`;
const BODY = {
  expectedVersion: 1, title: "Izmišljeni esej", instructions: "Upute za izmišljeni zadatak.", workType: "essay",
  opensAt: "2026-11-01T08:00:00Z", dueAt: "2026-11-30T22:00:00Z", aiPolicy: "prohibited", aiPurposes: [],
  evidenceProfile: "basic", importAllowed: false, wordMin: null, wordMax: null,
};

test("refuses an anonymous caller and a wrong Origin, uncached", async ({ request }) => {
  const anonymous = await request.post(path(randomUUID()), { headers: { origin: ORIGIN }, data: BODY });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["cache-control"]).toBe("no-store");
  expect(await anonymous.json()).toEqual({ error: "unauthorized" });

  const foreign = await request.post(path(randomUUID()), { headers: { origin: "https://evil.example" }, data: BODY });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toEqual({ error: "origin_mismatch" });
});

test("a signed-in student cannot publish a version, and the body stays closed", async ({ page }) => {
  await signIn(page, "/", "Demo studentica");
  const assignment = randomUUID();
  const refused = await page.request.post(path(assignment), { headers: { origin: ORIGIN }, data: BODY });
  expect(refused.status()).toBe(403);
  expect(refused.headers()["cache-control"]).toBe("no-store");
  expect(await refused.json()).toEqual({ error: "forbidden" });

  const withoutBound = Object.fromEntries(Object.entries(BODY).filter(([name]) => name !== "wordMin"));
  for (const data of [withoutBound, { ...BODY, role: "teacher" }]) {
    const invalid = await page.request.post(path(assignment), { headers: { origin: ORIGIN }, data });
    expect(invalid.status()).toBe(422);
    expect(await invalid.json()).toEqual({ error: "invalid_input" });
  }

  const malformed = await page.request.post(path("not-an-assignment"), { headers: { origin: ORIGIN }, data: BODY });
  expect(malformed.status()).toBe(422);
  expect(malformed.headers()["cache-control"]).toBe("no-store");
});
