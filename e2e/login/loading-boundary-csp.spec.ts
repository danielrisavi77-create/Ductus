import { readdirSync } from "node:fs";

import { expect, test, type APIRequestContext } from "@playwright/test";

/*
 * DAN-570 (#1541): Next.js writes the client chunks of a loading boundary as
 * `<script src async>` without the request nonce, and the page policy refuses
 * them ('strict-dynamic'); the page then never finished hydrating ("Upiši"
 * stayed disabled on WebKit). This checks the served HTML of every route with
 * a loading.tsx on the dev server of this suite. The one script without a nonce
 * it accepts is Turbopack's dev registration of stylesheets alone (a CSS module
 * in the boundary): it loads no code, so nothing waits for it. The browser
 * side runs in the F-7 step of demo-flow.spec.ts, in Chromium and WebKit.
 */

const INVENTED_ID = "00000000-0000-4000-8000-0000000d0570";

/** The URL of each loading boundary in app/, a dynamic segment filled with an invented id. */
function loadingRoutes(): string[] {
  const files = readdirSync("app", { recursive: true }) as string[];
  return files
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /(^|\/)loading\.(tsx|ts|jsx|js)$/.test(file))
    .map((file) => {
      const segments = file.split("/").slice(0, -1).filter((segment) => !/^\(.*\)$/.test(segment));
      return "/" + segments.map((segment) => (/^\[.*\]$/.test(segment) ? INVENTED_ID : segment)).join("/");
    })
    .sort();
}

// HTML tag and attribute names are case-insensitive, and a value may use either quote or none.
const SCRIPT_TAG = /<script\b[^>]*>/gi;
const SRC = /\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/i;
const NONCE = /\snonce\s*=\s*(?:"[^"]+"|'[^']+'|[^\s"'>]+)/i;
// The whole of a dev chunk-list registration; anything else in the file fails the match.
const CHUNK_LIST =
  /^\(globalThis\.TURBOPACK_CHUNK_LISTS \|\| \(globalThis\.TURBOPACK_CHUNK_LISTS = \[\]\)\)\.push\(\{\s*script: typeof document === "object" \? document\.currentScript : undefined,\s*chunks: (\[[^\]]*\]),\s*source: "\w+"\s*\}\);\s*$/;

/** The chunks a script without a nonce registers, or null when it is anything but a stylesheet registration. */
async function stylesheetsOnly(request: APIRequestContext, src: string): Promise<string[] | null> {
  const response = await request.get(src.replaceAll("&amp;", "&"));
  expect(response.status(), src).toBe(200);
  const chunks = (await response.text()).match(CHUNK_LIST)?.[1];
  if (chunks === undefined) return null;
  const list = JSON.parse(chunks) as string[];
  return list.length > 0 && list.every((chunk) => chunk.endsWith(".css")) ? list : null;
}

test("every route with a loading boundary is found", () => {
  expect(loadingRoutes()).toContain("/upis");
});

for (const route of loadingRoutes()) {
  test(`${route}: every script of the loading boundary carries the nonce`, async ({ request }) => {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const html = await response.text();
    // The boundary itself was served, not some other page.
    expect(html).toContain('aria-busy="true"');
    const withoutNonce = [...html.matchAll(SCRIPT_TAG)]
      .map(([tag]) => tag)
      .filter((tag) => SRC.test(tag) && !NONCE.test(tag))
      .map((tag) => {
        const [, double, single, bare] = tag.match(SRC)!;
        return (double ?? single ?? bare)!;
      });
    for (const src of withoutNonce) {
      expect(await stylesheetsOnly(request, src), `${src} loads code without the nonce`).not.toBeNull();
    }
  });
}
