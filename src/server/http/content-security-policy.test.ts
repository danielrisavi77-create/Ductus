import { describe, expect, it } from "vitest";

import { THEME_SCRIPT } from "@/components/shell/theme";

import {
  API_CONTENT_SECURITY_POLICY,
  issuerOriginOf,
  newNonce,
  pageContentSecurityPolicy,
  scriptHash,
  THEME_SCRIPT_HASH,
} from "./content-security-policy";

const NONCE = "AAAAAAAAAAAAAAAAAAAAAA==";
const HASH = "sha256-w5EUkO0mfeWuprqAVvvDQYH6baexqP0/rQ+LVq3kZ6I=";

describe("page Content-Security-Policy (DAN-489)", () => {
  it("is exact on the build: no unsafe-inline, no unsafe-eval", () => {
    const policy = pageContentSecurityPolicy({ nonce: NONCE, development: false, issuerOrigin: "http://localhost:8090" });
    expect(policy).toBe(
      "default-src 'self'; " +
        `script-src 'self' 'nonce-${NONCE}' '${HASH}' 'strict-dynamic'; ` +
        "style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'none'; " +
        "object-src 'none'; base-uri 'none'; form-action 'self' http://localhost:8090; frame-ancestors 'none'",
    );
    expect(policy).not.toContain("unsafe");
  });

  it("adds unsafe-eval for scripts and unsafe-inline for styles only under next dev", () => {
    const policy = pageContentSecurityPolicy({ nonce: NONCE, development: true, issuerOrigin: null });
    expect(policy).toContain(`script-src 'self' 'nonce-${NONCE}' '${HASH}' 'strict-dynamic' 'unsafe-eval';`);
    expect(policy).toContain("style-src 'self' 'unsafe-inline';");
    expect(policy).toContain("form-action 'self';");
  });

  it("keeps form-action at 'self' without an issuer origin (A6)", () => {
    const policy = pageContentSecurityPolicy({ nonce: NONCE, development: false, issuerOrigin: null });
    expect(policy).toContain("; form-action 'self'; ");
  });

  it.each([
    ["empty", ""],
    ["short", "AAAA"],
    ["129 bits", "AAAAAAAAAAAAAAAAAAAAAAA="],
    ["a source list break", `${NONCE.slice(0, 20)}'; script-src *`],
    ["a space", "AAAAAAAAAA AAAAAAAAAAA=="],
  ])("refuses a nonce that is %s", (_, nonce) => {
    expect(() => pageContentSecurityPolicy({ nonce, development: false, issuerOrigin: null })).toThrow(/nonce/);
  });

  it.each([
    ["without the sha256 prefix", HASH.slice("sha256-".length)],
    ["a sha384 source", `sha384-${"A".repeat(64)}`],
    ["one that breaks the list", `${HASH}' 'unsafe-inline`],
  ])("refuses a hash %s", (_, hash) => {
    expect(() => pageContentSecurityPolicy({ nonce: NONCE, development: false, issuerOrigin: null }, hash)).toThrow(/hash/);
  });

  it("allows THEME_SCRIPT by the hash of its actual text", async () => {
    expect(await scriptHash(THEME_SCRIPT)).toBe(THEME_SCRIPT_HASH);
    expect(THEME_SCRIPT_HASH).toBe(HASH);
  });
});

describe("issuer origin for form-action (A6)", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a URL", "localhost:8090"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,x"],
    ["an ftp URL", "ftp://idp.example.test"],
  ])("is null when OIDC_ISSUER is %s", (_, issuer) => {
    expect(issuerOriginOf(issuer)).toBeNull();
  });

  it("is the origin only, without path, query or credentials", () => {
    expect(issuerOriginOf("https://user:secret@idp.example.test:8443/realms/x?y=1#z")).toBe("https://idp.example.test:8443");
    expect(issuerOriginOf("http://localhost:8090")).toBe("http://localhost:8090");
  });
});

describe("nonce (A7)", () => {
  it("has 128 bits and is new on every call", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const nonce = newNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(nonce)).toHaveLength(16);
      seen.add(nonce);
    }
    expect(seen.size).toBe(1000);
  });
});

describe("API Content-Security-Policy", () => {
  it("lets nothing load and nothing frame an API response", () => {
    expect(API_CONTENT_SECURITY_POLICY).toBe("default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  });
});
