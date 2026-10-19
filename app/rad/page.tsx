import { cookies } from "next/headers";

import CommentPanel from "@/components/editor/CommentPanel";
import EditorToolbar from "@/components/editor/EditorToolbar";
import HeadingOutline from "@/components/editor/HeadingOutline";
import { OfflineBanner, OfflineChip } from "@/components/editor/OfflineNotice";
import {
  LocalDocumentProvider, LocalEditor, LocalLogout, LocalSaveChip,
} from "@/components/editor/LocalDocument";
import { InstructionsPanel, WorkPanel } from "@/components/editor/SidePanels";
import { LocalStatusLength } from "@/components/editor/StatusLength";
import PanelTabs from "@/components/shell/PanelTabs";
import SessionObserver from "@/components/shell/SessionObserver";
import SheetFrame from "@/components/shell/SheetFrame";
import WorkspaceShell, { RailSection } from "@/components/shell/WorkspaceShell";
import { DEMO_WORK_CONTEXT } from "@/lib/i18n/demo-context.hr";
import { DEMO_ASSIGNMENT, DEMO_WORK } from "@/lib/i18n/demo-work.hr";
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

const SIGN_IN_HREF = `/api/auth/login?returnTo=${encodeURIComponent("/rad")}`;

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
async function journalFor(): Promise<{
  scope: string | null; signedIn: boolean; signInAgain: boolean; tag: string | null; at: number;
}> {
  const at = Date.now();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
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
 * the assignment and the status bar the length against its word range, from
 * invented demo data until /rad reads its assignment (FE-D6). With a journal,
 * Upute and Rad show invented data of the real shape until their reads exist
 * (FE-D9, #476). Signing out
 * always ends the session (D-118, `LocalLogout`).
 */
export default async function WorkspacePage() {
  const { scope, signedIn, signInAgain, tag, at } = await journalFor();
  const session = signedIn && tag !== null ? { tag, at } : null;
  const workspace = (
    <WorkspaceShell
      writingHref="/rad"
      context={scope ? `${DEMO_WORK_CONTEXT.course} / ${DEMO_WORK_CONTEXT.assignment}` : null}
      barExtra={scope && signedIn ? <LocalLogout /> : signInAgain ? (
        // A plain link: the login route answers with a redirect, not a page.
        <a className="btn" href={SIGN_IN_HREF}>{t.auth.signIn}</a>
      ) : null}
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
              content: <InstructionsPanel load={scope ? { kind: "ready", value: DEMO_ASSIGNMENT } : { kind: "empty" }} />,
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
              content: <WorkPanel load={scope ? { kind: "ready", value: DEMO_WORK } : { kind: "empty" }} />,
            },
          ]}
        />
      }
      status={scope ? (
        <>
          <LocalSaveChip />
          <OfflineChip />
          <LocalStatusLength range={DEMO_WORK_CONTEXT.words} />
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
  );
  return (
    <>
      <SessionObserver tag={tag} at={at} />
      {scope ? (
        <LocalDocumentProvider scope={scope} documentId={LOCAL_DEMO_DOCUMENT_ID} session={session}>
          {workspace}
        </LocalDocumentProvider>
      ) : workspace}
    </>
  );
}
