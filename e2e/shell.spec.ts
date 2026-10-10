import { expect, test } from "@playwright/test";

// The F-4 shell (design v6, D-89): three columns on a wide screen, the sheet
// first and the rails as sections under it below 1100 px (DAN-131).
test.describe("workspace shell", () => {
  test("wide: rails beside the sheet, writing view marked current", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/rad");
    const rail = page.getByRole("complementary", { name: "Struktura rada" });
    const sheet = page.locator("article.sheet");
    const panel = page.getByRole("complementary", {
      name: "Upute, literatura i komentari",
    });
    const [r, s, p] = await Promise.all([rail.boundingBox(), sheet.boundingBox(), panel.boundingBox()]);
    expect(r && s && p).toBeTruthy();
    expect(r!.width).toBeCloseTo(236, 0);
    expect(p!.width).toBeCloseTo(322, 0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(s!.x);
    expect(s!.x + s!.width).toBeLessThanOrEqual(p!.x);
    expect(s!.width).toBeLessThanOrEqual(756);
    await expect(
      page.getByRole("navigation", { name: "Prikaz" }).getByRole("link", { name: "Pisanje" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("phone: sheet first, no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rad");
    const sheet = await page.locator("article.sheet").boundingBox();
    const rail = await page.getByRole("complementary", { name: "Struktura rada" }).boundingBox();
    expect(sheet!.y).toBeLessThan(rail!.y);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  // Whether Tab visits links is a browser setting in WebKit: off by default on
  // macOS and in the Windows port, on in the Linux port that CI runs.
  const tabVisitsLinks = (browserName: string) => browserName !== "webkit" || process.platform === "linux";

  for (const path of ["/", "/rad"]) {
    test(`keyboard: the skip link is the first stop on ${path} and leads to the content`, async ({
      page,
      browserName,
    }) => {
      await page.goto(path);
      const skip = page.getByRole("link", { name: "Preskoči na sadržaj" });
      if (tabVisitsLinks(browserName)) {
        await page.keyboard.press("Tab");
      } else {
        await skip.focus();
      }
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.locator("main#sadrzaj")).toBeFocused();
    });
  }

  test("keyboard: every stop in the workspace is a real control with a visible focus mark", async ({
    page,
    browserName,
  }) => {
    test.skip(!tabVisitsLinks(browserName), "Tab does not visit links in this WebKit port by default");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/rad");
    const stops: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      stops.push(((await focused.textContent()) ?? "").trim());
      expect(await focused.getAttribute("href")).not.toBe("#");
      const outline = await focused.evaluate((element) => getComputedStyle(element).outlineStyle);
      expect(outline).not.toBe("none");
    }
    // The teacher view has no address yet (F-8): it is a stop, but says it is not ready.
    expect(stops).toEqual(["Preskoči na sadržaj", "Ductus", "Pisanje", "Kako vidi nastavnik uskoro"]);
  });

  test("teacher view and sheet are visibly disabled until F-8", async ({ page }) => {
    await page.goto("/rad");
    const teacher = page.getByRole("navigation", { name: "Prikaz" }).getByRole("button", {
      name: "Kako vidi nastavnik uskoro",
    });
    await expect(teacher).toHaveAttribute("aria-disabled", "true");
    await expect(teacher).not.toHaveAttribute("href");
    // Playwright treats aria-disabled as disabled; force the click to prove it goes nowhere.
    await expect(teacher).toBeDisabled();
    await teacher.click({ force: true });
    await expect(page).toHaveURL(/\/rad$/);
    const sheetText = page.getByRole("textbox", { name: "Tekst rada" });
    await expect(sheetText).toHaveAttribute("aria-disabled", "true");
    await expect(sheetText).toHaveText("Pisanje ovdje još nije moguće. uskoro");
    await expect(sheetText).not.toContainText("Počni");
    await expect(sheetText.locator(".soon")).toBeVisible();
  });

  // One DOM order (sheet, instructions, structure) at every width; CSS places
  // the rails with grid areas, never with `order`.
  for (const width of [1440, 1000, 390]) {
    test(`order at ${width} px: DOM, Tab and reading order are one`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/rad");
      const order = await page.locator(".workspace__body > *").evaluateAll((items) =>
        items.map((item) => ({
          cls: item.className,
          order: getComputedStyle(item).order,
        })),
      );
      expect(order.map((item) => item.cls)).toEqual([
        "workspace__main",
        "workspace__panel",
        "workspace__rail",
      ]);
      expect(order.every((item) => item.order === "0")).toBe(true);
    });
  }

  test("wide: no rail toggles, rail content always shown", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/rad");
    await expect(page.locator(".rail-toggle")).toHaveCount(2);
    for (const toggle of await page.locator(".rail-toggle").all()) {
      await expect(toggle).toBeHidden();
    }
    await expect(page.getByText("Upute zadatka, literatura i komentari")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Struktura", exact: true })).toBeVisible();
  });

  for (const width of [1000, 390]) {
    test(`narrow ${width} px: rails under the sheet open with real buttons`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/rad");
      const sheet = await page.locator("article.sheet").boundingBox();
      const panel = page.getByRole("complementary", {
        name: "Upute, literatura i komentari",
      });
      const rail = page.getByRole("complementary", { name: "Struktura rada" });
      const [p, r] = await Promise.all([panel.boundingBox(), rail.boundingBox()]);
      expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(p!.y);
      expect(p!.y + p!.height).toBeLessThanOrEqual(r!.y);

      const panelToggle = panel.getByRole("button", {
        name: "Upute, literatura i komentari",
      });
      const railToggle = rail.getByRole("button", { name: "Struktura rada" });
      for (const toggle of [panelToggle, railToggle]) {
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        const box = await toggle.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByText("Upute zadatka, literatura i komentari")).toBeHidden();

      // Keyboard: the panel toggle comes right after the top bar and the
      // sheet has no stop, then the structure toggle; Enter opens.
      if (tabVisitsLinks(browserName)) {
        // Skip link, Ductus, Pisanje, Kako vidi nastavnik, then the panel.
        for (let i = 0; i < 5; i += 1) await page.keyboard.press("Tab");
        await expect(panelToggle).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(panelToggle).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByText("Upute zadatka, literatura i komentari")).toBeVisible();
        await page.keyboard.press("Tab");
        await expect(railToggle).toBeFocused();
        await page.keyboard.press("Space");
        await expect(railToggle).toHaveAttribute("aria-expanded", "true");
      } else {
        await panelToggle.click();
        await railToggle.click();
        await expect(panelToggle).toHaveAttribute("aria-expanded", "true");
        await expect(railToggle).toHaveAttribute("aria-expanded", "true");
      }
      await expect(page.getByRole("heading", { name: "Struktura", exact: true })).toBeVisible();
      await railToggle.click();
      await expect(railToggle).toHaveAttribute("aria-expanded", "false");
    });
  }

  for (const [width, min] of [
    [1440, 12],
    [390, 13],
  ] as const) {
    for (const path of ["/", "/rad"]) {
      test(`text on ${path} at ${width} px is at least ${min} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        for (const toggle of await page.locator(".rail-toggle").all()) {
          if (await toggle.isVisible()) await toggle.click();
        }
        const small = await page.evaluate((limit) => {
          const found: string[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const element = node.parentElement;
            if (!element || !node.textContent?.trim()) continue;
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const size = parseFloat(getComputedStyle(element).fontSize);
            if (size < limit) found.push(`${size}px: ${node.textContent.trim()}`);
          }
          return found;
        }, min);
        expect(small).toEqual([]);
      });
    }
  }

  test("dark: the sheet has a visible 1 px rule border", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/rad");
    const shadow = await page
      .locator("article.sheet")
      .evaluate((element) => getComputedStyle(element).boxShadow);
    expect(shadow).toMatch(/0px 0px 0px 1px/);
  });

  test("the brand link on the workspace is a comfortable target", async ({ page }) => {
    await page.goto("/rad");
    const box = await page.locator(".workspace__bar").getByRole("link", { name: "Ductus" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(32);
  });

  for (const width of [1440, 1000]) {
    test(`home at ${width} px: content lines up with the header brand`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const brand = await page.getByRole("banner").getByRole("link", { name: "Ductus" }).boundingBox();
      const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
      // The brand link pads 6 px each side for its target and pulls back by 6 px.
      expect(Math.abs(brand!.x + 6 - heading!.x)).toBeLessThanOrEqual(1);
    });
  }

  test("home states what Ductus does not judge", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(
        "Ductus ne procjenjuje autorstvo ni korištenje AI-ja. Prije početka vidiš što nastavnik vidi i od kada.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("home links to the workspace", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Otvori radni prostor" }).click();
    await expect(page).toHaveURL(/\/rad$/);
  });
});
