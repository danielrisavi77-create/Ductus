import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { urlWithUser } from "@/server/log/invented.fixture";
import { redact } from "@/server/log/redact";

// DAN-586: whatever structure a canary is hidden in, the redacted output is
// valid JSON, is built without throwing and never shows the canary. Every
// canary is invented and has at least one letter and one digit.
const canary = fc
  .tuple(fc.stringMatching(/^[A-Za-z]{6,12}$/), fc.stringMatching(/^[0-9]{2,4}$/), fc.stringMatching(/^[A-Za-z0-9]{12,20}$/))
  .map(([a, b, c]) => `kx${a}${b}${c}`);

const sensitiveKey = fc
  .constantFrom("authorization", "cookie", "set-cookie", "session_token", "password", "api_key", "client_secret", "text", "body", "html", "document", "snapshot", "payload", "email", "first_name", "oib", "jmbag", "phone", "user-agent")
  .chain((key) => fc.array(fc.boolean(), { minLength: key.length, maxLength: key.length }).map((upper) => [...key].map((ch, i) => (upper[i] ? ch.toUpperCase() : ch)).join("")))
  .chain((key) => fc.constantFrom(key, key.replace(/[-_]/g, ""), key.replace(/[-_]/g, "-"), key.replace(/[-_]/g, "_")));

/** One place the canary can hide, by input class of the contract. */
function hide(kind: number, key: string, secret: string): unknown {
  switch (kind) {
    case 0:
      return { [key]: secret };
    case 1:
      return { [key]: { nested: [secret] } };
    case 2:
      return `free text ${key}=${secret} and more`;
    case 3:
      return `request: Bearer ${secret}`;
    case 4:
      return urlWithUser("https", "u", secret, `h.example.test/p?q=${secret}#${secret}`);
    case 5:
      return new URL(`https://h.example.test/p?q=${secret}`);
    case 6:
      return new Headers({ authorization: secret, cookie: `a=${secret}` });
    case 7:
      return new Error("outer", { cause: new Error(`inner ${secret}`, { cause: { [key]: secret } }) });
    case 8:
      return new Map([[key, secret]]);
    case 9:
      return { [secret]: 1 };
    case 10:
      return `${secret}@example.test`;
    default:
      return secret;
  }
}

const harmless = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: "small" },
    fc.constantFrom("context", "duplicate", "42501", 0, 1, true, null),
    fc.array(tie("node"), { maxLength: 4 }),
    fc.dictionary(fc.constantFrom("stage", "code", "outcome", "id", "bytes"), tie("node"), { maxKeys: 3 }),
  ),
})).node;

test.prop([harmless, fc.nat(11), sensitiveKey, canary, fc.nat(60), fc.boolean()])(
  "no canary in any class, nesting, depth or cycle",
  (around, kind, key, secret, depth, cyclic) => {
    let value: unknown = { around, hidden: hide(kind, key, secret) };
    for (let i = 0; i < depth; i += 1) value = i % 2 === 0 ? { next: value } : [value];
    if (cyclic && typeof value === "object" && value !== null && !Array.isArray(value)) {
      (value as Record<string, unknown>).self = value;
    }
    let out = "";
    expect(() => {
      out = JSON.stringify(redact(value));
    }).not.toThrow();
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain(secret);
    expect(out.toLowerCase()).not.toContain(secret.toLowerCase());
  },
);

test.prop([fc.anything({ withBigInt: true, withDate: true, withMap: true, withSet: true, withTypedArray: true, withNullPrototype: true })])(
  "any value becomes valid JSON without throwing",
  (value) => {
    const out = JSON.stringify(redact(value));
    expect(typeof out).toBe("string");
    expect(() => JSON.parse(out)).not.toThrow();
  },
);
