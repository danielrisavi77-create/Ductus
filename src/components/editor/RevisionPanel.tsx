"use client";

/**
 * Revision requests on the student's /rad, beside the comments (DAN-314,
 * reference N-08), read only. The list comes from `list` of the revision
 * request route; the view is in revision-view.ts.
 *
 * Session: like CommentPanel (F-088, F-093), the panel starts from nothing
 * under another session, hears the end of the session itself and drops any
 * list that lands after it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { listRevisionRequests, type RevisionListOutcome } from "@/client/revision-requests";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import { formatDateHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { useLocalSignedOut } from "./LocalDocument";
import { RevisionList, isLive, type ListStatus } from "./revision-view";

const t = messagesHr.revisions;

export default function RevisionPanel({ documentId, session = null }: {
  documentId: string; session?: SessionMark | null;
}) {
  return <SessionRevisionPanel key={session?.tag ?? ""} documentId={documentId} session={session} />;
}

function SessionRevisionPanel({ documentId, session }: { documentId: string; session: SessionMark | null }) {
  const [sessionEnded, setSessionEnded] = useState(false);
  const stopped = useLocalSignedOut() || sessionEnded;
  const [outcome, setOutcome] = useState<RevisionListOutcome | null>(null);
  const generation = useRef(0);
  const stoppedRef = useRef(false);
  const watchRef = useRef<SessionWatch | null>(null);
  const mountedRef = useRef(false);
  const tag = session?.tag ?? null;
  const at = session?.at ?? 0;
  useEffect(() => {
    const watch = watchSessionEnd(tag === null ? null : { tag, at }, () => setSessionEnded(true));
    watchRef.current = watch;
    return () => {
      watch.close();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [tag, at]);
  // Before the load: an unmounted panel shows nothing, and what was on its way is dropped.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generation.current += 1;
    };
  }, []);
  const current = useCallback(() => isLive({ mounted: mountedRef, stopped: stoppedRef, watch: watchRef }), []);

  const load = useCallback(async () => {
    if (!current()) return;
    const mine = ++generation.current;
    const result = await listRevisionRequests(documentId, current);
    if (mine !== generation.current || stoppedRef.current) return;
    setOutcome(result);
  }, [documentId, current]);
  useEffect(() => { void load(); }, [load]);

  // The session ended: forget the requests in the render that first sees it;
  // the refs right after its commit.
  const [wasStopped, setWasStopped] = useState(stopped);
  if (stopped !== wasStopped) {
    setWasStopped(stopped);
    if (stopped) setOutcome(null);
  }
  useEffect(() => {
    if (!stopped) return;
    stoppedRef.current = true;
    generation.current += 1;
  }, [stopped]);

  const requests = !stopped && outcome?.kind === "ok" ? outcome.requests : [];
  const status: ListStatus = stopped ? "signedOut" : outcome === null ? "loading" : outcome.kind;

  return (
    <RevisionList t={t} formatDate={formatDateHr} status={status} requests={requests} onRetry={() => void load()} />
  );
}
