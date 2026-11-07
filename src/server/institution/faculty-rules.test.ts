import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { WORK_TYPES, facultyRulesOf, readFacultyRules } from "./faculty-rules";

// Invented versions only; no institution, person or rule text from any faculty.
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-pravila-3c9e";
const AT = new Date("2026-11-02T09:30:00.000Z");

type Row = Record<string, unknown>;

function version(extra: Row = {}): Row {
  return {
    work_type: "seminar_paper",
    version_no: 1,
    ai_policy: "partially_allowed",
    ai_purposes: ["proofreading", "translation"],
    evidence_profile: "basic",
    import_allowed: false,
    origin: "operator",
    published_at: AT,
    ...extra,
  };
}

const EMPTY: Row = { work_type: null, version_no: null, ai_policy: null, ai_purposes: null, evidence_profile: null,
  import_allowed: null, origin: null, published_at: null };

// The single statement: the role column on every row, versions only when it is true,
// one row without a version otherwise. `raw` replaces the answer as given.
function database(answer: { admin?: unknown; rows?: Row[]; raw?: Row[]; code?: string }) {
  const calls: string[] = [];
  const admin = "admin" in answer ? answer.admin : true;
  const withActor = vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string) {
        calls.push(text);
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        const versions = admin === true ? answer.rows ?? [] : [];
        const rows = answer.raw
          ?? (versions.length > 0 ? versions.map((row) => ({ admin, ...row })) : [{ admin, ...EMPTY }]);
        return { rows, rowCount: rows.length };
      },
    } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("facultyRulesOf: input classes (contract on #1091, c.6695058963)", () => {
  // Every class of a malformed row makes the whole read null, never a partial list.
  const malformed: [string, Row[]][] = [
    ["work_type outside the list", [version({ work_type: "thesis" })]],
    ["work_type empty", [version({ work_type: "" })]],
    ["work_type not a string", [version({ work_type: 3 })]],
    ["ai_policy outside the list", [version({ ai_policy: "allowed" })]],
    ["ai_policy null", [version({ ai_policy: null })]],
    ["ai_purposes not an array", [version({ ai_purposes: "{proofreading}" })]],
    ["ai_purposes unknown purpose", [version({ ai_purposes: ["drafting"] })]],
    ["ai_purposes duplicate", [version({ ai_purposes: ["proofreading", "proofreading"] })]],
    ["ai_purposes more than five", [version({ ai_purposes: ["formatting", "proofreading", "literature_search", "transcription", "translation", "formatting"] })]],
    ["ai_purposes non-string entry", [version({ ai_purposes: [1] })]],
    ["ai_purposes with prohibited", [version({ ai_policy: "prohibited", ai_purposes: ["formatting"] })]],
    ["evidence_profile outside the list", [version({ evidence_profile: "full" })]],
    ["import_allowed not a boolean", [version({ import_allowed: "false" })]],
    ["origin outside the list", [version({ origin: "lekta" })]],
    ["version_no zero", [version({ version_no: 0 })]],
    ["version_no negative", [version({ version_no: -1 })]],
    ["version_no fractional", [version({ version_no: 1.5 })]],
    ["version_no as string", [version({ version_no: "1" })]],
    ["version_no unsafe", [version({ version_no: Number.MAX_SAFE_INTEGER + 1 })]],
    ["chain not starting at 1", [version({ version_no: 2 })]],
    ["chain with a gap", [version(), version({ version_no: 3 })]],
    ["chain with a duplicate", [version(), version()]],
    ["chain out of order", [version({ version_no: 2 }), version()]],
    ["published_at a string", [version({ published_at: "2026-11-02T09:30:00Z" })]],
    ["published_at invalid date", [version({ published_at: new Date("x") })]],
    ["published_at null", [version({ published_at: null })]],
  ];

  it.each(malformed)("refuses %s", (_name, rows) => {
    expect(facultyRulesOf(rows)).toBeNull();
  });

  it("refuses one malformed row among valid ones", () => {
    expect(facultyRulesOf([version(), version({ work_type: "essay", ai_policy: "maybe" })])).toBeNull();
  });

  it("gives every work type, in a fixed order, with no versions for an institution without any", () => {
    const rules = facultyRulesOf([]);
    expect(rules?.map((rule) => rule.workType)).toEqual([...WORK_TYPES]);
    expect(rules?.every((rule) => rule.versions.length === 0)).toBe(true);
  });

  it("keeps the chain per work type in version order", () => {
    const rules = facultyRulesOf([
      version({ work_type: "essay", ai_policy: "prohibited", ai_purposes: [] }),
      version(),
      version({ version_no: 2, ai_policy: "encouraged", ai_purposes: [], evidence_profile: "extended",
        import_allowed: true, origin: "administrator" }),
    ]);
    const seminar = rules?.find((rule) => rule.workType === "seminar_paper");
    expect(seminar?.versions).toEqual([
      { versionNo: 1, aiPolicy: "partially_allowed", aiPurposes: ["proofreading", "translation"],
        evidenceProfile: "basic", importAllowed: false, origin: "operator", publishedAt: AT.toISOString() },
      { versionNo: 2, aiPolicy: "encouraged", aiPurposes: [], evidenceProfile: "extended",
        importAllowed: true, origin: "administrator", publishedAt: AT.toISOString() },
    ]);
    expect(rules?.find((rule) => rule.workType === "essay")?.versions).toHaveLength(1);
    expect(rules?.find((rule) => rule.workType === "master_thesis")?.versions).toEqual([]);
  });

  it("accepts all five purposes once each", () => {
    const all = ["formatting", "proofreading", "literature_search", "transcription", "translation"];
    expect(facultyRulesOf([version({ ai_purposes: all })])?.[2]?.versions[0]?.aiPurposes).toEqual(all);
  });
});

describe("readFacultyRules", () => {
  it.each([undefined, "", "kratko", `${"T".repeat(42)}!`])("refuses token %j without a query", async (token) => {
    const db = database({ rows: [version()] });
    expect(await readFacultyRules(token, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it("checks the role and reads the versions in one statement, in one transaction and with no parameter", async () => {
    const db = database({ rows: [version()] });
    const read = await readFacultyRules(TOKEN, db.withActor);
    expect(read.kind).toBe("ok");
    expect(db.withActor).toHaveBeenCalledTimes(1);
    expect(db.withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    // One statement is one snapshot: a role revoked mid-read cannot pass the check and then see no rows.
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatch(/FROM \(SELECT institution\.actor_has_role\('admin'\) AS admin\) r/);
    expect(db.calls[0]).toMatch(/LEFT JOIN institution\.faculty_rule_version v ON r\.admin IS TRUE/);
    expect(db.calls[0]).toMatch(/ORDER BY v\.work_type, v\.version_no\s*$/);
    expect(db.calls[0]).not.toMatch(/\$1|institution_id/);
  });

  it("gives every work type without versions to an administrator of an institution without any", async () => {
    const read = await readFacultyRules(TOKEN, database({ rows: [] }).withActor);
    expect(read).toEqual({ kind: "ok", rules: facultyRulesOf([]) });
  });

  it("answers notFound to anyone who is not an administrator, never an empty list", async () => {
    // QA on #1649 (c.6696173192): the role revoked as the versions are read is notFound, not ok with no rows.
    const db = database({ admin: false, rows: [version()] });
    expect(await readFacultyRules(TOKEN, db.withActor)).toEqual({ kind: "notFound" });
    expect(db.calls).toHaveLength(1);
  });

  it.each([
    ["no row", { raw: [] }],
    ["false with versions", { raw: [{ admin: false, ...version() }, { admin: false, ...EMPTY }] }],
    ["true then false", { raw: [{ admin: true, ...version() }, { admin: false, ...version({ version_no: 2 }) }] }],
    ["false then true", { raw: [{ admin: false, ...EMPTY }, { admin: true, ...version() }] }],
    ["two rows without a version", { raw: [{ admin: true, ...EMPTY }, { admin: true, ...EMPTY }] }],
    ["a null", { admin: null }],
    ["a string", { admin: "t" }],
  ])("is unavailable when the role column holds %s", async (_name, answer) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readFacultyRules(TOKEN, database(answer).withActor)).toEqual({ kind: "unavailable" });
  });

  it("maps ZD401 to unauthorized and ZD403 to notFound", async () => {
    expect(await readFacultyRules(TOKEN, database({ code: "ZD401" }).withActor)).toEqual({ kind: "unauthorized" });
    expect(await readFacultyRules(TOKEN, database({ code: "ZD403" }).withActor)).toEqual({ kind: "notFound" });
  });

  it("turns any other failure or a malformed row into unavailable and logs only a code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readFacultyRules(TOKEN, database({ code: "57014" }).withActor)).toEqual({ kind: "unavailable" });
    const thrower = vi.fn(async () => { throw new Error(`do not leak ${CANARY}`); }) as unknown as WithActor;
    expect(await readFacultyRules(TOKEN, thrower)).toEqual({ kind: "unavailable" });
    expect(await readFacultyRules(TOKEN, database({ rows: [version({ origin: CANARY })] }).withActor))
      .toEqual({ kind: "unavailable" });
    expect(log.mock.calls).toEqual([
      ["faculty rules read failed", "57014"],
      ["faculty rules read failed", "unknown"],
      ["faculty rules read failed", "row_malformed"],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
  });
});
