/**
 * Interface language (D-70, F-06): the language of the screen a person reads.
 *
 * It is a preference of the viewer and nothing else. The language a work is
 * written in is a separate value of the work (F-06, model in M2); neither is
 * read from the other, and nothing here maps one to the other.
 *
 * Croatian is the default. A catalogue is registered here once it fills every
 * key of the Croatian one (`parity.ts`), and only then can a stored value pick
 * it. Text checks: `scripts/forbidden-terms/` reads every file in this folder.
 */
import { messagesHr, type Messages } from "./messages.hr";

const CATALOGUES = { hr: messagesHr } as const satisfies Readonly<Record<string, Messages>>;

export type InterfaceLocale = keyof typeof CATALOGUES;

export const DEFAULT_INTERFACE_LOCALE: InterfaceLocale = "hr";

export const INTERFACE_LOCALES = Object.freeze(Object.keys(CATALOGUES) as InterfaceLocale[]);

/** Longest value read as a tag; a stored preference is a short tag, not a header. */
const MAX_TAG_LENGTH = 35;

/** A BCP 47 language tag in ASCII: language, then subtags of up to eight letters or digits. */
const TAG = /^([A-Za-z]{2,3})(?:-[A-Za-z0-9]{1,8})*$/;

function isInterfaceLocale(value: string): value is InterfaceLocale {
  return Object.hasOwn(CATALOGUES, value);
}

/**
 * The interface language a stored or requested value names, or the default.
 *
 * Reads one tag ("hr", "HR", "hr-HR"); the region and script are dropped. It
 * never throws: anything else (another type, padding, a list such as an
 * Accept-Language header, look-alike letters, a language without a catalogue)
 * gives the default. Nothing is normalised first, so only ASCII letters match.
 */
export function parseInterfaceLocale(value: unknown): InterfaceLocale {
  if (typeof value !== "string" || value.length > MAX_TAG_LENGTH) return DEFAULT_INTERFACE_LOCALE;
  const language = TAG.exec(value)?.[1]?.toLowerCase();
  return language !== undefined && isInterfaceLocale(language) ? language : DEFAULT_INTERFACE_LOCALE;
}

/** The catalogue of an interface language. */
export function messagesFor(locale: InterfaceLocale): Messages {
  return CATALOGUES[locale];
}
