import { openSession, withActor } from "@/server/db";

import { loadAuthConfig } from "./config";
import { failurePage, type AuthDeps } from "./flow";
import { createOidcClient } from "./oidc";

let deps: AuthDeps | undefined;

/**
 * The route dependencies, built on the first request rather than at import,
 * so `next build` needs no login configuration. An invalid configuration
 * (the fake provider in a production build among them) throws here, on every
 * login.
 */
export function authDeps(): AuthDeps {
  if (deps) return deps;
  // D-09 is a property of the build. Next replaces the literal
  // `process.env.NODE_ENV` when it compiles: `next build` writes "production",
  // `next dev` "development". So no NODE_ENV given to `next start` can select
  // the fake provider; only `next dev` and the unit tests can.
  const config = loadAuthConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV });
  deps = {
    config,
    oidc: createOidcClient(config),
    openSession,
    closeSession: (token) =>
      withActor(token, async (tx) => {
        const { rows } = await tx.query<{ closed: boolean }>("SELECT identity.close_current_session() AS closed");
        return rows[0]?.closed === true;
      }),
  };
  return deps;
}

/**
 * A route over the dependencies. A configuration that does not load (the
 * fake provider in a production build, a missing variable) ends on the same
 * neutral page as a provider that does not answer, never on a framework
 * error page that could name the variable.
 */
export function authRoute(handler: (request: Request, deps: AuthDeps) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    let loaded: AuthDeps;
    try {
      loaded = authDeps();
    } catch (error) {
      console.error("login failed", "config", error instanceof Error ? error.name : "unknown");
      return failurePage(503);
    }
    return handler(request, loaded);
  };
}
