/**
 * The provider keys for logout tokens (DAN-474): a cache of its JWKS. The
 * route is public, so a token with an unknown `kid` must not make Ductus ask
 * the provider each time (attack plan #1620 G4): the JWKS is fetched again at
 * most once per `minRefreshSeconds`, and concurrent requests share a fetch.
 */
import { createPublicKey, type KeyObject } from "node:crypto";

import type { IdTokenAlg } from "./config";
import type { LogoutKeySource } from "./logout-token";

export const JWKS_MIN_REFRESH_SECONDS = 60;

type Jwk = Record<string, unknown>;

const KEY_TYPE: Record<IdTokenAlg, { kty: string; crv?: string }> = {
  RS256: { kty: "RSA" },
  PS256: { kty: "RSA" },
  ES256: { kty: "EC", crv: "P-256" },
  EdDSA: { kty: "OKP", crv: "Ed25519" },
};

function fits(jwk: Jwk, alg: IdTokenAlg): boolean {
  const type = KEY_TYPE[alg];
  if (jwk.kty !== type.kty) return false;
  if (type.crv !== undefined && jwk.crv !== type.crv) return false;
  if (jwk.use !== undefined && jwk.use !== "sig") return false;
  if (jwk.alg !== undefined && jwk.alg !== alg) return false;
  if (jwk.key_ops !== undefined && !(Array.isArray(jwk.key_ops) && jwk.key_ops.includes("verify"))) return false;
  return true;
}

function publicKey(jwk: Jwk): KeyObject | undefined {
  // Only the public members are passed: a JWKS that leaks `d` still yields
  // nothing but a verification key.
  const { kty, n, e, crv, x, y } = jwk;
  try {
    return createPublicKey({ key: { kty, n, e, crv, x, y } as never, format: "jwk" });
  } catch {
    return undefined;
  }
}

/** Picks the one key for a header: by `kid`, or the only fitting key without one. */
export function selectKey(keys: readonly unknown[], kid: string | undefined, alg: IdTokenAlg): KeyObject | undefined {
  const candidates = keys.filter(
    (k): k is Jwk =>
      typeof k === "object" && k !== null && !Array.isArray(k) && fits(k as Jwk, alg) &&
      (kid === undefined || (k as Jwk).kid === kid),
  );
  if (candidates.length !== 1) return undefined;
  return publicKey(candidates[0] as Jwk);
}

export interface CachedKeySourceOptions {
  /** Fetches the JWKS `keys` array; throws when the provider does not answer. */
  load: () => Promise<readonly unknown[]>;
  minRefreshSeconds?: number;
  nowMs?: () => number;
}

export function createCachedKeySource(options: CachedKeySourceOptions): LogoutKeySource {
  const minRefreshMs = (options.minRefreshSeconds ?? JWKS_MIN_REFRESH_SECONDS) * 1000;
  const nowMs = options.nowMs ?? Date.now;
  let keys: readonly unknown[] | undefined;
  let loadedAt = -Infinity;
  let pending: Promise<readonly unknown[]> | undefined;

  function refresh(): Promise<readonly unknown[]> {
    pending ??= options
      .load()
      .then((fresh) => {
        keys = fresh;
        return fresh;
      })
      .finally(() => {
        // A failed fetch also counts, so an unreachable provider is not
        // asked again on every request.
        loadedAt = nowMs();
        pending = undefined;
      });
    return pending;
  }

  return {
    async key(kid, alg) {
      if (keys === undefined) {
        if (nowMs() - loadedAt < minRefreshMs && pending === undefined) throw new Error("JWKS recently unavailable");
        await refresh();
      }
      const found = selectKey(keys ?? [], kid, alg);
      if (found || nowMs() - loadedAt < minRefreshMs) return found;
      return selectKey(await refresh(), kid, alg);
    },
  };
}
