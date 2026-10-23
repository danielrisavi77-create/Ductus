import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import SignInScreen from "@/components/auth/SignInScreen";
import { SIGN_IN_DEFAULT_TARGET, signInHref, signInTarget } from "@/components/auth/sign-in-link";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.prijava.title} · ${t.app.name}` };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// FE-D3 (DAN-222): the sign-in screen. Students and teachers sign in only
// through AAI@EduHr (D-09), by the existing login route. Convenience only, not
// a safeguard: a visitor who already carries a session cookie goes to the
// workspace; the routes behind it check the session themselves.
export default async function PrijavaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token && TOKEN.test(token)) redirect(SIGN_IN_DEFAULT_TARGET);
  const { returnTo } = await searchParams;
  return <SignInScreen href={signInHref(signInTarget(returnTo))} />;
}
