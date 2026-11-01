import { expect, test, type APIResponse } from "@playwright/test";

// DAN-296 (M1.6, part one): the security headers the production build sends
// today, read from `next start`, not from next.config.ts. The inventory and the
// target are in docs/engineering/sigurnosna-zaglavlja.md. This spec pins the
// current state: PR 2 changes the headers, this table and that document
// together, so no header can change or disappear unnoticed.

/** Headers next.config.ts sets on every response (`/:path*`). */
const EVERY_RESPONSE = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
} as const;

/** Headers the build does not send yet; PR 2 adds them (document, N-4). */
const NOT_SENT_YET = [
  "content-security-policy",
  "content-security-policy-report-only",
  "permissions-policy",
  "strict-transport-security",
  "cross-origin-opener-policy",
  "x-powered-by",
] as const;

/** Next.js answer for a dynamically rendered page (document, 4.1). */
const DYNAMIC_HTML_CACHE = "private, no-cache, no-store, max-age=0, must-revalidate";

/** Pages whose answer does not depend on a session or the database. */
const HTML_ROUTES = ["/", "/prijava", "/rad"] as const;

/** Pages that may answer differently without a session; config headers only. */
const OTHER_ROUTES = ["/zadaci", "/upis", "/nastavnik", "/nastavnik/brz-put", "/nastavnik/zadatak/novi"] as const;

function expectConfigHeaders(response: APIResponse) {
  const headers = response.headers();
  for (const [name, value] of Object.entries(EVERY_RESPONSE)) {
    expect(headers[name], `${response.url()} ${name}`).toBe(value);
  }
  for (const name of NOT_SENT_YET) {
    expect(headers[name], `${response.url()} ${name}`).toBeUndefined();
  }
}

test.describe("security headers on the build (DAN-296 inventory)", () => {
  for (const route of HTML_ROUTES) {
    test(`${route} carries the config headers and is never stored`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(/^text\/html/);
      expectConfigHeaders(response);
      expect(response.headers()["cache-control"]).toBe(DYNAMIC_HTML_CACHE);
    });
  }

  for (const route of OTHER_ROUTES) {
    test(`${route} carries the config headers`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status()).toBeLessThan(500);
      expectConfigHeaders(response);
    });
  }

  test("an unknown page is a 404 that is never stored", async ({ request }) => {
    const response = await request.get("/nepostoji-dan296", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expectConfigHeaders(response);
    expect(response.headers()["cache-control"]).toBe(DYNAMIC_HTML_CACHE);
  });

  test("hashed static chunks are public and immutable", async ({ request }) => {
    const page = await request.get("/prijava");
    const chunk = (await page.text()).match(/\/_next\/static\/chunks\/[^"'\s]+\.js/)?.[0];
    expect(chunk, "a chunk referenced by /prijava").toBeDefined();
    const response = await request.get(chunk!);
    expect(response.status()).toBe(200);
    expectConfigHeaders(response);
    expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("/api/health is never stored", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expectConfigHeaders(response);
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("/api/auth/login is never stored and its referrer policy is overwritten by the config", async ({ request }) => {
    // The production build refuses "Demo prijava" (D-09, e2e/auth.spec.ts).
    const response = await request.get("/api/auth/login", { maxRedirects: 0 });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
    // Finding N-1: src/server/auth/flow.ts asks for `no-referrer`, but the
    // `/:path*` entry in next.config.ts replaces it. PR 2 adds an
    // `/api/auth/:path*` entry; this line then expects "no-referrer".
    expectConfigHeaders(response);
  });

  test("/api/auth/callback is never stored and its referrer policy is overwritten by the config", async ({ request }) => {
    // Same finding N-1 as the login route: the production build refuses the
    // callback with a 503 that is never stored.
    const response = await request.get("/api/auth/callback", { maxRedirects: 0 });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expectConfigHeaders(response);
  });

  test("POST /api/auth/logout is never stored and its referrer policy is overwritten by the config", async ({ request }) => {
    const response = await request.post("/api/auth/logout", { maxRedirects: 0 });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expectConfigHeaders(response);
  });

  test("/favicon.ico is public but revalidated on every use", async ({ request }) => {
    const response = await request.get("/favicon.ico");
    expect(response.status()).toBe(200);
    expectConfigHeaders(response);
    expect(response.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  test("a method an API route does not handle gets no Cache-Control", async ({ request }) => {
    // Finding N-2: the framework 405 bypasses the route's own no-store.
    const response = await request.delete("/api/health");
    expect(response.status()).toBe(405);
    expectConfigHeaders(response);
    expect(response.headers()["cache-control"]).toBeUndefined();
  });

  test("the prerendered /nastavnik/kolegiji redirect may be cached by a shared cache", async ({ request }) => {
    // Finding N-3: a static redirect carries s-maxage; it holds no personal data.
    const response = await request.get("/nastavnik/kolegiji", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe("/nastavnik");
    expectConfigHeaders(response);
    expect(response.headers()["cache-control"]).toBe("s-maxage=31536000");
  });
});
