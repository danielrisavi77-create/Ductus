import { describe, expect, it } from "vitest";
import type { SyncMeta } from "@/domain/sync/journal-types";
import { browserEvidenceSessionDeps, watchClosedBySubmission, type BrowserEvidenceInput } from "./evidence-session-deps";

const source = { navigator: { onLine: false }, addEventListener: () => {}, removeEventListener: () => {} };

function deps() {
  return browserEvidenceSessionDeps({
    journal: {} as BrowserEvidenceInput["journal"],
    documentId: "doc-1",
    assignmentId: "assignment-1",
    fetchImpl: async () => new Response(null, { status: 503 }),
    source: source as unknown as BrowserEvidenceInput["source"],
  });
}

describe("browserEvidenceSessionDeps: stored profile (Codex #803)", () => {
  it("reads the profile the journal stores, so segments build while open is out of reach", () => {
    const meta = { evidenceProfileId: "profil-1" } as unknown as SyncMeta;
    expect(deps().storedProfile?.(meta)).toBe("profil-1");
  });

  it("gives no profile for a record without one, or no record", () => {
    expect(deps().storedProfile?.({} as unknown as SyncMeta)).toBeNull();
    expect(deps().storedProfile?.(null)).toBeNull();
  });
});

// F-155: a commit 409 not_accepting is a submission, a version not
// acknowledged or one not open yet; only the server's "submitted" closes.
describe("watchClosedBySubmission (F-155)", () => {
  const notAccepting = async () => new Response(JSON.stringify({ status: "not_accepting" }), { status: 409 });

  async function heard(path: string, isSubmitted: () => Promise<boolean>) {
    let asked = 0;
    let fired = 0;
    const closed = watchClosedBySubmission(notAccepting, async () => { asked += 1; return isSubmitted(); });
    closed.watch(() => { fired += 1; });
    const response = await closed.fetchImpl(path, { method: "POST" });
    return { asked, fired, status: response.status, body: await response.json() };
  }

  it("closes by submission only when the server says the work is submitted", async () => {
    expect(await heard("/api/evidence/commit", async () => true))
      .toEqual({ asked: 1, fired: 1, status: 409, body: { status: "not_accepting" } });
  });

  it("closes nothing when the server says not submitted or cannot be asked", async () => {
    expect((await heard("/api/evidence/commit", async () => false)).fired).toBe(0);
    expect((await heard("/api/evidence/commit", async () => { throw new Error("invented outage"); })).fired).toBe(0);
  });

  it("asks nothing for a not_accepting of another route", async () => {
    expect(await heard("/api/evidence/open", async () => true))
      .toEqual({ asked: 0, fired: 0, status: 409, body: { status: "not_accepting" } });
  });
});
