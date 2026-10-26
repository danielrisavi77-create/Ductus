import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

// DAN-345 follow-up: the fake provider's "Demo prijava" page (local and CI
// only, D-09) answered /favicon.ico with 404. It now serves the app's mark in
// the colours of the first :root block of app/globals.css.
const GLOBALS = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
const ROOT = /:root\s*\{([\s\S]*?)\n\}/.exec(GLOBALS)?.[1] ?? "";
const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(ROOT)?.[1]?.toLowerCase();

test("the demo login page has the app's icon in the token colours", async ({ page, request }) => {
  const response = await request.get("http://localhost:8090/favicon.ico");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/svg+xml");
  const svg = (await response.text()).toLowerCase();
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{3,8})"/g)].map((m) => m[1]);
  expect(fills).toEqual([token("ground"), token("accent")]);

  await page.goto("/prijava");
  await page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:8090\/interaction\//);
  await expect(page.locator('head link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
});
