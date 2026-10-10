import { LocalDocumentProvider, LocalEditor, LocalStatus } from "@/components/editor/LocalDocument";
import WorkspaceShell, { RailSection } from "@/components/shell/WorkspaceShell";
import { wordsHr } from "@/lib/i18n/hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import {
  LOCAL_DEMO_DOCUMENT_ID, LocalScopeConfigError, localScopeConfigFromEnv, resolveLocalScope,
} from "@/lib/journal/local-scope";

export const metadata = {
  title: `${t.workspace.title} · ${t.app.name}`,
};

// The demo journal flag is read when the request arrives, never baked into
// the build: one build serves CI, the demo and a deployment without it.
export const dynamic = "force-dynamic";

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
 * The writing workspace. With the local demo journal on, the sheet is the
 * editor and the status bar shows the save state (F-3 step 1b); without it the
 * shell shows its empty states and a sheet that says it cannot be written in.
 */
export default function WorkspacePage() {
  const scope = localScope();
  const workspace = (
    <WorkspaceShell
      writingHref="/rad"
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
      status={scope ? <LocalStatus /> : <span>{wordsHr(0)}</span>}
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
