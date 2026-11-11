"use client";

/**
 * The replay of one work (DAN-537, rb 261; S-34 and N-09): the student's page
 * and the teacher's page both render this one component over the same
 * `loadReplay`, so both see the same player drawn by the same code (PRODUCT §5
 * rule 5). `student` changes two sentences addressed to the student and
 * nothing in the player. The player steps through changes by their place
 * only: no clock, no tempo, no session times (D-143, D-239). Gaps in the
 * record are shown where they stand and listed, never filled (rb 261). The
 * text is read-only React text (D-34). Written with `createElement`, like
 * `LiveText`, so the unit test renders it.
 */

import {
  createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode,
} from "react";

import { loadReplay, type ReplayOutcome } from "@/client/replay";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import { blockRuns } from "@/components/shell/manuscript-blocks";
import SheetFrame from "@/components/shell/SheetFrame";
import type { DocumentNode } from "@/domain/document";
import type { ReplayPlayer } from "@/domain/projection/replay-player";
import { messagesHr } from "@/lib/i18n/messages.hr";

import {
  describeChange, fill, gapWords, historyRows, nearestStep, nodeText, paragraphOption, replayBlocks, sourceLabel, stepsOf,
  type ChangePart,
} from "./replay-view";
import styles from "./ReplayView.module.css";

const t = messagesHr.replay;

type Player = Extract<ReplayPlayer, { ok: true }>;
type Outcome = ReplayOutcome | { kind: "loading" };

/** The replay of `documentId` while mounted; nothing more is read once the session ends here. */
export function useReplay(documentId: string, session: SessionMark | null) {
  // The last answer and the reading it answers; any other reading is still loading.
  const [read, setRead] = useState<{ key: string; outcome: ReplayOutcome } | null>(null);
  const [ended, setEnded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const watchRef = useRef<SessionWatch | null>(null);
  const tag = session?.tag ?? null;
  const at = session?.at ?? 0;
  useLayoutEffect(() => {
    const watch = watchSessionEnd(tag === null ? null : { tag, at }, () => setEnded(true));
    watchRef.current = watch;
    return () => {
      watch.close();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [tag, at]);
  // Asked right before every request: false once the session has ended (F-093).
  const current = useCallback(() => !(watchRef.current?.ended() ?? false), []);
  const key = `${documentId}#${attempt}`;
  useEffect(() => {
    if (ended) return;
    let live = true;
    loadReplay(documentId, current).then(
      (outcome) => { if (live) setRead({ key, outcome }); },
      () => { if (live) setRead({ key, outcome: { kind: "unavailable" } }); },
    );
    return () => { live = false; };
  }, [documentId, current, ended, key]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // D-118: once the session has ended in this browser the record is gone from the page.
  const outcome: Outcome = read !== null && read.key === key ? read.outcome : { kind: "loading" };
  return { outcome: ended ? ({ kind: "signedOut" } as const) : outcome, retry };
}

function Block({ node, touched }: { node: DocumentNode; touched: boolean }) {
  const children = node.children.map((child, i) => {
    let content: ReactNode = child.text;
    if (child.marks.includes("italic")) content = h("em", null, content);
    if (child.marks.includes("bold")) content = h("strong", null, content);
    return h("span", { key: i }, content);
  });
  const props = { "data-node-id": node.id, className: touched ? styles.touched : undefined };
  if (node.type === "paragraph" || node.type === "quote") return h("p", props, ...children);
  if (node.type === "bulletItem") return h("li", props, ...children);
  // The page has its own h1, so the work's levels 1 to 3 are h2 to h4.
  return h(node.level === 1 ? "h2" : node.level === 2 ? "h3" : "h4", props, ...children);
}

function Text({ nodes, touched }: { nodes: readonly DocumentNode[]; touched: ReadonlySet<string> }) {
  const block = (node: DocumentNode) => h(Block, { key: node.id, node, touched: touched.has(node.id) });
  return h(SheetFrame, null, h(
    "div",
    { className: `manuscript ${styles.text}`, role: "document", "aria-label": t.sheetLabel },
    ...blockRuns([...nodes]).map((run) =>
      run.kind === "list" ? h("ul", { key: run.items[0]!.id }, ...run.items.map(block))
        : run.kind === "quote" ? h("blockquote", { key: run.items[0]!.id }, ...run.items.map(block))
        : block(run.node)),
  ));
}

const ordinalIn = (nodes: readonly DocumentNode[] | null, id: string): number | null => {
  const i = nodes?.findIndex((node) => node.id === id) ?? -1;
  return i < 0 ? null : i + 1;
};

function GapMark({ text, note }: { text: string; note: string | null }) {
  return h("div", { className: styles.gap, role: "note" }, h("strong", null, t.gapTitle), h("span", null, text),
    note === null ? null : h("span", null, note));
}

/** The player over one verified record; `n` is the change shown, 0 the start of the record. */
export function ReplayPlayerView({ player }: { player: Player }) {
  const [n, setN] = useState(player.total);
  const [scoped, setScoped] = useState<string | null>(null);

  const finalNodes = useMemo(() => replayBlocks(player.documentAt(player.total)) ?? [], [player]);
  const nodes = useMemo(() => replayBlocks(player.documentAt(n)), [player, n]);
  const priorNodes = useMemo(() => (n > 0 ? replayBlocks(player.documentAt(n - 1)) : null), [player, n]);
  const change = useMemo(() => player.entries.flatMap((e) =>
    e.entry === "change" && e.change.index === n ? [e.change] : [])[0] ?? null, [player, n]);
  const gaps = useMemo(() => player.entries.flatMap((e) => (e.entry === "gap" ? [e] : [])), [player]);

  const steps = useMemo(() => stepsOf(player.total, scoped === null ? null : player.paragraphHistory(scoped)), [player, scoped]);
  // The paragraph whose history is shown: the chosen one, else the first one this change touched.
  const shownId = scoped ?? change?.blockIds[0] ?? null;
  const shownHistory = useMemo(() => (shownId === null ? null : player.paragraphHistory(shownId)), [player, shownId]);
  const touchedHistories = useMemo(
    () => (change?.blockIds ?? []).map((id) => ({ id, history: player.paragraphHistory(id) })), [player, change]);
  const place = steps.length === 0 ? -1 : nearestStep(steps, n);
  const go = (to: number) => setN(Math.max(0, Math.min(player.total, to)));

  if (nodes === null) return h("p", { className: styles.state, role: "alert" }, t.unavailable);

  const ordinal = (id: string) => ordinalIn(nodes, id) ?? ordinalIn(priorNodes, id) ?? 0;
  const parts: ChangePart[] = touchedHistories.flatMap(({ id, history }) => {
    const entry = history.find((e) => e.entry === "change" && e.index === n);
    return entry?.entry === "change" ? [{ ordinal: ordinal(id), removed: entry.removed, inserted: entry.inserted }] : [];
  });
  const live = n === 0 || change === null ? t.startLive : describeChange(n, change.kind, parts);

  const shownNode = nodes.find((node) => node.id === shownId);
  const rows = shownHistory === null ? [] : historyRows(shownHistory, n, shownNode === undefined ? null : nodeText(shownNode));
  const here = gaps.filter((g) => g.beforeIndex === n || (g.beforeIndex === n + 1 && (g.gap === "not_resumed" || n === 0)));

  // Only a paragraph of the final text can be chosen: the select lists those.
  const inFinal = (id: string | undefined) => (finalNodes.some((node) => node.id === id) ? id : undefined);
  const choose = (id: string | null) => {
    setScoped(id);
    if (id === null) return;
    const own = stepsOf(player.total, player.paragraphHistory(id));
    if (own.length > 0) setN(own[nearestStep(own, n)]!);
  };
  const scopeButton = (label: string, on: boolean, act: () => void) =>
    h("button", { type: "button", className: on ? "btn" : `btn ${styles.secondary}`, "aria-pressed": on, onClick: act }, label);
  const position = n === 0 ? t.start : fill(t.position, { n, total: player.total });

  return h(
    "div",
    { className: styles.player },
    change === null ? null : h("p", { className: styles.srcLine },
      h("span", null, t.sourceLine), h("span", { className: styles.srcTag }, sourceLabel(change.source))),
    ...here.map((g) => {
      const words = gapWords(g.gap, g.beforeIndex);
      return h(GapMark, { key: `${g.gap}-${g.beforeIndex}`, text: words.text, note: words.note });
    }),
    h(Text, { nodes, touched: new Set(change?.blockIds ?? []) }),
    shownId === null ? null : h(
      "section",
      { className: styles.card, "aria-labelledby": "replay-history" },
      h("h2", { id: "replay-history", className: styles.cardTitle }, fill(t.historyTitle, { k: ordinal(shownId) })),
      rows.length === 0 ? h("p", { className: styles.meta }, t.historyNone) : h(
        "div",
        { className: styles.tableWrap },
        h("table", { className: styles.table },
          h("thead", null, h("tr", null,
            h("th", { scope: "col" }, t.historyVersion), h("th", { scope: "col" }, t.historyReplaced),
            h("th", { scope: "col" }, t.historyOrigin))),
          h("tbody", null, ...rows.map((row, i) => row.row === "gap"
            ? h("tr", { key: i }, h("td", { colSpan: 3, className: styles.gapRow }, row.text))
            : h("tr", { key: i },
              h("td", null, `${row.label}: ${row.text}`), h("td", null, row.replacedBy),
              h("td", null, h("span", { className: styles.srcTag }, row.source)))))),
      ),
      h("p", { className: styles.meta }, t.historyNote),
    ),
    h(
      "section",
      { className: styles.card, "aria-labelledby": "replay-scope" },
      h("h2", { id: "replay-scope", className: styles.cardTitle }, t.scopeTitle),
      h("div", { className: styles.row },
        scopeButton(t.scopeWhole, scoped === null, () => choose(null)),
        scopeButton(t.scopeOne, scoped !== null, () => choose(inFinal(change?.blockIds[0]) ?? finalNodes[0]?.id ?? null)),
        h("label", { className: styles.meta, htmlFor: "replay-paragraph" }, t.paragraph),
        h("select", {
          id: "replay-paragraph",
          className: styles.select,
          value: scoped ?? "",
          disabled: scoped === null,
          onChange: (event: { target: { value: string } }) => choose(event.target.value),
        }, ...finalNodes.map((node, i) => h("option", { key: node.id, value: node.id }, paragraphOption(i + 1, node)))),
      ),
      h("p", { className: styles.meta }, t.scopeNote),
    ),
    h(
      "div",
      { className: styles.controls, role: "group", "aria-label": t.controls },
      steps.length === 0 ? h("p", { className: styles.meta }, t.scopeNone) : h(
        "div",
        { className: styles.slider },
        h("label", { className: styles.sliderLabel, htmlFor: "replay-slider" }, h("span", null, position)),
        h("input", {
          id: "replay-slider",
          type: "range",
          min: 0,
          max: steps.length - 1,
          step: 1,
          value: place,
          "aria-valuetext": position,
          onChange: (event: { target: { value: string } }) => go(steps[Number(event.target.value)] ?? n),
        }),
      ),
      h("div", { className: styles.row },
        h("button", { type: "button", className: `btn ${styles.secondary}`, disabled: place <= 0, onClick: () => go(steps[place - 1] ?? n) }, t.previous),
        h("button", { type: "button", className: `btn ${styles.secondary}`, disabled: place < 0 || place >= steps.length - 1, onClick: () => go(steps[place + 1] ?? n) }, t.next)),
      h("p", { className: styles.live, role: "status", "aria-live": "polite" }, live),
      h("p", { className: styles.meta }, t.stepNote),
    ),
    gaps.length === 0 ? null : h(
      "section",
      { className: styles.card, "aria-labelledby": "replay-gaps" },
      h("h2", { id: "replay-gaps", className: styles.cardTitle }, gaps.length === 1 ? t.gapTitle : t.gapsTitle),
      h("ul", { className: styles.gapList }, ...gaps.map((g) => {
        const words = gapWords(g.gap, g.beforeIndex);
        return h("li", { key: `${g.gap}-${g.beforeIndex}` }, h("span", null, words.text), words.target === null ? null
          : h("button", { type: "button", className: `btn ${styles.secondary}`, onClick: () => { setScoped(null); go(words.target!); } },
            fill(t.goTo, { n: words.target })));
      })),
    ),
  );
}

export type ReplayViewProps = { documentId: string; session: SessionMark | null; student: boolean };

/** The intro, the state of the reading, the player, and the two notes every replay carries. */
export default function ReplayView({ documentId, session, student }: ReplayViewProps) {
  const { outcome, retry } = useReplay(documentId, session);
  let body: ReactNode;
  if (outcome.kind === "loading") {
    body = h("div", { "aria-busy": true },
      h("p", { className: styles.state, role: "status" }, t.loading),
      ...["80", "60", "40"].map((w) => h("div", { key: w, className: `${styles.skel} ${styles[`w${w}`]}` })));
  } else if (outcome.kind === "ok") {
    const { player } = outcome;
    body = player.total === 0 && !player.entries.some((e) => e.entry === "gap")
      ? h("p", { className: styles.state }, t.empty)
      : h(ReplayPlayerView, { key: documentId, player });
  } else if (outcome.kind === "unavailable") {
    body = h("div", { className: styles.card, role: "alert" },
      h("p", null, t.unavailable), student ? h("p", { className: styles.meta }, t.unavailableStudent) : null,
      h("p", null, h("button", { type: "button", className: `btn ${styles.secondary}`, onClick: retry }, t.retry)));
  } else {
    body = h("p", { className: styles.state, role: "alert" }, outcome.kind === "notFound" ? t.notFound : t.signedOut);
  }
  return h(
    "div",
    { className: styles.replay },
    h("div", { className: styles.intro },
      h("p", { className: styles.lead }, t.intro),
      h("p", null, student ? `${t.purpose} ${t.sameView}` : t.purpose)),
    body,
    h("p", { className: styles.note }, t.note),
    h("p", { className: styles.foot }, t.foot),
  );
}
