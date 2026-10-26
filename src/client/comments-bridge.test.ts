import { describe, expect, it, vi } from "vitest";

import { announceCommentsLoaded, handleShowInText, onCommentsLoaded, showInText } from "./comments-bridge";

// #732 item 7: the teacher view follows the student's comment panel beside it.
// The ids are invented.
const DOC = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const OTHER = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const THREAD = "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f";

describe("comments loaded", () => {
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

describe("show in text", () => {
  it("leaves it to the panel's editor while no teacher view is shown", () => {
    expect(showInText(DOC, THREAD)).toBe(false);
  });

  it("hands the thread to the teacher view of the same document while it is shown", () => {
    const show = vi.fn();
    const stop = handleShowInText(DOC, show);
    expect(showInText(OTHER, THREAD)).toBe(false);
    expect(showInText(DOC, THREAD)).toBe(true);
    expect(show).toHaveBeenCalledWith(THREAD);
    stop();
    expect(showInText(DOC, THREAD)).toBe(false);
  });

  it("an older view's unregister leaves a newer view's handler in place", () => {
    const older = vi.fn();
    const newer = vi.fn();
    const stopOlder = handleShowInText(DOC, older);
    const stopNewer = handleShowInText(DOC, newer);
    stopOlder();
    expect(showInText(DOC, THREAD)).toBe(true);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
    stopNewer();
  });
});
