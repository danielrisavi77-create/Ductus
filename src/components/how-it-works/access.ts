import type { ShellRole } from "@/components/shell/nav";
import type { ShellAccount } from "@/components/shell/shell-role";

/** What the shell of /kako-radi shows for a reader. */
export type HowItWorksShell = { role: ShellRole | null; scope: string | null };

/**
 * The shell around "Kako Ductura radi" (DAN-431, J-02). The page itself is
 * the same for everyone: it reads nothing about the reader and has no state.
 * Only the shell follows the session, as on every other page: no session or a
 * failed read (`null`) shows no role and no navigation, never a guessed one.
 *
 * An administrator sees the shell of their base role. `readShellAccount`
 * knows teacher and student only; the administrator's shell comes from the
 * institution screens, which this page is not.
 */
export function howItWorksShell(account: ShellAccount | null): HowItWorksShell {
  if (account === null) return { role: null, scope: null };
  return { role: account.role, scope: account.scope };
}
