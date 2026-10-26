import { expect, test } from "@playwright/test";

// DAN-345 (demo dry run of 26 Oct 2026): /favicon.ico answered 404. The icon
// is app/favicon.ico, which Next.js serves and names in every page's head.
test("the application serves /favicon.ico and links it from the page", async ({ page, request }) => {
  const response = await request.get("/favicon.ico");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//);
  const body = await response.body();
  // An ICO file starts with reserved 0 and type 1.
  expect([...body.subarray(0, 4)]).toEqual([0, 0, 1, 0]);

  await page.goto("/prijava");
  await expect(page.locator('head link[rel="icon"][href^="/favicon.ico"]')).toHaveCount(1);
});
