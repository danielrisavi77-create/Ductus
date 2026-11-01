import type { Pool } from "pg";

import type { WithActor } from "./with-actor";

// The first statement of every withActor transaction carries the raw session
// token as a bind parameter (with-actor.ts). A database that writes statement
// parameters to its log would keep live bearer tokens there (F-036, DAN-169;
// docs/backend/baza-i-pogon.md). Before the first transaction the web process
// reads the logging settings its login sees and refuses to run when any of
// them would log a parameter of that statement. Only the setting's name is
// reported, never its value.

/** Settings the check reads; a core one that is missing counts as unsafe. */
export const LOG_SETTINGS = [
  "log_statement",
  "log_min_duration_statement",
  "log_min_duration_sample",
  "log_statement_sample_rate",
  "log_transaction_sample_rate",
  "log_parameter_max_length",
  "log_parameter_max_length_on_error",
  "log_min_error_statement",
  "debug_print_parse",
  "debug_print_rewritten",
  "debug_print_plan",
  // Extensions: present only when the library is loaded for this login.
  "auto_explain.log_min_duration",
  "auto_explain.log_parameter_max_length",
  "pgaudit.log",
  "pgaudit.log_parameter",
] as const;

const CORE = LOG_SETTINGS.filter((name) => !name.includes("."));

export const LOG_SETTINGS_SQL = "SELECT name, setting FROM pg_catalog.pg_settings WHERE name = ANY($1::text[])";

/** A number as pg_settings writes it, or NaN for anything else. */
function num(value: string | undefined): number {
  return value !== undefined && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
}

/** Off only when stated as off; a value that cannot be read counts as on. */
const isOn = (value: string | undefined) => value !== "off";
/** Logging is off only for -1 (or 0 for a rate); NaN counts as on. */
const durationLogs = (value: string | undefined) => !(num(value) < 0);
const rateLogs = (value: string | undefined) => !(num(value) <= 0);
/** Parameters are written unless the limit is exactly 0. */
const parametersLogged = (value: string | undefined) => num(value) !== 0;

/**
 * The name of the first setting that would write a parameter of a withActor
 * statement to the database log, or null when none would.
 */
export function parameterLoggingSetting(settings: ReadonlyMap<string, string>): string | null {
  const missing = CORE.find((name) => !settings.has(name));
  if (missing) return missing;
  const get = (name: (typeof LOG_SETTINGS)[number]) => settings.get(name);

  // The plan of a statement holds its bound values, whatever the limits below.
  for (const name of ["debug_print_parse", "debug_print_rewritten", "debug_print_plan"] as const) {
    if (isOn(get(name))) return name;
  }
  // A statement written on error carries its parameters up to this limit.
  if (get("log_min_error_statement") !== "panic" && parametersLogged(get("log_parameter_max_length_on_error"))) {
    return "log_parameter_max_length_on_error";
  }
  if (parametersLogged(get("log_parameter_max_length"))) {
    // withActor statements are SELECT, so only "all" of log_statement logs them.
    if (get("log_statement") !== "none" && get("log_statement") !== "ddl" && get("log_statement") !== "mod") {
      return "log_statement";
    }
    if (durationLogs(get("log_min_duration_statement"))) return "log_min_duration_statement";
    if (durationLogs(get("log_min_duration_sample")) && rateLogs(get("log_statement_sample_rate"))) {
      return "log_min_duration_sample";
    }
    if (rateLogs(get("log_transaction_sample_rate"))) return "log_transaction_sample_rate";
  }
  if (settings.has("auto_explain.log_min_duration") && durationLogs(get("auto_explain.log_min_duration"))
      && parametersLogged(get("auto_explain.log_parameter_max_length"))) {
    return "auto_explain.log_parameter_max_length";
  }
  if (settings.has("pgaudit.log_parameter") && isOn(get("pgaudit.log_parameter")) && get("pgaudit.log") !== "none") {
    return "pgaudit.log_parameter";
  }
  return null;
}

/** Reads the settings on `pool` and throws, naming the setting, when one would log a parameter. */
export async function assertNoParameterLogging(pool: Pick<Pool, "query">): Promise<void> {
  const result = await pool.query<{ name: string; setting: string }>(LOG_SETTINGS_SQL, [[...LOG_SETTINGS]]);
  const unsafe = parameterLoggingSetting(new Map(result.rows.map((row) => [row.name, row.setting])));
  if (unsafe) {
    throw new Error(`the database may log statement parameters (${unsafe}); database access stays closed`);
  }
}

/**
 * withActor that runs `check` before its first transaction. No transaction
 * starts until a check has passed; a failed check is not remembered, so the
 * next call checks again, and a refusal keeps refusing.
 */
export function withLogCheck(check: () => Promise<void>, actor: WithActor): WithActor {
  let passed = false;
  let pending: Promise<void> | undefined;
  return async (token, fn) => {
    if (!passed) {
      pending ??= check().then(
        () => {
          passed = true;
        },
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      );
      await pending;
    }
    return actor(token, fn);
  };
}
