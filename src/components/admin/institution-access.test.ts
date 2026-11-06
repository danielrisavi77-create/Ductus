import { describe, expect, it } from "vitest";

import type { SessionPrincipal } from "@/server/auth/principal";
import type { InstitutionOverviewRead } from "@/server/institution/institution-overview";
import type { TeacherRolesRead } from "@/server/institution/teacher-roles";

import { institutionScreen, type InstitutionScreen } from "./institution-access";

const TOKEN = "T".repeat(43);

type Read = InstitutionOverviewRead["kind"] | null;
type Principal = SessionPrincipal["kind"];

// "closed" is Z-03 with a cookie of the session's shape, the sign-in card without.
const CLOSED = "closed" as const;

// DAN-313 (A-01, #1316 c.6584772547): every read beside every principal. The
// two are read in parallel, so a closed principal beside any read but a
// failed one means the session closed between them; it wins over a refusal.
const TABLE: ReadonlyArray<readonly [Read, Principal, InstitutionScreen | typeof CLOSED]> = [
  ["ok", "signed-in", "allowed"],
  ["ok", "signed-out", CLOSED],
  ["ok", "unverified", "unavailable"],
  ["notFound", "signed-in", "notFound"],
  ["notFound", "signed-out", CLOSED],
  ["notFound", "unverified", "unavailable"],
  ["unavailable", "signed-in", "unavailable"],
  ["unavailable", "signed-out", "unavailable"],
  ["unavailable", "unverified", "unavailable"],
  ["unauthorized", "signed-in", CLOSED],
  ["unauthorized", "signed-out", CLOSED],
  ["unauthorized", "unverified", CLOSED],
  [null, "signed-in", CLOSED],
  [null, "signed-out", CLOSED],
  [null, "unverified", CLOSED],
];

describe("institutionScreen", () => {
  it.each(TABLE)("read %s beside principal %s gives %s", (read, principal, want) => {
    if (want === CLOSED) {
      expect(institutionScreen(read, principal, TOKEN)).toBe("expired");
      expect(institutionScreen(read, principal, "kratko")).toBe("signedOut");
      expect(institutionScreen(read, principal, undefined)).toBe("signedOut");
    } else {
      for (const token of [TOKEN, "kratko", undefined]) {
        expect(institutionScreen(read, principal, token)).toBe(want);
      }
    }
  });

  it("covers every read and principal", () => {
    const reads: Read[] = ["ok", "notFound", "unavailable", "unauthorized", null];
    const principals: Principal[] = ["signed-in", "signed-out", "unverified"];
    const keys = new Set(TABLE.map(([r, p]) => `${r}/${p}`));
    expect(keys.size).toBe(TABLE.length);
    for (const r of reads) for (const p of principals) expect(keys.has(`${r}/${p}`)).toBe(true);
  });

  it("never answers a session that closed between the reads with a 404", () => {
    expect(institutionScreen("notFound", "signed-out", TOKEN)).toBe("expired");
  });

  it("shows the counts only to a signed-in administrator", () => {
    expect(institutionScreen("ok", "signed-in", TOKEN)).toBe("allowed");
  });
});

// DAN-581 PR 3 (A-02, contract #1091 c.6677177709): /ustanova/korisnici takes
// its screen from the teacher roles read, whose answers are the same four.
describe("institutionScreen for the teacher roles read", () => {
  type RolesRead = TeacherRolesRead["kind"] | null;
  const kinds: Record<TeacherRolesRead["kind"], true> = { ok: true, unauthorized: true, notFound: true, unavailable: true };

  it("has a row in the table above for every answer of the teacher roles read", () => {
    const reads = new Set<RolesRead>(TABLE.map(([read]) => read));
    for (const kind of Object.keys(kinds) as TeacherRolesRead["kind"][]) expect(reads.has(kind)).toBe(true);
  });

  it("shows no list when the session closed after the lists were read", () => {
    expect(institutionScreen("ok", "signed-out", TOKEN)).toBe("expired");
    expect(institutionScreen("ok", "signed-out", undefined)).toBe("signedOut");
  });
});
