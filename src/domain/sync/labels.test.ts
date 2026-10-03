import { describe, expect, it } from "vitest";

import {
  MULTI_TAB_BLOCKED_MESSAGE,
  MULTI_TAB_BLOCKED_TONE,
  SYNC_STATE_LABELS,
  SYNC_TONES,
  chipContent,
  type SyncTone,
} from "./labels";
import { SYNC_STATES, type SyncState } from "./states";

/** Words that would turn an honest state into a generic "it's saved". */
const FORBIDDEN_BARE_LABELS = ["Spremljeno", "Saved", "Spremeno", "Sačuvano"];

describe("sync state labels", () => {
  it("covers exactly the eight states, with no extras", () => {
    expect(Object.keys(SYNC_STATE_LABELS).sort()).toEqual([...SYNC_STATES].sort());
  });

  it.each(SYNC_STATES)("gives %s a non-empty Croatian label", (state) => {
    const { label } = SYNC_STATE_LABELS[state];
    expect(typeof label).toBe("string");
    expect(label.trim()).not.toBe("");
    expect(label).toBe(label.trim());
  });

  it.each(SYNC_STATES)("gives %s a tone from the declared vocabulary", (state) => {
    expect(SYNC_TONES).toContain(SYNC_STATE_LABELS[state].tone);
  });

  it("never uses a bare generic 'saved' label for any state", () => {
    for (const state of SYNC_STATES) {
      expect(FORBIDDEN_BARE_LABELS).not.toContain(SYNC_STATE_LABELS[state].label);
    }
  });

  it("says 'lokalno' for LOCAL_DURABLE, so it cannot read as server sync", () => {
    const { label } = SYNC_STATE_LABELS.LOCAL_DURABLE;
    expect(label).toContain("lokalno");
    expect(label).not.toContain("Sinkron");
  });

  it("keeps LOCAL_DURABLE and SYNCED distinct in both label and tone", () => {
    const local = SYNC_STATE_LABELS.LOCAL_DURABLE;
    const synced = SYNC_STATE_LABELS.SYNCED;
    expect(local.label).not.toBe(synced.label);
    // Local durability must not borrow the all-clear tone the server earns.
    expect(local.tone).not.toBe(synced.tone);
  });

  it("gives every state a label distinct from every other state's", () => {
    const labels = SYNC_STATES.map((state) => SYNC_STATE_LABELS[state].label);
    expect(new Set(labels).size).toBe(SYNC_STATES.length);
  });

  it("uses the plan's wording for the two in-flight states", () => {
    expect(SYNC_STATE_LABELS.SAVING_LOCAL.label).toBe("Spremam lokalno");
    expect(SYNC_STATE_LABELS.SYNCING.label).toBe("Sinkroniziram");
  });

  it("animates only the in-flight states", () => {
    const progress = SYNC_STATES.filter(
      (state) => SYNC_STATE_LABELS[state].tone === "progress",
    );
    expect(progress).toEqual(["SAVING_LOCAL", "SYNCING"]);
  });

  it("reserves the 'ok' tone for the one state the server has confirmed", () => {
    const ok = SYNC_STATES.filter((state) => SYNC_STATE_LABELS[state].tone === "ok");
    expect(ok).toEqual(["SYNCED"]);
  });

  it("marks the two states that demand an explicit decision as trouble", () => {
    expect(SYNC_STATE_LABELS.CONFLICT.tone).toBe("warn");
    expect(SYNC_STATE_LABELS.RECOVERY_REQUIRED.tone).toBe("error");
  });
});

describe("chipContent", () => {
  it.each(SYNC_STATES)("renders %s as its own label and tone", (state) => {
    expect(chipContent(state)).toEqual({
      text: SYNC_STATE_LABELS[state].label,
      tone: SYNC_STATE_LABELS[state].tone,
    });
  });

  it("treats an omitted `blocked` as not blocked", () => {
    expect(chipContent("SYNCED")).toEqual(chipContent("SYNCED", false));
  });

  it.each(SYNC_STATES)("lets `blocked` win over %s", (state) => {
    expect(chipContent(state, true)).toEqual({
      text: MULTI_TAB_BLOCKED_MESSAGE,
      tone: MULTI_TAB_BLOCKED_TONE,
    });
  });

  it("never reports a state's own label while blocked", () => {
    const blockedTexts = new Set(
      SYNC_STATES.map((state: SyncState) => chipContent(state, true).text),
    );
    expect(blockedTexts).toEqual(new Set([MULTI_TAB_BLOCKED_MESSAGE]));
  });

  it("names the other tab in Croatian, as a full sentence", () => {
    expect(MULTI_TAB_BLOCKED_MESSAGE).toBe("Dokument je otvoren u drugoj kartici.");
  });

  it("uses a declared tone for the blocked notice", () => {
    const tone: SyncTone = MULTI_TAB_BLOCKED_TONE;
    expect(SYNC_TONES).toContain(tone);
  });

  it("is pure: repeated calls return equal content", () => {
    for (const state of SYNC_STATES) {
      expect(chipContent(state)).toEqual(chipContent(state));
      expect(chipContent(state, true)).toEqual(chipContent(state, true));
    }
  });
});
