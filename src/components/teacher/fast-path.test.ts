import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEMO_FAST_PATH } from "@/lib/i18n/demo-fast-path.hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { FastPath } from "./FastPath";
import { bySurname, compareHr, fastPathLines, fullName, textRuns, type FastPathStudent } from "./fast-path";

const t = messagesHr.fastPath;

// Invented names only.
function student(givenName: string | null, surname: string | null, id = `${givenName}-${surname}`): FastPathStudent {
  return { id, givenName, surname, work: "writing", lastChangeAt: null, record: null };
}

const SAMPLE = DEMO_FAST_PATH;

function render(load: Parameters<typeof FastPath>[0]["load"]): string {
  return renderToStaticMarkup(createElement(FastPath, { load }));
}

describe("bySurname (I1, D-80)", () => {
  it("follows the Croatian alphabet: c č ć d dž đ, l lj, n nj, s š, z ž", () => {
    const surnames = ["Žabić", "Zubić", "Šarić", "Sabić", "Njivić", "Nović", "Ljubić", "Lukić", "Đakić", "Džakić", "Dukić", "Ćakić", "Čakić", "Cakić"];
    expect(bySurname(surnames.map((s) => student("Ana", s))).map((s) => s.surname)).toEqual([
      "Cakić", "Čakić", "Ćakić", "Dukić", "Džakić", "Đakić", "Lukić", "Ljubić", "Nović", "Njivić", "Sabić", "Šarić", "Zubić", "Žabić",
    ]);
  });

  it("ignores case, then orders by given name, then by id", () => {
    const list = [student("Marko", "čakić", "2"), student("Ana", "Čakić", "3"), student("Ana", "Čakić", "1"), student("Iva", "Babić")];
    expect(bySurname(list).map((s) => s.id)).toEqual(["Iva-Babić", "1", "3", "2"]);
  });

  it("does not depend on the order it is given and leaves the input alone", () => {
    const list = [student("A", "Šarić"), student("B", "Babić"), student("C", "Ćakić")];
    const copy = [...list];
    expect(bySurname(list)).toEqual(bySurname([...list].reverse()));
    expect(list).toEqual(copy);
  });

  it("puts students without a name last, by id, whatever the order given (#757 D1)", () => {
    const list = [student(null, null, "z"), student("Iva", "Žabić"), student(null, null, "a"), student("Ana", "Babić")];
    const ids = bySurname(list).map((s) => s.id);
    expect(ids).toEqual(["Ana-Babić", "Iva-Žabić", "a", "z"]);
    expect(bySurname([...list].reverse()).map((s) => s.id)).toEqual(ids);
    expect(fullName(list[0]!)).toBe(t.unnamed);
  });

  it("agrees with the host's Croatian collation on the demo names where the host has it", () => {
    const names = DEMO_FAST_PATH.map((s) => s.surname!);
    const ours = [...names].sort(compareHr);
    const intl = [...names].sort(new Intl.Collator("hr").compare);
    expect(ours).toEqual(intl);
  });
});

describe("lines (I2)", () => {
  const withPaste = DEMO_FAST_PATH.find((s) => s.record && s.record.pastesWithoutSource > 0)!;
  const without = DEMO_FAST_PATH.find((s) => s.record && s.record.pastesWithoutSource === 0)!;

  it("gives the last change, the pastes and the state of the record, and no revision or declaration line (#757 O2, O3)", () => {
    const lines = fastPathLines(withPaste, withPaste.record!);
    expect(lines.map((l) => l.key)).toEqual(["lastChange", "pastes", "record"]);
    expect(lines[0]!.value).toBe("17. listopada 2026. u 10:42");
    expect(lines[1]!.value).toBe("3");
    expect(lines[2]!.value).toBe(messagesHr.summary.recordState.has_gaps);
    expect(fastPathLines(without, without.record!)[1]!.value).toBe(t.none);
  });

  it("has no percentage and no forbidden word in any line or label", () => {
    for (const s of DEMO_FAST_PATH) {
      if (!s.record) continue;
      for (const line of fastPathLines(s, s.record)) {
        expect(`${line.label} ${line.value}`).not.toMatch(/%|posto/);
        expect(findForbiddenTerms(`${line.label} ${line.value}`)).toEqual([]);
      }
    }
  });
});

describe("FastPath states", () => {
  it("loading, unavailable, signed out, no assignment and no works say so and show no name", () => {
    const states = [
      [{ state: "loading" }, t.loading],
      [{ state: "unavailable" }, t.unavailable],
      [{ state: "signedOut" }, messagesHr.teacher.signedOut],
      [{ state: "pickAssignment" }, t.pickAssignment],
      [{ state: "ready", students: [], stale: false }, t.empty],
    ] as const;
    for (const [load, text] of states) {
      const html = render(load);
      expect(html).toContain(text);
      expect(html).not.toContain("<nav");
      for (const s of SAMPLE) expect(html).not.toContain(s.surname!);
    }
    expect(render({ state: "signedOut" })).toContain('href="/api/auth/login"');
    expect(render({ state: "pickAssignment" })).toContain('href="/nastavnik"');
  });

  it("says how fresh the state is, and when a refresh failed keeps the last one", () => {
    expect(render({ state: "ready", students: SAMPLE, stale: false })).toContain(t.refresh);
    const stale = render({ state: "ready", students: SAMPLE, stale: true });
    expect(stale).toContain(t.stale);
    expect(stale).not.toContain(t.refresh);
    expect(stale).toContain(fullName(SAMPLE[0]!));
  });

  it("lists by surname whatever the order of the answer, marks the first as chosen and shows its text", () => {
    for (const students of [SAMPLE, [...SAMPLE].reverse()]) {
      const html = render({ state: "ready", students, stale: false });
      const order = bySurname(SAMPLE).map((s) => html.indexOf(fullName(s)));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(html.match(/aria-current="true"/g)).toHaveLength(1);
      expect(html).toContain(t.views.text);
      expect(html).toContain(t.soon);
    }
  });

  it("shows a student without a name last, in words, never as an id", () => {
    const html = render({ state: "ready", students: [student(null, null, "s-77"), ...SAMPLE], stale: false });
    expect(html.indexOf(t.unnamed)).toBeGreaterThan(html.indexOf(fullName(bySurname(SAMPLE).at(-1)!)));
    expect(html).not.toContain("s-77");
  });

  it("shows the pastes as a number with nothing to click and nothing marked", () => {
    const withPaste = SAMPLE.find((s) => s.record && s.record.pastesWithoutSource > 0)!;
    const html = render({ state: "ready", students: [withPaste], stale: false });
    expect(html).not.toContain("data-marked");
    expect(html).toContain('data-line="pastes">3</dd>');
    expect(html).not.toMatch(/<dd[^>]*><button/);
  });

  it("a student without a confirmed notice has no lines and no switch", () => {
    const pending = DEMO_FAST_PATH.find((s) => s.record === null)!;
    const html = render({ state: "ready", students: [pending], stale: false });
    expect(html).toContain(t.noRecordYet);
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("aria-pressed");
  });

  it("offers no control that sorts or writes (I1, I3)", () => {
    const html = render({ state: "ready", students: DEMO_FAST_PATH, stale: false });
    expect(html).not.toMatch(/<select|<textarea|<input|<form/);
  });

  it("marks each state word for its dot without adding an element, and keeps the surname order (#732 item 17)", () => {
    const works = ["submitted", "notice_pending", "writing"] as const;
    const students = works.map((work, i) => ({ ...student("Ana", `Prezime${i}`), work }));
    const html = render({ state: "ready", students, stale: false });
    for (const work of works) {
      expect(html).toContain(`data-work="${work}">${t.work[work]}</span>`);
    }
    // The e2e reads names as each button's first span; the dot must not add one.
    expect(html).not.toMatch(/<span[^>]*><\/span>/);
    // One per list row and one in the head of the chosen work.
    expect(html.split("data-work=").length - 1).toBe(works.length + 1);
    const order = students.map((s) => html.indexOf(`Ana ${s.surname}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("block kinds (F-150 point 1, E1)", () => {
  const blocks = [
    { kind: "heading", text: "Uvod" },
    { kind: "bulletItem", text: "prva stavka" },
    { kind: "bulletItem", text: "druga stavka" },
    { kind: "paragraph", text: "Odlomak između." },
    { kind: "quote", text: "prvi red navoda" },
    { kind: "quote", text: "drugi red navoda" },
    { kind: "bulletItem", text: "nova lista" },
  ] as const;

  it("groups consecutive items into one list and consecutive quotes into one quote", () => {
    expect(textRuns(blocks)).toEqual([
      { kind: "heading", texts: ["Uvod"] },
      { kind: "bulletItem", texts: ["prva stavka", "druga stavka"] },
      { kind: "paragraph", texts: ["Odlomak između."] },
      { kind: "quote", texts: ["prvi red navoda", "drugi red navoda"] },
      { kind: "bulletItem", texts: ["nova lista"] },
    ]);
    // Headings and paragraphs never merge.
    expect(textRuns([{ kind: "paragraph", text: "a" }, { kind: "paragraph", text: "b" }])).toHaveLength(2);
    expect(textRuns([])).toEqual([]);
  });

  it("draws every block in order: items as list entries, quotes as a block quote", () => {
    const base = SAMPLE.find((s) => s.record !== null)!;
    const html = render({ state: "ready", students: [{ ...base, record: { ...base.record!, blocks } }], stale: false });
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html).toContain("<ul><li>prva stavka</li><li>druga stavka</li></ul>");
    expect(html).toContain("<blockquote><p>prvi red navoda</p><p>drugi red navoda</p></blockquote>");
    expect(html).toContain("<ul><li>nova lista</li></ul>");
    const order = blocks.map((b) => html.indexOf(b.text));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("text coverage", () => {
  it("the forbidden-terms scan reads the demo data and the messages", () => {
    expect(isUiTextModule("src/lib/i18n/demo-fast-path.hr.ts")).toBe(true);
    expect(isUiTextModule("src/lib/i18n/messages.hr.ts")).toBe(true);
  });

  it("no demo text holds a forbidden word", () => {
    expect(findForbiddenTerms(JSON.stringify(DEMO_FAST_PATH))).toEqual([]);
    expect(findForbiddenTerms(JSON.stringify(t))).toEqual([]);
  });
});
