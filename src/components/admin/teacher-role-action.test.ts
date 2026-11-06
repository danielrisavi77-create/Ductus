import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { confirmTeacherRole, revokeTeacherRole, type TeacherRoleAction } from "./teacher-role-action";

// DAN-581 (A-02, plan #1592 B and C): one POST per action, and only the
// exact 200 reply of that action counts as done. Everything the reply does
// not prove is "unknown", never a success and never retried here.
const ID = "3f1c2a4e-9b7d-4c1e-8a2f-5d6e7f8a9b0c";

const reply = (status: number, body: unknown) => async () =>
  new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const run = (action: TeacherRoleAction, send: typeof fetch) =>
  (action === "confirm" ? confirmTeacherRole : revokeTeacherRole)(ID, send);

describe("teacher role actions: what each reply means", () => {
  it.each<[TeacherRoleAction, number, unknown, string]>([
    ["confirm", 200, { confirmed: true }, "confirmed"],
    ["revoke", 200, { revoked: true }, "revoked"],
    ["revoke", 200, { revoked: false }, "notConfirmed"],
    ["confirm", 404, { error: "not_found" }, "notCandidate"],
    ["revoke", 404, { error: "not_found" }, "unknown"],
    ["confirm", 401, { error: "unauthorized" }, "unauthorized"],
    ["revoke", 401, { error: "unauthorized" }, "unauthorized"],
    ["confirm", 403, { error: "forbidden" }, "forbidden"],
    ["revoke", 403, { error: "forbidden" }, "forbidden"],
    ...[400, 413, 415, 422].flatMap((status) => (["confirm", "revoke"] as const)
      .map((action): [TeacherRoleAction, number, unknown, string] => [action, status, { error: "invalid_input" }, "invalid"])),
    ["confirm", 503, { error: "unavailable" }, "unknown"],
    ["revoke", 500, undefined, "unknown"],
    ["confirm", 302, undefined, "unknown"],
    ["confirm", 200, { confirmed: false }, "unknown"],
    ["confirm", 200, { confirmed: "true" }, "unknown"],
    ["confirm", 200, { confirmed: true, extra: 1 }, "unknown"],
    ["confirm", 200, { revoked: true }, "unknown"],
    ["revoke", 200, { confirmed: true }, "unknown"],
    ["revoke", 200, { revoked: "false" }, "unknown"],
    ["revoke", 200, [true], "unknown"],
    ["revoke", 200, "not json", "unknown"],
    ["confirm", 200, null, "unknown"],
  ])("%s, %i %j → %s", async (action, status, body, kind) => {
    expect(await run(action, vi.fn(reply(status, body)))).toEqual({ kind });
  });

  it("a network error or a redirect refused by fetch is unknown, never retried", async () => {
    for (const action of ["confirm", "revoke"] as const) {
      const send = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
      expect(await run(action, send)).toEqual({ kind: "unknown" });
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it("an id that is not a UUID is invalid and sends nothing", async () => {
    for (const id of ["", "1", `${ID} `, `${ID}/role-revocation`, "../x", ID.replaceAll("-", "")]) {
      const send = vi.fn(reply(200, { confirmed: true }));
      expect(await confirmTeacherRole(id, send)).toEqual({ kind: "invalid" });
      expect(await revokeTeacherRole(id, send)).toEqual({ kind: "invalid" });
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("sends one empty POST to the action's own route", async () => {
    for (const [action, path] of [["confirm", "role-confirmation"], ["revoke", "role-revocation"]] as const) {
      const send = vi.fn(reply(200, action === "confirm" ? { confirmed: true } : { revoked: true }));
      await run(action, send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(`/api/institution/teachers/${ID}/${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        cache: "no-store", redirect: "error", body: "{}",
      });
    }
  });
});

describe("teacher role actions: no other reply is a success (property)", () => {
  const SUCCESS: Record<TeacherRoleAction, string> = { confirm: '{"confirmed":true}', revoke: '{"revoked":true}' };
  const body = fc.oneof(
    fc.json(),
    fc.string(),
    fc.constantFrom('{"confirmed":true}', '{"revoked":true}', '{"revoked":false}', '{"confirmed":true,"x":0}'),
  );

  it("only the exact 200 of the action is done, and one request is sent", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom<TeacherRoleAction>("confirm", "revoke"), fc.integer({ min: 200, max: 599 }), body,
      async (action, status, text) => {
        const send = vi.fn(async () => new Response([204, 205, 304].includes(status) ? null : text, { status }));
        const { kind } = await run(action, send);
        expect(send).toHaveBeenCalledTimes(1);
        const exact = status === 200 && JSON.stringify(safeParse(text)) === SUCCESS[action];
        expect(kind === "confirmed" || kind === "revoked").toBe(exact);
      },
    ));
  });
});

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
