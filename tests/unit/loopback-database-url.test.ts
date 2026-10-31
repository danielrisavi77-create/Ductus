import { describe, expect, it } from "vitest";

import { isLoopbackDatabaseUrl, requireLoopbackDatabaseUrl } from "../integration/loopback-database-url";

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
