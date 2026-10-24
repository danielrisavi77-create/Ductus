import { describe, expect, it } from "vitest";

import { showsInventedPanels } from "./demo-panels";

describe("invented Upute and Rad data (F-110 t.1)", () => {
  it("only for the local demo journal without a session", () => {
    expect(showsInventedPanels({ scope: "local-demo", signedIn: false })).toBe(true);
  });

  it("never for a signed-in person", () => {
    expect(showsInventedPanels({ scope: "scope-of-a-signed-in-person", signedIn: true })).toBe(false);
  });

  it("never without a journal", () => {
    expect(showsInventedPanels({ scope: null, signedIn: false })).toBe(false);
    expect(showsInventedPanels({ scope: null, signedIn: true })).toBe(false);
  });
});
