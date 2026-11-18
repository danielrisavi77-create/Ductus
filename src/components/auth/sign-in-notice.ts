/**
 * S-01 states of /prijava (DAN-566 reference, `prijava.html` states 2 to 4):
 * why the last sign-in did not open the person's space. Chosen by the
 * `?stanje=` query of /prijava, which the login route is to set on its way
 * back (a later step); until then only a link with the query shows them.
 */
export type SignInNotice = "failed" | "unavailable" | "noRole";

/** The query of /prijava that picks the state. */
export const SIGN_IN_NOTICE_PARAM = "stanje";

/**
 * The closed list of query values. A refused sign-in and any other failure
 * read the same, as the login route cannot tell them apart
 * (src/server/auth/flow.ts); only an unanswering AAI@EduHr gets its own text.
 */
const NOTICES: ReadonlyMap<string, SignInNotice> = new Map([
  ["greska", "failed"],
  ["nedostupno", "unavailable"],
  ["bez-uloge", "noRole"],
]);

/**
 * The state of /prijava from its untrusted query value: a value of the list
 * exactly, otherwise null and the default sign-in. The raw value never
 * reaches the page; only one of the fixed states does.
 */
export function signInNotice(raw: unknown): SignInNotice | null {
  return typeof raw === "string" ? (NOTICES.get(raw) ?? null) : null;
}
