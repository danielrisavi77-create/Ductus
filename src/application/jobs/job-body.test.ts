import { describe, expect, it } from "vitest";

import { isJobDefinition, parseJobBody, type JobBodyProblem } from "./job-body";

// DAN-517, attack plan #1826 row W-11 (D-74: a job body is identifiers only).
// Every identifier here is invented.
const FIELDS = ["domainId", "packageId"] as const;
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

class Carrier {
  domainId = A;
  packageId = B;
}

function withGetter(): object {
  let reads = 0;
  const body = { packageId: B };
  Object.defineProperty(body, "domainId", {
    enumerable: true,
    get: () => {
      reads += 1;
      throw new Error(`getter ran ${reads} time(s)`);
    },
  });
  return body;
}

function hidden(): object {
  const body = { packageId: B };
  Object.defineProperty(body, "domainId", { enumerable: false, value: A });
  return body;
}

const throwingProxy = new Proxy(
  {},
  {
    getPrototypeOf() {
      throw new Error("synthetic trap");
    },
    ownKeys() {
      throw new Error("synthetic trap");
    },
  },
);

// One row per class of input the guard has to settle. `null` means accepted.
const CLASSES: ReadonlyArray<readonly [string, unknown, JobBodyProblem | null]> = [
  // Not an object at all.
  ["null", null, "not_object"],
  ["undefined", undefined, "not_object"],
  ["a string", JSON.stringify({ domainId: A, packageId: B }), "not_object"],
  ["a number", 7, "not_object"],
  ["a boolean", true, "not_object"],
  ["a bigint", BigInt(7), "not_object"],
  ["a symbol", Symbol("body"), "not_object"],
  ["a function", () => ({ domainId: A, packageId: B }), "not_object"],
  // An object that is not a plain record.
  ["an array", [A, B], "not_plain"],
  ["an array with the fields set on it", Object.assign([], { domainId: A, packageId: B }), "not_plain"],
  ["a Date", new Date(0), "not_plain"],
  ["a Map", new Map([["domainId", A], ["packageId", B]]), "not_plain"],
  ["a class instance", new Carrier(), "not_plain"],
  ["an object whose prototype carries the fields", Object.create({ domainId: A, packageId: B }), "not_plain"],
  ["a proxy whose traps throw", throwingProxy, "not_plain"],
  // Keys.
  ["a symbol key", { domainId: A, packageId: B, [Symbol("extra")]: A }, "symbol_key"],
  ["a getter", withGetter(), "accessor"],
  ["a field that is not enumerable", hidden(), "accessor"],
  ["an unknown field", { domainId: A, packageId: B, note: A }, "unknown_field"],
  ["__proto__ as an own key", JSON.parse(`{"domainId":"${A}","packageId":"${B}","__proto__":"${A}"}`), "unknown_field"],
  ["a field in another case", { domainid: A, packageId: B }, "unknown_field"],
  ["a missing field", { domainId: A }, "missing_field"],
  ["an empty object", {}, "missing_field"],
  // Values that are not a string.
  ["a number value", { domainId: 7, packageId: B }, "not_uuid"],
  ["an object value", { domainId: { id: A }, packageId: B }, "not_uuid"],
  ["an array value", { domainId: [A], packageId: B }, "not_uuid"],
  ["a null value", { domainId: null, packageId: B }, "not_uuid"],
  ["an undefined value", { domainId: undefined, packageId: B }, "not_uuid"],
  ["a String object", { domainId: new String(A), packageId: B }, "not_uuid"],
  // Strings that are not the one spelling of a UUID.
  ["an empty string", { domainId: "", packageId: B }, "not_uuid"],
  ["upper case", { domainId: A.toUpperCase(), packageId: B }, "not_uuid"],
  ["a leading space", { domainId: ` ${A}`, packageId: B }, "not_uuid"],
  ["a trailing newline", { domainId: `${A}\n`, packageId: B }, "not_uuid"],
  ["braces", { domainId: `{${A}}`, packageId: B }, "not_uuid"],
  ["the urn prefix", { domainId: `urn:uuid:${A}`, packageId: B }, "not_uuid"],
  ["no hyphens", { domainId: A.replaceAll("-", ""), packageId: B }, "not_uuid"],
  ["one character short", { domainId: A.slice(0, -1), packageId: B }, "not_uuid"],
  ["one character long", { domainId: `${A}0`, packageId: B }, "not_uuid"],
  ["a letter outside hex", { domainId: A.replace("a1", "g1"), packageId: B }, "not_uuid"],
  ["free text", { domainId: "synthetic note, not an identifier", packageId: B }, "not_uuid"],
  // Controls: the guard must not refuse a valid body.
  ["a valid body", { domainId: A, packageId: B }, null],
  ["a valid body in another key order", { packageId: B, domainId: A }, null],
  ["a valid body without a prototype", Object.assign(Object.create(null), { domainId: A, packageId: B }), null],
  ["a valid body as the queue returns it", JSON.parse(JSON.stringify({ domainId: A, packageId: B })), null],
];

describe("parseJobBody", () => {
  it.each(CLASSES)("%s", (_label, input, problem) => {
    const result = parseJobBody(input, FIELDS);
    if (problem === null) {
      expect(result).toEqual({ ok: true, body: { domainId: A, packageId: B } });
    } else {
      expect(result).toEqual({ ok: false, problem });
    }
  });

  it("returns a new frozen record with exactly the listed fields, in their listed order", () => {
    const input = { packageId: B, domainId: A };
    const result = parseJobBody(input, FIELDS);
    if (!result.ok) throw new Error("expected a valid body");
    expect(result.body).not.toBe(input);
    expect(Object.keys(result.body)).toEqual([...FIELDS]);
    expect(Object.isFrozen(result.body)).toBe(true);
    expect(JSON.stringify(result.body)).toBe(`{"domainId":"${A}","packageId":"${B}"}`);
  });

  it("names the problem only: no result carries a value of the refused input", () => {
    const marker = "synthetic-marker-7f3a";
    for (const input of [{ domainId: marker, packageId: B }, { domainId: A, packageId: B, [marker]: A }, marker]) {
      expect(JSON.stringify(parseJobBody(input, FIELDS))).not.toContain(marker);
    }
  });
});

describe("isJobDefinition", () => {
  const valid = { name: "self_check", fields: ["domainId"], subject: "domainId" };

  it("accepts a queue name, a list of distinct fields and a subject among them", () => {
    expect(isJobDefinition(valid)).toBe(true);
    expect(isJobDefinition({ name: "evidence_rebuild", fields: ["domainId", "packageId"], subject: "packageId" })).toBe(true);
  });

  it.each([
    ["an empty name", { ...valid, name: "" }],
    ["a name with a dot", { ...valid, name: "self.check" }],
    ["a name in upper case", { ...valid, name: "Self_check" }],
    ["a name with a quote", { ...valid, name: "self'check" }],
    ["a name longer than 40 characters", { ...valid, name: "a".repeat(41) }],
    ["no fields", { ...valid, fields: [] }],
    ["a repeated field", { ...valid, fields: ["domainId", "domainId"] }],
    ["a field that is not an identifier", { ...valid, fields: ["domain id"], subject: "domain id" }],
    ["__proto__ as a field", { ...valid, fields: ["__proto__"], subject: "__proto__" }],
    ["a subject outside the fields", { ...valid, subject: "packageId" }],
  ])("refuses %s", (_label, definition) => {
    expect(isJobDefinition(definition)).toBe(false);
  });
});
