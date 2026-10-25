import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEMO_FAST_PATH } from "@/lib/i18n/demo-fast-path.hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { FastPath } from "./FastPath";
import { bySurname, compareHr, fastPathLines, placeOf, type FastPathStudent } from "./fast-path";

const t = messagesHr.fastPath;

// Invented names only.
function student(givenName: string, surname: string, id = `${givenName}-${surname}`): FastPathStudent {
  return { id, givenName, surname, work: "writing", lastChangeAt: null, record: null };
}

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

  it("agrees with the host's Croatian collation on the demo names where the host has it", () => {
    const names = DEMO_FAST_PATH.map((s) => s.surname);
    const ours = [...names].sort(compareHr);
    const intl = [...names].sort(new Intl.Collator("hr").compare);
    expect(ours).toEqual(intl);
  });
});

describe("lines (I2)", () => {
  const withPaste = DEMO_FAST_PATH.find((s) => s.record && s.record.pastesWithoutSource.length > 0)!;

  it("gives the four lines of D-80 and the state of the record, in that order", () => {
    const lines = fastPathLines(withPaste, withPaste.record!);
    expect(lines.map((l) => l.key)).toEqual(["lastChange", "revisions", "pastes", "declaration", "record"]);
    expect(lines[0]!.value).toBe("17. listopada 2026. u 10:42");
    expect(lines[1]!.value).toBe("1 zahtjev za doradu");
    expect(lines[2]!.value).toBe("1 · Analiza, 2. odlomak");
    expect(lines[4]!.value).toBe(messagesHr.summary.recordState.has_gaps);
  });

  it("names the place of a paragraph under its heading", () => {
    const blocks = withPaste.record!.blocks;
    expect(placeOf(blocks, 1)).toBe("Uvod, 1. odlomak");
    expect(placeOf([{ kind: "paragraph", text: "x" }], 0)).toBe(`1. ${t.paragraph}`);
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
  it("loading, unavailable and no students say so and show no student", () => {
    expect(render({ state: "loading" })).toContain(t.loading);
    expect(render({ state: "unavailable" })).toContain(t.unavailable);
    expect(render({ state: "ready", students: [] })).toContain(t.noStudents);
    expect(render({ state: "loading" })).not.toContain("<nav");
  });

  it("lists by surname, marks the first as chosen and shows its text", () => {
    const html = render({ state: "ready", students: DEMO_FAST_PATH });
    const order = bySurname(DEMO_FAST_PATH).map((s) => html.indexOf(`${s.givenName} ${s.surname}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain(t.views.text);
    expect(html).toContain(t.soon);
  });

  it("a student without a confirmed notice has no lines and no switch", () => {
    const pending = DEMO_FAST_PATH.find((s) => s.record === null)!;
    const html = render({ state: "ready", students: [pending] });
    expect(html).toContain(t.noRecordYet);
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("aria-pressed");
  });

  it("offers no control that sorts or writes (I1, I3)", () => {
    const html = render({ state: "ready", students: DEMO_FAST_PATH });
    expect(html).not.toMatch(/<select|<textarea|<input|<form/);
  });

  it("puts a hidden dot before each state word and keeps the surname order (#732 item 17)", () => {
    const works = ["submitted", "notice_pending", "revision_requested", "writing"] as const;
    const students = works.map((work, i) => ({ ...student("Ana", `Prezime${i}`), work }));
    const html = render({ state: "ready", students });
    for (const work of works) {
      expect(html).toMatch(new RegExp(`<span[^>]*data-work="${work}"[^>]*aria-hidden="true"[^>]*></span>${t.work[work]}`));
    }
    const order = students.map((s) => html.indexOf(`Ana ${s.surname}`));
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
