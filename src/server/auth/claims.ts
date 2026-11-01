/**
 * The identity a login yields (docs/BACKEND.md 4.3, D-73): the issuer and
 * hrEduPersonUniqueID, with the OIDC subject kept alongside, never e-mail or
 * OIB. The home organisation picks the institution in open_session.
 *
 * A refusal names the reason, never a value, so nothing the provider sent
 * reaches a log or a response.
 */
export interface LoginIdentity {
  subject: string;
  uniqueId: string;
  homeOrg: string;
  /**
   * Two separate attributes (#757, O1), never split from a display name. Present only when both are valid: a missing or invalid name
   * costs the name, never the login.
   */
  givenName?: string;
  familyName?: string;
}

export type ClaimsResult =
  | { ok: true; identity: LoginIdentity }
  | { ok: false; reason: "missing_claim" | "invalid_claim" | "subject_mismatch" };

// Same bound as the CHECK constraints of identity.user_account, counted in
// code points as PostgreSQL counts characters.
const MAX_CHARS = 255;
// Controls (NUL among them), separators and invisible format characters
// (zero-width, bidi overrides): no AAI identifier contains them, and they
// make two values that look equal differ. Lone surrogates are not text.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

type Claims = Readonly<Record<string, unknown>>;

type Checked = { value: string } | { error: "missing_claim" | "invalid_claim" };

function check(value: unknown): Checked {
  if (value === undefined || value === null) return { error: "missing_claim" };
  if (typeof value !== "string" || value === "" || UNSAFE.test(value)) return { error: "invalid_claim" };
  if ([...value].length > MAX_CHARS) return { error: "invalid_claim" };
  return { value };
}

/**
 * AAI@EduHr releases its special hrEdu claims as JSON arrays, also the
 * single-valued ones (Srce wiki, page 59867172); the local fake provider
 * sends strings. An array counts only with exactly one member, which must
 * itself pass `check`: of several values none is picked, and nothing is
 * coerced. An array that holds no value (`[]`, `[null]`) is invalid, never
 * missing, so it cannot read as an absent attribute.
 */
function checkSingleValued(value: unknown): Checked {
  if (!Array.isArray(value)) return check(value);
  if (value.length !== 1 || !Object.hasOwn(value, 0)) return { error: "invalid_claim" };
  const only = check(value[0]);
  return "error" in only ? { error: "invalid_claim" } : only;
}

// Which claim names AAI@EduHr OIDC uses for the two names is not yet
// confirmed (#757): the OIDC profile names or the LDAP attribute names. Each
// pair is taken whole, the OIDC one first, so a name never mixes the two.
const NAME_PAIRS = [
  ["given_name", "family_name"],
  ["givenName", "sn"],
] as const;

function nameFromClaims(claims: Claims): { givenName: string; familyName: string } | undefined {
  for (const [given, family] of NAME_PAIRS) {
    const givenName = check(claims[given]);
    const familyName = check(claims[family]);
    if ("value" in givenName && "value" in familyName) {
      return { givenName: givenName.value, familyName: familyName.value };
    }
  }
  return undefined;
}

/**
 * `idToken` holds the verified ID token claims. `userinfo`, when the provider
 * released attributes there, must name the same subject (OIDC Core 5.3.2);
 * its attributes take precedence over the ID token's.
 */
export function identityFromClaims(idToken: Claims, userinfo?: Claims): ClaimsResult {
  if (userinfo !== undefined && userinfo.sub !== idToken.sub) {
    return { ok: false, reason: "subject_mismatch" };
  }
  const merged = { ...idToken, ...userinfo };
  const subject = check(idToken.sub);
  // `sub` is a standard claim and stays a plain string (OIDC Core 2).
  const uniqueId = checkSingleValued(merged.hrEduPersonUniqueID);
  const homeOrg = checkSingleValued(merged.hrEduPersonHomeOrg);
  for (const c of [subject, uniqueId, homeOrg]) if ("error" in c && c.error === "missing_claim") return { ok: false, reason: c.error };
  if (!("value" in subject) || !("value" in uniqueId) || !("value" in homeOrg)) {
    return { ok: false, reason: "invalid_claim" };
  }
  const identity: LoginIdentity = { subject: subject.value, uniqueId: uniqueId.value, homeOrg: homeOrg.value };
  const names = nameFromClaims(merged);
  if (names) Object.assign(identity, names);
  return { ok: true, identity };
}
