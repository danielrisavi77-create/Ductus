import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CAPABILITIES, checkCapabilities, type Capability, type CapabilityProbe } from "@/server/ready";

// DAN-585: every combination of probe outcomes. The rule is total: ready iff
// the database is ready and no capability is unavailable; the answer holds no
// text of any failure.
const SECRET = "postgres://user:pw@db.internal/ductus";

const outcome = fc.constantFrom(
  "ready",
  "not_configured",
  "unavailable",
  "unexpected",
  "coded",
  "uncoded",
  "non_error",
  "sync_throw",
);

type Outcome = typeof outcome extends fc.Arbitrary<infer T> ? T : never;

function probeFor(kind: Outcome): CapabilityProbe {
  switch (kind) {
    case "ready":
    case "not_configured":
    case "unavailable":
      return async () => kind;
    case "unexpected":
      return (async () => SECRET) as unknown as CapabilityProbe;
    case "coded":
      return () => Promise.reject(Object.assign(new Error(SECRET), { code: "ETIMEDOUT" }));
    case "uncoded":
      return () => Promise.reject(new Error(SECRET));
    case "non_error":
      return () => Promise.reject({ message: SECRET });
    case "sync_throw":
      return (() => {
        throw new Error(SECRET);
      }) as unknown as CapabilityProbe;
  }
}

describe("checkCapabilities over all outcome combinations", () => {
  it("is ready exactly when the database is ready and nothing is unavailable", async () => {
    await fc.assert(
      fc.asyncProperty(fc.tuple(outcome, outcome, outcome, outcome), async (kinds) => {
        const probes = Object.fromEntries(CAPABILITIES.map((name, i) => [name, probeFor(kinds[i])])) as Record<
          Capability,
          CapabilityProbe
        >;
        const result = await checkCapabilities(probes);
        const states = Object.values(result.capabilities);
        expect(result.ready).toBe(result.capabilities.database === "ready" && !states.includes("unavailable"));
        for (const [i, name] of CAPABILITIES.entries()) {
          const expected = kinds[i] === "ready" || kinds[i] === "not_configured" ? kinds[i] : "unavailable";
          expect(result.capabilities[name]).toBe(expected);
        }
        expect(result.faults.map((f) => f.capability)).toEqual(
          CAPABILITIES.filter((name) => result.capabilities[name] === "unavailable"),
        );
        expect(JSON.stringify(result)).not.toMatch(/postgres|pw|internal/);
      }),
    );
  });
});
