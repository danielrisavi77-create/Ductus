/**
 * Scope of the local journal before sign-in exists (F-3 step 1, plan #197).
 *
 * `AtomicDexieJournal` is keyed by a SHA-256 digest of the authenticated
 * principal. Until F-5 brings AAI@EduHr sign-in, the demo has no principal, so
 * the journal runs under ONE fixed local scope. This is the name of a local
 * IndexedDB database, not an identity: nothing here signs anyone in, nothing
 * reaches a server, and the UI never presents it as an account (D-09).
 *
 * The scope exists only behind an explicit server flag, like the fake OIDC
 * provider (BACKEND §4.3). It is read at request time on the server, never
 * inlined into the client bundle, so one `next build` serves both E2E and the
 * demo and the flag is set where the server starts. NODE_ENV cannot tell
 * production apart, so the flag also needs an explicit, allow-listed
 * deployment (`local`, `ci` or `demo`); an unset or any other deployment
 * refuses it instead of silently journalling under a shared scope.
 *
 * Its database name differs from every principal's, so when sign-in arrives
 * the demo journal is never picked up as a signed-in student's work: F-5
 * constructs the journal with the principal's own digest (step 5, DAN-92).
 */

/** Plain-text label the scope digest is derived from; versioned on purpose. */
export const LOCAL_DEMO_SCOPE_LABEL = "ductus-local-demo-journal-v1";

/** SHA-256 hex of `LOCAL_DEMO_SCOPE_LABEL`; a test recomputes it. */
export const LOCAL_DEMO_SCOPE_HASH =
  "7b240ae113072b46d91df37b08b29482f6761431bd88caed744fc82151689d1d";

/** The one document `/rad` edits while there is no document list. */
export const LOCAL_DEMO_DOCUMENT_ID = "local-demo-document";

export type LocalScopeConfig = {
  /** `"1"` enables the demo scope; unset or empty leaves it off. */
  readonly localDemoJournal?: string;
  /** Deployment marker; only `LOCAL_DEMO_DEPLOYMENTS` allow the demo scope. */
  readonly deployment?: string;
};

/** The only deployments the demo scope runs in; matched exactly. */
export const LOCAL_DEMO_DEPLOYMENTS: readonly string[] = ["local", "ci", "demo"];

export class LocalScopeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalScopeConfigError";
  }
}

/**
 * The journal scope for this server, or null when local journalling is off.
 * Null means the editor must stay read-only: there is nowhere honest to save.
 * A malformed or forbidden configuration throws rather than guessing.
 */
export function resolveLocalScope(config: LocalScopeConfig): string | null {
  const flag = config.localDemoJournal ?? "";
  if (flag === "") return null;
  if (flag !== "1") {
    throw new LocalScopeConfigError("local demo journal flag must be \"1\" or unset");
  }
  // Allow-list, not deny-list: "Production", "prod " or a forgotten marker
  // must fail closed rather than look like a non-production deployment.
  if (!LOCAL_DEMO_DEPLOYMENTS.includes(config.deployment ?? "")) {
    throw new LocalScopeConfigError(
      "local demo journal needs a deployment of exactly local, ci or demo",
    );
  }
  return LOCAL_DEMO_SCOPE_HASH;
}

/**
 * Reads the runtime configuration. Server only: without the `NEXT_PUBLIC_`
 * prefix these are undefined in the browser, so the server resolves the scope
 * per request and hands the result to the editor.
 */
export function localScopeConfigFromEnv(): LocalScopeConfig {
  return {
    localDemoJournal: process.env.DUCTUS_LOCAL_DEMO_JOURNAL,
    deployment: process.env.DUCTUS_DEPLOYMENT,
  };
}
