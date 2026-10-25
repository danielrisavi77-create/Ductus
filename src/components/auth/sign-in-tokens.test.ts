import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// #732 items 1 and 2: the sign-in screen and the demo login it leads to look
// like the rest of the app, on the v3 tokens of app/globals.css.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** Every hex value in the custom properties of the first :root block, shadows included. */
function rootTokens(css: string): Set<string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const values = [...root.matchAll(/--[\w-]+:([^;]*);/g)].map((m) => m[1]);
  return new Set(values.flatMap((value) => [...value.matchAll(HEX)].map((m) => m[0].toLowerCase())));
}

describe("sign-in on the v3 tokens", () => {
  it("the sign-in screen names no colour of its own", () => {
    expect(withoutComments(read("src/components/auth/SignInScreen.module.css")).match(HEX)).toBeNull();
  });

  it("the demo login page uses only token values of app/globals.css", () => {
    const tokens = rootTokens(read("app/globals.css"));
    const style = /const PAGE_STYLE = `([\s\S]*?)`;/.exec(read("infra/fake-oidc/server.mjs"))?.[1];
    expect(style).toBeDefined();
    const used = [...(style ?? "").matchAll(HEX)].map((m) => m[0].toLowerCase());
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((value) => !tokens.has(value))).toEqual([]);
  });
});
