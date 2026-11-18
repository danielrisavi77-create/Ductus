// orch:owner, pure core only; no file or network is read.
import assert from "node:assert/strict";
import test from "node:test";

import { datesIn, deadlineOf, groupByDeadline, parseOwnerQueue, renderHtml, renderText } from "./owner-queue-core.mjs";

const STATE = [
  "# Stanje rada",
  "- [ ] outside the section, ignored. Rok: 1. 1. 2026.",
  "## Owner queue (samo Daniel)",
  "Uvodni tekst.",
  "- [x] Q-4: gotovo. Rok: 1. 11. 2026.",
  "- [ ] Q-1, ugovor (D-264 Q13, prije probe 22. 2. 2027.). Rok: 13. 11. 2026. Radnja: vlasnik.",
  "- [ ] Q-3, FPZG. Paket poslan do 13. 11.; odgovori do 30. 11. 2026. Radnja: vlasnik.",
  "- [ ] Q-15, zaštita <main>. Radnja vlasnika (DAN-552). Rok: 22. 2. 2027.",
  "- [ ] FPZG AAI: ovlast za Lab. Blokira M1, ne demo.",
  "## Engineering System v1",
  "- [ ] not an owner item. Rok: 2. 1. 2026.",
].join("\n");

test("datesIn reads Croatian dates and borrows a missing year from the next date", () => {
  assert.deepEqual(datesIn("do 13. 11.; odgovori do 30. 11. 2026.", 2020).map((d) => d.date), ["2026-11-13", "2026-11-30"]);
  assert.deepEqual(datesIn("do 5. 3.", 2027).map((d) => d.date), ["2027-03-05"]);
  assert.deepEqual(datesIn("31. 2. 2026. i D-199 t. 3", 2026), []);
});

test("deadlineOf prefers Rok, then the earliest 'do' date, and ignores other dates", () => {
  assert.equal(deadlineOf("prije probe 22. 2. 2027. Rok: 13. 11. 2026.", 2026), "2026-11-13");
  assert.equal(deadlineOf("odgovori do 30. 11. 2026., poslan do 13. 11. 2026.", 2026), "2026-11-13");
  assert.equal(deadlineOf("odlučeno 9. 11. 2026. (D-288)", 2026), null);
});

test("parseOwnerQueue reads only the Owner queue section", () => {
  const items = parseOwnerQueue(STATE, 2026);
  assert.deepEqual(items.map((i) => i.label), ["Q-4", "Q-1", "Q-3", "Q-15", "FPZG AAI"]);
  assert.deepEqual(items.map((i) => i.done), [true, false, false, false, false]);
  assert.deepEqual(items.map((i) => i.deadline), ["2026-11-01", "2026-11-13", "2026-11-13", "2027-02-22", null]);
  assert.deepEqual(items.map((i) => i.action), [null, "vlasnik", "vlasnik", "vlasnik", null]);
  assert.ok(items[1].text.startsWith("ugovor"));
  assert.deepEqual(parseOwnerQueue("# bez sekcije\n- [ ] x", 2026), []);
});

test("groupByDeadline drops done items and splits by distance from today", () => {
  const g = groupByDeadline(parseOwnerQueue(STATE, 2026), "2026-11-18");
  assert.deepEqual(g.overdue.map((i) => [i.label, i.days]), [["Q-1", -5], ["Q-3", -5]]);
  assert.deepEqual(g.soon, []);
  assert.deepEqual(g.later.map((i) => i.label), ["Q-15"]);
  assert.deepEqual(g.none.map((i) => i.label), ["FPZG AAI"]);
  const edge = groupByDeadline([{ done: false, label: "a", text: "", deadline: "2026-12-02" }, { done: false, label: "b", text: "", deadline: "2026-11-18" }], "2026-11-18");
  assert.deepEqual(edge.soon.map((i) => [i.label, i.days]), [["b", 0], ["a", 14]]);
  assert.throws(() => groupByDeadline([], "sutra"), /bad date/);
});

test("renderText lists non-empty groups with the deadline and the lag", () => {
  const text = renderText(groupByDeadline(parseOwnerQueue(STATE, 2026), "2026-11-18"), "2026-11-18").join("\n");
  assert.match(text, /Owner queue na dan 18\. 11\. 2026\./);
  assert.match(text, /Prekoračeno \(2\)\n {2}Q-1 {2}13\. 11\. 2026\. \(kasni 5 d\)/);
  assert.match(text, /Bez roka \(1\)\n {2}FPZG AAI\n/);
  assert.doesNotMatch(text, /Uskoro|Q-4/);
});

test("renderHtml escapes item text and carries no script or external request", () => {
  const html = renderHtml(groupByDeadline(parseOwnerQueue(STATE, 2026), "2026-11-18"), "2026-11-18");
  assert.match(html, /zaštita &lt;main&gt;/);
  assert.doesNotMatch(html, /<main>\./);
  assert.doesNotMatch(html, /<script|https?:\/\/|@import|url\(/);
  assert.match(html, /<html lang="hr">/);
});
