"use client";

/**
 * Revision requests on the student's /rad, beside the comments (DAN-314,
 * reference N-08). The list comes from `list` of the revision request route;
 * the student answers the current version "done" or declines with a reason
 * through `respond`, on the revision `openWork` reads at that moment. The
 * answer is sent once: a changed request is shown as it is now, never sent
 * again (revision-requests.ts). The view is in revision-view.ts. While the
 * text holds changes the server has not confirmed, the buttons wait and say
 * why, since the answer would name a revision without them (DAN-314).
 *
 * Session: like CommentPanel (F-088, F-093), the panel starts from nothing
 * under another session, hears the end of the session itself and drops any
 * answer that lands after it, with every typed explanation.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { openWork } from "@/client/evidence-ingest";
import { listRevisionRequests, respondRevisionRequest, type RevisionListOutcome } from "@/client/revision-requests";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import type { RevisionKind } from "@/domain/collaboration/revision-input";
import { formatDateHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { useLocalSignedOut, useLocalSubmitted, useLocalUnconfirmed } from "./LocalDocument";
import {
  RevisionList, clearSent, isLive, revisionFromOpen, sendAnswer, type AnswerError, type ListStatus,
} from "./revision-view";

const t = messagesHr.revisions;

function without<T>(all: Readonly<Record<string, T>>, id: string): Record<string, T> {
  const rest = { ...all };
  delete rest[id];
  return rest;
}

export default function RevisionPanel({ documentId, assignmentId, session = null }: {
  documentId: string; assignmentId: string; session?: SessionMark | null;
}) {
  return <SessionRevisionPanel key={session?.tag ?? ""} documentId={documentId} assignmentId={assignmentId} session={session} />;
}

function SessionRevisionPanel({ documentId, assignmentId, session }: {
  documentId: string; assignmentId: string; session: SessionMark | null;
}) {
  const [sessionEnded, setSessionEnded] = useState(false);
  const stopped = useLocalSignedOut() || sessionEnded;
  const submitted = useLocalSubmitted();
  // The answer names the server's current revision: changes still on the device wait first (DAN-314).
  const { unconfirmed, now: unconfirmedNow, edits } = useLocalUnconfirmed();
  const [outcome, setOutcome] = useState<RevisionListOutcome | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, AnswerError>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [live, setLive] = useState("");
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
  // Before the load: an unmounted panel answers nothing, and what was on its way is dropped.
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
    // Asked again once the answer is here: the session may have ended while
    // it was on the way, in a tab whose end only the cookie tells (#1858).
    if (mine !== generation.current || !current()) return;
    setOutcome(result);
  }, [documentId, current]);
  useEffect(() => { void load(); }, [load]);

  // The session ended: forget the requests and every typed explanation in the
  // render that first sees it; the refs right after its commit.
  const [wasStopped, setWasStopped] = useState(stopped);
  if (stopped !== wasStopped) {
    setWasStopped(stopped);
    if (stopped) {
      setOutcome(null);
      setDrafts({});
      setErrors({});
      setLive("");
    }
  }
  useEffect(() => {
    if (!stopped) return;
    stoppedRef.current = true;
    generation.current += 1;
  }, [stopped]);

  const requests = !stopped && outcome?.kind === "ok" ? outcome.requests : [];
  const status: ListStatus = stopped ? "signedOut" : outcome === null ? "loading" : outcome.kind;

  const answer = async (id: string, kind: RevisionKind) => {
    const request = requests.find((r) => r.id === id);
    // An unconfirmed text is refused by sendAnswer itself, so the student is told why.
    if (!request || sending !== null) return;
    setSending(id);
    setLive("");
    const mine = generation.current;
    const sent = drafts[id] ?? "";
    const result = await sendAnswer(request, kind, sent, {
      respond: respondRevisionRequest,
      revision: async () => revisionFromOpen(await openWork(assignmentId)),
      current,
      unconfirmed: unconfirmedNow,
      edits,
    });
    setSending(null);
    if (stoppedRef.current || mine !== generation.current) return;
    if (result.kind === "sent") {
      setDrafts((all) => clearSent(all, id, sent));
      setErrors((all) => without(all, id));
      setLive(t.sent);
      void load();
      return;
    }
    // The typed explanation stays; a changed request is read again, not answered again.
    setErrors((all) => ({ ...all, [id]: result.error }));
    if (result.reload) void load();
  };

  return (
    <RevisionList
      t={t} formatDate={formatDateHr} status={status} requests={requests} submitted={submitted} unconfirmed={unconfirmed}
      drafts={drafts} sending={sending} errors={errors} live={live}
      onDraft={(id, value) => setDrafts((all) => ({ ...all, [id]: value }))}
      onAnswer={(id, kind) => void answer(id, kind)}
      onRetry={() => void load()}
    />
  );
}
