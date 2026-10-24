import { describe, expect, it } from "vitest";

import { messagesHr } from "./messages.hr";

const t = messagesHr.liveView;

// F-110 t.2, owner decision of 24 Oct (#87): the live view's note and its
// signed-out line say only what is true for the teacher's page.
describe("live view wording (F-110 t.2)", () => {
  it("the note does not claim the student sees the same view", () => {
    expect(t.note).toBe(
      "Prikazan je zadnji tekst koji je studentov preglednik poslao. To nije zapis rada i može kasniti ili zastati.",
    );
    expect(t.note).not.toContain("Student vidi");
  });

  it("the signed-out line does not name a cause", () => {
    expect(t.connection.signedOut).toBe("Više niste prijavljeni.");
    expect(t.connection.signedOut).not.toContain("istekla");
  });
});
