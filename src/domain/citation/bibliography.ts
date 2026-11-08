import type { CanonicalDocumentV2, CitationNode, DocumentSource, SourceId } from "../document/schema";
import { assignYearSuffixes, formatBibliographyEntry, formatCitationInText, sortBibliography } from "./format";
import type { CitationStyle } from "./style";
import type { Source } from "./types";

/** One entry: the cited source with its derived year suffix, and its text in the style. */
export type BibliographyEntry = { sourceId: SourceId; source: Source; text: string };

/**
 * The bibliography of a document v2 (contract document-schema-v2 §4). It is
 * never stored; it is derived from `nodes` and `sources` each time.
 */
export type Bibliography = {
  entries: BibliographyEntry[];
  /** Citations whose source is not in `sources`: no entry, a visible count (§3.3). */
  orphanCitations: number;
};

type Keyed = Source & { readonly sourceId: SourceId };

function compareIds(a: Keyed, b: Keyed): number {
  return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
}

function withoutId(source: DocumentSource): Source {
  const rest: Partial<DocumentSource> = { ...source };
  delete rest.id;
  return rest as Source;
}

/**
 * Derives the bibliography: every source cited at least once, once, with the
 * suffixes of `assignYearSuffixes`, in the order of `sortBibliography`.
 * Sources without a citation are left out. Pure and total for every document
 * the v2 validator accepts; the input is never mutated.
 *
 * Both helpers are stable, so ties (titles equal under collation, identical
 * records) would follow the order of `sources`. The cited sources are first
 * ordered by `id`, which is unique, so the result does not depend on that
 * order (§10 (e)).
 */
export function deriveBibliography(document: CanonicalDocumentV2, style: CitationStyle): Bibliography {
  const byId = new Map(document.sources.map((source) => [source.id, source]));
  const cited = new Map<SourceId, Keyed>();
  let orphanCitations = 0;
  for (const node of document.nodes) {
    for (const child of node.children) {
      if (child.type !== "citation") continue;
      const source = byId.get(child.sourceId);
      if (source === undefined) orphanCitations++;
      else if (!cited.has(source.id)) cited.set(source.id, { ...withoutId(source), sourceId: source.id });
    }
  }
  const ordered = sortBibliography(assignYearSuffixes([...cited.values()].sort(compareIds)));
  const entries = ordered.map(({ sourceId, ...rest }) => {
    const source = rest as Source;
    return { sourceId, source, text: formatBibliographyEntry(source, style) };
  });
  return { entries, orphanCitations };
}

/**
 * The in-text citation as shown, with the year suffix from `bibliography`
 * and the locator as `formatCitationInText` shows it. `undefined` for a
 * citation whose source is not in the bibliography (an orphan).
 */
export function formatCitation(citation: CitationNode, bibliography: Bibliography, style: CitationStyle): string | undefined {
  const entry = bibliography.entries.find((e) => e.sourceId === citation.sourceId);
  return entry === undefined ? undefined : formatCitationInText(entry.source, style, citation.locator);
}
