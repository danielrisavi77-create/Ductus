import { expect, test, type APIResponse } from "@playwright/test";

// DAN-296 (M1.6, part one) and DAN-489 (M1.6b): the security headers the
// production build sends, read from `next start`, not from next.config.ts.
// The inventory is in docs/engineering/sigurnosna-zaglavlja.md. This spec pins
// the current state: a change to the headers changes this table and that
// document together, so no header can change or disappear unnoticed.

/** Headers next.config.ts sets on every response (`/:path*`). */
const EVERY_RESPONSE = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), clipboard-write=(self)",
} as const;

/** Headers the build does not send (document, 6 and 8). */
const NOT_SENT_YET = ["content-security-policy-report-only", "cross-origin-opener-policy", "x-powered-by"] as const;

/** middleware.ts: a policy with a new 128-bit nonce on every page (DAN-489). */
const PAGE_CSP = new RegExp(
  "^default-src 'self'; script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' " +
    "'sha256-w5EUkO0mfeWuprqAVvvDQYH6baexqP0/rQ\\+LVq3kZ6I=' 'strict-dynamic'; style-src 'self'; img-src 'self'; " +
    "font-src 'self'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; " +
    "form-action 'self' http://localhost:8090; frame-ancestors 'none'$",
);

/** next.config.ts on /api/:path*: nothing loads from an API response. */
const API_CSP = "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/**
 * next.config.ts on the paths middleware.ts leaves out (/_next/static/*,
 * /favicon.ico): the same no-load policy, so an HTML error there runs nothing.
 */
const STATIC_CSP = API_CSP;

/** Which Content-Security-Policy a response carries: a page, an API answer or a file. */
type Csp = "page" | "api" | "static";

/** Next.js answer for a dynamically rendered page (document, 4.1). */
const DYNAMIC_HTML_CACHE = "private, no-cache, no-store, max-age=0, must-revalidate";

/** Pages whose answer does not depend on a session or the database. */
const HTML_ROUTES = ["/", "/prijava", "/rad"] as const;

/** Pages that may answer differently without a session; config headers only. */
const OTHER_ROUTES = ["/zadaci", "/upis", "/nastavnik", "/nastavnik/brz-put", "/nastavnik/zadatak/novi"] as const;

function expectConfigHeaders(response: APIResponse, csp: Csp) {
  const headers = response.headers();
  for (const [name, value] of Object.entries(EVERY_RESPONSE)) {
    expect(headers[name], `${response.url()} ${name}`).toBe(value);
  }
  for (const name of NOT_SENT_YET) {
    expect(headers[name], `${response.url()} ${name}`).toBeUndefined();
  }
  const policy = headers["content-security-policy"];
  if (csp === "page") expect(policy, `${response.url()} csp`).toMatch(PAGE_CSP);
  else if (csp === "api") expect(policy, `${response.url()} csp`).toBe(API_CSP);
  else expect(policy, `${response.url()} csp`).toBe(STATIC_CSP);
}

test.describe("security headers on the build (DAN-296 inventory)", () => {
  for (const route of HTML_ROUTES) {
    test(`${route} carries the config headers and is never stored`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(/^text\/html/);
      expectConfigHeaders(response, "page");
      expect(response.headers()["cache-control"]).toBe(DYNAMIC_HTML_CACHE);
    });
  }

  for (const route of OTHER_ROUTES) {
    test(`${route} carries the config headers`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status()).toBeLessThan(500);
      expectConfigHeaders(response, "page");
    });
  }

  test("an unknown page is a 404 that is never stored", async ({ request }) => {
    const response = await request.get("/nepostoji-dan296", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expectConfigHeaders(response, "page");
    expect(response.headers()["cache-control"]).toBe(DYNAMIC_HTML_CACHE);
  });

  test("an unknown path below /_next/image is an HTML 404 under the page policy", async ({ request }) => {
    // DAN-489 review finding: the matcher excluded `_next/image/`, which only
    // ever matched such paths, so their HTML 404 had no policy at all.
    const response = await request.get("/_next/image/nepostoji-dan489", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toMatch(/^text\/html/);
    expectConfigHeaders(response, "page");
    expect(response.headers()["cache-control"]).toBe(DYNAMIC_HTML_CACHE);
  });

  test("the image endpoint's own error keeps the page policy", async ({ request }) => {
    const response = await request.get("/_next/image", { maxRedirects: 0 });
    expect(response.status()).toBe(400);
    expectConfigHeaders(response, "page");
  });

  test("hashed static chunks are public and immutable", async ({ request }) => {
    const page = await request.get("/prijava");
    const chunk = (await page.text()).match(/\/_next\/static\/chunks\/[^"'\s]+\.js/)?.[0];
    expect(chunk, "a chunk referenced by /prijava").toBeDefined();
    const response = await request.get(chunk!);
    expect(response.status()).toBe(200);
    expectConfigHeaders(response, "static");
    expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("a GET error on a static chunk is never an HTML page without a policy", async ({ request }) => {
    // DAN-489 review finding (c.6581226772): the middleware skips
    // /_next/static/*, and Next.js answers a Range past the end of a chunk
    // with a 416 rendered by its error page, as HTML. It must carry the
    // no-load policy from next.config.ts.
    const page = await request.get("/prijava");
    const chunk = (await page.text()).match(/\/_next\/static\/chunks\/[^"'\s]+\.js/)?.[0];
    expect(chunk, "a chunk referenced by /prijava").toBeDefined();
    const response = await request.get(chunk!, { headers: { range: "bytes=999999999999-" }, maxRedirects: 0 });
    expect(response.status()).toBe(416);
    expect(await response.text()).toMatch(/^<!DOCTYPE html>/);
    expectConfigHeaders(response, "static");
  });

  test("/api/health is never stored", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expectConfigHeaders(response, "api");
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("an unknown API path is a JSON 404 under the API policy, never an HTML page", async ({ request }) => {
    // DAN-489 review finding: app/not-found.tsx rendered here as HTML without
    // a nonce, so `default-src 'none'` refused its styles and scripts.
    for (const response of [
      await request.get("/api/nepostoji-dan489", { maxRedirects: 0 }),
      await request.post("/api/nepostoji-dan489", { maxRedirects: 0 }),
      await request.get("/api/health/nepostoji-dan489", { maxRedirects: 0 }),
      await request.get("/api/comments/nepostoji/dan489", { maxRedirects: 0 }),
    ]) {
      expect(response.status(), response.url()).toBe(404);
      expect(response.headers()["content-type"], response.url()).toMatch(/^application\/json/);
      expect(await response.json()).toEqual({ error: "not_found" });
      expectConfigHeaders(response, "api");
      expect(response.headers()["cache-control"], response.url()).toBe("no-store");
    }
  });

  test("/api/auth/login is never stored and its referrer policy is overwritten by the config", async ({ request }) => {
    // The production build refuses "Demo prijava" (D-09, e2e/auth.spec.ts).
    const response = await request.get("/api/auth/login", { maxRedirects: 0 });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
    // Finding N-1: src/server/auth/flow.ts asks for `no-referrer`, but the
    // `/:path*` entry in next.config.ts replaces it. A separate PR (outside
    // DAN-489) adds an `/api/auth/:path*` entry; this line then expects
    // "no-referrer".
    expectConfigHeaders(response, "api");
  });

  test("/api/auth/callback is never stored and its referrer policy is overwritten by the config", async ({ request }) => {
    // Same finding N-1 as the login route: the production build refuses the
    // callback with a 503 that is never stored.
    const response = await request.get("/api/auth/callback", { maxRedirects: 0 });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expectConfigHeaders(response, "api");
  });

  test("POST /api/auth/logout is never stored and its referrer policy is overwritten by the config", async ({ request }) => {
    const response = await request.post("/api/auth/logout", { maxRedirects: 0 });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expectConfigHeaders(response, "api");
  });

  test("/favicon.ico is public but revalidated on every use", async ({ request }) => {
    const response = await request.get("/favicon.ico");
    expect(response.status()).toBe(200);
    expectConfigHeaders(response, "static");
    expect(response.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  test("a method an API route does not handle gets no Cache-Control", async ({ request }) => {
    // Finding N-2: the framework 405 bypasses the route's own no-store.
    const response = await request.delete("/api/health");
    expect(response.status()).toBe(405);
    expectConfigHeaders(response, "api");
    expect(response.headers()["cache-control"]).toBeUndefined();
  });

  test("the /nastavnik/kolegiji redirect is no longer prerendered and never stored", async ({ request }) => {
    // Finding N-3, closed by DAN-489: the middleware makes the route dynamic,
    // so the redirect lost the year-long s-maxage a shared cache could keep.
    const response = await request.get("/nastavnik/kolegiji", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toBe("/nastavnik");
    expectConfigHeaders(response, "page");
    expect(response.headers()["cache-control"]).toBe("private, no-cache, no-store, max-age=0, must-revalidate");
  });
});
