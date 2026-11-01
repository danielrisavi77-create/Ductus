import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isLoopbackDatabaseUrl, requireLoopbackDatabaseUrl } from "../integration/loopback-database-url";

const INTEGRATION = fileURLToPath(new URL("../integration/", import.meta.url));

/** Names X in `new URL(X).hostname` that hold a database URL rather than an S3 or HTTP endpoint. */
function hostnameOnlyDatabaseGuards(source: string): string[] {
  return [...source.matchAll(/new URL\(\s*([\w.]+)\s*\)\.hostname/g)]
    .map((match) => match[1])
    .filter((name) => /DATABASE|ADMIN|APP_URL|DB/i.test(name));
}

// F-167: the integration tests accept only a plain local database URL.
// Hosts and passwords are invented.
describe("isLoopbackDatabaseUrl", () => {
  it("accepts a plain postgres URL on this machine", () => {
    for (const url of [
      "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
      "postgresql://ductus:ductus-local-only@localhost:54329/ductus",
      "postgres://ductus:ductus-local-only@[::1]:54329/ductus",
      "postgres://ductus@127.0.0.1/ductus",
    ]) {
      expect(isLoopbackDatabaseUrl(url), url).toBe(true);
    }
  });

  it("refuses any query or fragment, even behind a loopback hostname", () => {
    for (const url of [
      "postgres://u:p@127.0.0.1:54329/ductus?sslmode=disable",
      "postgres://u:p@127.0.0.1:54329/ductus?application_name=it",
      "postgres://u:p@localhost:54329/ductus?a=1&b=2",
      "postgres://u:p@127.0.0.1:54329/ductus?",
      "postgres://u:p@127.0.0.1:54329/ductus#part",
      "postgres://u:p@127.0.0.1:54329/ductus#",
    ]) {
      expect(isLoopbackDatabaseUrl(url), url).toBe(false);
    }
  });

  it("refuses another host, another protocol and text that is no URL", () => {
    for (const url of [
      "postgres://u:p@db.remote.example:5432/ductus",
      "postgres://u:p@127.0.0.2:54329/ductus",
      "postgres://u:p@127.0.0.1.remote.example/ductus",
      "postgres:///ductus",
      "socket:/tmp/socket-dir",
      "http://127.0.0.1:54329/ductus",
      "127.0.0.1:54329/ductus",
      "",
    ]) {
      expect(isLoopbackDatabaseUrl(url), url).toBe(false);
    }
  });
});

describe("requireLoopbackDatabaseUrl", () => {
  it("returns an accepted URL unchanged and throws the given message otherwise", () => {
    const local = "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
    expect(requireLoopbackDatabaseUrl(local, "local only")).toBe(local);
    expect(() => requireLoopbackDatabaseUrl(`${local}?sslmode=disable`, "local only")).toThrow("local only");
  });
});

// F-172: a hostname check alone lets `?host=` in the query send pg elsewhere,
// so a database URL in an integration test goes through the helper above.
describe("database URL guards in the integration tests", () => {
  it("never check a database URL by its hostname alone", () => {
    const offenders = readdirSync(INTEGRATION)
      .filter((file) => file.endsWith(".ts") && file !== "loopback-database-url.ts")
      .flatMap((file) => hostnameOnlyDatabaseGuards(readFileSync(`${INTEGRATION}${file}`, "utf8")).map((name) => `${file}: ${name}`));
    expect(offenders).toEqual([]);
  });

  it("notice a hostname-only guard on a database URL and leave an S3 endpoint check alone", () => {
    expect(hostnameOnlyDatabaseGuards('if (!["127.0.0.1"].includes(new URL(ADMIN_URL).hostname)) {}')).toEqual(["ADMIN_URL"]);
    expect(hostnameOnlyDatabaseGuards("new URL(process.env.DATABASE_URL).hostname")).toEqual(["process.env.DATABASE_URL"]);
    expect(hostnameOnlyDatabaseGuards('if (!["127.0.0.1"].includes(new URL(S3_ENDPOINT).hostname)) {}')).toEqual([]);
  });
});