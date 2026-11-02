import { expect, test, type Page } from "@playwright/test";

// DAN-489 (M1.6b): the page Content-Security-Policy, enforced by the browser
// on the build. Playwright's evaluate() is exempt from CSP, so attacks are
// written into the served HTML through page.route, which keeps the real
// response headers. Violations are counted by a listener the init script
// registers before any markup runs. Only made-up text is typed.

type Probe = { violations: string[]; a1?: number; a2?: number; a4?: number; a4Control?: number };

const NONCE = /'nonce-([A-Za-z0-9+/]{22}==)'/;

/** Collects every securitypolicyviolation as "directive blocked-uri". */
async function watchViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: Probe = { violations: [] };
    (window as unknown as { __csp: Probe }).__csp = probe;
    document.addEventListener("securitypolicyviolation", (event) => {
      probe.violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
}

const probeOf = (page: Page) => page.evaluate(() => (window as unknown as { __csp: Probe }).__csp);

/** Serves `path` with `markup(nonce)` placed right after <head>, real headers kept. */
async function inject(page: Page, path: string, markup: (nonce: string) => string): Promise<void> {
  await page.route((url) => url.pathname === path, async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    const nonce = response.headers()["content-security-policy"]?.match(NONCE)?.[1];
    expect(nonce, "the served page carries a nonce").toBeDefined();
    const body = (await response.text()).replace("<head>", `<head>${markup(nonce!)}`);
    await route.fulfill({ response, body });
  });
}

test.describe("pages run under the policy without a violation", () => {
  for (const path of ["/", "/prijava", "/zadaci", "/nepostoji-dan489"]) {
    test(`${path}`, async ({ page }) => {
      await watchViolations(page);
      const response = await page.goto(path);
      expect(response!.headers()["content-security-policy"]).toMatch(NONCE);
      await page.waitForLoadState("networkidle");
      expect((await probeOf(page)).violations).toEqual([]);
    });
  }

  test("the editor on /rad takes text and keeps it on the device", async ({ page }) => {
    await watchViolations(page);
    await page.goto("/rad");
    const editor = page.getByRole("textbox", { name: "Tekst rada" });
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.click();
    await page.keyboard.type("Izmišljena rečenica pod politikom.");
    await expect(editor).toContainText("Izmišljena rečenica pod politikom.");
    await expect(page.locator(".workspace__status [role=status]")).toHaveText("Spremljeno na uređaju");
    // The base rules come from app/prosemirror.css, not an injected <style>.
    expect(await editor.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("break-spaces");
    expect(await page.locator("style[data-tiptap-style]").count()).toBe(0);
    expect((await probeOf(page)).violations).toEqual([]);
  });
});

test.describe("attacks the browser refuses (DAN-489)", () => {
  test("A1: an injected script without a nonce does not run", async ({ page }) => {
    await watchViolations(page);
    await inject(page, "/prijava", () => "<script>window.__csp.a1 = 1</script>");
    await page.goto("/prijava");
    await expect.poll(async () => (await probeOf(page)).violations).toContainEqual(expect.stringMatching(/^script-src(-elem)? inline$/));
    expect((await probeOf(page)).a1).toBeUndefined();
  });

  test("A2: an injected script with a made-up nonce does not run", async ({ page }) => {
    await watchViolations(page);
    await inject(page, "/prijava", () => '<script nonce="AAAAAAAAAAAAAAAAAAAAAA==">window.__csp.a2 = 1</script>');
    await page.goto("/prijava");
    await expect.poll(async () => (await probeOf(page)).violations).toContainEqual(expect.stringMatching(/^script-src(-elem)? inline$/));
    expect((await probeOf(page)).a2).toBeUndefined();
  });

  test("A3: an injected style is not applied", async ({ page }) => {
    await watchViolations(page);
    await inject(page, "/prijava", () => "<style>:root { --csp-a3: injected; }</style>");
    await page.goto("/prijava");
    await expect.poll(async () => (await probeOf(page)).violations).toContainEqual(expect.stringMatching(/^style-src(-elem)? inline$/));
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--csp-a3"))).toBe("");
  });

  test("A4: eval inside a script with the right nonce is refused, the script itself runs", async ({ page }) => {
    await watchViolations(page);
    await inject(
      page,
      "/prijava",
      (nonce) => `<script nonce="${nonce}">window.__csp.a4Control = 1; try { eval("window.__csp.a4 = 1"); } catch (_) {}</script>`,
    );
    await page.goto("/prijava");
    await expect.poll(async () => (await probeOf(page)).violations).toContainEqual(expect.stringMatching(/^script-src(-elem)? eval$/));
    const probe = await probeOf(page);
    expect(probe.a4Control, "the control: a script with the nonce runs, so the test is not blind").toBe(1);
    expect(probe.a4).toBeUndefined();
  });

  test("A7: two requests for the same page get different nonces", async ({ request }) => {
    const nonces = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      const policy = (await request.get("/prijava")).headers()["content-security-policy"];
      nonces.add(policy!.match(NONCE)![1]!);
    }
    expect(nonces.size).toBe(2);
  });
});
