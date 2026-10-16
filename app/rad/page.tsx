import { cookies } from "next/headers";

import {
  LocalDocumentProvider, LocalEditor, LocalLogout, LocalSaveChip, LocalWordCount,
} from "@/components/editor/LocalDocument";
import WorkspaceShell, { RailSection } from "@/components/shell/WorkspaceShell";
import { wordsHr } from "@/lib/i18n/hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import {
  LOCAL_DEMO_DOCUMENT_ID, LocalScopeConfigError, localScopeConfigFromEnv, resolveLocalScope,
} from "@/lib/journal/local-scope";
import { sessionPrincipal } from "@/server/auth/principal";
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
 * signed in.
 */
async function journalFor(): Promise<{ scope: string | null; signedIn: boolean; signInAgain: boolean }> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const principal = await sessionPrincipal(token, withActor);
  if (principal.kind === "signed-in") return { scope: principal.scope, signedIn: true, signInAgain: false };
  if (token !== undefined) return { scope: null, signedIn: false, signInAgain: true };
  return { scope: localScope(), signedIn: false, signInAgain: false };
}

/**
 * The writing workspace. With a journal, the sheet is the editor and the
 * status bar shows the save state (F-3 step 1b); without one the shell shows
 * its empty states and a sheet that says it cannot be written in. Signing out
 * goes through the journal first (`LocalLogout`).
 */
export default async function WorkspacePage() {
  const { scope, signedIn, signInAgain } = await journalFor();
  const workspace = (
    <WorkspaceShell
      writingHref="/rad"
      barExtra={scope && signedIn ? <LocalLogout /> : signInAgain ? (
        // A plain link: the login route answers with a redirect, not a page.
        <a className="btn" href={SIGN_IN_HREF}>{t.auth.signIn}</a>
      ) : null}
      rail={
        <>
          <RailSection title={t.workspace.structure}>
            <p className="rail-empty">{t.workspace.structureEmpty}</p>
          </RailSection>
          <RailSection title={t.workspace.tables}>
            <p className="rail-empty">{t.workspace.tablesEmpty}</p>
          </RailSection>
          <RailSection title={t.workspace.footnotes}>
            <p className="rail-empty">{t.workspace.footnotesEmpty}</p>
          </RailSection>
        </>
      }
      panel={<p className="rail-empty">{t.workspace.sidePanelEmpty}</p>}
      status={scope ? (
        <>
          <LocalSaveChip />
          <LocalWordCount />
        </>
      ) : (
        <span>{wordsHr(0)}</span>
      )}
    >
      <div className="sheet-area">
        <article className="sheet">
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
        </article>
      </div>
    </WorkspaceShell>
  );
  return scope ? (
    <LocalDocumentProvider scope={scope} documentId={LOCAL_DEMO_DOCUMENT_ID}>
      {workspace}
    </LocalDocumentProvider>
  ) : (
    workspace
  );
}
