import { existsSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HOW_IT_WORKS_HREF } from "@/components/shell/nav";
import type { ShellAccount } from "@/components/shell/shell-role";

import { howItWorksShell } from "./access";
import HowItWorks from "./HowItWorks";

// DAN-431 (J-02), contract (a): the four reader classes. The page is the same
// for all of them; only the shell follows the session. Accounts are invented.
const SCOPE = "a".repeat(43);

const CASES: ReadonlyArray<{
  name: string;
  account: ShellAccount | null;
  role: "teacher" | "student" | null;
  scope: string | null;
}> = [
  { name: "signed out (no session)", account: { role: null, scope: null }, role: null, scope: null },
  { name: "student", account: { role: "student", scope: SCOPE }, role: "student", scope: SCOPE },
  { name: "teacher", account: { role: "teacher", scope: SCOPE }, role: "teacher", scope: SCOPE },
  // readShellAccount reads an administrator's base role; the admin shell
  // belongs to the institution screens only.
  { name: "administrator (base role teacher)", account: { role: "teacher", scope: SCOPE }, role: "teacher", scope: SCOPE },
  { name: "failed read", account: null, role: null, scope: null },
];

describe("howItWorksShell", () => {
  it.each(CASES)("$name: role $role", ({ account, role, scope }) => {
    expect(howItWorksShell(account)).toEqual({ role, scope });
  });

  it("never invents a role the read did not give", () => {
    for (const { account } of CASES) {
      expect(howItWorksShell(account).role).toBe(account?.role ?? null);
    }
  });
});

describe("/kako-radi", () => {
  it("is a route that exists", () => {
    expect(existsSync(join(process.cwd(), "app", HOW_IT_WORKS_HREF, "page.tsx"))).toBe(true);
  });

  it("renders the same page without any reader input", () => {
    const first = renderToStaticMarkup(createElement(HowItWorks));
    const second = renderToStaticMarkup(createElement(HowItWorks));
    expect(first).toBe(second);
    expect(first).not.toMatch(/<form|<input|<button/);
  });
});
