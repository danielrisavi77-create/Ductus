import { describe, expect, it } from "vitest";

import { endRun } from "./run-refs";

function fakePublisher() {
  const p = { stopped: 0, stop: () => { p.stopped += 1; } };
  return p;
}

describe("endRun (F-125 t. 2)", () => {
  it("finally clears only its own run's refs and stops only its own publisher", () => {
    const publisherRef: { current: ReturnType<typeof fakePublisher> | null } = { current: null };
    const logoutRef: { current: object | null } = { current: null };
    const refs = { publisher: publisherRef, logout: logoutRef };

    const first = { publisher: fakePublisher(), logout: {} };
    publisherRef.current = first.publisher;
    logoutRef.current = first.logout;
    // The next run installs its own values before the first run's finally.
    const next = { publisher: fakePublisher(), logout: {} };
    publisherRef.current = next.publisher;
    logoutRef.current = next.logout;

    endRun(refs, first);
    expect(first.publisher.stopped).toBe(1);
    expect(next.publisher.stopped).toBe(0);
    expect(publisherRef.current).toBe(next.publisher);
    expect(logoutRef.current).toBe(next.logout);

    endRun(refs, next);
    expect(next.publisher.stopped).toBe(1);
    expect(publisherRef.current).toBeNull();
    expect(logoutRef.current).toBeNull();
  });

  it("a run without a publisher leaves the next run's refs alone", () => {
    const next = { publisher: fakePublisher(), logout: {} };
    const refs = { publisher: { current: next.publisher }, logout: { current: next.logout as object } };
    endRun(refs, { publisher: null, logout: null });
    expect(refs.publisher.current).toBe(next.publisher);
    expect(refs.logout.current).toBe(next.logout);
    expect(next.publisher.stopped).toBe(0);
  });
});
