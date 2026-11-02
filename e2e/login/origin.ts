import { loginOrigin } from "../../scripts/demo/login-e2e-https.mjs";

/**
 * The origin of the app under test: https on our own dev server, http against a
 * server reused with E2E_REUSE_SERVER=1 (playwright.login.config.ts). Specs use
 * this and never spell the address out.
 */
export const APP_ORIGIN = loginOrigin(process.env);

/** The origin as a pattern, for a RegExp that has to match it. */
export const APP_ORIGIN_PATTERN = APP_ORIGIN.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
