import { describe, expect, it } from "vitest";

import { AuthConfigError, loadAuthConfig } from "./config";

// Synthetic values only (plan of attack #154, item 27).
const LOCAL = {
  NODE_ENV: "development",
  DUCTUS_AUTH_PROVIDER: "fake-oidc",
  OIDC_ISSUER: "http://localhost:8090",
  OIDC_CLIENT_ID: "ductus-local",
  OIDC_CLIENT_SECRET: "ductus-local-only",
  OIDC_REDIRECT_URI: "http://localhost:3000/api/auth/callback",
};
const PRODUCTION = {
  NODE_ENV: "production",
  DUCTUS_AUTH_PROVIDER: "aai-eduhr",
  OIDC_ISSUER: "https://idp.aai.example.hr",
  OIDC_CLIENT_ID: "ductus",
  OIDC_CLIENT_SECRET: "secret-value-that-must-not-leak",
  OIDC_REDIRECT_URI: "https://ductus.example.hr/api/auth/callback",
};

function refusal(env: Record<string, string>): AuthConfigError {
  try {
    loadAuthConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthConfigError);
    const secret = env.OIDC_CLIENT_SECRET;
    if (secret !== undefined && secret.trim() !== "") expect((error as Error).message).not.toContain(secret);
    return error as AuthConfigError;
  }
  throw new Error("configuration was accepted");
}

describe("loadAuthConfig", () => {
  it("accepts the fake provider over http on localhost outside production", () => {
    const config = loadAuthConfig(LOCAL);
    expect(config.provider).toBe("fake-oidc");
    expect(config.allowInsecureRequests).toBe(true);
    expect(config.idTokenAlg).toBe("RS256");
    expect(config.clockToleranceSeconds).toBe(30);
  });

  it("refuses the fake provider in production, whatever else is set", () => {
    expect(refusal({ ...LOCAL, NODE_ENV: "production" }).message).toMatch(/prohibited in production/);
    expect(refusal({ ...PRODUCTION, DUCTUS_AUTH_PROVIDER: "fake-oidc" }).message).toMatch(/prohibited/);
    expect(refusal({ ...PRODUCTION, DUCTUS_AUTH_PROVIDER: "FAKE-OIDC" }).message).toMatch(/must be aai-eduhr/);
  });

  it.each([
    "http://localhost:8090",
    "https://localhost:8090",
    "https://127.0.0.1",
    "https://[::1]",
    "https://oidc.lokalno.test",
    "https://idp.example",
    "https://fake.local",
    "http://idp.aai.example.hr",
  ])("refuses the issuer %s in production", (issuer) => {
    expect(refusal({ ...PRODUCTION, OIDC_ISSUER: issuer }).message).toMatch(/OIDC_ISSUER must be an https URL/);
  });

  it("refuses a local redirect URI in production and never allows insecure requests there", () => {
    expect(refusal({ ...PRODUCTION, OIDC_REDIRECT_URI: "http://localhost:3000/cb" }).message).toMatch(
      /OIDC_REDIRECT_URI/,
    );
    expect(loadAuthConfig(PRODUCTION).allowInsecureRequests).toBe(false);
  });

  it("allows http only for the fake provider on a loopback host", () => {
    expect(refusal({ ...LOCAL, DUCTUS_AUTH_PROVIDER: "aai-eduhr" }).message).toMatch(/http only/);
    expect(refusal({ ...LOCAL, OIDC_ISSUER: "http://oidc.lokalno.test" }).message).toMatch(/http only/);
    expect(refusal({ ...LOCAL, OIDC_ISSUER: "ftp://localhost" }).message).toMatch(/http\(s\)/);
  });

  it("requires every variable and names it without its value", () => {
    for (const name of Object.keys(LOCAL).filter((n) => n !== "NODE_ENV")) {
      const env: Record<string, string> = { ...LOCAL, [name]: " " };
      expect(refusal(env).message).toContain(name);
    }
    expect(refusal({ ...LOCAL, OIDC_ISSUER: "not a url" }).message).toBe("OIDC_ISSUER is not a URL");
  });

  it("pins an asymmetric ID token algorithm and bounds the clock tolerance", () => {
    for (const alg of ["none", "HS256", "rs256"]) {
      expect(refusal({ ...LOCAL, OIDC_ID_TOKEN_ALG: alg }).message).toMatch(/OIDC_ID_TOKEN_ALG/);
    }
    expect(loadAuthConfig({ ...LOCAL, OIDC_ID_TOKEN_ALG: "ES256" }).idTokenAlg).toBe("ES256");
    for (const seconds of ["-1", "121", "1.5", "abc"]) {
      expect(refusal({ ...LOCAL, OIDC_CLOCK_TOLERANCE_SECONDS: seconds }).message).toMatch(/TOLERANCE/);
    }
    expect(loadAuthConfig({ ...LOCAL, OIDC_CLOCK_TOLERANCE_SECONDS: "0" }).clockToleranceSeconds).toBe(0);
  });
});
