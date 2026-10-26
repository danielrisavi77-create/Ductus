import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { localAdminUrl, localAppUrl, localDbUrl } from "../../e2e/login/local-db-url";

// F-142 t.5: one place builds the e2e database URLs.
const E2E = fileURLToPath(new URL("../../e2e/", import.meta.url));
const HELPER = "login/local-db-url.ts";
const MESSAGE = "only against a local database";

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe("localDbUrl", () => {
  it.each([
    "postgres://u:p@127.0.0.1:54329/ductus",
    "postgres://u:p@localhost:5432/ductus",
    "postgresql://u:p@[::1]:5432/ductus",
  ])("accepts %s unchanged", (url) => {
    expect(localDbUrl(url)).toBe(url);
  });

  it.each([
    "postgres://u:p@db.example.test:5432/ductus",
    "postgres://u:p@127.0.0.1.example.test/ductus",
    "postgres://u:p@localhost.example.test/ductus",
    "postgres://u:p@10.0.0.5/ductus",
    "postgres://u:p@127.0.0.2/ductus",
    "postgres://u:p@postgres:5432/ductus",
    "postgres://127.0.0.1:p@db.example.test/ductus",
  ])("refuses %s", (url) => {
    expect(() => localDbUrl(url)).toThrow(MESSAGE);
  });

  it("refuses a value that is not a URL", () => {
    expect(() => localDbUrl("127.0.0.1")).toThrow();
  });
});

describe("localAdminUrl and localAppUrl", () => {
  it("fall back to the compose database", () => {
    expect(new URL(localAdminUrl({})).host).toBe("127.0.0.1:54329");
    expect(new URL(localAppUrl({})).host).toBe("127.0.0.1:54329");
    expect(new URL(localAdminUrl({})).username).toBe("ductus");
    expect(new URL(localAppUrl({})).username).toBe("ductus_app_local");
  });

  it("take the variables the e2e run sets", () => {
    const admin = "postgres://a:b@localhost:6000/x";
    const app = "postgres://c:d@localhost:6001/y";
    expect(localAdminUrl({ E2E_ADMIN_DATABASE_URL: admin })).toBe(admin);
    expect(localAppUrl({ APP_DATABASE_URL: app })).toBe(app);
  });

  it("refuse a variable that names another host", () => {
    const remote = "postgres://a:b@db.example.test:5432/x";
    expect(() => localAdminUrl({ E2E_ADMIN_DATABASE_URL: remote })).toThrow(MESSAGE);
    expect(() => localAppUrl({ APP_DATABASE_URL: remote })).toThrow(MESSAGE);
  });
});

describe("e2e files", () => {
  const files = filesUnder(E2E).map((path) => relative(E2E, path).replaceAll("\\", "/"));

  it("include the helper", () => {
    expect(files).toContain(HELPER);
  });

  it("build no database URL outside the helper", () => {
    const pattern = /postgres(?:ql)?:\/\/|DATABASE_URL|\bPG(?:HOST|USER|PASSWORD|PORT|DATABASE)\b/;
    const offenders = files
      .filter((file) => file !== HELPER)
      .filter((file) => pattern.test(readFileSync(join(E2E, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
