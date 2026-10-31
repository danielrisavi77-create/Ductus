import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatBibliographyEntry, formatInText } from "../src/domain/citation/format";
import { parseCitationStyle } from "../src/domain/citation/style";
import type { ArticleSource, BookSource } from "../src/domain/citation/types";
import { messagesHr } from "../src/lib/i18n/messages.hr";

// The same file `fpzgCitationStyle` parses; Playwright does not import JSON modules.
const fpzgCitationStyle = parseCitationStyle(
  JSON.parse(readFileSync(join(process.cwd(), "config/faculties/fpzg/citation.json"), "utf8")),
);

/**
 * DAN-343 (contract on #866): the "Literatura" tab writes the citation and the
 * bibliography entry in the FPZG style, byte for byte the citation domain's
 * text, in Croatian alphabetical order under the heading "Literatura", and
 * writes nothing into a sheet that may not be written in. Invented authors
 * and titles only.
 */

const t = messagesHr.workspace.sources;

const BOOK: BookSource = {
  type: "book", authors: [{ kind: "person", family: "Horvat", given: "Ana" }], year: 2021,
  title: "Izmišljena knjiga", place: "Zagreb", publisher: "Primjer",
};
const ARTICLE: ArticleSource = {
  type: "article",
  authors: [{ kind: "person", family: "Babić", given: "Iva" }, { kind: "person", family: "Kovač", given: "Luka" }],
  year: 2019, title: "Izmišljeni članak", journal: "Primjer časopis", volume: "12", issue: "3", pages: "45-60",
};

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
const panelOf = (page: Page) => page.getByRole("complementary", { name: "Upute, literatura i komentari" });

async function openSources(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  if (width < 700) await page.locator(".workspace__panel .rail-toggle").click();
  const panel = panelOf(page);
  await panel.getByRole("tab", { name: messagesHr.workspace.tabSources }).click();
  return panel.getByRole("tabpanel");
}

async function blocksOf(page: Page): Promise<[string, string][]> {
  return editorOf(page).locator(":scope > *").evaluateAll((nodes) =>
    nodes.map((node) => [node.tagName.toLowerCase(), node.textContent ?? ""]));
}

async function fill(tab: Locator, values: Record<string, string>): Promise<void> {
  for (const [label, value] of Object.entries(values)) {
    await tab.getByLabel(label, { exact: true }).fill(value);
  }
}

async function noAxeFindings(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include(".workspace__panel").analyze();
  expect(results.violations).toEqual([]);
}

test.describe("sources panel (DAN-343)", () => {
  test("a book and an article: the domain's text, in order, under Literatura", async ({ page }, testInfo) => {
    const tab = await openSources(page, 1440);
    await editorOf(page).click();
    await page.keyboard.type("Prvi odlomak ");

    await tab.getByRole("button", { name: t.add }).click();
    await fill(tab, {
      [t.family]: "Horvat", [t.given]: "Ana", [t.year]: "2021", [t.title]: "Izmišljena knjiga",
      [t.place]: "Zagreb", [t.publisher]: "Primjer", [t.citePage]: "15",
    });
    await expect(tab.locator('[data-preview="citation"]')).toHaveText(formatInText(BOOK, fpzgCitationStyle, "15"));
    await expect(tab.locator('[data-preview="entry"]')).toHaveText(formatBibliographyEntry(BOOK, fpzgCitationStyle));
    await noAxeFindings(page);
    await testInfo.attach("sources-form-1440.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await tab.getByRole("button", { name: t.addAndCite }).click();

    await tab.getByRole("button", { name: t.add }).click();
    await tab.getByLabel(t.article).check();
    await fill(tab, {
      [t.family]: "Babić", [t.given]: "Iva", [t.family2]: "Kovač", [t.given2]: "Luka", [t.year]: "2019",
      [t.title]: "Izmišljeni članak", [t.journal]: "Primjer časopis", [t.volume]: "12", [t.issue]: "3", [t.pages]: "45-60",
    });
    await tab.getByRole("button", { name: t.addOnly }).click();

    // The same book again adds no second entry.
    await tab.getByRole("button", { name: t.add }).click();
    await fill(tab, {
      [t.family]: "Horvat", [t.given]: "Ana", [t.year]: "2021", [t.title]: "Izmišljena knjiga",
      [t.place]: "Zagreb", [t.publisher]: "Primjer",
    });
    await tab.getByRole("button", { name: t.addOnly }).click();

    const book = formatBibliographyEntry(BOOK, fpzgCitationStyle);
    const article = formatBibliographyEntry(ARTICLE, fpzgCitationStyle);
    await expect.poll(() => blocksOf(page)).toEqual([
      ["p", `Prvi odlomak ${formatInText(BOOK, fpzgCitationStyle, "15")}`],
      ["h1", "Literatura"],
      ["p", article],
      ["p", book],
    ]);
    await expect(tab.getByRole("listitem")).toHaveText([article + t.cite, book + t.cite]);
    await noAxeFindings(page);
    await testInfo.attach("sources-list-1440.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });

  test("missing fields are named and nothing is written", async ({ page }) => {
    const tab = await openSources(page, 1440);
    const before = await blocksOf(page);
    await tab.getByRole("button", { name: t.add }).click();
    await fill(tab, { [t.year]: "21" });
    await tab.getByRole("button", { name: t.addAndCite }).click();
    const alert = tab.getByRole("alert");
    await expect(alert).toContainText(t.required.replace("{field}", t.family));
    await expect(alert).toContainText(t.yearInvalid);
    await expect(tab.getByLabel(t.family, { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(await blocksOf(page)).toEqual(before);
    await tab.getByRole("button", { name: t.cancel }).click();
    await expect(tab.getByRole("button", { name: t.add })).toBeFocused();
  });

  // F-154 point 2: a field takes no more than its limit, typed or pasted.
  test("the fields take no more than their limit", async ({ page }) => {
    const tab = await openSources(page, 1440);
    await tab.getByRole("button", { name: t.add }).click();
    await fill(tab, { [t.title]: "n".repeat(301), [t.family]: "p".repeat(81), [t.citePage]: "1".repeat(21) });
    await expect(tab.getByLabel(t.title, { exact: true })).toHaveValue("n".repeat(300));
    await expect(tab.getByLabel(t.family, { exact: true })).toHaveValue("p".repeat(80));
    await expect(tab.getByLabel(t.citePage, { exact: true })).toHaveValue("1".repeat(20));
  });

  test("a tab that may not write says so and writes nothing", async ({ page, context }) => {
    await openSources(page, 1440);
    const second = await context.newPage();
    await second.setViewportSize({ width: 1440, height: 900 });
    await second.goto("/rad");
    await expect(editorOf(second)).toHaveAttribute("contenteditable", "false");
    await panelOf(second).getByRole("tab", { name: messagesHr.workspace.tabSources }).click();
    const tab = panelOf(second).getByRole("tabpanel");
    await expect(tab.getByText(t.readOnly)).toBeVisible();
    await tab.getByRole("button", { name: t.add }).click();
    await fill(tab, {
      [t.family]: "Horvat", [t.given]: "Ana", [t.year]: "2021", [t.title]: "Izmišljena knjiga",
      [t.place]: "Zagreb", [t.publisher]: "Primjer",
    });
    const write = tab.getByRole("button", { name: t.addAndCite });
    await expect(write).toHaveAttribute("aria-disabled", "true");
    // Forced: aria-disabled keeps the button reachable, and its click must do nothing.
    await write.click({ force: true });
    // The blocked tab shows no text (local-editor.spec.ts), and the click added none.
    await expect(editorOf(second)).toHaveText("");
    await expect(tab.getByRole("listitem")).toHaveCount(0);
  });

  test("on a phone the form fits and has no axe findings", async ({ page }, testInfo) => {
    const tab = await openSources(page, 375);
    await tab.getByRole("button", { name: t.add }).click();
    await expect(tab.getByLabel(t.family, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await noAxeFindings(page);
    await testInfo.attach("sources-form-375.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
});
