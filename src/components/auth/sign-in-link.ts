import { DEFAULT_RETURN_TO, safeReturnTo } from "@/server/auth/return-to";

/** Where /prijava sends a person after sign-in when nothing else is asked for. */
export const SIGN_IN_DEFAULT_TARGET = "/rad";

/**
 * The page to return to after sign-in, from the untrusted `returnTo` query of
 * /prijava. The login route checks it again (safeReturnTo); this only keeps
 * the link on the page from carrying what that route would discard, and turns
 * its fallback ("/") into the workspace.
 */
export function signInTarget(raw: unknown): string {
  const target = safeReturnTo(raw);
  return target === DEFAULT_RETURN_TO ? SIGN_IN_DEFAULT_TARGET : target;
}

/** The existing login flow (B-6): a plain link, answered with a redirect to AAI@EduHr. */
export function signInHref(target: string): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(target)}`;
}
