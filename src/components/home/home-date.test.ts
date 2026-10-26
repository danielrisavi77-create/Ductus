import { describe, expect, it } from "vitest";

import { homeDate } from "./home-date";

describe("homeDate (#802 part B)", () => {
  it("writes the day in Croatian with a capital weekday", () => {
    expect(homeDate(new Date("2026-10-25T10:00:00Z"))).toBe("Nedjelja, 25. 10. 2026.");
    expect(homeDate(new Date("2026-03-02T10:00:00Z"))).toBe("Ponedjeljak, 2. 3. 2026.");
  });

  it("counts the day in Zagreb, not on the server's clock", () => {
    // 23:30 UTC on Saturday is already Sunday in Zagreb.
    expect(homeDate(new Date("2026-10-24T23:30:00Z"))).toBe("Nedjelja, 25. 10. 2026.");
  });
});
