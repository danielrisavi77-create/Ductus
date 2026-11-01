import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadAuthConfig } from "@/server/auth/config";
import { finishLogin, LOGIN_COOKIE_NAME, startLogin, type AuthDeps } from "@/server/auth/flow";
import { createOidcClient } from "@/server/auth/oidc";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { createOpenSession } from "@/server/db/open-session";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER, type Misbehaviour, type TestAccount } from "../unit/auth/test-idp";
import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-196, plan #1104, A18 and A19: the whole AAI-shaped login (routes, real
// openid-client, the in-process provider of tests/unit/auth/test-idp.ts in
// its AAI shape) into the real identity.open_session, with two invented
// institutions. The fake provider never leaves this process (D-09). Every
// institution, account and name is random and synthetic.
const ADMIN_URL = requireLoopbackDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
  "The AAI login test runs only against a loopback database (DATABASE_URL).",
);
const suffix = randomBytes(4).toString("hex");
const AUTH_LOGIN = `it_aai_login_${suffix}`;
const password = randomBytes(24).toString("hex");
const A = { id: randomUUID(), homeOrg: `aai-a-${suffix}.ductus.test` };
const B = { id: randomUUID(), homeOrg: `aai-b-${suffix}.ductus.test` };
const APP = "https://ductus.test";
const CALLBACK = `${APP}/api/auth/callback`;
const config = loadAuthConfig({
  NODE_ENV: "test",
  DUCTUS_AUTH_PROVIDER: "aai-eduhr",
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_REDIRECT_URI: CALLBACK,
});

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
let authPool: pg.Pool;

beforeAll(async () => {
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_auth', $1::text, $2::text) AS ddl",
    [AUTH_LOGIN, password],
  );
  await admin.query(ddl.rows[0].ddl);
  for (const [institution, slug] of [[A, `it-aai-a-${suffix}`], [B, `it-aai-b-${suffix}`]] as const) {
    await admin.query("INSERT INTO identity.institution (id, slug, aai_home_org) VALUES ($1, $2, $3)", [
      institution.id, slug, institution.homeOrg,
    ]);
    // DAN-159: an institution takes logins only from an issuer recorded for
    // it, in the spelling the login route stores (accountIssuer).
    await admin.query("INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES ($1, $2)", [
      institution.id, ISSUER,
    ]);
  }
  const url = new URL(ADMIN_URL);
  url.username = AUTH_LOGIN;
  url.password = password;
  authPool = new pg.Pool({ connectionString: url.href, max: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(async () => {
  await authPool?.end();
  const ids = [A.id, B.id];
  await admin.query("DELETE FROM identity.person_name WHERE institution_id = ANY($1::uuid[])", [ids]);
  await admin.query("DELETE FROM identity.teacher_eligibility WHERE institution_id = ANY($1::uuid[])", [ids]);
  await admin.query(
    "DELETE FROM identity.session WHERE user_id IN (SELECT id FROM identity.user_account WHERE institution_id = ANY($1::uuid[]))",
    [ids],
  );
  await admin.query("DELETE FROM identity.user_account WHERE institution_id = ANY($1::uuid[])", [ids]);
  await admin.query("DELETE FROM identity.institution_issuer WHERE institution_id = ANY($1::uuid[])", [ids]);
  await admin.query("DELETE FROM identity.institution WHERE id = ANY($1::uuid[])", [ids]);
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  await admin.end();
  vi.restoreAllMocks();
});

/** One whole login of `account` at the AAI-shaped provider. */
async function signIn(account: TestAccount, next: Misbehaviour = {}) {
  const idp = createTestIdp(account, ISSUER, "aai");
  idp.state.next = next;
  const deps: AuthDeps = {
    config,
    oidc: createOidcClient(config, idp.fetch),
    openSession: createOpenSession(authPool),
    closeSession: async () => true,
  };
  const start = await startLogin(new Request(`${APP}/api/auth/login`), deps);
  const attempt = start.headers.getSetCookie().find((c) => c.startsWith(`${LOGIN_COOKIE_NAME}=`))!;
  const callback = idp.approve(new URL(start.headers.get("location")!), CALLBACK);
  return finishLogin(new Request(callback, { headers: { cookie: attempt.slice(0, attempt.indexOf(";")) } }), deps);
}

async function accountsOf(subject: string) {
  const { rows } = await admin.query<{ institution_id: string }>(
    "SELECT institution_id FROM identity.user_account WHERE institution_id = ANY($1::uuid[]) AND oidc_subject = $2",
    [[A.id, B.id], subject],
  );
  return rows.map((row) => row.institution_id);
}

/** Whether the account of `subject` holds the teacher right, and its stored name. */
async function rightAndName(subject: string) {
  const { rows } = await admin.query<{ eligible: boolean; name: string | null }>(
    `SELECT EXISTS (SELECT 1 FROM identity.teacher_eligibility e WHERE e.user_id = u.id AND e.institution_id = u.institution_id) AS eligible,
            (SELECT n.given_name || ' ' || n.family_name FROM identity.person_name n WHERE n.user_id = u.id) AS name
       FROM identity.user_account u WHERE u.institution_id = ANY($1::uuid[]) AND u.oidc_subject = $2`,
    [[A.id, B.id], subject],
  );
  return rows;
}

const account = (sub: string, local: string, homeOrg: string, realm = homeOrg): TestAccount => ({
  sub,
  uniqueId: `${local}@${realm}`,
  homeOrg,
  givenName: "Lea",
  familyName: "Izmišljić",
  affiliation: ["djelatnik"],
});

describe("AAI-shaped login into identity.open_session", () => {
  it("A18 opens each account's session in its own institution", async () => {
    const lea = account(`sub-a-${suffix}`, "lea", A.homeOrg);
    const ivo = account(`sub-b-${suffix}`, "ivo", B.homeOrg);
    expect((await signIn(lea)).status).toBe(303);
    expect((await signIn(ivo)).status).toBe(303);
    expect(await accountsOf(lea.sub)).toEqual([A.id]);
    expect(await accountsOf(ivo.sub)).toEqual([B.id]);
  });

  it("A19 refuses an account of B whose unique id is in the realm of A", async () => {
    const mixed = account(`sub-mix-${suffix}`, "mia", B.homeOrg, A.homeOrg);
    const response = await signIn(mixed);
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && !c.includes("Max-Age=0"))).toBe(false);
    expect(await accountsOf(mixed.sub)).toEqual([]);
  });

  it("A19 refuses a home organisation no institution has", async () => {
    const stranger = account(`sub-none-${suffix}`, "eva", `aai-c-${suffix}.ductus.test`);
    expect((await signIn(stranger)).status).toBe(403);
    expect(await accountsOf(stranger.sub)).toEqual([]);
  });

  it("A19 refuses a home organisation array naming both institutions", async () => {
    const both = account(`sub-both-${suffix}`, "ana", A.homeOrg);
    const response = await signIn(both, { userinfo: (u) => ({ ...u, hrEduPersonHomeOrg: [A.homeOrg, B.homeOrg] }) });
    expect(response.status).toBe(403);
    expect(await accountsOf(both.sub)).toEqual([]);
  });

  // DAN-304 (#1181, items 1, 4, 10, 11, 21 and 26): every login writes the
  // right anew from its own affiliation, the name stays its own fact, and no
  // affiliation value is stored.
  it("DAN-304 gives the teacher right for djelatnik, takes it at a student login and gives it back", async () => {
    const vid = account(`sub-right-${suffix}`, "vid", A.homeOrg);
    expect((await signIn(vid)).status).toBe(303);
    expect(await rightAndName(vid.sub)).toEqual([{ eligible: true, name: "Lea Izmišljić" }]);
    expect((await signIn({ ...vid, affiliation: ["student"] })).status).toBe(303);
    expect(await rightAndName(vid.sub)).toEqual([{ eligible: false, name: "Lea Izmišljić" }]);
    expect((await signIn({ ...vid, affiliation: ["vanjski suradnik"] })).status).toBe(303);
    expect(await rightAndName(vid.sub)).toEqual([{ eligible: true, name: "Lea Izmišljić" }]);
    expect((await signIn(vid, { userinfo: (u) => ({ ...u, given_name: ["Lea"] }) })).status).toBe(303);
    expect(await rightAndName(vid.sub)).toEqual([{ eligible: true, name: null }]);
    const stored = await admin.query(
      `SELECT count(*)::int AS n FROM identity.teacher_eligibility e
        WHERE e.institution_id = ANY($1::uuid[]) AND to_jsonb(e)::text ~* 'djelatnik|suradnik|student'`,
      [[A.id, B.id]],
    );
    expect(stored.rows[0].n).toBe(0);
  });
});
