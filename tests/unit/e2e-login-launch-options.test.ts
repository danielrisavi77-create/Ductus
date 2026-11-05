import { describe, expect, it } from "vitest";

import { demoLaunchOptions } from "../../e2e/login/launch-options";

const ENV = { PATH: "/bin", HOME: "/h", EMPTY: undefined };

// Input classes: the three engines Playwright names, and a name it does not.
describe("demoLaunchOptions", () => {
  it("starts Chromium in Croatian, by its argument and the environment", () => {
    const options = demoLaunchOptions("chromium", ENV);
    expect(options.args).toEqual(["--lang=hr-HR"]);
    expect(options.env).toEqual({ PATH: "/bin", HOME: "/h", LANG: "hr_HR.UTF-8", LANGUAGE: "hr" });
  });

  it.each(["webkit", "firefox"])("gives %s the environment alone: --lang is a Chromium argument they refuse", (engine) => {
    const options = demoLaunchOptions(engine, ENV);
    expect(options.args).toBeUndefined();
    expect(options.env).toEqual({ PATH: "/bin", HOME: "/h", LANG: "hr_HR.UTF-8", LANGUAGE: "hr" });
  });

  it("treats a name it does not know like an engine that takes no Chromium argument", () => {
    expect(demoLaunchOptions("other", ENV).args).toBeUndefined();
  });

  it("does not let the environment override the language it sets", () => {
    const options = demoLaunchOptions("webkit", { ...ENV, LANG: "en_US.UTF-8", LANGUAGE: "en" });
    expect(options.env).toMatchObject({ LANG: "hr_HR.UTF-8", LANGUAGE: "hr" });
  });
});
