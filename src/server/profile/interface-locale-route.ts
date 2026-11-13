import { canonicalizeJcs } from "@/domain/forensics/jcs";
import {
  INTERFACE_LOCALE_SETTING_VALUES,
  parseInterfaceLocaleSetting,
} from "@/domain/profile/interface-locale-setting";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";
import type { InterfaceLocale } from "@/lib/i18n/locale";

/**
 * DAN-427 (M11.5-P02) HTTP boundary for the interface language setting
 * (contract on #1836, c.6820446364). GET answers the caller's saved value or
 * null; POST saves `{"locale": "hr" | "en"}` and nothing else. Who it is comes
 * from the session inside identity.interface_locale() and
 * identity.set_interface_locale(), never from the body, so the AAI identity
 * (D-09) and the language of a work are out of reach.
 *
 * A log line carries one closed code, never a value from the body.
 */

// {"locale":"hr"} is 15 bytes; 256 leaves room for nothing else.
export const MAX_INTERFACE_LOCALE_BODY_BYTES = 256;
const BODY_TIMEOUT_MS = 5_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const NO_STORE = { "cache-control": "no-store" };

// Spelled out in full: the RPC/HTTP inventory looks for "identity.<name>(".
const READ_SQL = "SELECT identity.interface_locale() AS locale";
const SET_SQL = "SELECT identity.set_interface_locale($1) AS locale";

export interface InterfaceLocaleDeps {
  withActor: WithActor;
  sessionToken?: string;
}

export interface InterfaceLocalePostDeps extends InterfaceLocaleDeps {
  expectedOrigin: string;
}

function respond(status: number, payload: Record<string, unknown> = { error: "unavailable" }): Response {
  return Response.json(payload, { status, headers: NO_STORE });
}

function isLocale(value: unknown): value is InterfaceLocale {
  return typeof value === "string" && (INTERFACE_LOCALE_SETTING_VALUES as readonly string[]).includes(value);
}

function codeOf(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

type Outcome = { ok: true; value: unknown } | { ok: false; response: Response };

async function rpc(token: string, deps: InterfaceLocaleDeps, sql: string, params: unknown[]): Promise<Outcome> {
  try {
    const result = await deps.withActor(token, (tx) => tx.query<{ locale: unknown }>(sql, params));
    if (result.rows.length !== 1) {
      console.error("interface locale failed", "row_malformed");
      return { ok: false, response: respond(503) };
    }
    return { ok: true, value: result.rows[0]?.locale };
  } catch (error) {
    // PostgreSQL raises documented ZD codes; its message, SQL and parameters never leave.
    const code = codeOf(error);
    if (code === "ZD401") return { ok: false, response: respond(401, { error: "unauthorized" }) };
    if (code === "ZD422") return { ok: false, response: respond(422, { error: "invalid_input" }) };
    console.error("interface locale failed", typeof code === "string" && SQLSTATE.test(code) ? code : "unknown");
    return { ok: false, response: respond(503) };
  }
}

/** GET: the caller's saved interface language, or null when none is saved. */
export async function handleInterfaceLocaleGet(request: Request, deps: InterfaceLocaleDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return respond(405, { error: "method_not_allowed" });
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return respond(403, { error: "forbidden" });
  const token = deps.sessionToken;
  if (token === undefined || !TOKEN.test(token)) return respond(401, { error: "unauthorized" });
  const read = await rpc(token, deps, READ_SQL, []);
  if (!read.ok) return read.response;
  if (read.value !== null && !isLocale(read.value)) {
    console.error("interface locale failed", "row_malformed");
    return respond(503);
  }
  return respond(200, { locale: read.value });
}

/** POST: saves the caller's interface language and answers the saved value. */
export async function handleInterfaceLocalePost(request: Request, deps: InterfaceLocalePostDeps): Promise<Response> {
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return respond(503);
  }
  if (!allowed.ok) return respond(allowed.status, { error: allowed.reason });
  const token = deps.sessionToken;
  if (token === undefined || !TOKEN.test(token)) return respond(401, { error: "unauthorized" });
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return respond(415, { error: "unsupported_media_type" });
  }

  const raw = await readBodyWithLimit(request, MAX_INTERFACE_LOCALE_BODY_BYTES, BODY_TIMEOUT_MS);
  if (!raw.ok) return respond(raw.status, { error: raw.reason });
  let text: string;
  let value: unknown;
  try {
    // A byte order mark stays in the text, so it is refused like any other byte.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw.bytes);
    value = JSON.parse(text);
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  let canonical = false;
  try {
    canonical = canonicalizeJcs(value) === text;
  } catch {
    canonical = false;
  }
  const setting = canonical ? parseInterfaceLocaleSetting(value) : null;
  if (!setting) return respond(422, { error: "invalid_input" });

  const saved = await rpc(token, deps, SET_SQL, [setting.locale]);
  if (!saved.ok) return saved.response;
  if (saved.value !== setting.locale) {
    console.error("interface locale failed", "row_malformed");
    return respond(503);
  }
  return respond(200, { locale: setting.locale });
}
