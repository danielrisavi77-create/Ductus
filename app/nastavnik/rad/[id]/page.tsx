import { cookies } from "next/headers";

import AppHeader from "@/components/shell/AppHeader";
import SessionObserver from "@/components/shell/SessionObserver";
import LiveWorkView from "@/components/teacher/LiveWorkView";
import { isDocumentId } from "@/domain/collaboration";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { sessionPrincipal, sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.liveView.context} · ${t.app.name}` };

/**
 * The teacher's live view of one work (DAN-86 step 2b). Who may read the
 * text is decided by the live route and its RPC on every request (BACKEND
 * 4.12 t. 4); this page only checks that someone is signed in, so a person
 * without a session is offered sign-in instead of a view that cannot load.
 * The page renders no text of the work on the server (4.12, attack 24).
 */
export default async function LiveWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const at = Date.now();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const tag = sessionTag(token);
  const principal = await sessionPrincipal(token, withActor);
  const session = principal.kind === "signed-in" && tag !== null ? { tag, at } : null;
  const returnTo = `/nastavnik/rad/${encodeURIComponent(id)}`;

  let body;
  if (!isDocumentId(id)) {
    body = <p role="status">{t.liveView.invalid}</p>;
  } else if (session === null) {
    body = (
      <>
        <p role="status">{t.liveView.signInFirst}</p>
        {/* The login route answers with a redirect: a plain link, never a prefetched one. */}
        <p><a href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>{t.liveView.signIn}</a></p>
      </>
    );
  } else {
    body = <LiveWorkView documentId={id} session={session} />;
  }

  return (
    <>
      <SessionObserver tag={tag} at={at} />
      <AppHeader context={t.liveView.context} />
      <main id="sadrzaj" tabIndex={-1} className="page">
        <h1 className="visually-hidden">{t.liveView.context}</h1>
        {body}
      </main>
    </>
  );
}
