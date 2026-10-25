import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import CommentPanel from "@/components/editor/CommentPanel";
import EarlierDraft from "@/components/editor/EarlierDraft";
import EditorToolbar from "@/components/editor/EditorToolbar";
import HeadingOutline from "@/components/editor/HeadingOutline";
import { OfflineBanner, OfflineChip } from "@/components/editor/OfflineNotice";
import OpenWork from "@/components/editor/OpenWork";
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
import { sheetTitle } from "@/components/student/sheet-title";
import { teacherViewMode } from "@/components/student/teacher-view";
import TeacherViewSheet from "@/components/student/TeacherViewSheet";
import { assignmentParam, readWorkContext, type WorkContextRead } from "@/components/student/work-context-read";
import { pastDue, workDocumentPlan } from "@/components/student/work-document-plan";
import { DEMO_WORK } from "@/lib/i18n/demo-work.hr";
import { formatDateTimeHr } from "@/lib/i18n/hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import {
  LocalScopeConfigError, localScopeConfigFromEnv, resolveLocalScope,
} from "@/lib/journal/local-scope";
import { sessionPrincipal, sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readWorkDocument } from "@/server/evidence/work-document-read";

export const metadata = {
  title: `${t.workspace.title} · ${t.app.name}`,
};

// The demo journal flag is read when the request arrives, never baked into
// the build: one build serves CI, the demo and a deployment without it.
export const dynamic = "force-dynamic";

/** The sheet heading of every plan without the student's own assignment. */
const NO_CONTEXT: WorkContextRead = { kind: "none" };

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
 * The writing workspace. Which document the sheet writes into is one plan of
 * `workDocumentPlan` (#711 F1, contract 6391402093 §2, §3, §5, §6 with the
 * amendment 6391779486): a signed-in student on `?zadatak=` writes into their
 * own work of that assignment, whose id comes only from the B1 read
 * (`readWorkDocument`); editor, comments and live view get that same id. A
 * work that does not exist yet is opened by `OpenWork` with one POST, never by
 * this GET. Without `?zadatak=` a signed-in person gets the free draft of
 * this device: no comments, no live view, no submission, nothing sent (P1).
 * Any other `?zadatak=` (foreign, unknown, malformed, a teacher, reads that
 * disagree) is one neutral read-only sheet with no id at all. Without a
 * session cookie the local demo journal stays as before (A18).
 *
 * With a journal the sheet is the editor, the toolbar and the structure rail
 * follow it (F-8), and the status bar shows the save state of the device
 * (F-3); without a network the banner and the status bar say so (F-8,
 * DAN-211). The top bar names the course and the assignment, and Upute shows
 * its notice, only from the RLS read of an acknowledged assignment of this
 * student (#476 contract 6280487079); without the acknowledgment the page
 * sends them to the notice (PRODUCT §5 rule 6). Past the due date the editor
 * stays writable and a note says the submission will be marked late (P3).
 * Only the local demo journal without a session shows invented Rad stages
 * (FE-D9, F-110 t.1). The shell marks the session for the other tabs (F-113
 * t.1). Signing out always ends the session (D-118, `LocalLogout`).
 */
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { zadatak: rawParam, prikaz } = await searchParams;
  const assignmentId = assignmentParam(rawParam);
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [{ scope, signedIn, signInAgain, tag, at }, read, role, doc] = await Promise.all([
    journalFor(token),
    readWorkContext(token, assignmentId, withActor),
    readShellRole(token, withActor),
    readWorkDocument(token, assignmentId, withActor),
  ]);
  // PRODUCT §5 rule 6: an assignment whose current notice is not acknowledged
  // opens on its notice, never on the workspace.
  if (read.kind === "noticeFirst" && assignmentId) redirect(`/zadatak/${assignmentId}`);
  const plan = workDocumentPlan({ rawParam, assignmentId, signedIn, signInAgain, scope, context: read, doc });
  const journal = plan.journal;
  const view = teacherViewMode(plan, prikaz);
  // Course, title and Upute only for the student's own acknowledged assignment.
  const ownsAssignment = plan.kind === "assignment" || plan.kind === "opening" || plan.kind === "notYetOpen";
  const work = ownsAssignment && read.kind === "ready" ? read : null;
  const session = signedIn && tag !== null ? { tag, at } : null;
  const invented = showsInventedPanels({ scope: journal?.scope ?? null, signedIn });
  const late = plan.kind === "assignment" && pastDue(plan.dueAt, at);
  // In the shell's account place: signing out goes through LocalLogout where
  // a journal is open, which knows what the device still holds (D-118, I5).
  const account = journal && signedIn ? <LocalLogout /> : signInAgain ? (
    // A plain link: the login route answers with a redirect, not a page.
    <a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent(radPath(assignmentId))}`}>{t.auth.signIn}</a>
  ) : undefined;
  const heading = <h1 className="manuscript manuscript__title">{sheetTitle(work ?? NO_CONTEXT, t.workspace.documentUntitled)}</h1>;
  const workspace = (
    <AppShell session={{ tag, at }} role={signedIn ? role : null} scope={signedIn ? scope : null} current="/rad" crumbs={[t.workspace.title]} account={account} ownMain>
      <WorkspaceShell
        mode={view.mode}
        writingHref={radPath(assignmentId)}
        teacherViewHref={view.teacherViewHref}
        context={work ? `${work.course} / ${work.notice.title}` : null}
        barExtra={plan.submission ? (
          // F-10 (#653 contract 6385776645): a plain link; the submission page
          // reads the server's text and sends nothing itself.
          <a className="btn" href={`/rad/${encodeURIComponent(plan.assignmentId)}/predaja`}>{t.workspace.submitLink}</a>
        ) : null}
        banner={journal ? <OfflineBanner /> : null}
        rail={
          <>
            <RailSection title={t.workspace.structure}>
              {journal ? <HeadingOutline /> : <p className="rail-empty">{t.workspace.structureEmpty}</p>}
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
                content: plan.comments ? (
                  <CommentPanel documentId={plan.journal.documentId} session={session} />
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
        status={journal ? (
          <>
            <LocalSaveChip />
            <OfflineChip />
            <LocalStatusLength range={plan.kind === "assignment" ? work?.wordRange ?? null : null} />
          </>
        ) : (
          <span>{t.workspace.statusNoJournal}</span>
        )}
        teacherView={plan.kind === "assignment" ? (
          <TeacherViewSheet documentId={plan.journal.documentId} session={session} heading={heading} />
        ) : null}
      >
        {journal ? <EditorToolbar /> : null}
        <div className="sheet-area">
          {late ? <p className="sheet-notice" role="note">{t.workspace.lateNote}</p> : null}
          {/* F1b (§4): the free draft of this device, offered only to read and copy. */}
          {plan.kind === "assignment" ? <EarlierDraft scope={plan.journal.scope} /> : null}
          <SheetFrame>
            {heading}
            {plan.kind === "free" ? <p className="sheet-note">{t.workspace.freeNote}</p> : null}
            {journal ? (
              <LocalEditor />
            ) : plan.kind === "opening" ? (
              <OpenWork assignmentId={plan.assignmentId} />
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
                  {plan.kind === "unavailable" ? t.workspace.unavailable
                    : plan.kind === "notYetOpen" ? t.workspace.openNotYet.replace("{time}", formatDateTimeHr(plan.opensAt))
                    : <>{t.workspace.documentNotEditable} <span className="soon">{t.workspace.soon}</span></>}
                </p>
              </div>
            )}
          </SheetFrame>
        </div>
      </WorkspaceShell>
    </AppShell>
  );
  // A new document id mounts a new editor: nothing of X (text, undo) reaches Y (A8).
  return journal ? (
    <LocalDocumentProvider key={journal.documentId} scope={journal.scope} documentId={journal.documentId}
      session={session} livePublish={plan.live}>
      {workspace}
    </LocalDocumentProvider>
  ) : workspace;
}
