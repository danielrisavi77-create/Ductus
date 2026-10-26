import { describe, expect, it, vi } from "vitest";

import { announceCommentsLoaded, onCommentsLoaded } from "./comments-loaded";

// #732 item 7: the marks of the teacher view follow the student's comment panel.
// The ids are invented.
const DOC = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const OTHER = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";

describe("comments-loaded", () => {
  it("calls the listener of the announced document only", () => {
    const mine = vi.fn();
    const other = vi.fn();
    const stopMine = onCommentsLoaded(DOC, mine);
    const stopOther = onCommentsLoaded(OTHER, other);
    announceCommentsLoaded(DOC);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    stopMine();
    stopOther();
  });

  it("stops calling after the unsubscribe", () => {
    const listener = vi.fn();
    const stop = onCommentsLoaded(DOC, listener);
    stop();
    announceCommentsLoaded(DOC);
    expect(listener).not.toHaveBeenCalled();
  });
});
