export type DemoAccount = { readonly name: string; readonly affiliation: string };

export const DEMO_HOME_ORG: string;

export const ACCOUNTS: Readonly<Record<string, DemoAccount>>;

export const DEMO_ACCOUNTS: Readonly<Record<string, DemoAccount>>;

/** True only for an own, declared demo account id. */
export function isDemoAccountId(id: unknown): id is string;

/** The declared demo account, or undefined for anything else. */
export function findDemoAccount(id: unknown): DemoAccount | undefined;

/** The OIDC claims of a declared demo account, or undefined for anything else. */
export function demoAccountClaims(id: unknown): Record<string, string> | undefined;
