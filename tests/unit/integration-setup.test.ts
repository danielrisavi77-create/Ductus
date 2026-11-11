import { describe, expect, it } from "vitest";

import { DATABASE_URL_VARIABLES, foreignDatabaseUrls } from "../integration/loopback-database-url";
import config from "../../vitest.config";

// F-019: the integration project refuses to start against a database that is
// not this machine's. Hosts and passwords are invented.
const LOCAL = "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";

describe("integration setup", () => {
  it("is a setup file of the integration project", () => {
    const projects = (config.test?.projects ?? []) as { test?: { name?: string; setupFiles?: string[] } }[];
    const integration = projects.find((project) => project.test?.name === "integration");
    expect(integration?.test?.setupFiles).toContain("tests/integration/setup.ts");
  });

  it("accepts unset and local URLs", () => {
    expect(foreignDatabaseUrls({})).toEqual([]);
    expect(foreignDatabaseUrls(Object.fromEntries(DATABASE_URL_VARIABLES.map((name) => [name, LOCAL])))).toEqual([]);
  });

  it("names every variable that points elsewhere", () => {
    expect(
      foreignDatabaseUrls({
        DATABASE_URL: "postgres://u:p@db.remote.example:5432/ductus",
        APP_DATABASE_URL: LOCAL,
        AUTH_DATABASE_URL: `${LOCAL}?host=db.remote.example`,
      }),
    ).toEqual(["DATABASE_URL", "AUTH_DATABASE_URL"]);
    expect(foreignDatabaseUrls({ APP_DATABASE_URL: "postgres://u:p@127.0.0.1:6543/ductus" })).toEqual(["APP_DATABASE_URL"]);
    expect(foreignDatabaseUrls({ DATABASE_URL: "" })).toEqual(["DATABASE_URL"]);
  });
});
