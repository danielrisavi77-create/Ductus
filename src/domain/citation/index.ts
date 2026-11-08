export { deriveBibliography, formatCitation, type Bibliography, type BibliographyEntry } from "./bibliography";
export {
  assignYearSuffixes,
  formatBibliographyEntry,
  formatCitationInText,
  formatInText,
  normalizePages,
  sortBibliography,
} from "./format";
export { CitationStyleError, parseCitationStyle, type CitationStyle } from "./style";
export * from "./types";

// A style comes from the record of an institution (src/domain/institution-config,
// M2.12-P02), never from a default here.
