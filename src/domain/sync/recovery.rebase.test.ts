// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emptyDocument } from "../document";
import { planRecovery, type PlanRecoveryInput } from "./recovery";

const LOCAL = emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001");
const SERVER = emptyDocument(() => "bbbbbbbb-0000-4000-8000-000000000001");

function scenario(overrides: Partial<PlanRecoveryInput> = {}): PlanRecoveryInput {
  return {
    journalReadable: true,
    pendingNewest: { document: LOCAL, revision: 1, at: "2026-10-09T10:00:00.000Z" },
    snapshot: null,
    serverDocument: SERVER,
    serverRevision: 5,
    ...overrides,
  };
}

describe("salvage-local CAS rebase and provenance (DAN-25)", () => {
  it("keeps the local source revision while explicitly providing the newer server CAS base", () => {
    const given = scenario();
    const frozen = structuredClone(given);
    const plan = planRecovery(given);
    expect(plan.recommended).toBe("salvage-local");
    expect(plan.salvage).toMatchObject({
      revision: 1,
      originalCandidateRevision: 1,
      nextBaseRevision: 5,
      source: "pending",
      document: LOCAL,
    });
    expect(plan.adopt).toMatchObject({
      revision: 5,
      originalCandidateRevision: null,
      nextBaseRevision: 5,
      source: null,
    });
    expect(given).toEqual(frozen);
  });

  it("refuses to generate any network CAS base when the server could not be validated", () => {
    for (const overrides of [
      { serverDocument: null, serverRevision: 5 },
      { serverDocument: { bad: true }, serverRevision: 5 },
      { serverDocument: SERVER, serverRevision: null },
      { serverDocument: SERVER, serverRevision: Number.NaN },
      { serverDocument: SERVER, serverRevision: -1 },
      { serverDocument: SERVER, serverRevision: Number.MAX_SAFE_INTEGER + 1 },
    ] as Partial<PlanRecoveryInput>[]) {
      const plan = planRecovery(scenario(overrides));
      expect(plan.salvage?.revision).toBe(1);
      expect(plan.salvage?.originalCandidateRevision).toBe(1);
      expect(plan.salvage?.nextBaseRevision).toBeNull();
      expect(plan.canAdoptServer).toBe(false);
    }
  });

  it("does not rebase a local future revision onto an older restored server snapshot", () => {
    const plan = planRecovery(scenario({
      pendingNewest: { document: LOCAL, revision: 7, at: null },
      serverRevision: 5,
    }));
    expect(plan.salvage?.originalCandidateRevision).toBe(7);
    expect(plan.salvage?.nextBaseRevision).toBeNull();
  });

  it.each([null, "2026-10-09T09:00:00.000Z"])(
    "prevents a hidden rollback when a higher-revision pending row loses timestamp ranking (%s)",
    (pendingAt) => {
      const plan = planRecovery(scenario({
        pendingNewest: { document: LOCAL, revision: 7, at: pendingAt },
        snapshot: { document: LOCAL, revision: 4, at: "2026-10-09T10:10:00.000Z" },
        serverRevision: 5,
      }));
      // The snapshot wins on time, but the validated pending row proves the
      // server has previously reached revision 7.
      expect(plan.salvage).toMatchObject({
        source: "snapshot",
        revision: 4,
        originalCandidateRevision: 4,
        nextBaseRevision: null,
      });
      expect(plan.adopt?.revision).toBe(5);
    },
  );

  it("does not use a corrupt high-revision local row as rollback evidence", () => {
    const plan = planRecovery(scenario({
      pendingNewest: { document: { invalid: true }, revision: 7, at: null },
      snapshot: { document: LOCAL, revision: 4, at: "2026-10-09T10:10:00.000Z" },
      serverRevision: 5,
    }));
    expect(plan.salvage).toMatchObject({ source: "snapshot", nextBaseRevision: 5 });
  });

  it("recovery at equal revisions requires no invented increment", () => {
    const plan = planRecovery(scenario({ serverRevision: 1 }));
    expect(plan.salvage?.nextBaseRevision).toBe(1);
  });

  it("preserves latest local snapshot provenance when it wins timestamp ranking", () => {
    const plan = planRecovery(scenario({
      snapshot: { document: LOCAL, revision: 2, at: "2026-10-09T10:01:00.000Z" },
    }));
    expect(plan.salvage).toMatchObject({
      source: "snapshot", revision: 2, originalCandidateRevision: 2, nextBaseRevision: 5,
    });
  });
});
