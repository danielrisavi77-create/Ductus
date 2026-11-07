import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatInText, parseCitationStyle, type BookSource } from "@/domain/citation";

import fpzgStyleFile from "../../../config/faculties/fpzg/citation.json";
import institutionsFile from "../../../config/institutions.json";

import {
  InstitutionConfigError, parseInstitutionRecords, resolveCitationStyle, resolveInstitutionConfig,
} from "./index";

// M2.12-P02 (DAN-443), plan napada #1689: the configuration of an institution
// comes only from its record; no slug ever falls back to another record.

const fpzgStyle = parseCitationStyle(fpzgStyleFile);
const STYLES = { fpzg: fpzgStyle };
const BOOK: BookSource = {
  type: "book", authors: [{ kind: "person", family: "Horvat", given: "Ana" }], year: 2020,
  title: "Izmišljena knjiga", place: "Zagreb", publisher: "Izdavač",
};

describe("resolveInstitutionConfig: slug input classes (A1 to A5)", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["upper case", "DEMO-FAKULTET"],
    ["leading space", " demo-fakultet"],
    ["trailing newline", "demo-fakultet\n"],
    ["__proto__", "__proto__"],
    ["constructor", "constructor"],
    ["toString", "toString"],
    ["hasOwnProperty", "hasOwnProperty"],
    ["33 characters", "a".repeat(33)],
    ["Cyrillic lookalike", "demo-fаkultet"],
    ["a database slug without a record (fixture fak-a)", "fak-a"],
    ["a number", 7],
    ["an object", { slug: "demo-fakultet" }],
  ])("refuses %s", (_name, slug) => {
    expect(resolveInstitutionConfig(slug)).toEqual({ ok: false, reason: "unknown_institution" });
    expect(resolveCitationStyle(slug)).toBeNull();
  });

  it("refuses every slug that has no record (property)", () => {
    const known = new Set(institutionsFile.institutions.map((r) => r.slug));
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.stringMatching(/^[a-z0-9-]{2,32}$/)), (slug) => {
        fc.pre(!known.has(slug));
        expect(resolveInstitutionConfig(slug).ok).toBe(false);
      }),
    );
  });

  it("gives each recorded institution its own slug and the one FPZG style source (A6, A7)", () => {
    for (const slug of ["fpzg", "demo-fakultet", "demo-fakultet-b"]) {
      const result = resolveInstitutionConfig(slug);
      expect(result.ok && result.config.slug).toBe(slug);
      expect(result.ok && result.config.citationStyle).toEqual(fpzgStyle);
    }
    // E1: the same text the FPZG style file gives, through the resolver.
    expect(formatInText(BOOK, resolveCitationStyle("demo-fakultet")!, "15")).toBe(formatInText(BOOK, fpzgStyle, "15"));
  });

  it("hands out frozen configuration", () => {
    const result = resolveInstitutionConfig("demo-fakultet");
    expect(result.ok && Object.isFrozen(result.config)).toBe(true);
    expect(result.ok && Object.isFrozen(result.config.citationStyle)).toBe(true);
  });
});

describe("parseInstitutionRecords: record input classes (B1 to B6)", () => {
  const ok = { format: "ductus-institutions-v1", institutions: [{ slug: "fak-a", citationStyle: "fpzg" }] };

  it("accepts a well-formed file", () => {
    expect(parseInstitutionRecords(ok, STYLES).get("fak-a")?.citationStyle).toEqual(fpzgStyle);
  });

  it.each<[string, unknown]>([
    ["not an object", "x"],
    ["an array", [ok]],
    ["an unknown top-level field", { ...ok, fallback: "fpzg" }],
    ["a wrong format tag", { ...ok, format: "ductus-institutions-v2" }],
    ["no format tag", { institutions: ok.institutions }],
    ["institutions not an array", { ...ok, institutions: {} }],
    ["an unknown record field", { ...ok, institutions: [{ slug: "fak-a", citationStyle: "fpzg", default: true }] }],
    ["a duplicate slug", { ...ok, institutions: [ok.institutions[0], ok.institutions[0]] }],
    ["an unknown style", { ...ok, institutions: [{ slug: "fak-a", citationStyle: "apa" }] }],
    ["a style named by an inherited key", { ...ok, institutions: [{ slug: "fak-a", citationStyle: "toString" }] }],
    ["a slug outside the database CHECK", { ...ok, institutions: [{ slug: "Fak_A", citationStyle: "fpzg" }] }],
    ["a one-character slug", { ...ok, institutions: [{ slug: "a", citationStyle: "fpzg" }] }],
    ["a missing style", { ...ok, institutions: [{ slug: "fak-a" }] }],
    ["a signing key", { ...ok, institutions: [{ slug: "fak-a", citationStyle: "fpzg", signingKey: "x" }] }],
    ["a storage domain", { ...ok, institutions: [{ slug: "fak-a", citationStyle: "fpzg", storageDomain: "x" }] }],
    ["a record that is null", { ...ok, institutions: [null] }],
  ])("refuses %s", (_name, file) => {
    expect(() => parseInstitutionRecords(file, STYLES)).toThrow(InstitutionConfigError);
  });

  it("refuses fields that are only inherited (B5)", () => {
    const record = Object.create({ slug: "fak-a", citationStyle: "fpzg" }) as object;
    expect(() => parseInstitutionRecords({ ...ok, institutions: [record] }, STYLES)).toThrow(InstitutionConfigError);
    const file = Object.create(ok) as object;
    expect(() => parseInstitutionRecords(file, STYLES)).toThrow(InstitutionConfigError);
  });

  it("parses the committed file", () => {
    expect([...parseInstitutionRecords(institutionsFile, STYLES).keys()]).toEqual(["fpzg", "demo-fakultet", "demo-fakultet-b"]);
  });
});
