import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../src/lib/i18n/messages.hr";

// The public homepage is a browser-local product demonstration, not a real work.
test.describe("public home page", () => {
  test("a visitor sees the product, both audiences and the catalogue", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Jedan rad.");
    await expect(page.locator("#studenti")).toBeVisible();
    await expect(page.locator("#fakulteti")).toBeVisible();
    await expect(page.locator("#primjer")).toBeVisible();
    await expect(page.locator("#sve-mogucnosti .catalogue-list > details")).toHaveCount(11);
    await expect(page.getByText("Proizvod u razvoju.")).toBeVisible();
  });

  test("writing, mentor comment, revision and replay share the visitor's text", async ({ page }) => {
    await page.goto("/");
    const student = page.locator("#sample-text");
    await student.fill("Početna rečenica.");
    await expect(page.locator("#mirror-text")).toHaveText("Početna rečenica.");
    await page.locator("#flow-to-mentor").click();
    await expect(page.locator("#sample-read")).toHaveText("Početna rečenica.");
    await page.locator("#comment-text").fill("Molim obrazložite.");
    await page.locator("#comment-form button[type=submit]").click();
    await page.locator("#flow-to-student").click();
    await expect(page.locator("#comment-value")).toHaveText("Molim obrazložite.");
    await student.fill("Dorađena rečenica.");
    await expect(page.locator("#flow-before")).toHaveText("Početna rečenica.");
    await expect(page.locator("#flow-after")).toHaveText("Dorađena rečenica.");
    await page.locator("#flow-replay").click();
    await expect(page.locator("#tab-proces")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#own-history-text")).toHaveText("Dorađena rečenica.");
    await page.locator("#own-history-range").fill("1");
    await expect(page.locator("#own-history-text")).toHaveText("Početna rečenica.");
  });

  test("the prepared replay can be scrubbed and played", async ({ page }) => {
    await page.goto("/");
    await page.locator("#tab-proces").click();
    const slider = page.locator("#vision-replay-range");
    await slider.fill("0");
    await expect(page.locator("#vision-replay-text")).not.toBeEmpty();
    await page.locator("#vision-replay-play").click();
    await expect(page.locator("#vision-replay-play")).toHaveText("Zaustavi");
  });

  test("tabs respond to keyboard and the questions open", async ({ page }) => {
    await page.goto("/");
    const writing = page.locator("#tab-pisanje");
    await writing.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-izvori")).toHaveAttribute("aria-selected", "true");
    await page.getByText("Može li Ductura utvrditi tko je napisao rad?").click();
    await expect(page.getByText("Ne. Na temelju zapisa Ductura ne procjenjuje autorstvo.", { exact: false })).toBeVisible();
  });

  test("every way in leads to /prijava", async ({ page }) => {
    await page.goto("/");
    const entries = page.locator('a[href="/prijava"]');
    await expect(entries).toHaveCount(3);
    for (const entry of await entries.all()) await expect(entry).toHaveAttribute("href", "/prijava");
    await page.getByRole("link", { name: t.landing.enter }).click();
    await expect(page).toHaveURL(/\/prijava$/);
  });

  test("the section links lead to their sections", async ({ page }) => {
    await page.goto("/");
    if (await page.locator(".menu").isVisible()) await page.locator(".menu").click();
    await page.getByRole("navigation", { name: "Glavna navigacija" }).getByRole("link", { name: "Za studente" }).click();
    await expect(page).toHaveURL(/#studenti$/);
    await expect(page.locator("#studenti")).toBeInViewport();
  });

  test("the full catalogue opens without implying availability", async ({ page }) => {
    await page.goto("/");
    const catalogue = page.locator("#sve-mogucnosti");
    await expect(catalogue.locator(".catalogue-list > details")).toHaveCount(11);
    await expect(catalogue).toContainText("Dio funkcija je u razvoju ili planiran");
    await catalogue.locator("details").first().locator("summary").click();
    await expect(catalogue.locator("details").first()).toHaveAttribute("open", "");
  });

  test("a faculty can inspect the snapshot and prepare an unsent enquiry", async ({ page }) => {
    await page.goto("/");
    await page.locator("#faculty-explore").click();
    await page.locator("#faculty-search").fill("Rijeka");
    await page.locator("#faculty-unit").selectOption("uniri::efri");
    await expect(page.locator("#faculty-citations")).toContainText("Harvard");
    await expect(page.locator(".faculty-source")).toHaveAttribute("href", /verified-index\.json$/);
    await page.locator("#request-institution").fill("Fakultet");
    await page.locator("#request-form button[type=submit]").click();
    await expect(page.locator("#request-output")).toHaveValue(/Ustanova: Fakultet/);
    await expect(page.locator("#request-feedback")).toContainText("nije poslan");
  });

  test("the skip link moves focus to the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: t.shell.skipToContent })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#sadrzaj")).toBeFocused();
  });

  test("axe: no WCAG 2.1 AA violations on the public landing", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("at 390 px nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });

  test("with reduced motion the page has no running transition or animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const moving = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => {
      const style = getComputedStyle(element);
      const seconds = (value: string) => Math.max(...value.split(",").map((part) => parseFloat(part) || 0));
      return seconds(style.transitionDuration) > 0 || style.animationName !== "none";
    }).length);
    expect(moving).toBe(0);
  });
});
