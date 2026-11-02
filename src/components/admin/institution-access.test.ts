import { describe, expect, it } from "vitest";

import { institutionScreen } from "./institution-access";

const TOKEN = "T".repeat(43);

// DAN-313 (A-01): the screen of /ustanova by the read and the principal.
describe("institutionScreen", () => {
  it("shows the counts only to a signed-in administrator", () => {
    expect(institutionScreen("ok", "signed-in", TOKEN)).toBe("allowed");
  });

  it("answers a refused person with the 404 of a route that does not exist", () => {
    for (const principal of ["signed-in", "signed-out", "unverified"] as const) {
      expect(institutionScreen("notFound", principal, TOKEN)).toBe("notFound");
    }
  });

  it("tells a closed session from no session (#1234)", () => {
    expect(institutionScreen(null, "signed-out", undefined)).toBe("signedOut");
    expect(institutionScreen("unauthorized", "signed-out", TOKEN)).toBe("expired");
    expect(institutionScreen("unauthorized", "signed-out", "kratko")).toBe("signedOut");
  });

  it("never shows the counts beside a session that closed between the reads", () => {
    expect(institutionScreen("ok", "signed-out", TOKEN)).toBe("expired");
    expect(institutionScreen("ok", "unverified", TOKEN)).toBe("unavailable");
  });

  it("keeps a failed read unavailable", () => {
    expect(institutionScreen("unavailable", "signed-in", TOKEN)).toBe("unavailable");
  });
});
