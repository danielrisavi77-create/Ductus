import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// D-09: AAI@EduHr is the only login. The auth API is exactly these five
// routes; another (a password form, a magic link, another provider) fails
// here and needs a decision first (attacks 27, 28). The fourth,
// back-channel logout, came with one (D-200 P4, DAN-474): the provider posts
// a signed logout token and the route only closes sessions, never opens one.
// The fifth, sign-out on every device (DAN-296, D-200 P2), likewise only
// closes the sessions of the account behind the cookie.
const ROOT = join(process.cwd(), "app");

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routes(path);
    return /^route\.[jt]sx?$/.test(entry.name) ? [relative(ROOT, path).replaceAll("\\", "/")] : [];
  });
}

describe("auth route inventory", () => {
  it("has login, callback, logout, logout-all and back-channel logout under app/api/auth and nothing else", () => {
    expect(routes(join(ROOT, "api", "auth")).sort()).toEqual([
      "api/auth/backchannel-logout/route.ts",
      "api/auth/callback/route.ts",
      "api/auth/login/route.ts",
      "api/auth/logout-all/route.ts",
      "api/auth/logout/route.ts",
    ]);
  });

  it("has no other route that names a login, session or password", () => {
    const suspicious = routes(ROOT).filter(
      (path) => !path.startsWith("api/auth/") && /(log-?in|sign-?in|session|passw|token|oauth|oidc|saml)/i.test(path),
    );
    expect(suspicious).toEqual([]);
  });
});

describe("a login configuration that does not load", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("ends on the neutral page, naming no variable: the fake provider in a production build (D-09)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DUCTUS_AUTH_PROVIDER", "fake-oidc");
    vi.stubEnv("OIDC_ISSUER", "http://localhost:8090");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../../../app/api/auth/login/route");
    const response = await GET(new Request("http://localhost:3000/api/auth/login"));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toContain("Prijava nije dovršena");
    expect(body).not.toMatch(/OIDC|DUCTUS_|fake|D-09/);
    expect(log).toHaveBeenCalledWith("login failed", "config", "AuthConfigError");
  });

  it("G1, G6: back-channel logout answers 503 with no body, naming no variable, and 405 to GET (DAN-474)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DUCTUS_AUTH_PROVIDER", "fake-oidc");
    vi.stubEnv("OIDC_ISSUER", "http://localhost:8090");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST, GET } = await import("../../../app/api/auth/backchannel-logout/route");
    const response = await POST(
      new Request("http://localhost:3000/api/auth/backchannel-logout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "logout_token=a.b.c",
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("");
    expect(log).toHaveBeenCalledWith("backchannel logout failed", "config", "AuthConfigError");
    const other = GET();
    expect(other.status).toBe(405);
    expect(other.headers.get("allow")).toBe("POST");
  });
});
