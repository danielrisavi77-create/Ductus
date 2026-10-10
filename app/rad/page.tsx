import WorkspaceShell, { RailSection } from "@/components/shell/WorkspaceShell";
import { wordsHr } from "@/lib/i18n/hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

export const metadata = {
  title: `${t.workspace.title} · ${t.app.name}`,
};

/**
 * The empty writing workspace. F-8 mounts the editor, the save state and the
 * side panel tabs into these slots; until then the shell shows its empty
 * states.
 */
export default function WorkspacePage() {
  return (
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
      status={<span>{wordsHr(0)}</span>}
    >
      <div className="sheet-area">
        <article className="sheet">
          <h1 className="manuscript manuscript__title">{t.workspace.documentUntitled}</h1>
          {/* Not editable until F-8 mounts the editor; it says so instead of inviting typing. */}
          <div
            className="manuscript"
            role="textbox"
            aria-multiline="true"
            aria-disabled="true"
            aria-label={t.workspace.documentLabel}
          >
            <p className="manuscript__placeholder">
              {t.workspace.documentPlaceholder} <span className="soon">{t.workspace.soon}</span>
            </p>
          </div>
        </article>
      </div>
    </WorkspaceShell>
  );
}
