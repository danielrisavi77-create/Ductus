import { expect, test } from "@playwright/test";

// The F-4 workspace (design editor-v11, FE-D1) inside the design v3 shell
// (#476 6314969336, "Pisanje"): three columns on a wide screen; up to 1250 px
// the structure rail folds under the sheet, up to 1050 px the panel too
// (design v3 breakpoints with the shell's 236 px side bar; was README §5.1,
// FE-D2; DAN-131).
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
    expect(r!.width).toBeCloseTo(174, 0);
    expect(p!.width).toBeCloseTo(284, 0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(s!.x);
    expect(s!.x + s!.width).toBeLessThanOrEqual(p!.x);
    expect(s!.width).toBeLessThanOrEqual(720);
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
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      stops.push((await focused.getAttribute("aria-label")) ?? ((await focused.textContent()) ?? "").trim());
      expect(await focused.getAttribute("href")).not.toBe("#");
      const outline = await focused.evaluate((element) => getComputedStyle(element).outlineStyle);
      expect(outline).not.toBe("none");
    }
    // Without an assignment the teacher view has no address: it is a stop, but says so.
    // The shell's brand, the top bar's Početna (#802) and the theme switch come
    // first (no session: no navigation).
    expect(stops).toEqual([
      "Preskoči na sadržaj", "Ductura, početna", "Početna", "Promijeni svijetlu ili tamnu temu", "Pisanje",
      "Kako vidi nastavnik samo uz zadatak",
    ]);
  });

  test("teacher view is visibly disabled without an assignment; the sheet is the local editor", async ({ page }) => {
    await page.goto("/rad");
    const teacher = page.getByRole("navigation", { name: "Prikaz" }).getByRole("button", {
      name: "Kako vidi nastavnik samo uz zadatak",
    });
    await expect(teacher).toHaveAttribute("aria-disabled", "true");
    await expect(teacher).not.toHaveAttribute("href");
    // Playwright treats aria-disabled as disabled; force the click to prove it goes nowhere.
    await expect(teacher).toBeDisabled();
    await teacher.click({ force: true });
    await expect(page).toHaveURL(/\/rad$/);
    // This server runs with the local demo journal on (playwright.config.ts),
    // so the sheet is the editor; the read-only cases are covered below.
    const sheetText = page.getByRole("textbox", { name: "Tekst rada" });
    await expect(sheetText).toHaveAttribute("contenteditable", "true");
    await expect(sheetText).toHaveAttribute("aria-readonly", "false");
    await expect(sheetText).not.toHaveAttribute("aria-disabled", "true");
    // The sheet says nothing is coming; the closed Upute and Rad tabs (FE-D9)
    // hold their own "uskoro" marks, so only the visible ones are counted.
    await expect(page.locator("article.sheet .soon")).toHaveCount(0);
    await expect(page.locator(".soon:visible")).toHaveCount(1);
  });

  // Without the flag (as deployed) and with the flag refused outside
  // local|ci|demo, /rad keeps the read-only sheet and mounts no editor.
  for (const { name, origin } of [
    { name: "as deployed, without the local demo journal", origin: "http://localhost:3003" },
    { name: "with the local demo journal refused", origin: "http://localhost:3004" },
  ]) {
    test(`/rad ${name}: the sheet stays the read-only placeholder`, async ({ page }) => {
      await page.goto(`${origin}/rad`);
      const sheetText = page.getByRole("textbox", { name: "Tekst rada" });
      await expect(sheetText).toHaveAttribute("aria-disabled", "true");
      await expect(sheetText).toHaveText("Pisanje ovdje još nije moguće. uskoro");
      await expect(sheetText).not.toContainText("Počni");
      await expect(sheetText.locator(".soon")).toBeVisible();
      await expect(page.locator("[contenteditable]")).toHaveCount(0);
    });
  }

  // One DOM order (sheet, instructions, structure) at every width; CSS places
  // the rails with grid areas, never with `order`.
  for (const width of [1440, 1100, 990, 390]) {
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

  // 1251 px is the first width with three columns (folds up to 1250).
  for (const width of [1440, 1251]) {
    test(`wide ${width} px: no rail toggles, rail content always shown`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/rad");
      await expect(page.locator(".rail-toggle")).toHaveCount(2);
      for (const toggle of await page.locator(".rail-toggle").all()) {
        await expect(toggle).toBeHidden();
      }
      await expect(page.getByText("Komentari nastavnika prikazuju se ovdje.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Struktura", exact: true })).toBeVisible();
      const [r, s] = await Promise.all([
        page.getByRole("complementary", { name: "Struktura rada" }).boundingBox(),
        page.locator("article.sheet").boundingBox(),
      ]);
      expect(r!.x + r!.width).toBeLessThanOrEqual(s!.x);
    });
  }

  // From 1051 px up to 1250 px the panel stays beside the sheet and only the
  // structure folds under it; 1051 px is the first width that keeps the panel.
  for (const width of [1250, 1051]) {
    test(`middle ${width} px: panel beside the sheet, structure folded under it`, async ({
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
      expect(p!.width).toBeCloseTo(284, 0);
      expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(p!.x);
      expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(r!.y);
      expect(r!.x + r!.width).toBeLessThanOrEqual(p!.x + 1);

      const panelToggle = panel.getByRole("button", { name: "Upute, literatura i komentari" });
      const railToggle = rail.getByRole("button", { name: "Struktura rada" });
      await expect(panelToggle).toBeHidden();
      await expect(page.getByText("Komentari nastavnika prikazuju se ovdje.")).toBeVisible();
      await expect(railToggle).toBeVisible();
      await expect(railToggle).toHaveAttribute("aria-expanded", "false");
      expect((await railToggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole("heading", { name: "Struktura", exact: true })).toBeHidden();

      // Keyboard: after the editor the panel's tab list (one stop), then the
      // structure toggle; the hidden panel toggle is not a stop.
      if (tabVisitsLinks(browserName)) {
        await expect(page.getByRole("textbox", { name: "Tekst rada" })).toHaveAttribute("contenteditable", "true");
        // The sheet theme is in the toolbar's "Prikaz" menu (FE-D5): two stops
        // fewer; the shell's theme switch is one more, and so is the top bar's
        // Početna (#802).
        for (let i = 0; i < 9; i += 1) await page.keyboard.press("Tab");
        await expect(panel.getByRole("tab", { name: "Komentari" })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(railToggle).toBeFocused();
        await page.keyboard.press("Enter");
      } else {
        await railToggle.click();
      }
      await expect(railToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("heading", { name: "Struktura", exact: true })).toBeVisible();
    });
  }

  for (const width of [1050, 390]) {
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
      await expect(page.getByText("Komentari nastavnika prikazuju se ovdje.")).toBeHidden();

      // Keyboard: the panel toggle comes right after the top bar and the
      // sheet's editor, then the structure toggle; Enter opens.
      if (tabVisitsLinks(browserName)) {
        await expect(page.getByRole("textbox", { name: "Tekst rada" })).toHaveAttribute("contenteditable", "true");
        // Skip link, the shell (Ductura, Početna and the theme switch; below
        // 800 px ☰, Početna and the theme switch, the side bar being a closed
        // drawer), Pisanje, Kako vidi nastavnik, the toolbar (one stop, the
        // sheet theme is in its "Prikaz" menu, FE-D5), the editor, then the panel.
        for (let i = 0; i < 9; i += 1) await page.keyboard.press("Tab");
        await expect(panelToggle).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(panelToggle).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByText("Komentari nastavnika prikazuju se ovdje.")).toBeVisible();
        // The open panel's tab list is one stop, then the structure toggle.
        await page.keyboard.press("Tab");
        await expect(panel.getByRole("tab", { name: "Komentari" })).toBeFocused();
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

  test("work header: under the shell's top bar, the view switch at its end (design v3)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/rad");
    const bar = page.locator(".workspace__bar");
    const [top, header, modes] = await Promise.all([
      page.getByRole("banner").boundingBox(),
      bar.boundingBox(),
      bar.getByRole("navigation", { name: "Prikaz" }).boundingBox(),
    ]);
    expect(top!.y + top!.height).toBeLessThanOrEqual(header!.y);
    expect(modes!.x + modes!.width).toBeLessThanOrEqual(header!.x + header!.width);
    expect(modes!.x).toBeGreaterThan(header!.x + header!.width / 2);
    expect(header!.height).toBeGreaterThanOrEqual(48);
    // Brand and demo label are the shell's, not repeated in the work header.
    await expect(bar.getByRole("link", { name: /Ductura/ })).toHaveCount(0);
    await expect(page.getByRole("banner").getByText("Demo · izmišljeni podaci")).toBeVisible();
  });

  test("right panel: tabs in design order, Komentari open, arrow keys move and open", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/rad");
    const panel = page.getByRole("complementary", { name: "Upute, literatura i komentari" });
    const list = panel.getByRole("tablist", { name: "Bočni panel" });
    const tabs = list.getByRole("tab");
    await expect(tabs).toHaveText(["Literatura", "Upute", "Komentari", "Rad"]);
    const comments = list.getByRole("tab", { name: "Komentari" });
    await expect(comments).toHaveAttribute("aria-selected", "true");
    // One Tab stop: only the open tab is in the Tab order.
    await expect(list.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(panel.getByRole("tabpanel")).toHaveCount(1);
    await expect(panel.getByRole("tabpanel")).toHaveText("Komentari nastavnika prikazuju se ovdje.");

    await comments.focus();
    await page.keyboard.press("ArrowRight");
    const work = list.getByRole("tab", { name: "Rad" });
    await expect(work).toBeFocused();
    await expect(panel.getByRole("tabpanel")).toContainText("Etape");
    await page.keyboard.press("ArrowRight");
    const sources = list.getByRole("tab", { name: "Literatura" });
    await expect(sources).toBeFocused();
    await expect(sources).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("tabpanel")).toHaveText("Literatura rada prikazuje se ovdje.");
    await page.keyboard.press("End");
    await expect(work).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(comments).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    const instructions = list.getByRole("tab", { name: "Upute" });
    await expect(instructions).toHaveAttribute("aria-selected", "true");
    // No readable assignment on this /rad: the empty state, never an invented task (#476).
    await expect(panel.getByRole("tabpanel")).toHaveText("Upute zadatka prikazuju se ovdje.");
    await page.keyboard.press("Home");
    await expect(sources).toBeFocused();
    await instructions.click();
    await expect(panel.getByRole("tabpanel")).toHaveAccessibleName("Upute");
  });

  // The task, its due date and the allowed uses of a readable assignment are
  // in login/assignment-notice.spec.ts and SidePanels.test.ts (#476 contract
  // 6280487079): without one, Upute names no task and no word range.
  test("right panel (FE-D9): Upute without a readable assignment invents no task, Rad the stages with written states", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/rad");
    const panel = page.getByRole("complementary", { name: "Upute, literatura i komentari" });
    await panel.getByRole("tab", { name: "Upute" }).click();
    const upute = panel.getByRole("tabpanel");
    await expect(upute).toHaveText("Upute zadatka prikazuju se ovdje.");
    await expect(upute.getByRole("heading", { name: "Zadatak" })).toHaveCount(0);
    await expect(upute).not.toContainText("riječi");

    await panel.getByRole("tab", { name: "Rad" }).click();
    const rad = panel.getByRole("tabpanel");
    const stages = rad.getByRole("list").first().getByRole("listitem");
    await expect(stages).toHaveCount(5);
    // The state is written out, never colour alone.
    await expect(stages.nth(2)).toContainText("vraćeno s napomenom");
    await expect(stages.nth(2)).toContainText("Mentor: ");
    await expect(rad.getByRole("heading", { name: "Uz rad" })).toBeVisible();
  });

  test("the sheet has a visible 1 px rule border on the dark shell", async ({ page }) => {
    await page.goto("/rad");
    const shadow = await page
      .locator("article.sheet")
      .evaluate((element) => getComputedStyle(element).boxShadow);
    expect(shadow).toMatch(/0px 0px 0px 1px/);
  });

  test("shell is dark whatever the system says, the sheet is dark by default (design v3)", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/rad");
      const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(body).toBe("rgb(25, 22, 26)");
      const sheet = page.locator("article.sheet");
      await expect(sheet).toHaveAttribute("data-sheet-theme", "dark");
      expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(41, 35, 41)");
    }
  });

  test("the sheet theme switch works, is announced and is remembered only in the browser", async ({ page }) => {
    // On /rad the theme is in the toolbar's "Prikaz" menu (FE-D5).
    await page.goto("/rad");
    const view = page.getByRole("toolbar", { name: "Oblikovanje teksta" }).getByRole("button", { name: "Prikaz" });
    const theme = (name: string) => page.getByRole("menu", { name: "Prikaz" }).getByRole("menuitemradio", { name });
    await view.click();
    await expect(theme("Tamni list")).toHaveAttribute("aria-checked", "true");
    await expect(theme("Bijeli list")).toHaveAttribute("aria-checked", "false");
    await theme("Bijeli list").click();
    const sheet = page.locator("article.sheet");
    await expect(sheet).toHaveAttribute("data-sheet-theme", "light");
    await view.click();
    await expect(theme("Bijeli list")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    await page.reload();
    await expect(sheet).toHaveAttribute("data-sheet-theme", "light");
    await view.click();
    await theme("Tamni list").click();
    await expect(sheet).toHaveAttribute("data-sheet-theme", "dark");
  });

  test("a stored value that is not a theme leaves the sheet dark", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ductus.sheetTheme", "sepia"));
    await page.goto("/rad");
    await expect(page.locator("article.sheet")).toHaveAttribute("data-sheet-theme", "dark");
  });

  test("the brand link on the workspace is a comfortable target", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/rad");
    const box = await page.getByRole("complementary", { name: "Bočna navigacija" }).getByRole("link", { name: /Ductura/ }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(32);
  });

  for (const width of [1440, 1000]) {
    test(`home at ${width} px: content lines up with the header brand`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const brand = await page.getByRole("banner").getByRole("link", { name: "Ductura" }).boundingBox();
      const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
      // The brand link pads 6 px each side for its target and pulls back by 6 px.
      expect(Math.abs(brand!.x + 6 - heading!.x)).toBeLessThanOrEqual(1);
    });
  }

  test("home states what Ductura does not judge", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(
        "Ductura ne procjenjuje autorstvo ni korištenje AI-ja. Prije početka vidiš što nastavnik vidi i od kada.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  // Without a session "/" is the public home page and its way in is /prijava
  // (FE-H1, #476); the workspace link for a signed-in person is checked in
  // e2e/login/sign-out.spec.ts.
  test("home without a session leads to the sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Prijava" })).toHaveAttribute("href", "/prijava");
  });
});
