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

  // Codex r4384309111: an open route that never answers must not hold the
  // commit's answer, or the drain and sign-out waiting on it would hang.
  it("lets the commit answer go on after the time limit when the open route does not answer", async () => {
    let fired = 0;
    const closed = watchClosedBySubmission(notAccepting, () => new Promise<boolean>(() => {}), 20);
    closed.watch(() => { fired += 1; });
    const response = await closed.fetchImpl("/api/evidence/commit", { method: "POST" });
    expect(response.status).toBe(409);
    expect(fired).toBe(0);
  });

  it("closes nothing for a late yes that comes after the time limit", async () => {
    let fired = 0;
    let answer: (yes: boolean) => void = () => {};
    const closed = watchClosedBySubmission(notAccepting, () => new Promise<boolean>((resolve) => { answer = resolve; }), 20);
    closed.watch(() => { fired += 1; });
    await closed.fetchImpl("/api/evidence/commit", { method: "POST" });
    answer(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(0);
  });

  it("asks nothing for a not_accepting of another route", async () => {
    expect(await heard("/api/evidence/open", async () => true))
      .toEqual({ asked: 0, fired: 0, status: 409, body: { status: "not_accepting" } });
  });
});
