import { DEFAULT_RETURN_TO, safeReturnTo } from "@/server/auth/return-to";

/**
 * Where /prijava sends a person after sign-in when nothing else is asked for:
 * the home page, which sends a signed-in person on to their own page by the
 * role the database knows (DAN-325, `readHome` in src/components/shell/shell-role.ts).
 */
export const SIGN_IN_DEFAULT_TARGET = DEFAULT_RETURN_TO;

/**
 * The page to return to after sign-in, from the untrusted `returnTo` query of
 * /prijava. The login route checks it again (safeReturnTo); this only keeps
 * the link on the page from carrying what that route would discard.
 */
export function signInTarget(raw: unknown): string {
  return safeReturnTo(raw);
}

/** The existing login flow (B-6): a plain link, answered with a redirect to AAI@EduHr. */
export function signInHref(target: string): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(target)}`;
}

const SESSION_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** True for /prijava however a browser could spell it, so a forward never lands back on it. */
function isSignInPage(target: string): boolean {
  let path = target.split(/[?#]/, 1)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    return true;
  }
  return path.toLowerCase().replace(/\/+$/, "") === "/prijava";
}

/**
 * Where /prijava sends a visitor who already carries a cookie of the
 * session's shape: on to the page they asked to return to (#1231), which
 * reads the session itself and shows Z-03 when it is closed, or to "/" when
 * nothing safe is asked for, which sends the person to their own page
 * (DAN-325). Decided by the shape alone, so /prijava never reads the
 * database (F-151); null keeps the sign-in screen. /prijava itself as the
 * target would forward in a loop, so it becomes "/".
 */
export function signedInRedirect(token: string | undefined, returnTo?: unknown): string | null {
  if (token === undefined || !SESSION_SHAPE.test(token)) return null;
  const target = signInTarget(returnTo);
  return isSignInPage(target) ? SIGN_IN_DEFAULT_TARGET : target;
}
