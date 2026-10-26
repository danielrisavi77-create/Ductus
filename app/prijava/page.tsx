import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import SignInScreen from "@/components/auth/SignInScreen";
import { signInHref, signInTarget } from "@/components/auth/sign-in-link";
import SessionObserver from "@/components/shell/SessionObserver";
import { shellSession } from "@/components/shell/shell-session";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { homeTarget } from "@/server/institution/home-target";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.prijava.title} · ${t.app.name}` };

// FE-D3 (DAN-222): the sign-in screen. Students and teachers sign in only
// through AAI@EduHr (D-09), by the existing login route. Convenience only, not
// a safeguard: a person with an open session goes to their own page by the
// role the database knows (DAN-325); without one, or when the database cannot
// say, the sign-in screen stays. The routes behind it check the session
// themselves.
export default async function PrijavaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const home = token === undefined ? null : await homeTarget(token, withActor);
  if (home?.kind === "page") redirect(home.path);
  const { returnTo } = await searchParams;
  // Outside the shell: the sign-in screen marks the session itself (F-113 t.1).
  const { tag, at } = shellSession(token);
  return (
    <>
      <SessionObserver tag={tag} at={at} />
      <SignInScreen href={signInHref(signInTarget(returnTo))} />
    </>
  );
}
