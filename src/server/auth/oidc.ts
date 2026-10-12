import { createHash, randomBytes } from "node:crypto";

import * as client from "openid-client";

import type { AuthConfig } from "./config";

/**
 * The OIDC relying party (B-6; D-09). This is the only file that imports
 * openid-client: the flow sees the small interface below, and state, nonce
 * and PKCE values are made here with node:crypto, so replacing the library
 * touches this file alone.
 */
export interface LoginChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface VerifiedLogin {
  /** `iss` of the verified ID token. */
  issuer: string;
  idToken: Readonly<Record<string, unknown>>;
  userinfo: Readonly<Record<string, unknown>>;
}

export interface OidcClient {
  authorizationUrl(checks: LoginChecks): Promise<URL>;
  /** `callbackUrl` carries the query of the callback request, nothing else. */
  verify(callbackUrl: URL, checks: LoginChecks): Promise<VerifiedLogin>;
}

/** The provider did not answer, answered 5xx, or timed out. */
export class ProviderUnavailableError extends Error {
  override name = "ProviderUnavailableError";
}

/** Largest response body read from the provider: discovery, JWKS, token, userinfo. */
export const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
/** Seconds for each request to the provider. */
export const PROVIDER_TIMEOUT_SECONDS = 10;

export function newLoginChecks(): LoginChecks {
  const token = () => randomBytes(32).toString("base64url");
  return { state: token(), nonce: token(), codeVerifier: token() };
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/**
 * fetch with a size limit. A provider (or anything between) that streams a
 * 5 MB userinfo is cut off at the limit instead of being buffered, and a
 * network failure or 5xx becomes ProviderUnavailableError.
 */
export function limitedFetch(limit: number, fetchImpl: typeof fetch = fetch): client.CustomFetch {
  return async (url, options) => {
    let response: Response;
    try {
      response = await fetchImpl(url, options as RequestInit);
    } catch (error) {
      throw new ProviderUnavailableError("provider request failed", { cause: error });
    }
    if (response.status >= 500) {
      await response.body?.cancel();
      throw new ProviderUnavailableError("provider answered with a server error");
    }
    if (Number(response.headers.get("content-length") ?? 0) > limit) {
      await response.body?.cancel();
      throw new Error("provider response is too large");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error("provider response is too large");
        }
        chunks.push(value);
      }
    }
    const body = NULL_BODY_STATUS.has(response.status) ? null : Buffer.concat(chunks);
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

export function isProviderUnavailable(error: unknown): boolean {
  for (let e = error, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (e instanceof ProviderUnavailableError || e.name === "TimeoutError" || e.name === "AbortError") return true;
  }
  return false;
}

export function createOidcClient(config: AuthConfig, fetchImpl: typeof fetch = fetch): OidcClient {
  let discovered: Promise<client.Configuration> | undefined;

  function configuration(): Promise<client.Configuration> {
    discovered ??= client
      .discovery(
        config.issuer,
        config.clientId,
        {
          id_token_signed_response_alg: config.idTokenAlg,
          [client.clockTolerance]: config.clockToleranceSeconds,
        },
        client.ClientSecretBasic(config.clientSecret),
        {
          [client.customFetch]: limitedFetch(MAX_PROVIDER_RESPONSE_BYTES, fetchImpl),
          timeout: PROVIDER_TIMEOUT_SECONDS,
          // The ID token signature is checked against the provider JWKS even
          // though it came over TLS from the token endpoint (attacks 6, 7).
          execute: [
            client.enableNonRepudiationChecks,
            ...(config.allowInsecureRequests ? [client.allowInsecureRequests] : []),
          ],
        },
      )
      .catch((error: unknown) => {
        // A failed discovery is retried on the next login, not cached.
        discovered = undefined;
        throw error;
      });
    return discovered;
  }

  return {
    async authorizationUrl(checks) {
      return client.buildAuthorizationUrl(await configuration(), {
        redirect_uri: config.redirectUri.href,
        scope: "openid profile",
        state: checks.state,
        nonce: checks.nonce,
        code_challenge: codeChallenge(checks.codeVerifier),
        code_challenge_method: "S256",
      });
    },

    async verify(callbackUrl, checks) {
      const oidc = await configuration();
      // The redirect URI sent to the token endpoint is the configured one,
      // never one rebuilt from the Host header of the request.
      const current = new URL(config.redirectUri.href);
      current.search = callbackUrl.search;
      const tokens = await client.authorizationCodeGrant(oidc, current, {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.codeVerifier,
        idTokenExpected: true,
      });
      const idToken = tokens.claims();
      if (!idToken) throw new Error("token response has no ID token");
      const userinfo = await client.fetchUserInfo(oidc, tokens.access_token, idToken.sub);
      return { issuer: idToken.iss, idToken, userinfo };
    },
  };
}
