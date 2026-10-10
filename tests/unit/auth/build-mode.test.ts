import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

// D-09 rests on `next build` fixing NODE_ENV to "production" (deps.ts). Next
// fixes "development" instead when this experimental flag is on, which would
// let a deployed build select the fake provider.
describe("build mode", () => {
  it("never builds with development NODE_ENV", () => {
    expect(nextConfig.experimental?.allowDevelopmentBuild).toBeUndefined();
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).not.toContain("allowDevelopmentBuild");
  });

  it("passes the build-time NODE_ENV literal to the login configuration", () => {
    const source = readFileSync(join(process.cwd(), "src/server/auth/deps.ts"), "utf8");
    expect(source).toContain("loadAuthConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV })");
  });
});
