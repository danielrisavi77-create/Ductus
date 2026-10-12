import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { safeReturnTo } from "./return-to";

// Plan of attack #154, item 17: whatever path pieces an attacker combines,
// the result stays a path of this application.
const piece = fc.constantFrom(
  "/", "//", "\\", ".", "..", "%2e", "%2E", "%2e%2e", "%2f", "%5c", "?", "#", "@", ":", "zlo.test", "a", "api",
);
const candidate = fc.array(piece, { maxLength: 12 }).map((parts) => parts.join(""));

test.prop([fc.oneof(candidate, candidate.map((value) => `/${value}`), fc.string())])(
  "never leaves the origin and never starts with // or /\\",
  (value) => {
    const result = safeReturnTo(value);
    expect(result.startsWith("/")).toBe(true);
    expect(result.startsWith("//")).toBe(false);
    expect(result.startsWith("/\\")).toBe(false);
    expect(new URL(result, "https://ductus.example").origin).toBe("https://ductus.example");
  },
);
