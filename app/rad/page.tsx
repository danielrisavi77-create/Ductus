import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import CommentPanel from "@/components/editor/CommentPanel";
import EditorToolbar from "@/components/editor/EditorToolbar";
import HeadingOutline from "@/components/editor/HeadingOutline";
import { OfflineBanner, OfflineChip } from "@/components/editor/OfflineNotice";
import {
  LocalDocumentProvider, LocalEditor, LocalLogout, LocalSaveChip,
} from "@/components/editor/LocalDocument";
import { showsInventedPanels } from "@/components/editor/demo-panels";
import { InstructionsPanel, WorkPanel } from "@/components/editor/SidePanels";
import { LocalStatusLength } from "@/components/editor/StatusLength";
import AppShell from "@/components/shell/AppShell";
import PanelTabs from "@/components/shell/PanelTabs";
import SheetFrame from "@/components/shell/SheetFrame";
import { readShellRole } from "@/components/shell/shell-role";
import WorkspaceShell, { RailSection } from "@/components/shell/WorkspaceShell";
import { assignmentParam, readWorkContext } from "@/components/student/work-context-read";
import { DEMO_WORK } from "@/lib/i18n/demo-work.hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import {
  LOCAL_DEMO_DOCUMENT_ID, LocalScopeConfigError, localScopeConfigFromEnv, resolveLocalScope,
} from "@/lib/journal/local-scope";
import { sessionPrincipal, sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const metadata = {
  title: `${t.workspace.title} · ${t.app.name}`,
};

// The demo journal flag is read when the request arrives, never baked into
// the build: one build serves CI, the demo and a deployment without it.
export const dynamic = "force-dynamic";

/** `/rad`, or `/rad?zadatak=<id>` for a well-formed assignment id. */
function radPath(assignmentId: string | null): string {
  return assignmentId ? `/rad?zadatak=${assignmentId}` : "/rad";
}

/**
 * The local journal scope, or null. A refused configuration fails closed: the
 * sheet stays the neutral read-only placeholder, and the reason goes to the
 * server log only (#197 attack 12).
 */
function localScope(): string | null {
  try {
    return resolveLocalScope(localScopeConfigFromEnv());
  } catch (error) {
    if (!(error instanceof LocalScopeConfigError)) throw error;
    console.error(`local demo journal refused: ${error.message}`);
    return null;
  }
}

/**
 * The journal this request may open (F-5, plan #376). A signed-in person
 * journals under their own scope, checked by the database on every request;
 * a cookie that cannot be checked, or whose session has closed or expired,
 * opens no journal at all and offers to sign in again. Only without any
 * session cookie does the local demo journal remain, and it shows no one as
 * signed in. `tag` and `at` name the cookie and the server time of this
 * render for the tabs of the browser (D-118, src/client/session-marks.ts).
 */
async function journalFor(token: string | undefined): Promise<{
  scope: string | null; signedIn: boolean; signInAgain: boolean; tag: string | null; at: number;
}> {
  const at = Date.now();
  const tag = sessionTag(token);
  const principal = await sessionPrincipal(token, withActor);
  if (principal.kind === "signed-in") return { scope: principal.scope, signedIn: true, signInAgain: false, tag, at };
  if (token !== undefined) return { scope: null, signedIn: false, signInAgain: true, tag, at };
  return { scope: localScope(), signedIn: false, signInAgain: false, tag, at };
}

/**
 * The writing workspace. With a journal, the sheet is the editor and the
 * status bar shows the save state (F-3 step 1b); without one the shell shows
 * its empty states and a sheet that says it cannot be written in. With a
 * journal, the toolbar sits above the sheet and the structure rail lists the
 * headings of the text (F-8 step 1). Without a network the banner and the
 * status bar say so (F-8, DAN-211). A signed-in student sees the teacher's
 * comments in the side panel (F-9 step 1). The top bar names the course and
 * the assignment, and Upute shows its notice, only from an RLS read of the
 * assignment in `?zadatak=` that the student may see and whose current
 * notice they acknowledged (#476 contract 6280487079); without the
 * acknowledgment the page sends them to the notice (PRODUCT §5 rule 6);
 * otherwise neither is shown, never an invented value. The
 * status bar shows the length and any limits of the acknowledged current
 * assignment version (DAN-225/229). Only with that acknowledgment does the
 * tab publish the live view (B-LIVE step 4, F-121). Only the local demo
 * journal without a session shows invented Rad stages of the real shape; a
 * signed-in person sees the empty state until its read exists (FE-D9, #476,
 * F-110 t.1). The shell marks the session for the other tabs (F-113 t.1).
 * Signing out
 * always ends the session (D-118, `LocalLogout`).
 */
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const assignmentId = assignmentParam((await searchParams).zadatak);
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [{ scope, signedIn, signInAgain, tag, at }, read, role] = await Promise.all([
    journalFor(token),
    readWorkContext(token, assignmentId, withActor),
    readShellRole(token, withActor),
  ]);
  // PRODUCT §5 rule 6: an assignment whose current notice is not acknowledged
  // opens on its notice, never on the workspace.
  if (read.kind === "noticeFirst" && assignmentId) redirect(`/zadatak/${assignmentId}`);
  const work = read.kind === "ready" ? read : null;
  const session = signedIn && tag !== null ? { tag, at } : null;
  const invented = showsInventedPanels({ scope, signedIn });
  // In the shell's account place: signing out always goes through LocalLogout
  // here, which knows what the device still holds (D-118, I5).
  const account = scope && signedIn ? <LocalLogout /> : signInAgain ? (
    // A plain link: the login route answers with a redirect, not a page.
    <a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent(radPath(assignmentId))}`}>{t.auth.signIn}</a>
  ) : undefined;
  const workspace = (
    <AppShell session={{ tag, at }} role={signedIn ? role : null} current="/rad" crumbs={[t.workspace.title]} account={account} ownMain>
      <WorkspaceShell
        writingHref={radPath(assignmentId)}
        context={work ? `${work.course} / ${work.notice.title}` : null}
        banner={scope ? <OfflineBanner /> : null}
        rail={
          <>
            <RailSection title={t.workspace.structure}>
              {scope ? <HeadingOutline /> : <p className="rail-empty">{t.workspace.structureEmpty}</p>}
            </RailSection>
            <RailSection title={t.workspace.tables}>
              <p className="rail-empty">{t.workspace.tablesEmpty}</p>
            </RailSection>
            <RailSection title={t.workspace.footnotes}>
              <p className="rail-empty">{t.workspace.footnotesEmpty}</p>
            </RailSection>
          </>
        }
        panel={
          <PanelTabs
            label={t.workspace.panelTabs}
            initial="comments"
            tabs={[
              { id: "sources", label: t.workspace.tabSources, content: <p className="rail-empty">{t.workspace.sourcesEmpty}</p> },
              {
                id: "instructions",
                label: t.workspace.tabInstructions,
                content: <InstructionsPanel load={work ? { kind: "ready", value: work.notice } : { kind: "empty" }} />,
              },
              {
                id: "comments",
                label: t.workspace.tabComments,
                content: scope && signedIn ? (
                  <CommentPanel documentId={LOCAL_DEMO_DOCUMENT_ID} session={session} />
                ) : (
                  <p className="rail-empty">{t.workspace.commentsEmpty}</p>
                ),
              },
              {
                id: "work",
                label: t.workspace.tabWork,
                content: <WorkPanel load={invented ? { kind: "ready", value: DEMO_WORK } : { kind: "empty" }} />,
              },
            ]}
          />
        }
        status={scope ? (
          <>
            <LocalSaveChip />
            <OfflineChip />
            <LocalStatusLength range={work?.wordRange ?? null} />
          </>
        ) : (
          <span>{t.workspace.statusNoJournal}</span>
        )}
      >
        {scope ? <EditorToolbar /> : null}
        <div className="sheet-area">
          <SheetFrame>
            <h1 className="manuscript manuscript__title">{t.workspace.documentUntitled}</h1>
            {scope ? (
              <LocalEditor />
            ) : (
              // Not editable: the text says so, matching aria-disabled.
              <div
                className="manuscript"
                role="textbox"
                aria-multiline="true"
                aria-disabled="true"
                aria-label={t.workspace.documentLabel}
              >
                <p className="manuscript__placeholder">
                  {t.workspace.documentNotEditable} <span className="soon">{t.workspace.soon}</span>
                </p>
              </div>
            )}
          </SheetFrame>
        </div>
      </WorkspaceShell>
    </AppShell>
  );
  return scope ? (
    <LocalDocumentProvider scope={scope} documentId={LOCAL_DEMO_DOCUMENT_ID} session={session}
      livePublish={work !== null}>
      {workspace}
    </LocalDocumentProvider>
  ) : workspace;
}
