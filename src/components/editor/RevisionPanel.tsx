"use client";

/**
 * Revision requests on the student's /rad, beside the comments (DAN-314,
 * reference N-08). The list comes from `list` of the revision request route;
 * the student answers the current version "done" or declines with a reason
 * through `respond`, on the revision `openWork` reads at that moment. The
 * answer is sent once: a changed request is shown as it is now, never sent
 * again (revision-requests.ts). The view is in revision-view.ts.
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

import { useLocalSignedOut, useLocalSubmitted } from "./LocalDocument";
import { RevisionList, revisionFromOpen, sendAnswer, type AnswerError, type ListStatus } from "./revision-view";

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
  const [outcome, setOutcome] = useState<RevisionListOutcome | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, AnswerError>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const generation = useRef(0);
  const stoppedRef = useRef(false);
  const watchRef = useRef<SessionWatch | null>(null);
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
  const current = useCallback(() => !stoppedRef.current && !(watchRef.current?.ended() ?? false), []);

  const load = useCallback(async () => {
    if (!current()) return;
    const mine = ++generation.current;
    const result = await listRevisionRequests(documentId, current);
    if (mine !== generation.current || stoppedRef.current) return;
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
    if (!request || sending !== null) return;
    setSending(id);
    setLive("");
    const mine = generation.current;
    const result = await sendAnswer(request, kind, drafts[id] ?? "", {
      respond: respondRevisionRequest,
      revision: async () => revisionFromOpen(await openWork(assignmentId)),
      current,
    });
    setSending(null);
    if (stoppedRef.current || mine !== generation.current) return;
    if (result.kind === "sent") {
      setDrafts((all) => without(all, id));
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
      t={t} formatDate={formatDateHr} status={status} requests={requests} submitted={submitted}
      drafts={drafts} sending={sending} errors={errors} live={live}
      onDraft={(id, value) => setDrafts((all) => ({ ...all, [id]: value }))}
      onAnswer={(id, kind) => void answer(id, kind)}
      onRetry={() => void load()}
    />
  );
}
