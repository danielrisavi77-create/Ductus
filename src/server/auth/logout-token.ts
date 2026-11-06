/**
 * Verification of a back-channel `logout_token` (DAN-474, D-200 P4; OpenID
 * Connect Back-Channel Logout 1.0 §2.4 and §2.6). The route trusts nothing
 * but a token signed by the configured provider: no cookie, no origin, no
 * session the caller names. Every failure is one `LogoutTokenError` whose
 * code is safe to log; the token, `sub`, `sid` and `jti` never are.
 *
 * Only the pinned algorithm is accepted (`none` and HMAC never), and a key
 * is taken from the provider's JWKS alone.
 */
import { constants, verify, type KeyObject } from "node:crypto";

import type { IdTokenAlg } from "./config";

export const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
/** A token older than this (plus skew) is refused; the jti record lasts longer. */
export const MAX_TOKEN_AGE_SECONDS = 600;
/** A compact JWS larger than this is not a logout token. */
export const MAX_LOGOUT_TOKEN_CHARS = 8192;

export type LogoutTokenErrorCode =
  | "malformed"
  | "algorithm"
  | "key"
  | "signature"
  | "issuer"
  | "audience"
  | "iat"
  | "exp"
  | "nbf"
  | "events"
  | "subject"
  | "nonce"
  | "jti";

export class LogoutTokenError extends Error {
  constructor(readonly code: LogoutTokenErrorCode) {
    super(`logout token rejected: ${code}`);
    this.name = "LogoutTokenError";
  }
}

export interface VerifiedLogoutToken {
  sub: string | null;
  sid: string | null;
  jti: string;
}

/** Finds the provider key for a header; refreshes the JWKS at most rarely. */
export interface LogoutKeySource {
  key(kid: string | undefined, alg: IdTokenAlg): Promise<KeyObject | undefined>;
}

export interface LogoutTokenChecks {
  issuer: string;
  clientId: string;
  alg: IdTokenAlg;
  clockToleranceSeconds: number;
  /** Seconds since the epoch. */
  now: number;
}

type Json = Record<string, unknown>;

const B64URL = /^[A-Za-z0-9_-]*$/;
const MAX_CHARS = 255;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function decodeObject(part: string): Json {
  if (!B64URL.test(part) || part.length % 4 === 1) throw new LogoutTokenError("malformed");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new LogoutTokenError("malformed");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new LogoutTokenError("malformed");
  }
  return parsed as Json;
}

function plainString(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !UNSAFE.test(value) && [...value].length <= MAX_CHARS;
}

function verifySignature(alg: IdTokenAlg, key: KeyObject, input: Buffer, signature: Buffer): boolean {
  switch (alg) {
    case "RS256":
      return key.asymmetricKeyType === "rsa" && verify("sha256", input, key, signature);
    case "PS256":
      return (
        (key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "rsa-pss") &&
        verify("sha256", input, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature)
      );
    case "ES256":
      return (
        key.asymmetricKeyType === "ec" &&
        key.asymmetricKeyDetails?.namedCurve === "prime256v1" &&
        signature.length === 64 &&
        verify("sha256", input, { key, dsaEncoding: "ieee-p1363" }, signature)
      );
    case "EdDSA":
      return key.asymmetricKeyType === "ed25519" && verify(null, input, key, signature);
  }
}

function checkAudience(payload: Json, clientId: string): void {
  const { aud, azp } = payload;
  if (typeof aud === "string") {
    if (aud !== clientId) throw new LogoutTokenError("audience");
    return;
  }
  if (!Array.isArray(aud) || !aud.includes(clientId)) throw new LogoutTokenError("audience");
  // Same rule as for the ID token: with other audiences the token must have
  // been issued to this client.
  if (aud.length > 1 && azp !== clientId) throw new LogoutTokenError("audience");
}

function checkTimes(payload: Json, checks: LogoutTokenChecks): void {
  const { iat, exp, nbf } = payload;
  const skew = checks.clockToleranceSeconds;
  if (typeof iat !== "number" || !Number.isFinite(iat)) throw new LogoutTokenError("iat");
  if (iat > checks.now + skew || iat < checks.now - MAX_TOKEN_AGE_SECONDS - skew) {
    throw new LogoutTokenError("iat");
  }
  if (exp !== undefined && (typeof exp !== "number" || !Number.isFinite(exp) || exp <= checks.now - skew)) {
    throw new LogoutTokenError("exp");
  }
  if (nbf !== undefined && (typeof nbf !== "number" || !Number.isFinite(nbf) || nbf > checks.now + skew)) {
    throw new LogoutTokenError("nbf");
  }
}

function checkEvents(payload: Json): void {
  const { events } = payload;
  if (typeof events !== "object" || events === null || Array.isArray(events)) throw new LogoutTokenError("events");
  if (!Object.hasOwn(events, BACKCHANNEL_LOGOUT_EVENT)) throw new LogoutTokenError("events");
  const member = (events as Json)[BACKCHANNEL_LOGOUT_EVENT];
  if (typeof member !== "object" || member === null || Array.isArray(member)) throw new LogoutTokenError("events");
}

function optionalIdentifier(payload: Json, name: "sub" | "sid"): string | null {
  if (!Object.hasOwn(payload, name)) return null;
  const value = payload[name];
  if (!plainString(value)) throw new LogoutTokenError("subject");
  return value;
}

export async function verifyLogoutToken(
  token: string,
  checks: LogoutTokenChecks,
  keys: LogoutKeySource,
): Promise<VerifiedLogoutToken> {
  if (token.length > MAX_LOGOUT_TOKEN_CHARS) throw new LogoutTokenError("malformed");
  const parts = token.split(".");
  if (parts.length !== 3) throw new LogoutTokenError("malformed");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeObject(headerPart);
  if (!B64URL.test(signaturePart) || signaturePart === "") throw new LogoutTokenError("malformed");

  if (header.alg !== checks.alg) throw new LogoutTokenError("algorithm");
  // No extension is understood, so any critical one must be refused.
  if (Object.hasOwn(header, "crit")) throw new LogoutTokenError("algorithm");
  if (header.kid !== undefined && !plainString(header.kid)) throw new LogoutTokenError("key");

  const key = await keys.key(header.kid as string | undefined, checks.alg);
  if (!key) throw new LogoutTokenError("key");
  const input = Buffer.from(`${headerPart}.${payloadPart}`, "ascii");
  const signature = Buffer.from(signaturePart, "base64url");
  if (!verifySignature(checks.alg, key, input, signature)) throw new LogoutTokenError("signature");

  // The payload is read only after the signature holds.
  const payload = decodeObject(payloadPart);
  if (payload.iss !== checks.issuer) throw new LogoutTokenError("issuer");
  checkAudience(payload, checks.clientId);
  checkTimes(payload, checks);
  checkEvents(payload);
  if (Object.hasOwn(payload, "nonce")) throw new LogoutTokenError("nonce");
  const sub = optionalIdentifier(payload, "sub");
  const sid = optionalIdentifier(payload, "sid");
  if (sub === null && sid === null) throw new LogoutTokenError("subject");
  if (!plainString(payload.jti)) throw new LogoutTokenError("jti");
  return { sub, sid, jti: payload.jti };
}

