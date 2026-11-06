import { backchannelLogout } from "@/server/db";

import { backchannelLogout as backchannelHandler, type BackchannelDeps } from "./backchannel";
import { loadAuthConfig } from "./config";
import { createCachedKeySource } from "./logout-keys";
import { createOidcClient } from "./oidc";

let deps: BackchannelDeps | undefined;

/**
 * The back-channel dependencies (DAN-474), built on the first request like
 * the login ones: the same configuration and the same bounded fetch, and one
 * JWKS cache per process (#1620 G4), so an unknown kid refreshes the keys at
 * most once a minute, whoever sends it. Kept apart from `deps.ts` (F-042):
 * this module reaches the database only through `backchannelLogout`, which
 * closes sessions and never opens one.
 */
function backchannelDeps(): BackchannelDeps {
  if (deps) return deps;
  // As in deps.ts: Next replaces `process.env.NODE_ENV` at build time, so a
  // production build never selects the fake provider (D-09).
  const config = loadAuthConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV });
  const provider = createOidcClient(config);
  deps = {
    config,
    discoveredIssuer: () => provider.discoveredIssuer(),
    keys: createCachedKeySource({ load: () => provider.jwks() }),
    backchannelLogout,
  };
  return deps;
}

/**
 * POST /api/auth/backchannel-logout. A configuration that does not load
 * answers 503 with no body: the caller is the provider, not a browser, so
 * there is no page to show.
 */
export async function backchannelRoute(request: Request): Promise<Response> {
  let loaded: BackchannelDeps;
  try {
    loaded = backchannelDeps();
  } catch (error) {
    console.error("backchannel logout failed", "config", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return backchannelHandler(request, loaded);
}
