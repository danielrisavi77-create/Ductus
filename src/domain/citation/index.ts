import fpzgCitationConfig from "../../../config/faculties/fpzg/citation.json";

import { parseCitationStyle, type CitationStyle } from "./style";

export {
  assignYearSuffixes,
  formatBibliographyEntry,
  formatInText,
  normalizePages,
  sortBibliography,
} from "./format";
export { CitationStyleError, parseCitationStyle, type CitationStyle } from "./style";
export * from "./types";

/** FPZG style copied from Lekta for the demo (D-83); replaced by the Lekta package in M4. */
export const fpzgCitationStyle: CitationStyle = parseCitationStyle(fpzgCitationConfig);
