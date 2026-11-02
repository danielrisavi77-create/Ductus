import { afterEach, describe, expect, it, vi } from "vitest";

import { environmentProblems } from "./env";

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

describe("instrumentation register()", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Next.js 15 keeps a process whose register() throws and answers 500, so
  // register() ends it itself.
  const exits = () => {
    const codes: number[] = [];
    const exit = ((code: number) => {
      codes.push(code);
      return undefined as never;
    }) as (code: number) => never;
    return { codes, exit };
  };

  it("ends a Node server without APP_DATABASE_URL with code 1 and names only the variable", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", "invented-secret");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { codes, exit } = exits();
    const { register } = await import("../../instrumentation");
    await register(exit);
    expect(codes).toEqual([1]);
    expect(errors).toHaveBeenCalledWith("Ductus cannot start: APP_DATABASE_URL is not a URL");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("invented-secret");
    errors.mockRestore();
  });

  it("lets a Node server with the variable start and skips the edge runtime", async () => {
    const { register } = await import("../../instrumentation");
    const { codes, exit } = exits();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", GOOD);
    await register(exit);
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("APP_DATABASE_URL", "");
    await register(exit);
    expect(codes).toEqual([]);
  });
});
