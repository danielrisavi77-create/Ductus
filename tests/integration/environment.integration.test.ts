import { createHash, randomBytes } from "node:crypto";

import pg from "pg";
import { describe, expect, it } from "vitest";

// Checks compose.yaml: every service later milestones rely on answers on its
// documented local port. Values match .env.example.
const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const DATABASE_URL = env("DATABASE_URL", "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus");
const S3_ENDPOINT = env("S3_ENDPOINT", "http://127.0.0.1:9100");
const MAILPIT_URL = env("MAILPIT_URL", "http://127.0.0.1:8025");
const OIDC_ISSUER = env("OIDC_ISSUER", "http://localhost:8090");
const OIDC_CLIENT_ID = env("OIDC_CLIENT_ID", "ductus-local");
const OIDC_CLIENT_SECRET = env("OIDC_CLIENT_SECRET", "ductus-local-only");
const REDIRECT_URI = "http://localhost:3000/api/auth/callback";

/** Minimal cookie jar: enough for the provider's interaction cookies. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function step(jar: CookieJar, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { ...init.headers, cookie: jar.header() },
  });
  jar.store(response);
  return response;
}

const location = (response: Response) => new URL(response.headers.get("location") ?? "", OIDC_ISSUER);

describe("local environment", () => {
  it("Postgres 17 accepts connections", async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ server_version: string }>("show server_version");
      expect(rows[0].server_version).toMatch(/^17\./);
    } finally {
      await client.end();
    }
  });

  it("object store speaks S3 and refuses anonymous listing", async () => {
    const response = await fetch(`${S3_ENDPOINT}/`);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("AccessDenied");
  });

  it("Mailpit API is up", async () => {
    const response = await fetch(`${MAILPIT_URL}/api/v1/info`);
    expect(response.ok).toBe(true);
  });

  it("fake OIDC provider signs a demo account in with PKCE", async () => {
    const jar = new CookieJar();
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    const authorize = new URL("/auth", OIDC_ISSUER);
    authorize.search = new URLSearchParams({
      client_id: OIDC_CLIENT_ID,
      response_type: "code",
      scope: "openid profile",
      redirect_uri: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "local-state",
      nonce: "local-nonce",
    }).toString();
    const toInteraction = await step(jar, authorize.href);
    expect(toInteraction.status).toBe(303);

    const loginPage = await step(jar, location(toInteraction).href);
    expect(await loginPage.text()).toContain("Demo prijava");

    const submitted = await step(jar, `${location(toInteraction).href}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ account: "demo-student" }).toString(),
    });
    const callback = location(await step(jar, location(submitted).href));
    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const basic = Buffer.from(`${OIDC_CLIENT_ID}:${OIDC_CLIENT_SECRET}`).toString("base64");
    const tokenResponse = await fetch(new URL("/token", OIDC_ISSUER), {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as { access_token: string; id_token: string };
    expect(tokens.id_token).toBeTruthy();

    const userinfo = await fetch(new URL("/me", OIDC_ISSUER), {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(await userinfo.json()).toMatchObject({
      sub: "demo-student",
      hrEduPersonUniqueID: "demo-student@demo.ductus.test",
      hrEduPersonHomeOrg: "demo.ductus.test",
    });
  });

  it("fake OIDC provider rejects an authorization request without PKCE", async () => {
    const authorize = new URL("/auth", OIDC_ISSUER);
    authorize.search = new URLSearchParams({
      client_id: OIDC_CLIENT_ID,
      response_type: "code",
      scope: "openid",
      redirect_uri: REDIRECT_URI,
    }).toString();
    const response = await fetch(authorize, { redirect: "manual" });
    expect(location(response).searchParams.get("error")).toBe("invalid_request");
  });
});
