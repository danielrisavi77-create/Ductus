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

function refusal(env: Record<string, string | undefined>): AuthConfigError {
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

  // QA of #191: only development and test are not production; anything else,
  // unset or misspelt included, fails closed.
  it.each([undefined, "", "Production", "PRODUCTION", " production", "prod", "staging", "Development"])(
    "treats NODE_ENV=%j as production",
    (nodeEnv) => {
      expect(refusal({ ...LOCAL, NODE_ENV: nodeEnv }).message).toMatch(/prohibited in production/);
      const config = loadAuthConfig({ ...PRODUCTION, NODE_ENV: nodeEnv });
      expect(config.allowInsecureRequests).toBe(false);
      expect(refusal({ ...PRODUCTION, NODE_ENV: nodeEnv, OIDC_ISSUER: "https://localhost" }).message).toMatch(
        /OIDC_ISSUER must be an https URL/,
      );
    },
  );

  it("allows the fake provider under NODE_ENV=test", () => {
    expect(loadAuthConfig({ ...LOCAL, NODE_ENV: "test" }).provider).toBe("fake-oidc");
  });

  it("refuses a fake provider issuer that is not a loopback host", () => {
    for (const issuer of ["https://evil.example.com", "http://oidc.lokalno.test", "https://10.0.0.5"]) {
      expect(refusal({ ...LOCAL, OIDC_ISSUER: issuer }).message).toMatch(/must be a loopback host/);
    }
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
    // Review of #191: trailing dots, the rest of 127/8, unspecified and
    // mapped addresses, other IPv4 spellings, private ranges, single labels.
    "https://localhost.",
    "https://localhost.:8090",
    "https://oidc.test.",
    "https://idp.example..",
    "https://127.0.0.2",
    "https://0.0.0.0",
    "https://2130706433",
    "https://0x7f.1",
    "https://[::ffff:127.0.0.1]",
    "https://[::]",
    "https://[2001:db8::1]",
    "https://10.0.0.5",
    "https://172.16.0.1",
    "https://192.168.1.10",
    "https://169.254.169.254",
    "https://8.8.8.8",
    "https://intranet",
    // QA of #191: userinfo, query, fragment, a port, more reserved suffixes
    // and malformed labels.
    "https://user@idp.aai.example.hr",
    "https://user:pw@idp.aai.example.hr",
    "https://:pw@idp.aai.example.hr",
    "https://idp.aai.example.hr/?",
    "https://idp.aai.example.hr/#",
    "https://idp.aai.example.hr?",
    "https://idp.aai.example.hr/?x=1",
    "https://idp.aai.example.hr/#x",
    "https://idp.aai.example.hr:8443/oidc",
    "https://metadata.google.internal",
    "https://router.home.arpa",
    "https://1.0.0.127.in-addr.arpa",
    "https://idp.lan",
    "https://idp.corp",
    "https://idp.intranet",
    "https://idpxxxxxxxxxxxxxxx.onion",
    "https://idp..aai.example.hr",
    "https://-idp.aai.example.hr",
    "https://idp-.aai.example.hr",
    "https://idp_x.aai.example.hr",
  ])("refuses the issuer %s in production", (issuer) => {
    expect(refusal({ ...PRODUCTION, OIDC_ISSUER: issuer }).message).toMatch(/OIDC_ISSUER must be an https URL/);
  });

  it("refuses a local redirect URI in production and never allows insecure requests there", () => {
    expect(refusal({ ...PRODUCTION, OIDC_REDIRECT_URI: "http://localhost:3000/cb" }).message).toMatch(
      /OIDC_REDIRECT_URI/,
    );
    for (const redirect of [
      "https://localhost./cb",
      "https://127.0.0.2/cb",
      "https://[::ffff:7f00:1]/cb",
      "https://10.0.0.5/cb",
      "https://u:p@ductus.example.hr/api/auth/callback",
      "https://ductus.example.hr/api/auth/callback?next=/x",
      "https://ductus.example.hr/api/auth/callback#x",
      "https://:p@ductus.example.hr/api/auth/callback",
      "https://ductus.example.hr/api/auth/callback?",
      "https://ductus.example.hr/api/auth/callback#",
      "https://ductus.example.hr:8443/api/auth/callback",
      "https://ductus.corp/api/auth/callback",
    ]) {
      expect(refusal({ ...PRODUCTION, OIDC_REDIRECT_URI: redirect }).message).toMatch(/OIDC_REDIRECT_URI/);
    }
    expect(loadAuthConfig(PRODUCTION).allowInsecureRequests).toBe(false);
  });

  it("accepts a public DNS host in production, also with a trailing dot or the default port", () => {
    expect(loadAuthConfig({ ...PRODUCTION, OIDC_ISSUER: "https://idp.aai.example.hr./" }).issuer.hostname).toBe(
      "idp.aai.example.hr.",
    );
    expect(loadAuthConfig({ ...PRODUCTION, OIDC_ISSUER: "https://login.aai.example.hr/oidc" }).provider).toBe("aai-eduhr");
    expect(loadAuthConfig({ ...PRODUCTION, OIDC_ISSUER: "https://login.aai-x1.example.hr:443/oidc" }).issuer.port).toBe("");
  });

  it("allows http only for the fake provider on a loopback host", () => {
    expect(refusal({ ...LOCAL, DUCTUS_AUTH_PROVIDER: "aai-eduhr" }).message).toMatch(/http only/);
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
    for (const seconds of ["-1", "121", "1.5", "abc", "", " ", "1e1", "0x10", "+5", "0030"]) {
      expect(refusal({ ...LOCAL, OIDC_CLOCK_TOLERANCE_SECONDS: seconds }).message).toMatch(/TOLERANCE/);
    }
    expect(loadAuthConfig({ ...LOCAL, OIDC_CLOCK_TOLERANCE_SECONDS: "0" }).clockToleranceSeconds).toBe(0);
    expect(loadAuthConfig({ ...LOCAL, OIDC_CLOCK_TOLERANCE_SECONDS: "120" }).clockToleranceSeconds).toBe(120);
  });

  it("trims the client ID", () => {
    expect(loadAuthConfig({ ...LOCAL, OIDC_CLIENT_ID: " ductus-local\n" }).clientId).toBe("ductus-local");
  });
});
