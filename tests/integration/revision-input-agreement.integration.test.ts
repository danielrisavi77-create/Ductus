import fc from "fast-check";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { isRangeHash, isRevisionText } from "@/domain/collaboration/revision-input";

import { BLANKS, TEXT_CASES } from "../unit/revision-text-cases";
import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-314 step 2d (contract on #1091, c.6696530499; plan of attack #1506
// class 8, docs/backend/suradnja.md 4.14 G1 to G9): the route refuses early
// with isRevisionText and isRangeHash, so both must give the answer of the
// database for every text. Each sample is asked of the real function and the
// real CHECK regex. A lone surrogate cannot reach the database (the driver
// sends UTF-8) and is covered by the unit test; U+0000 is refused by
// PostgreSQL itself before the function runs (22021), which this test shows.
// All text is invented. Loopback only; nothing is written.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The revision input agreement test runs only against a loopback database (DATABASE_URL).");
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });

afterAll(async () => {
  await admin.end();
});

/** The database's answer, or "refused" when PostgreSQL cannot hold the text at all. */
async function database(text: string): Promise<boolean | "refused"> {
  try {
    const result = await admin.query<{ ok: boolean }>("SELECT collaboration.is_revision_text($1) AS ok", [text]);
    return result.rows[0].ok;
  } catch (error) {
    if ((error as { code?: string }).code === "22021") return "refused";
    throw error;
  }
}

async function agrees(text: string) {
  const answer = await database(text);
  // A text the database refuses is never valid for the route either.
  return answer === "refused" ? isRevisionText(text) === false : isRevisionText(text) === answer;
}

// Letters, blanks, every C0 and C1 control, DEL, bidi controls, combining
// marks, astral characters and the neighbours of each range.
const POOL = [
  "a", "Z", "7", ".", "<", "*", "\u010D", "\u0161", "\u00E1", "\u4E2D", "\u{1F600}", "\u{1D11E}",
  ...BLANKS,
  ...Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)),
  ...Array.from({ length: 0x21 }, (_, i) => String.fromCharCode(0x7f + i)),
  "\u00A1", "\u00AD", "\u200E", "\u200F", "\u2029", "\u202A", "\u202B", "\u202C", "\u202D", "\u202E", "\u202F",
  "\u2065", "\u2066", "\u2067", "\u2068", "\u2069", "\u206A", "\u2061", "\uFEFE", "\uFFFD",
  "\u0300", "\u0301", "\u030C", "\u0327", "\u0334", "\u0338", "\u0307",
  // Newer than the database's Unicode: the QA pair of #1654 and its kin.
  "\u0897", "\u{113C2}", "\u{105D2}", "\u{105C9}", "\u{16D63}", "\u{16D67}", "\u1ACF",
];

describe("isRevisionText agrees with collaboration.is_revision_text", () => {
  it.each(TEXT_CASES)("%s", async (_name, text, ok) => {
    expect(isRevisionText(text)).toBe(ok);
    expect(await agrees(text)).toBe(true);
  });

  it("U+0000 never reaches the function", async () => {
    expect(await database("a\u0000b")).toBe("refused");
    expect(isRevisionText("a\u0000b")).toBe(false);
  });

  it("agrees on each C0 and C1 control inside text", async () => {
    const codes = [...Array.from({ length: 0x1f }, (_, i) => i + 1), ...Array.from({ length: 0x21 }, (_, i) => 0x7f + i)];
    for (const code of codes) expect(await agrees(`a${String.fromCharCode(code)}b`), code.toString(16)).toBe(true);
  });

  it("agrees on 500 mixed samples", async () => {
    const parts = fc.array(fc.constantFrom(...POOL), { minLength: 0, maxLength: 12 });
    await fc.assert(fc.asyncProperty(parts, async (chosen) => agrees(chosen.join(""))), { numRuns: 500 });
  });

  // Node and PostgreSQL carry their own Unicode tables (#1654 QA), so every
  // code point is asked alone, before a lower class mark, after a composed
  // letter and as its own NFD, which covers each composition and reordering.
  it("agrees on every code point", { timeout: 300_000 }, async () => {
    const texts: string[] = [];
    for (let code = 1; code <= 0x10ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const x = String.fromCodePoint(code);
      texts.push(`a${x}`, `a${x}\u0334`, `\u00E1${x}`, `a${x.normalize("NFD")}`);
    }
    const differ: string[] = [];
    for (let start = 0; start < texts.length; start += 40_000) {
      const batch = texts.slice(start, start + 40_000);
      const { rows } = await admin.query<{ ok: boolean }>(
        "SELECT collaboration.is_revision_text(t) AS ok FROM unnest($1::text[]) WITH ORDINALITY u(t, n) ORDER BY n", [batch]);
      batch.forEach((text, i) => {
        if (rows[i].ok !== isRevisionText(text)) differ.push([...text].map((c) => c.codePointAt(0)?.toString(16)).join(" "));
      });
    }
    expect(differ).toEqual([]);
  });

  it("agrees around the length limit", async () => {
    const lengths = fc.integer({ min: 1995, max: 2005 });
    await fc.assert(fc.asyncProperty(lengths, fc.constantFrom("a", "\u{1F600}", "\u00E1"), async (n, unit) =>
      agrees(unit.repeat(n))), { numRuns: 40 });
  });
});

describe("isRangeHash agrees with the accepted_range_hash CHECK", () => {
  const regex = async (value: string) => (await admin.query<{ ok: boolean }>(
    "SELECT $1::text ~ '^[0-9a-f]{64}$' AS ok", [value])).rows[0].ok;

  it("agrees on hex-like samples", async () => {
    const hex = fc.constantFrom(..."0123456789abcdefABCDEFg \n");
    const samples = fc.array(hex, { minLength: 62, maxLength: 66 }).map((chars) => chars.join(""));
    await fc.assert(fc.asyncProperty(samples, async (value) => isRangeHash(value) === await regex(value)), { numRuns: 200 });
  });

  it("agrees on the edge cases", async () => {
    for (const value of ["a".repeat(64), "A".repeat(64), "a".repeat(63), "a".repeat(65), `${"a".repeat(64)}\n`, "", "0".repeat(64)]) {
      expect(isRangeHash(value)).toBe(await regex(value));
    }
  });
});
