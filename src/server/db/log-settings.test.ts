import { describe, expect, it, vi } from "vitest";

import {
  assertNoParameterLogging,
  LOG_SETTINGS,
  LOG_SETTINGS_SQL,
  parameterLoggingSetting,
  withLogCheck,
} from "./log-settings";
import type { WithActor } from "./with-actor";

// PostgreSQL defaults, as pg_settings shows them to the app login of the
// local stack and CI (no extension loaded).
const DEFAULTS: Record<string, string> = {
  log_statement: "none",
  log_min_duration_statement: "-1",
  log_min_duration_sample: "-1",
  log_statement_sample_rate: "1",
  log_transaction_sample_rate: "0",
  log_parameter_max_length: "-1",
  log_parameter_max_length_on_error: "0",
  log_min_error_statement: "error",
  debug_print_parse: "off",
  debug_print_rewritten: "off",
  debug_print_plan: "off",
};
const settings = (over: Record<string, string> = {}, base = DEFAULTS) =>
  new Map(Object.entries({ ...base, ...over }).filter(([, value]) => value !== "<absent>"));

describe("parameterLoggingSetting", () => {
  it("passes the PostgreSQL defaults", () => {
    expect(parameterLoggingSetting(settings())).toBeNull();
  });

  it.each([
    [{ log_statement: "all" }, "log_statement"],
    [{ log_min_duration_statement: "0" }, "log_min_duration_statement"],
    [{ log_min_duration_statement: "250" }, "log_min_duration_statement"],
    [{ log_min_duration_sample: "0" }, "log_min_duration_sample"],
    [{ log_transaction_sample_rate: "0.01" }, "log_transaction_sample_rate"],
    [{ log_parameter_max_length_on_error: "-1" }, "log_parameter_max_length_on_error"],
    [{ log_parameter_max_length_on_error: "64" }, "log_parameter_max_length_on_error"],
    [{ debug_print_plan: "on" }, "debug_print_plan"],
    [{ debug_print_parse: "on" }, "debug_print_parse"],
    [{ debug_print_rewritten: "on" }, "debug_print_rewritten"],
  ])("refuses %o and names %s", (over, name) => {
    expect(parameterLoggingSetting(settings(over))).toBe(name);
  });

  it.each<Record<string, string>>([
    { log_statement: "mod" },
    { log_statement: "ddl" },
    { log_statement: "all", log_parameter_max_length: "0" },
    { log_min_duration_statement: "0", log_parameter_max_length: "0" },
    { log_min_duration_sample: "0", log_statement_sample_rate: "0" },
    { log_parameter_max_length_on_error: "-1", log_min_error_statement: "panic" },
  ])("passes %o, which logs no parameter of a SELECT", (over) => {
    expect(parameterLoggingSetting(settings(over))).toBeNull();
  });

  it("refuses a value it cannot read rather than guess", () => {
    expect(parameterLoggingSetting(settings({ log_min_duration_statement: "soon" }))).toBe("log_min_duration_statement");
    expect(parameterLoggingSetting(settings({ log_statement: "everything" }))).toBe("log_statement");
    expect(parameterLoggingSetting(settings({ debug_print_plan: "" }))).toBe("debug_print_plan");
  });

  it("refuses when a core setting is missing", () => {
    expect(parameterLoggingSetting(settings({ log_parameter_max_length: "<absent>" }))).toBe("log_parameter_max_length");
  });

  it("checks auto_explain and pgaudit only when they are loaded", () => {
    expect(parameterLoggingSetting(settings({ "auto_explain.log_min_duration": "-1" }))).toBeNull();
    expect(parameterLoggingSetting(settings({ "auto_explain.log_min_duration": "0" }))).toBe("auto_explain.log_parameter_max_length");
    expect(
      parameterLoggingSetting(settings({ "auto_explain.log_min_duration": "0", "auto_explain.log_parameter_max_length": "0" })),
    ).toBeNull();
    expect(parameterLoggingSetting(settings({ "pgaudit.log": "read", "pgaudit.log_parameter": "on" }))).toBe("pgaudit.log_parameter");
    expect(parameterLoggingSetting(settings({ "pgaudit.log": "none", "pgaudit.log_parameter": "on" }))).toBeNull();
    expect(parameterLoggingSetting(settings({ "pgaudit.log": "all", "pgaudit.log_parameter": "off" }))).toBeNull();
  });
});

describe("assertNoParameterLogging", () => {
  const pool = (rows: Record<string, string>) => {
    const query = vi.fn(async () => ({ rows: Object.entries(rows).map(([name, setting]) => ({ name, setting })) }));
    return { query } as unknown as Parameters<typeof assertNoParameterLogging>[0] & { query: typeof query };
  };

  it("reads every listed setting in one statement", async () => {
    const p = pool(DEFAULTS);
    await expect(assertNoParameterLogging(p)).resolves.toBeUndefined();
    expect(p.query).toHaveBeenCalledWith(LOG_SETTINGS_SQL, [[...LOG_SETTINGS]]);
  });

  it("names the setting and never its value", async () => {
    const error = await assertNoParameterLogging(pool({ ...DEFAULTS, log_min_duration_statement: "4321" })).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("log_min_duration_statement");
    expect((error as Error).message).not.toContain("4321");
  });
});

describe("withLogCheck", () => {
  /** A withActor that records each transaction it starts into `order`. */
  const recording = (order: string[]): WithActor => async (_token, fn) => {
    order.push("transaction");
    return fn({ query: async () => ({ rows: [], rowCount: 0 }) });
  };

  it("checks once, before the first transaction", async () => {
    const order: string[] = [];
    const check = vi.fn(async () => void order.push("check"));
    const guarded = withLogCheck(check, recording(order));
    await Promise.all([guarded(null, async () => 1), guarded(null, async () => 2)]);
    await guarded(null, async () => 3);
    expect(check).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["check", "transaction", "transaction", "transaction"]);
  });

  it("runs no transaction while the check refuses, and checks again on the next call", async () => {
    const order: string[] = [];
    const check = vi.fn(async () => {
      throw new Error("refused");
    });
    const guarded = withLogCheck(check, recording(order));
    await expect(guarded(null, async () => 1)).rejects.toThrow("refused");
    await expect(guarded(null, async () => 1)).rejects.toThrow("refused");
    expect(check).toHaveBeenCalledTimes(2);
    expect(order).toEqual([]);
  });

  it("opens once a later check passes", async () => {
    const order: string[] = [];
    const check = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue(undefined);
    const guarded = withLogCheck(check, recording(order));
    await expect(guarded(null, async () => 1)).rejects.toThrow("connection lost");
    await expect(guarded(null, async () => 7)).resolves.toBe(7);
    expect(order).toEqual(["transaction"]);
  });
});
