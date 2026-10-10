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
  const uniqueId = check(merged.hrEduPersonUniqueID);
  const homeOrg = check(merged.hrEduPersonHomeOrg);
  for (const c of [subject, uniqueId, homeOrg]) if ("error" in c && c.error === "missing_claim") return { ok: false, reason: c.error };
  if (!("value" in subject) || !("value" in uniqueId) || !("value" in homeOrg)) {
    return { ok: false, reason: "invalid_claim" };
  }
  return { ok: true, identity: { subject: subject.value, uniqueId: uniqueId.value, homeOrg: homeOrg.value } };
}
