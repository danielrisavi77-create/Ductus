"use client";

/**
 * The first opening of an assignment's work on `/rad?zadatak=` (#711 F1,
 * contract 6391402093 §2 "Prvo otvaranje", amendment 6391779486 point 6).
 *
 * Shown only for the plan `opening`: the server read says the student may
 * write but the work does not exist yet. On mount it calls `openWork` exactly
 * once (a ref, so React Strict Mode's second effect sends no second POST) and
 * hands the answer to `openWorkStep`. After `opened` it refreshes the server
 * render once; the document id the editor, the comments and the live view use
 * comes only from that render (B1), never from this answer. `router.refresh()`
 * keeps this component mounted, so the refreshed flag lives in a ref: if the
 * refresh ends and the page still renders `opening`, the state is `error`,
 * with no second POST and no second refresh. Without a network it waits for
 * the `online` event; only "Pokušaj ponovno" starts another attempt by hand.
 * The sheet stays read-only throughout, and nothing is written locally.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { openWork, type OpenOutcome } from "@/client/evidence-ingest";
import { openWorkStep } from "@/components/student/work-document-plan";

import { OpenWorkView, type OpenWorkPhase } from "./OpenWorkView";

export default function OpenWork({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<OpenWorkPhase>({ kind: "loading" });
  const [refreshing, startRefresh] = useTransition();
  const started = useRef(false);
  const inFlight = useRef(false);
  // Kept across renders: router.refresh() does not remount this component.
  const refreshed = useRef(false);
  const wasRefreshing = useRef(false);
  const lastOutcome = useRef<OpenOutcome | null>(null);

  const attempt = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: "loading" });
    // DAN-331: the only caller that may make the work (F-137); DAN-330 moves it to the click.
    const outcome = await openWork(assignmentId, fetch, { start: true });
    inFlight.current = false;
    lastOutcome.current = outcome;
    const step = openWorkStep(outcome, refreshed.current, navigator.onLine);
    if (step.kind === "refresh") {
      refreshed.current = true;
      startRefresh(() => router.refresh());
      return;
    }
    setPhase(step);
  }, [assignmentId, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void attempt();
  }, [attempt]);

  // The refresh has finished and this component is still on the page: the
  // server render is still `opening`. That is the `opened` answer a second
  // time, which openWorkStep turns into an error instead of a loop.
  useEffect(() => {
    if (wasRefreshing.current && !refreshing && refreshed.current && lastOutcome.current) {
      const step = openWorkStep(lastOutcome.current, true, navigator.onLine);
      if (step.kind !== "refresh") setPhase(step);
    }
    wasRefreshing.current = refreshing;
  }, [refreshing]);

  // Without a network the first opening waits for it and then goes on by itself.
  useEffect(() => {
    if (phase.kind !== "offline") return;
    const online = () => { void attempt(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [phase.kind, attempt]);

  const retry = useCallback(() => {
    // A new attempt by hand may refresh once again; nothing repeats by itself.
    refreshed.current = false;
    void attempt();
  }, [attempt]);

  return (
    <OpenWorkView
      phase={phase}
      assignmentId={assignmentId}
      onRetry={retry}
      onReload={() => window.location.reload()}
    />
  );
}
