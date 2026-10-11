import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

/**
 * An OIDC provider that lives in a `fetch` function: no port, no network.
 * The flow under test gets it through createOidcClient(config, idp.fetch).
 * Every account and value is invented. Tests change `next` to make the
 * provider misbehave in one way at a time.
 */
// The fake provider accepts only a loopback issuer (config.ts); nothing
// listens here, every request goes to `fetch` below.
export const ISSUER = "https://127.0.0.1:9443";
export const CLIENT_ID = "ductus-test";
export const CLIENT_SECRET = "test-only-client-secret";

export interface Misbehaviour {
  /** Edits the ID token claims before signing. */
  claims?: (claims: Record<string, unknown>) => Record<string, unknown>;
  /** "none", "HS256" (keyed with the client secret), or a foreign RSA key. */
  signing?: "none" | "HS256" | "foreign-key" | "unknown-kid";
  userinfo?: (userinfo: Record<string, unknown>) => Record<string, unknown>;
  /** Raw userinfo body, e.g. 5 MB; streamed without Content-Length. */
  userinfoBody?: () => ReadableStream<Uint8Array>;
  /** Status code the token endpoint answers with instead of tokens. */
  tokenStatus?: number;
  /** Network failure on every request. */
  down?: boolean;
}

interface Grant {
  nonce: string;
  challenge: string;
  redirectUri: string;
  used: boolean;
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function rsaKey(): { privateKey: KeyObject; jwk: Record<string, unknown> } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, jwk: publicKey.export({ format: "jwk" }) as Record<string, unknown> };
}

export function createTestIdp(account = { sub: "sub-demo-1", uniqueId: "ana@demo.ductus.test", homeOrg: "demo.ductus.test" }) {
  const key = rsaKey();
  const foreign = rsaKey();
  const grants = new Map<string, Grant>();
  const tokenRequests: URLSearchParams[] = [];
  const state = { next: {} as Misbehaviour, account };

  function idToken(grant: Grant): string {
    const now = Math.floor(Date.now() / 1000);
    let claims: Record<string, unknown> = {
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: state.account.sub,
      iat: now,
      exp: now + 300,
      nonce: grant.nonce,
    };
    if (state.next.claims) claims = state.next.claims(claims);
    const signing = state.next.signing;
    const alg = signing === "none" ? "none" : signing === "HS256" ? "HS256" : "RS256";
    const kid = signing === "unknown-kid" ? "other-kid" : "test-kid";
    const input = `${b64({ alg, kid, typ: "JWT" })}.${b64(claims)}`;
    if (alg === "none") return `${input}.`;
    if (alg === "HS256") return `${input}.${createHmac("sha256", CLIENT_SECRET).update(input).digest("base64url")}`;
    const signer = signing === "foreign-key" ? foreign.privateKey : key.privateKey;
    return `${input}.${sign("sha256", Buffer.from(input), signer).toString("base64url")}`;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    switch (url.pathname) {
      case "/.well-known/openid-configuration":
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/auth`,
          token_endpoint: `${ISSUER}/token`,
          userinfo_endpoint: `${ISSUER}/me`,
          jwks_uri: `${ISSUER}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      case "/jwks":
        return json({ keys: [{ ...key.jwk, kid: "test-kid", alg: "RS256", use: "sig" }] });
      case "/token": {
        if (state.next.tokenStatus) return json({ error: "server_error" }, state.next.tokenStatus);
        // RFC 6749 2.3.1: both parts form-encoded before base64.
        const basic = Buffer.from((new Headers(init.headers).get("authorization") ?? "").replace(/^Basic /, ""), "base64").toString();
        const [id, secret] = basic.split(":").map((part) => decodeURIComponent(part.replaceAll("+", " ")));
        if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return json({ error: "invalid_client" }, 401);
        const params = new URLSearchParams(String(init.body));
        tokenRequests.push(params);
        const grant = grants.get(params.get("code") ?? "");
        const verifier = params.get("code_verifier") ?? "";
        if (
          !grant ||
          grant.used ||
          grant.redirectUri !== params.get("redirect_uri") ||
          createHash("sha256").update(verifier).digest("base64url") !== grant.challenge
        ) {
          return json({ error: "invalid_grant" }, 400);
        }
        grant.used = true;
        return json({ access_token: "at-" + randomBytes(8).toString("hex"), token_type: "Bearer", expires_in: 300, id_token: idToken(grant) });
      }
      case "/me": {
        if (state.next.userinfoBody) {
          return new Response(state.next.userinfoBody(), { headers: { "content-type": "application/json" } });
        }
        let body: Record<string, unknown> = {
          sub: state.account.sub,
          hrEduPersonUniqueID: state.account.uniqueId,
          hrEduPersonHomeOrg: state.account.homeOrg,
        };
        if (state.next.userinfo) body = state.next.userinfo(body);
        return json(body);
      }
      default:
        return new Response("not found", { status: 404 });
    }
  }

  return {
    state,
    tokenRequests,
    fetch: (async (input: string | URL | Request, init: RequestInit = {}) => {
      if (state.next.down) throw new TypeError("fetch failed");
      return handle(new URL(String(input instanceof Request ? input.url : input)), init);
    }) as typeof fetch,
    /** The user signs in at the provider; returns the callback URL it redirects to. */
    approve(authorizationUrl: URL, callbackBase: string): URL {
      const p = authorizationUrl.searchParams;
      const code = randomBytes(16).toString("base64url");
      grants.set(code, {
        nonce: p.get("nonce") ?? "",
        challenge: p.get("code_challenge") ?? "",
        redirectUri: p.get("redirect_uri") ?? "",
        used: false,
      });
      const callback = new URL(callbackBase);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", p.get("state") ?? "");
      callback.searchParams.set("iss", ISSUER);
      return callback;
    },
  };
}
