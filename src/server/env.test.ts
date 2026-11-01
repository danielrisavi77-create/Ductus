import { afterEach, describe, expect, it, vi } from "vitest";

import { assertEnvironment, EnvironmentError, environmentProblems } from "./env";

// DAN-299: the startup check. Passwords and hosts below are invented.
const GOOD = "postgres://ductus_app_local:invented-secret@127.0.0.1:54329/ductus";

describe("environmentProblems", () => {
  it("accepts a postgres or postgresql URL with a host", () => {
    expect(environmentProblems({ APP_DATABASE_URL: GOOD })).toEqual([]);
    expect(environmentProblems({ APP_DATABASE_URL: "postgresql://u:p@db.example.invalid:5432/ductus" })).toEqual([]);
  });

  it("names a missing, empty, malformed or foreign value by its variable only", () => {
    const cases: [string | undefined, string][] = [
      [undefined, "APP_DATABASE_URL is not set"],
      ["", "APP_DATABASE_URL is not set"],
      ["   ", "APP_DATABASE_URL is not set"],
      ["invented-secret-not-a-url", "APP_DATABASE_URL is not a URL"],
      ["mysql://u:invented-secret@127.0.0.1/ductus", "APP_DATABASE_URL is not a postgres URL"],
      ["postgres:///ductus?password=invented-secret", "APP_DATABASE_URL names no host"],
    ];
    for (const [value, problem] of cases) {
      const problems = environmentProblems({ APP_DATABASE_URL: value });
      expect(problems, String(value)).toEqual([problem]);
      expect(problems.join(" ")).not.toContain("invented-secret");
    }
  });

  it("does not ask for the login variables, so a D-09 production build still starts", () => {
    expect(
      environmentProblems({ APP_DATABASE_URL: GOOD, NODE_ENV: "production", DUCTUS_AUTH_PROVIDER: "fake-oidc" }),
    ).toEqual([]);
  });
});

describe("assertEnvironment", () => {
  it("throws an EnvironmentError without the value", () => {
    expect(() => assertEnvironment({ APP_DATABASE_URL: "invented-secret" })).toThrow(EnvironmentError);
    expect(() => assertEnvironment({ APP_DATABASE_URL: "invented-secret" })).toThrow(/^Ductus cannot start: APP_DATABASE_URL is not a URL$/);
    expect(() => assertEnvironment({ APP_DATABASE_URL: GOOD })).not.toThrow();
  });
});

describe("instrumentation register()", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stops a Node server without APP_DATABASE_URL", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", "");
    const { register } = await import("../../instrumentation");
    await expect(register()).rejects.toThrow("APP_DATABASE_URL is not set");
  });

  it("lets a Node server with the variable start and skips the edge runtime", async () => {
    const { register } = await import("../../instrumentation");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", GOOD);
    await expect(register()).resolves.toBeUndefined();
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("APP_DATABASE_URL", "");
    await expect(register()).resolves.toBeUndefined();
  });
});
