import { fc, test as prop } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { COMPONENT_STATES, STALE_AFTER_MS, isStale, isStaleAt, parsePublicStatus } from "./public-status";

const AT = "2027-03-06T13:10:00.000Z";
const valid = { checkedAt: AT, components: { writing: "radi", submission: "ne_radi", mentorView: "nije_ukljuceno" } };
const withComponents = (components: unknown) => ({ checkedAt: AT, components });
const withAt = (checkedAt: unknown) => ({ checkedAt, components: valid.components });

// DAN-429: every class of input the page can receive is either a checked
// value or null; nothing throws and nothing unchecked passes through.
describe("parsePublicStatus", () => {
  it.each<[string, unknown]>([
    // (2) not an object
    ["null", null],
    ["undefined", undefined],
    ["array", [valid]],
    ["number", 1],
    ["string", JSON.stringify(valid)],
    // (3) missing field
    ["no checkedAt", { components: valid.components }],
    ["no components", { checkedAt: AT }],
    ["no writing", withComponents({ submission: "radi", mentorView: "radi" })],
    ["no mentorView", withComponents({ writing: "radi", submission: "radi" })],
    ["components null", withComponents(null)],
    ["components array", withComponents(["radi", "radi", "radi"])],
    // (4) extra field, prototype keys as JSON.parse makes them
    ["extra top field", { ...valid, host: "db.internal" }],
    ["extra component", withComponents({ ...valid.components, aai: "radi" })],
    ["own __proto__ on top", JSON.parse(`{"checkedAt":"${AT}","components":${JSON.stringify(valid.components)},"__proto__":{}}`)],
    ["own __proto__ in components", withComponents(JSON.parse('{"writing":"radi","submission":"radi","mentorView":"radi","__proto__":"radi"}'))],
    ["own constructor in components", withComponents({ ...valid.components, constructor: "radi" })],
    // (5) wrong type
    ["checkedAt number", withAt(Date.parse(AT))],
    ["state number", withComponents({ ...valid.components, writing: 1 })],
    ["state null", withComponents({ ...valid.components, writing: null })],
    // (6) unknown state word
    ["readiness word ok", withComponents({ ...valid.components, writing: "ok" })],
    ["readiness word nedostupno", withComponents({ ...valid.components, submission: "nedostupno" })],
    ["upper case", withComponents({ ...valid.components, mentorView: "RADI" })],
    ["padded", withComponents({ ...valid.components, mentorView: " radi" })],
    // (7) not a valid UTC instant
    ["empty checkedAt", withAt("")],
    ["no zone", withAt("2027-03-06T13:10:00.000")],
    ["offset zone", withAt("2027-03-06T14:10:00.000+01:00")],
    ["impossible date", withAt("2027-02-30T13:10:00.000Z")],
    ["impossible hour", withAt("2027-03-06T25:10:00.000Z")],
    ["text", withAt("Invalid Date")],
    ["too long", withAt(`${AT}${" ".repeat(40)}`)],
  ])("refuses %s", (_name, input) => {
    expect(parsePublicStatus(input)).toBeNull();
  });

  it("accepts every combination of known states and copies only checked fields", () => {
    for (const writing of COMPONENT_STATES)
      for (const submission of COMPONENT_STATES)
        for (const mentorView of COMPONENT_STATES) {
          const input = { checkedAt: AT, components: { writing, submission, mentorView } };
          const out = parsePublicStatus(JSON.parse(JSON.stringify(input)));
          expect(out).toEqual(input);
          expect(out?.components).not.toBe(input.components);
        }
  });

  it("accepts an instant without milliseconds", () => {
    expect(parsePublicStatus(withAt("2027-03-06T13:10:00Z"))?.checkedAt).toBe("2027-03-06T13:10:00Z");
  });

  prop.prop([fc.anything()])("never throws and returns null or a value of the closed shape", (input) => {
    const out = parsePublicStatus(input);
    if (out === null) return;
    expect(Object.keys(out).sort()).toEqual(["checkedAt", "components"]);
    expect(Object.keys(out.components).sort()).toEqual(["mentorView", "submission", "writing"]);
    for (const state of Object.values(out.components)) expect(COMPONENT_STATES).toContain(state);
  });

  prop.prop([fc.jsonValue()])("never throws on any JSON the server might send", (input) => {
    expect(() => parsePublicStatus(input)).not.toThrow();
  });

  prop.prop([fc.string()])("refuses any state word outside the closed list", (word) => {
    fc.pre(!(COMPONENT_STATES as readonly string[]).includes(word));
    expect(parsePublicStatus(withComponents({ ...valid.components, submission: word }))).toBeNull();
  });
});

describe("isStale", () => {
  it.each<[string, number | null, number, boolean]>([
    ["never received", null, 1_000, true],
    ["fresh", 1_000, 1_000 + 5_000, false],
    ["exactly at the limit", 1_000, 1_000 + STALE_AFTER_MS, false],
    ["past the limit", 1_000, 1_000 + STALE_AFTER_MS + 1, true],
    ["clock went back", 10_000, 9_999, true],
    ["not a number", Number.NaN, 1_000, true],
  ])("%s", (_name, last, now, stale) => {
    expect(isStale(last, now)).toBe(stale);
  });

  prop.prop([fc.double({ noNaN: true }), fc.double({ noNaN: true })])("is stale exactly outside [last, last + limit]", (last, now) => {
    fc.pre(Number.isFinite(last) && Number.isFinite(now));
    const age = now - last;
    expect(isStale(last, now)).toBe(!(age >= 0 && age <= STALE_AFTER_MS));
  });
});

describe("isStaleAt", () => {
  const at = (mono: number, wall: number) => ({ mono, wall });
  const T = Date.parse("2027-03-06T13:10:00.000Z");
  it.each<[string, ReturnType<typeof at> | null, ReturnType<typeof at>, boolean]>([
    ["never received", null, at(1_000, T), true],
    ["fresh on both clocks", at(1_000, T), at(6_000, T + 5_000), false],
    // The device slept 8 h: the monotonic clock stood still, the wall clock did not.
    ["slept with the page open", at(1_000, T), at(6_000, T + 8 * 3_600_000), true],
    ["wall clock set back", at(1_000, T), at(6_000, T - 60_000), true],
    ["monotonic past the limit", at(1_000, T), at(1_000 + STALE_AFTER_MS + 1, T + 5_000), true],
  ])("%s", (_name, last, now, stale) => {
    expect(isStaleAt(last, now)).toBe(stale);
  });
});
