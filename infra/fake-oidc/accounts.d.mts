export type DemoAccount = {
  readonly name: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly affiliation: string;
  readonly homeOrg: string;
};

/** The claims of a demo account, the hrEdu ones as arrays like AAI@EduHr. */
export type DemoAccountClaims = {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  hrEduPersonUniqueID: string[];
  hrEduPersonHomeOrg: string[];
  hrEduPersonAffiliation: string[];
};

export const DEMO_HOME_ORG: string;

export const DEMO_HOME_ORG_B: string;

export const ACCOUNTS: Readonly<Record<string, DemoAccount>>;

export const DEMO_ACCOUNTS: Readonly<Record<string, DemoAccount>>;

/** True only for an own, declared demo account id. */
export function isDemoAccountId(id: unknown): id is string;

/** The declared demo account, or undefined for anything else. */
export function findDemoAccount(id: unknown): DemoAccount | undefined;

/** The OIDC claims of a declared demo account, or undefined for anything else. */
export function demoAccountClaims(id: unknown): DemoAccountClaims | undefined;
