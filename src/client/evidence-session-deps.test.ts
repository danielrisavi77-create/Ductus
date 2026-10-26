import { describe, expect, it, vi } from "vitest";
import type { SyncMeta } from "@/domain/sync/journal-types";
import type { FetchLike } from "./evidence-ingest";
import {
  browserEvidenceSessionDeps, guardedFetch, SignedOutError, type BrowserEvidenceInput,
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
