"use client";

/**
 * The first opening of an assignment's work on `/rad?zadatak=` (#711 F1,
 * contract 6391402093 §2 "Prvo otvaranje", amendment 6391779486 point 6;
 * changed by DAN-330: the work starts on the student's click).
 *
 * Shown only for the plan `notStarted`: the server read says the student may
 * write but the work does not exist yet. Mounting sends nothing: the sheet is
 * read-only with "Započni rad", and only that click calls `openWork`, once
 * (the `inFlight` ref, so a double click or Enter and a click send one POST).
 * The answer goes to `openWorkStep`. After `opened` it refreshes the server
 * render once; the document id the editor, the comments and the live view use
 * comes only from that render (B1), never from this answer. `router.refresh()`
 * keeps this component mounted, so the refreshed flag lives in a ref: if the
 * refresh ends and the page still renders `notStarted`, the state is `error`,
 * with no second POST and no second refresh. Without a network the click waits
 * for the `online` event and then goes on by itself; only "Pokušaj ponovno"
 * starts another attempt by hand. The sheet stays read-only throughout, and
 * nothing is written locally. Like the other parts of the page (D-118), it
 * follows the session it was rendered under: once that session has ended the
 * click sends nothing and the sheet offers to sign in again.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { openWork, type OpenOutcome } from "@/client/evidence-ingest";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import { openWorkStep } from "@/components/student/work-document-plan";

import { startWorkAttempt } from "./open-work-start";
import { OpenWorkView, type OpenWorkPhase } from "./OpenWorkView";

/** The existing sign-in-again phase: the page's session has ended. */
const SESSION_ENDED: OpenWorkPhase = { kind: "unavailable", signIn: true };

export default function OpenWork({ assignmentId, session }: { assignmentId: string; session: SessionMark | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<OpenWorkPhase>({ kind: "idle" });
  const watch = useRef<SessionWatch | null>(null);
  const tag = session?.tag ?? null;
  const at = session?.at ?? 0;
  useEffect(() => {
    const w = watchSessionEnd(tag === null ? null : { tag, at }, () => setPhase(SESSION_ENDED));
    watch.current = w;
    return () => { w.close(); if (watch.current === w) watch.current = null; };
  }, [tag, at]);
  const [refreshing, startRefresh] = useTransition();
  const inFlight = useRef(false);
  // Kept across renders: router.refresh() does not remount this component.
  const refreshed = useRef(false);
  const wasRefreshing = useRef(false);
  const lastOutcome = useRef<OpenOutcome | null>(null);

  const attempt = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: "loading" });
    const result = await startWorkAttempt(assignmentId, {
      sessionEnded: () => watch.current?.ended() ?? false,
      open: openWork,
    });
    inFlight.current = false;
    if (result.status === "sessionEnded") {
      setPhase(SESSION_ENDED);
      return;
    }
    const outcome: OpenOutcome = result;
    if (watch.current?.ended()) {
      setPhase(SESSION_ENDED);
      return;
    }
    lastOutcome.current = outcome;
    const step = openWorkStep(outcome, refreshed.current, navigator.onLine);
    if (step.kind === "refresh") {
      refreshed.current = true;
      startRefresh(() => router.refresh());
      return;
    }
    setPhase(step);
  }, [assignmentId, router]);

  // The refresh has finished and this component is still on the page: the
  // server render is still `notStarted`. That is the `opened` answer a second
  // time, which openWorkStep turns into an error instead of a loop.
  useEffect(() => {
    if (wasRefreshing.current && !refreshing && refreshed.current && lastOutcome.current) {
      const step = openWorkStep(lastOutcome.current, true, navigator.onLine);
      if (step.kind !== "refresh") setPhase(step);
    }
    wasRefreshing.current = refreshing;
  }, [refreshing]);

  // Only after the click: without a network the opening waits for it and then
  // goes on by itself. The phase `offline` comes only from an attempt.
  useEffect(() => {
    if (phase.kind !== "offline") return;
    const online = () => { void attempt(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [phase.kind, attempt]);

  const start = useCallback(() => { void attempt(); }, [attempt]);

  const retry = useCallback(() => {
    // A new attempt by hand may refresh once again; nothing repeats by itself.
    refreshed.current = false;
    void attempt();
  }, [attempt]);

  return (
    <OpenWorkView
      phase={phase}
      assignmentId={assignmentId}
      onStart={start}
      onRetry={retry}
      onReload={() => window.location.reload()}
    />
  );
}
