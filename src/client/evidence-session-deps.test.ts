import { describe, expect, it, vi } from "vitest";
import type { SyncMeta } from "@/domain/sync/journal-types";
import type { FetchLike } from "./evidence-ingest";
import {
  browserEvidenceSessionDeps, guardedFetch, SignedOutError, watchClosedBySubmission, type BrowserEvidenceInput,
} from "./evidence-session-deps";

const source = { navigator: { onLine: false }, addEventListener: () => {}, removeEventListener: () => {} };

function deps() {
  return browserEvidenceSessionDeps({
    journal: {} as BrowserEvidenceInput["journal"],
    documentId: "doc-1",
    assignmentId: "assignment-1",
    current: () => true,
    fetchImpl: async () => new Response(null, { status: 503 }),
    source: source as unknown as BrowserEvidenceInput["source"],
  });
}

describe("browserEvidenceSessionDeps: requests only under the tab's sign-in (F-154)", () => {
  function counted(signedIn: { value: boolean }) {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ status: "not_found" }), { status: 404 }));
    const built = browserEvidenceSessionDeps({
      journal: {} as BrowserEvidenceInput["journal"],
      documentId: "doc-1",
      assignmentId: "assignment-1",
      current: () => signedIn.value,
      fetchImpl,
      source: source as unknown as BrowserEvidenceInput["source"],
    });
    return { built, fetchImpl };
  }

  it("asks current() before every open and sends nothing once the sign-in ended", async () => {
    const signedIn = { value: true };
    const { built, fetchImpl } = counted(signedIn);
    await built.open();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    signedIn.value = false;
    expect((await built.open()).status).toBe("unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    signedIn.value = true;
    await built.open();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("the guard rejects with SignedOutError and never calls the fetch", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await expect(guardedFetch(fetchImpl, () => false)("/api/evidence/commit", {})).rejects.toBeInstanceOf(SignedOutError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

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

// #913 on #914: the open that confirms a submission (F-155) is built on the
// same guarded fetch as every other evidence request (F-154), as in
// browserEvidenceSessionDeps. A sign-in that ends between the commit and that
// open sends nothing more and closes nothing.
describe("F-155 confirmation under the F-154 guard", () => {
  it("sends no confirming open once the tab's sign-in has ended, and closes nothing", async () => {
    const signedIn = { value: true };
    const paths: string[] = [];
    const raw = vi.fn<FetchLike>(async (input) => {
      paths.push(String(input));
      if (input === "/api/evidence/commit") {
        signedIn.value = false;
        return new Response(JSON.stringify({ status: "not_accepting" }), { status: 409 });
      }
      return new Response(JSON.stringify({ status: "opened" }), { status: 200 });
    });
    const guarded = guardedFetch(raw, () => signedIn.value);
    const closed = watchClosedBySubmission(guarded, async () => (await guarded("/api/evidence/open", { method: "POST" })).ok);
    let fired = 0;
    closed.watch(() => { fired += 1; });
    const response = await closed.fetchImpl("/api/evidence/commit", { method: "POST" });
    expect(response.status).toBe(409);
    expect(paths).toEqual(["/api/evidence/commit"]);
    expect(fired).toBe(0);
  });

  it("the browser deps' open is the guarded one", async () => {
    const raw = vi.fn<FetchLike>();
    const built = browserEvidenceSessionDeps({
      journal: {} as BrowserEvidenceInput["journal"],
      documentId: "doc-1",
      assignmentId: "assignment-1",
      current: () => false,
      fetchImpl: raw,
      source: source as unknown as BrowserEvidenceInput["source"],
    });
    expect((await built.open()).status).toBe("unavailable");
    expect(raw).not.toHaveBeenCalled();
  });
});
