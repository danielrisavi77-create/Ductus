/**
 * Interface language (D-70, F-06): the language of the screen a person reads.
 *
 * It is a preference of the viewer and nothing else. The language a work is
 * written in is a separate value of the work (F-06, model in M2); neither is
 * read from the other, and nothing here maps one to the other.
 *
 * Croatian is the default; English (`messages.en.ts`) is the second. A
 * catalogue is registered here once it fills every key of the Croatian one
 * (`parity.ts`), and only then can a stored value pick it. Text checks:
 * `scripts/forbidden-terms/` reads every file in this folder.
 */
import { messagesEn } from "./messages.en";
import { messagesHr, type Messages } from "./messages.hr";

const CATALOGUES = { hr: messagesHr, en: messagesEn } as const satisfies Readonly<Record<string, Messages>>;

export type InterfaceLocale = keyof typeof CATALOGUES;

export const DEFAULT_INTERFACE_LOCALE: InterfaceLocale = "hr";

export const INTERFACE_LOCALES = Object.freeze(Object.keys(CATALOGUES) as InterfaceLocale[]);

/** Longest value read as a tag; a stored preference is a short tag, not a header. */
const MAX_TAG_LENGTH = 35;

/**
 * A well-formed BCP 47 language tag in ASCII (RFC 5646 2.1, `langtag`): a
 * language of two to eight letters, extended language (only after a language
 * of two or three letters), script, region, variants, extensions and private
 * use, each in its place and of its length. A singleton ("u", "x") needs at
 * least one subtag after it. Duplicate variants or singletons are not looked
 * for (that is validity, 2.2.9, not form).
 */
const TAG = new RegExp(
  [
    "^(?:([A-Za-z]{2,3})(?:-[A-Za-z]{3}){0,3}|([A-Za-z]{4,8}))",
    "(?:-[A-Za-z]{4})?",
    "(?:-(?:[A-Za-z]{2}|[0-9]{3}))?",
    "(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*",
    "(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*",
    "(?:-[Xx](?:-[A-Za-z0-9]{1,8})+)?$",
  ].join(""),
);

function isInterfaceLocale(value: string): value is InterfaceLocale {
  return Object.hasOwn(CATALOGUES, value);
}

/**
 * The language of one tag ("hr", "HR", "hr-HR" give "hr"), in lower case, or
 * undefined. The region and script are dropped. Anything that is not one tag
 * (another type, padding, a list such as an Accept-Language header, look-alike
 * letters) gives undefined; nothing is normalised first, so only ASCII letters
 * match. Whether the language has a catalogue is not checked here.
 */
export function languageOfTag(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_TAG_LENGTH) return undefined;
  const match = TAG.exec(value);
  return (match?.[1] ?? match?.[2])?.toLowerCase();
}

/**
 * The interface language a stored or requested value names, or the default.
 * It never throws: a value that is not one tag, or names a language without a
 * catalogue, gives the default.
 */
export function parseInterfaceLocale(value: unknown): InterfaceLocale {
  const language = languageOfTag(value);
  return language !== undefined && isInterfaceLocale(language) ? language : DEFAULT_INTERFACE_LOCALE;
}

/** The catalogue of an interface language. */
export function messagesFor(locale: InterfaceLocale): Messages {
  return CATALOGUES[locale];
}
