import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { identityFromClaims } from "@/server/auth/claims";
import { newSessionToken } from "@/server/auth/session-token";
import { createOpenSession } from "@/server/db/open-session";
import { createWithActor } from "@/server/db/with-actor";

import { ACCOUNTS, DEMO_HOME_ORG, DEMO_HOME_ORG_B, demoAccountClaims } from "../../infra/fake-oidc/accounts.mjs";

// DAN-483: the two invented institutions of db/local/seed.sql share the fake
// provider's issuer, so only the home organisation and the realm of the
// unique id keep their accounts apart. The claims are the fake accounts'
// own, under a per-run subject: the seeded demo accounts that demo:prepare
// and E2E sign in with are never touched. Everything here is synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const ISSUER = "http://localhost:8090";
const AUTH_LOGIN = "it_fake_oidc_inst_auth";
const APP_LOGIN = "it_fake_oidc_inst_app";
const password = randomBytes(24).toString("hex");
const suffix = randomBytes(4).toString("hex");

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pools: pg.Pool[] = [];
const subjects: string[] = [];
const institutionOf = new Map<string, string>();

function loginPool(login: string) {
  const url = new URL(ADMIN_URL);
  url.username = login;
  url.password = password;
  const pool = new pg.Pool({ connectionString: url.href, max: 1 });
  pools.push(pool);
  return pool;
}

type Variant = { homeOrg?: string; realm?: string; subject?: string };

/** The claims of a fake account under this run's subject, optionally altered. */
function claimsOf(id: string, variant: Variant = {}) {
  const own = ACCOUNTS[id].homeOrg;
  const sub = variant.subject ?? `${id}-it-${suffix}`;
  if (!subjects.includes(sub)) subjects.push(sub);
  return {
    ...demoAccountClaims(id)!,
    sub,
    hrEduPersonUniqueID: [`${sub}@${variant.realm ?? own}`],
    hrEduPersonHomeOrg: [variant.homeOrg ?? own],
  };
}

function identityOf(claims: ReturnType<typeof claimsOf>) {
  const result = identityFromClaims(claims);
  if (!result.ok) throw new Error(`claims refused: ${result.reason}`);
  return result.identity;
}

let auth: pg.Pool;

/** One login through the callback's own path: claims, then open_session. */
async function login(claims: ReturnType<typeof claimsOf>) {
  const { token, tokenHash } = newSessionToken();
  const result = await createOpenSession(auth)({ issuer: ISSUER, ...identityOf(claims), tokenHash });
  return { result, token, tokenHash };
}

/** The same call as createOpenSession, to read the SQLSTATE it folds into "refused". */
async function sqlState(claims: ReturnType<typeof claimsOf>) {
  const identity = identityOf(claims);
  const { tokenHash } = newSessionToken();
  const failure = await auth
    .query("SELECT identity.open_session($1, $2, $3, $4, $5, $6, $7, $8)", [
      ISSUER, identity.subject, identity.uniqueId, identity.homeOrg, tokenHash,
      identity.givenName ?? null, identity.familyName ?? null, identity.teacherEligible,
    ])
    .then(() => undefined, (error: { code?: string }) => error.code);
  return { failure, tokenHash };
}

const accountsOf = async (subject: string) =>
  (await admin.query<{ institution_id: string; hr_edu_person_unique_id: string }>(
    "SELECT institution_id, hr_edu_person_unique_id FROM identity.user_account WHERE oidc_issuer = $1 AND oidc_subject = $2",
    [ISSUER, subject],
  )).rows;
const sessionCount = async (tokenHash: Buffer) =>
  (await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM identity.session WHERE token_hash = $1", [tokenHash])).rows[0].n;

beforeAll(async () => {
  const seeded = await admin.query<{ id: string; aai_home_org: string }>(
    `SELECT i.id, i.aai_home_org FROM identity.institution i
       JOIN identity.institution_issuer ii ON ii.institution_id = i.id AND ii.oidc_issuer = $1
      WHERE i.slug = ANY($2)`,
    [ISSUER, ["demo-fakultet", "demo-fakultet-b"]],
  );
  for (const row of seeded.rows) institutionOf.set(row.aai_home_org, row.id);
  if (!institutionOf.has(DEMO_HOME_ORG) || !institutionOf.has(DEMO_HOME_ORG_B)) {
    throw new Error("Run pnpm db:seed (or pnpm demo:prepare) first: both demo institutions must exist");
  }
  for (const [name, group] of [[AUTH_LOGIN, "ductus_auth"], [APP_LOGIN, "ductus_app"]]) {
    await admin.query(`DROP ROLE IF EXISTS ${name}`);
    const ddl = await admin.query<{ ddl: string }>(
      "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE %I', $1::text, $2::text, $3::text) AS ddl",
      [name, password, group],
    );
    await admin.query(ddl.rows[0].ddl);
  }
  auth = loginPool(AUTH_LOGIN);
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  const mine = "SELECT id FROM identity.user_account WHERE oidc_issuer = $1 AND oidc_subject = ANY($2)";
  await admin.query(`DELETE FROM identity.person_name WHERE user_id IN (${mine})`, [ISSUER, subjects]);
  await admin.query(`DELETE FROM identity.teacher_eligibility WHERE user_id IN (${mine})`, [ISSUER, subjects]);
  await admin.query(`DELETE FROM identity.session WHERE user_id IN (${mine})`, [ISSUER, subjects]);
  await admin.query("DELETE FROM identity.user_account WHERE oidc_issuer = $1 AND oidc_subject = ANY($2)", [ISSUER, subjects]);
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.end();
});

describe("the fake provider's two institutions over open_session (DAN-483)", () => {
  it("lets each institution's own accounts in, each into its own institution", async () => {
    for (const id of Object.keys(ACCOUNTS)) {
      const claims = claimsOf(id);
      const { result, tokenHash } = await login(claims);
      expect(result.ok, id).toBe(true);
      expect(await accountsOf(claims.sub)).toEqual([
        { institution_id: institutionOf.get(ACCOUNTS[id].homeOrg), hr_edu_person_unique_id: claims.hrEduPersonUniqueID[0] },
      ]);
      expect(await sessionCount(tokenHash)).toBe(1);
    }
  });

  // Scenario 1: an account of A under B's home organisation, and the reverse.
  it.each([
    ["demo-teacher", DEMO_HOME_ORG_B],
    ["demo-student", DEMO_HOME_ORG_B],
    ["demo-b-teacher", DEMO_HOME_ORG],
    ["demo-b-student", DEMO_HOME_ORG],
  ])("refuses %s under the other institution's home organisation (%s) and leaves no row", async (id, other) => {
    const variant = { homeOrg: other, subject: `${id}-cross-${suffix}` };
    const { result, tokenHash } = await login(claimsOf(id, variant));
    expect(result).toEqual({ ok: false, reason: "refused" });
    expect(await sessionCount(tokenHash)).toBe(0);
    const direct = await sqlState(claimsOf(id, variant));
    expect(direct.failure).toBe("ZD503");
    expect(await sessionCount(direct.tokenHash)).toBe(0);
    expect(await accountsOf(variant.subject)).toEqual([]);
  });

  // Scenario 2: the realm of the unique id differs from the home organisation.
  it.each([
    ["demo-student", DEMO_HOME_ORG_B],
    ["demo-b-teacher", DEMO_HOME_ORG],
    ["demo-b-student", "nepoznata.ductus.test"],
  ])("refuses %s with a unique id in the realm %s with ZD503", async (id, realm) => {
    const variant = { realm, subject: `${id}-realm-${suffix}` };
    const direct = await sqlState(claimsOf(id, variant));
    expect(direct.failure).toBe("ZD503");
    expect(await sessionCount(direct.tokenHash)).toBe(0);
    expect(await accountsOf(variant.subject)).toEqual([]);
  });

  // Scenario 3: the teacher affiliation is the right to have a role
  // confirmed, never the role; a student has neither.
  it("records the teacher right only for staff, and the right alone creates no course", async () => {
    const withActor = createWithActor(loginPool(APP_LOGIN));
    for (const id of ["demo-student", "demo-b-student", "demo-teacher", "demo-b-teacher"]) {
      const claims = claimsOf(id, { subject: `${id}-right-${suffix}` });
      const staff = ACCOUNTS[id].affiliation === "djelatnik";
      expect(identityOf(claims).teacherEligible, id).toBe(staff);
      const { result, token } = await login(claims);
      expect(result.ok, id).toBe(true);
      const rights = await admin.query<{ institution_id: string }>(
        `SELECT e.institution_id FROM identity.teacher_eligibility e
           JOIN identity.user_account u ON u.id = e.user_id
          WHERE u.oidc_issuer = $1 AND u.oidc_subject = $2`,
        [ISSUER, claims.sub],
      );
      expect(rights.rows, id).toEqual(staff ? [{ institution_id: institutionOf.get(ACCOUNTS[id].homeOrg) }] : []);
      await expect(
        withActor(token, (tx) =>
          tx.query("SELECT institution.create_course($1, $2, $3)", ["Sinteticki kolegij", "2026/2027", "prohibited"])),
        id,
      ).rejects.toMatchObject({ code: "ZD403" });
    }
  });

  // Scenario 4: one subject under the other home organisation, with a unique
  // id in that realm, gives no second user in the other institution.
  it.each([
    ["demo-teacher", DEMO_HOME_ORG_B],
    ["demo-b-student", DEMO_HOME_ORG],
  ])("keeps the subject of %s in its own institution when it arrives under %s", async (id, other) => {
    const subject = `${id}-move-${suffix}`;
    const own = claimsOf(id, { subject });
    expect((await login(own)).result.ok).toBe(true);
    const before = await accountsOf(subject);
    expect(before).toEqual([
      { institution_id: institutionOf.get(ACCOUNTS[id].homeOrg), hr_edu_person_unique_id: own.hrEduPersonUniqueID[0] },
    ]);

    const moved = claimsOf(id, { subject, homeOrg: other, realm: other });
    const { result, tokenHash } = await login(moved);
    expect(result).toEqual({ ok: false, reason: "refused" });
    expect(await sessionCount(tokenHash)).toBe(0);
    expect((await sqlState(moved)).failure).toBe("ZD403");
    expect(await accountsOf(subject)).toEqual(before);
    expect((await admin.query(
      "SELECT count(*)::int AS n FROM identity.user_account WHERE oidc_issuer = $1 AND hr_edu_person_unique_id = $2",
      [ISSUER, moved.hrEduPersonUniqueID[0]],
    )).rows[0].n).toBe(0);
  });
});
