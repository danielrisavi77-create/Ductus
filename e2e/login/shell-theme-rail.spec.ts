import { expect, test, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// #1325 (DAN-490): in the light theme the student's side bar was an empty
// column right after the window widened from a phone to 1440 px; the drawer
// slide ran on the wide screen too. The navigation and "Odjava" must be in
// place at once, in both themes. Invented demo account only.

const PATH = "/upis";

/** Where the side bar and its parts are, read once and without waiting. */
async function railPlace(page: Page) {
  return page.locator("#bocna-navigacija").evaluate((aside, signOut) => {
    const nav = aside.querySelector("nav")!.getBoundingClientRect();
    const out = [...aside.querySelectorAll("button")].find((b) => b.textContent?.trim() === signOut);
    const outBox = out?.getBoundingClientRect();
    return {
      left: aside.getBoundingClientRect().left,
      navLeft: nav.left,
      navWidth: nav.width,
      signOutLeft: outBox ? outBox.left : -1,
      visibility: getComputedStyle(aside).visibility,
    };
  }, t.shell.signOut);
}

async function shoot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

for (const theme of ["tamna", "svijetla"] as const) {
  test(`${theme}: after widening from 400 to 1440 px the navigation and Odjava are visible at once`, async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    await signIn(page, PATH);
    if (theme === "svijetla") {
      await page.getByRole("button", { name: t.shell.theme }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    }
    await shoot(page, `traka-${theme}-400`);

    await page.setViewportSize({ width: 1440, height: 900 });
    const place = await railPlace(page);
    expect(place.left).toBe(0);
    expect(place.visibility).toBe("visible");
    expect(place.navLeft).toBeGreaterThanOrEqual(0);
    expect(place.navWidth).toBeGreaterThan(0);
    expect(place.signOutLeft).toBeGreaterThanOrEqual(0);

    const aside = page.getByRole("complementary", { name: t.shell.sideNav });
    await expect(aside.getByRole("navigation", { name: t.shell.workNav })).toBeInViewport({ ratio: 1 });
    await expect(aside.getByRole("button", { name: t.shell.signOut, exact: true })).toBeInViewport({ ratio: 1 });
    // The text reads against its own ground: ink and chrome differ.
    const colours = await aside.evaluate((el) => {
      const link = el.querySelector("nav a")!;
      return { ink: getComputedStyle(link).color, ground: getComputedStyle(el).backgroundColor };
    });
    expect(colours.ink).not.toBe(colours.ground);
    await shoot(page, `traka-${theme}-1440`);
  });
}
