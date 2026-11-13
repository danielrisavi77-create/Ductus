import { cookies } from "next/headers";

import { howItWorksShell } from "@/components/how-it-works/access";
import HowItWorks from "@/components/how-it-works/HowItWorks";
import AppShell from "@/components/shell/AppShell";
import { HOW_IT_WORKS_HREF } from "@/components/shell/nav";
import { readShellAccountOrFailure } from "@/components/shell/shell-role";
import { shellSession } from "@/components/shell/shell-session";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const t = messagesHr.howItWorks;
export const metadata = { title: `${t.title} · ${messagesHr.app.name}` };

// DAN-431 (M11.10, J-02): "Kako Ductura radi". The page is static and the
// same for every reader, signed in or not; only the shell follows the session
// (src/components/how-it-works/access.ts). Nothing on it reads or writes data.
export default async function HowItWorksPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  pageActivity(token);
  const { role, scope } = howItWorksShell(await readShellAccountOrFailure(token, withActor));
  return (
    <AppShell session={shellSession(token)} role={role} scope={scope} current={HOW_IT_WORKS_HREF} crumbs={[t.title]}>
      <HowItWorks />
    </AppShell>
  );
}
