import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { BULLET_ITEM_HTML_ATTRIBUTE, BULLET_ITEM_HTML_VALUE } from "../src/editor/bullet-item";
import { messagesHr as t } from "../src/lib/i18n/messages.hr";
import { SHEET_THEME_KEY } from "../src/lib/ui/sheet-theme";

// Public home page for a visitor without a session (FE-H1, #476).

test.describe("public home page", () => {
  test("a visitor without a session sees the home page with its sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t.landing.title);
    await expect(page.getByRole("heading", { level: 2, name: t.landing.forWhomTitle })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: t.landing.howTitle })).toBeVisible();
    await expect(page.locator("#kako-radi ol > li")).toHaveCount(4);
    await expect(page.getByRole("figure", { name: t.landing.previewLabel })).toBeVisible();
    await expect(page.getByText(t.landing.aaiOnly)).toBeVisible();
  });

  test("the try-out block mirrors what the visitor types into the mentor's read-only view", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: t.landing.wow.sidesTitle })).toBeVisible();
    const student = page.getByRole("textbox", { name: t.landing.wow.editorLabel });
    const mentor = page.getByRole("textbox", { name: t.landing.wow.mentorLabel });
    await expect(mentor).toHaveAttribute("aria-readonly", "true");
    await student.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Dodana rečenica.");
    await expect(mentor).toContainText("Dodana rečenica.");
  });

  test("the try-out editor has the writing page's toolbar, and the mentor's view follows it (DAN-354)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", { name: t.toolbar.label });
    const student = page.getByRole("textbox", { name: t.landing.wow.editorLabel });
    const mentor = page.getByRole("textbox", { name: t.landing.wow.mentorLabel });
    // A tool that does not fit is in "Više", with the same command.
    const use = async (label: string) => {
      const button = toolbar.getByRole("button", { name: label, exact: true });
      if (await button.isVisible()) return button.click();
      await toolbar.getByRole("button", { name: t.toolbar.more }).click();
      await page.getByRole("menuitemcheckbox", { name: label }).click();
    };
    await student.click();
    await page.keyboard.press("End");
    await use(t.toolbar.heading1);
    await expect(student.locator("h1")).toHaveCount(1);
    await expect(mentor.locator("h1")).toHaveCount(1);
    await toolbar.getByRole("button", { name: t.toolbar.undo, exact: true }).click();
    await expect(student.locator("h1")).toHaveCount(0);
    await expect(mentor.locator("h1")).toHaveCount(0);
    await use(t.toolbar.bulletItem);
    const bullet = `p[${BULLET_ITEM_HTML_ATTRIBUTE}="${BULLET_ITEM_HTML_VALUE}"]`;
    await expect(student.locator(bullet)).toHaveCount(1);
    await expect(mentor.locator(bullet)).toHaveCount(1);
  });

  test("the try-out sends nothing and keeps nothing but the sheet theme (DAN-354)", async ({ page }) => {
    await page.goto("/");
    const student = page.getByRole("textbox", { name: t.landing.wow.editorLabel });
    await expect(student).toBeVisible();
    await page.waitForLoadState("networkidle");
    const before = await page.evaluate(() => Object.keys(localStorage).sort());
    const sent: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() !== "GET" || url.pathname.startsWith("/api/")) sent.push(`${request.method()} ${url.pathname}`);
    });
    await student.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Probna rečenica.");
    const toolbar = page.getByRole("toolbar", { name: t.toolbar.label });
    await toolbar.getByRole("button", { name: t.toolbar.bold, exact: true }).click();
    await page.keyboard.type(" Masno.");
    await toolbar.getByRole("button", { name: t.toolbar.undo, exact: true }).click();
    await toolbar.getByRole("button", { name: t.toolbar.view }).click();
    await page.getByRole("menuitemradio", { name: t.workspace.sheetThemeLight }).click();
    await page.waitForLoadState("networkidle");
    expect(sent).toEqual([]);
    const after = await page.evaluate(() => Object.keys(localStorage).sort());
    const added = after.filter((key) => !before.includes(key));
    expect(added.filter((key) => key !== SHEET_THEME_KEY)).toEqual([]);
    const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
    expect(stored).not.toContain("Probna");
  });

  test("the top of the page offers the try-out at once, without signing in (DAN-354)", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("main#sadrzaj").getByRole("link", { name: t.landing.tryEditorLink });
    await expect(hero).toHaveAttribute("href", "#isprobaj");
    const nav = page.getByRole("navigation", { name: t.landing.sectionsNav });
    await expect(nav.getByRole("link", { name: t.landing.tryEditorLink })).toHaveAttribute("href", "#isprobaj");
    await hero.click();
    await expect(page).toHaveURL(/#isprobaj$/);
    await expect(page.getByRole("heading", { level: 2, name: t.landing.wow.sidesTitle })).toBeInViewport();
  });

  test("the replay block scrubs an invented paragraph step by step", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: t.landing.replay.title })).toBeVisible();
    const slider = page.getByRole("slider", { name: t.landing.replay.sliderLabel });
    await slider.fill("0");
    await expect(page.getByText(t.landing.replay.empty)).toBeVisible();
    await slider.fill("1");
    await expect(page.getByText("Gradovi", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: t.landing.replay.play }).click();
    await expect(page.getByRole("button", { name: t.landing.replay.pause })).toBeVisible();
  });

  test("the access block switches roles with the keyboard and the questions open", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: t.landing.access.title })).toBeVisible();
    const student = page.getByRole("tab", { name: t.landing.access.roles.student.name });
    await expect(student).toHaveAttribute("aria-selected", "true");
    await student.focus();
    await page.keyboard.press("ArrowRight");
    const mentor = page.getByRole("tab", { name: t.landing.access.roles.mentor.name });
    await expect(mentor).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText(t.landing.access.roles.mentor.sees[0]);
    const first = Object.values(t.landing.faq.items)[0];
    await page.getByText(first.q).click();
    await expect(page.getByText(first.a)).toBeVisible();
  });

  test("every way in is a plain link to /prijava", async ({ page }) => {
    await page.goto("/");
    const entries = page.getByRole("link", { name: new RegExp(`^(${t.auth.signIn}|${t.landing.enter})$`) });
    await expect(entries).toHaveCount(3);
    for (const entry of await entries.all()) await expect(entry).toHaveAttribute("href", "/prijava");
    await page.getByRole("link", { name: t.landing.enter }).click();
    await expect(page).toHaveURL(/\/prijava$/);
  });

  test("the section links lead to their sections", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: t.landing.sectionsNav });
    await nav.getByRole("link", { name: t.landing.forWhomLink }).click();
    await expect(page).toHaveURL(/#za-koga$/);
    await expect(page.locator("#za-koga")).toBeInViewport();
  });

  test("the flow section announces ten steps and marks the coming ones (FE-H2a)", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: t.landing.sectionsNav });
    await nav.getByRole("link", { name: t.landing.flow.link }).click();
    await expect(page).toHaveURL(/#tijek-rada$/);
    const section = page.locator("#tijek-rada");
    await expect(section.getByRole("heading", { level: 2, name: t.landing.flow.title })).toBeInViewport();
    const cards = section.locator("ol > li");
    await expect(cards).toHaveCount(10);
    const soon = section.locator("ol > li[data-soon]");
    await expect(soon).toHaveCount(5);
    for (const card of await soon.all()) await expect(card).toContainText(t.landing.flow.soon);
    await expect(cards.filter({ hasText: t.landing.flow.soon })).toHaveCount(5);
    await expect(cards.first()).toContainText(t.landing.flow.steps.assignment.title);
    // Announcements only: no control inside the cards.
    await expect(section.locator("ol").locator("a, button, input, select, textarea")).toHaveCount(0);
  });

  test("the skip link moves focus to the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: t.shell.skipToContent })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#sadrzaj")).toBeFocused();
  });

  for (const sheet of ["dark", "light"] as const) {
    test(`axe: no WCAG 2.1 AA violations (sheet: ${sheet})`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: sheet === "light" ? t.workspace.sheetThemeLight : t.workspace.sheetThemeDark }).click();
      await expect(page.locator("article.sheet").first()).toHaveAttribute("data-sheet-theme", sheet);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test("at 390 px nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });

  test("with reduced motion the page has no running transition or animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("body *")].filter((element) => {
        const style = getComputedStyle(element);
        const seconds = (value: string) => Math.max(...value.split(",").map((part) => parseFloat(part) || 0));
        return seconds(style.transitionDuration) > 0 || style.animationName !== "none";
      }).length,
    );
    expect(moving).toBe(0);
  });
});
