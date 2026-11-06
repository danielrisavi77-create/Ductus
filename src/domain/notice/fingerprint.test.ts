import { readFileSync } from "node:fs";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";

import {
  NOTICE_FINGERPRINT_FIELDS,
  NOTICE_FINGERPRINT_FORMAT_V1,
  NOTICE_TEMPLATE_VERSION,
  noticeFingerprint,
  noticeFingerprintPayload,
  prefixedSha256,
  type NoticeFingerprintInput,
} from "./fingerprint";

// DAN-306 (M2.13-P02a), attack plan #1502: A2 to A14. Invented assignment
// content only. The same two vectors are asserted in SQL by
// db/tests/105-notice-fingerprint.sql, so the server and this function agree.
const BASE: NoticeFingerprintInput = {
  templateVersion: 1,
  title: "Osvrt na zadani ulomak",
  instructions: "Napišite osvrt na zadani ulomak.",
  workType: "essay",
  opensAt: "2026-11-10T08:00:00.000Z",
  dueAt: "2026-11-24T22:59:00.000Z",
  aiPolicy: "partially_allowed",
  aiPurposes: ["proofreading", "formatting", "proofreading"],
  evidenceProfile: "basic",
  wordMin: 800,
  wordMax: 1200,
};
// Also the output of printf 'ductus-notice-fingerprint-v1\n%s' '<canonical>' | sha256sum.
const GOLDEN_BASE = "46887c60a041c0c4d9b03a87bc255037fd18a8d15eaf276aefd7c3e4877baf2d";
const BASE_CANONICAL =
  '{"aiPolicy":"partially_allowed","aiPurposes":["formatting","proofreading"],"dueAt":"2026-11-24T22:59:00.000Z",' +
  '"evidenceProfile":"basic","instructions":"Napišite osvrt na zadani ulomak.","opensAt":"2026-11-10T08:00:00.000Z",' +
  '"templateVersion":1,"title":"Osvrt na zadani ulomak","wordMax":1200,"wordMin":800,"workType":"essay"}';

// Escapes, an astral character, CRLF, no word range, a prohibited policy that
// still lists a purpose (dropped), the extended profile, a later template.
const EDGE: NoticeFingerprintInput = {
  templateVersion: 2,
  title: "Kratki rad",
  instructions: 'Redak 1\r\nRedak\t2 "citat" \\ ž 😀',
  workType: "master_thesis",
  opensAt: "2027-01-01T00:00:00.000Z",
  dueAt: "2027-01-31T23:59:59.999Z",
  aiPolicy: "prohibited",
  aiPurposes: ["translation"],
  evidenceProfile: "extended",
  wordMin: null,
  wordMax: null,
};
const GOLDEN_EDGE = "ed1f97681a3e115bced99beb26d683f5ed57b59bb3c420602671894db0582c1d";

// DAN-306, review c.6632344287: the lower edge of the supported years, the
// UTC instant of 1000-01-01T00:00:00-01:00. SQL writes the same year from
// the same timestamptz (db/tests/105-notice-fingerprint.sql, section 12).
const RANGE_EDGE = { ...BASE, opensAt: "1000-01-01T01:00:00.000Z" };
const GOLDEN_RANGE_EDGE = "e29ba1fd26110106c3b259ad8116a1a61ea1a1ef2703638a2e332b39fd5cc42c";

const fingerprint = (change: Partial<NoticeFingerprintInput>) => noticeFingerprint({ ...BASE, ...change });

describe("notice fingerprint (DAN-306)", () => {
  it("A2: matches the golden vectors, and the SQL test holds the same ones", async () => {
    expect(canonicalizeJcs(noticeFingerprintPayload(BASE))).toBe(BASE_CANONICAL);
    expect(await noticeFingerprint(BASE)).toBe(GOLDEN_BASE);
    expect(await noticeFingerprint(EDGE)).toBe(GOLDEN_EDGE);
    const sql = readFileSync("db/tests/105-notice-fingerprint.sql", "utf8");
    expect(sql).toContain(GOLDEN_BASE);
    expect(sql).toContain(GOLDEN_EDGE);
  });

  it("A2: the lower edge of the supported years has the same fingerprint as in SQL", async () => {
    expect(await noticeFingerprint(RANGE_EDGE)).toBe(GOLDEN_RANGE_EDGE);
    const sql = readFileSync("db/tests/105-notice-fingerprint.sql", "utf8");
    expect(sql).toContain(GOLDEN_RANGE_EDGE);
  });

  it("refuses an instant whose year is outside 1000 to 9999, where SQL and JavaScript write years apart", async () => {
    // 0001-01-01T00:00:00+14:00 and +01:00 in UTC: JavaScript writes year
    // 0000, PostgreSQL's YYYY writes 0001 for 1 BC. Neither may be canonical.
    for (const opensAt of ["0000-12-31T10:00:00.000Z", "0000-12-31T23:00:00.000Z", "0999-12-31T23:59:59.999Z"]) {
      await expect(fingerprint({ opensAt })).rejects.toThrow("not an ISO UTC instant");
      await expect(fingerprint({ dueAt: opensAt })).rejects.toThrow("not an ISO UTC instant");
    }
    await expect(fingerprint({ opensAt: "1000-01-01T00:00:00.000Z" })).resolves.toMatch(/^[0-9a-f]{64}$/);
    await expect(fingerprint({ dueAt: "9999-12-31T23:59:59.999Z" })).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it("A3: the scheme prefix separates the notice from any other object over the same bytes", async () => {
    const canonical = canonicalizeJcs(noticeFingerprintPayload(BASE));
    const values = [
      await prefixedSha256(NOTICE_FINGERPRINT_FORMAT_V1, canonical),
      await prefixedSha256("", canonical),
      await prefixedSha256("ductus-segment-v3", canonical),
    ];
    expect(values[0]).toBe(GOLDEN_BASE);
    expect(new Set(values).size).toBe(3);
  });

  it("A4, A5: no normalisation: NFC and NFD, CRLF and LF differ", async () => {
    const nfc = "Upute: č";
    const nfd = "Upute: č";
    expect(nfc.normalize("NFC")).toBe(nfd.normalize("NFC"));
    expect(await fingerprint({ instructions: nfc })).not.toBe(await fingerprint({ instructions: nfd }));
    expect(await fingerprint({ instructions: "a\r\nb" })).not.toBe(await fingerprint({ instructions: "a\nb" }));
  });

  it("A7: a prohibited policy carries no purposes and differs from a policy that allows none", async () => {
    const prohibited = { aiPolicy: "prohibited", aiPurposes: [] as string[] };
    expect(noticeFingerprintPayload({ ...BASE, aiPolicy: "prohibited" }).aiPurposes).toEqual([]);
    expect(await fingerprint({ aiPolicy: "prohibited" })).toBe(await fingerprint(prohibited));
    expect(await fingerprint(prohibited)).not.toBe(await fingerprint({ aiPolicy: "encouraged", aiPurposes: [] }));
  });

  it("A8, A10: each shown element, changed alone, changes the fingerprint", async () => {
    const changes: Partial<NoticeFingerprintInput>[] = [
      { templateVersion: 2 },
      { title: "Osvrt na drugi ulomak" },
      { instructions: "Napišite osvrt na zadani ulomak!" },
      { workType: "seminar_paper" },
      { opensAt: "2026-11-10T08:00:00.001Z" },
      { dueAt: "2026-11-25T22:59:00.000Z" },
      { aiPolicy: "encouraged" },
      { aiPurposes: ["proofreading"] },
      { aiPurposes: ["formatting", "proofreading", "translation"] },
      { evidenceProfile: "extended" },
      { wordMin: 801 },
      { wordMax: 1201 },
    ];
    const values = await Promise.all(changes.map(fingerprint));
    expect(new Set([GOLDEN_BASE, ...values]).size).toBe(changes.length + 1);
  });

  it("A11: the fields are the notice view's shown fields, the policy and the template version", () => {
    const source = readFileSync("src/components/student/assignment-notice-read.ts", "utf8");
    const body = /export interface NoticeView \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
    const viewKeys = [...body.matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);
    expect(viewKeys.length).toBeGreaterThan(5);
    const shown = viewKeys.filter((key) => !["assignmentId", "versionNo", "acknowledgedAt"].includes(key));
    // DAN-306 P02b: the view now carries aiPolicy too, so the client can hash
    // what it shows; the set of fields stays exactly the same.
    expect([...NOTICE_FINGERPRINT_FIELDS]).toEqual([...new Set([...shown, "aiPolicy", "templateVersion"])].sort());
    expect(Object.keys(noticeFingerprintPayload(BASE))).toEqual([...NOTICE_FINGERPRINT_FIELDS]);
    expect(NOTICE_TEMPLATE_VERSION).toBe(1);
  });

  it("A11, A12: the privacy notice, the course name and the course AI rule do not enter the fingerprint", async () => {
    // Orchestrator answers 2 and 6 on #1502: only the S3 notice as shown.
    // Whatever else a caller passes along is not carried into the payload.
    const extra = {
      privacyNotice: "Izmišljena obavijest o privatnosti, druga inačica.",
      courseName: "Izmišljeni kolegij",
      courseAiPolicy: "prohibited",
    };
    const widened = { ...BASE, ...extra } as NoticeFingerprintInput;
    expect(Object.keys(noticeFingerprintPayload(widened))).toEqual([...NOTICE_FINGERPRINT_FIELDS]);
    expect(await noticeFingerprint(widened)).toBe(GOLDEN_BASE);
    const changed = { ...widened, privacyNotice: "Promijenjena izmišljena obavijest." } as NoticeFingerprintInput;
    expect(await noticeFingerprint(changed)).toBe(GOLDEN_BASE);
  });

  it("A14: boundary inputs are deterministic and null differs from empty or zero", async () => {
    const long = "u".repeat(20_000);
    expect(await fingerprint({ instructions: "" })).toBe(await fingerprint({ instructions: "" }));
    expect(await fingerprint({ instructions: long })).toBe(await fingerprint({ instructions: long }));
    expect(await fingerprint({ wordMin: 1000, wordMax: 1000 })).not.toBe(await fingerprint({ wordMin: 1000, wordMax: null }));
    expect(await fingerprint({ wordMax: null })).not.toBe(await fingerprint({ wordMax: 0 }));
    expect(await fingerprint({ title: "" })).not.toBe(await fingerprint({ instructions: "" }));
  });

  it("refuses a template version or an instant it cannot write canonically", async () => {
    for (const templateVersion of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      await expect(fingerprint({ templateVersion })).rejects.toThrow("invalid template version");
    }
    for (const opensAt of ["2026-11-10T08:00:00Z", "2026-11-10T09:00:00.000+01:00", "2026-11-10"]) {
      await expect(fingerprint({ opensAt })).rejects.toThrow("not an ISO UTC instant");
    }
  });

  it("order and repeats of purposes do not matter", async () => {
    const purposes = fc.subarray(["formatting", "proofreading", "literature_search", "transcription", "translation"]);
    await fc.assert(
      fc.asyncProperty(purposes, fc.array(fc.nat(10)), async (set, picks) => {
        const shuffled = [...set, ...picks.filter((i) => i < set.length).map((i) => set[i])].reverse();
        expect(await fingerprint({ aiPurposes: shuffled })).toBe(await fingerprint({ aiPurposes: set }));
      }),
      { numRuns: 50 },
    );
  });
});
