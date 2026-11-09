import { describe, expect, it } from "vitest";

import { parseWorkerEnvironment, WORKER_NUMBERS } from "./environment";

// DAN-517, plan #1826 W-14. The table of input classes was written before the
// parser. Every value below is invented; the address names a reserved domain.
const URL_OK = "postgres://synthetic_worker:synthetic-pass@db.example:5432/ductus";
const SECRET = "synthetic-pass";
const NUMBER_NAMES = Object.keys(WORKER_NUMBERS) as Array<keyof typeof WORKER_NUMBERS>;

function problems(env: Record<string, string | undefined>): readonly string[] {
  const result = parseWorkerEnvironment(env);
  return result.ok ? [] : result.problems;
}

describe("worker environment: the database address", () => {
  const cases: ReadonlyArray<[string, string | undefined, string]> = [
    ["missing", undefined, "WORKER_DATABASE_URL is not set"],
    ["empty", "", "WORKER_DATABASE_URL is not set"],
    ["spaces only", "   ", "WORKER_DATABASE_URL is not set"],
    ["a tab and a newline only", "\t\n", "WORKER_DATABASE_URL is not set"],
    ["not a URL", "synthetic-pass at db.example", "WORKER_DATABASE_URL is not a URL"],
    ["a bare host", "db.example", "WORKER_DATABASE_URL is not a URL"],
    ["a space before", ` ${URL_OK}`, "WORKER_DATABASE_URL is not a URL"],
    ["a space after", `${URL_OK} `, "WORKER_DATABASE_URL is not a URL"],
    ["a newline inside", URL_OK.replace("@", "@\n"), "WORKER_DATABASE_URL is not a URL"],
    ["http", URL_OK.replace("postgres:", "http:"), "WORKER_DATABASE_URL is not a postgres URL"],
    ["https", URL_OK.replace("postgres:", "https:"), "WORKER_DATABASE_URL is not a postgres URL"],
    ["mysql", URL_OK.replace("postgres:", "mysql:"), "WORKER_DATABASE_URL is not a postgres URL"],
    ["file", "file:///synthetic-pass", "WORKER_DATABASE_URL is not a postgres URL"],
    ["no host", "postgres:///ductus?password=synthetic-pass", "WORKER_DATABASE_URL names no host"],
    ["no host, one slash", "postgres:/ductus", "WORKER_DATABASE_URL names no host"],
  ];
  it.each(cases)("%s is refused by name", (_label, value, expected) => {
    const env = value === undefined ? {} : { WORKER_DATABASE_URL: value };
    expect(problems(env)).toEqual([expected]);
  });

  it.each(["postgres:", "postgresql:"])("%s with a host is accepted unchanged", (protocol) => {
    const value = URL_OK.replace("postgres:", protocol);
    const result = parseWorkerEnvironment({ WORKER_DATABASE_URL: value });
    expect(result.ok && result.settings.queue.connectionString).toBe(value);
  });
});

describe("worker environment: the numbers", () => {
  // One table for every numeric variable: [class, value].
  const refused: ReadonlyArray<[string, string]> = [
    ["empty", ""],
    ["spaces only", "  "],
    ["a word", "many"],
    ["negative", "-1"],
    ["a plus sign", "+5"],
    ["a fraction", "1.5"],
    ["a fraction with a comma", "1,5"],
    ["an exponent", "1e3"],
    ["hexadecimal", "0x10"],
    ["a leading zero", "010"],
    ["a space before", " 10"],
    ["a space after", "10 "],
    ["a unit", "10s"],
    ["digits of another script", "١٠"],
    ["too many digits", "1234567890"],
    ["infinity", "Infinity"],
    ["not a number", "NaN"],
  ];
  const table = NUMBER_NAMES.flatMap((name) => refused.map(([label, value]) => [name, label, value] as const));
  it.each(table)("%s: %s is not a whole number", (name, _label, value) => {
    expect(problems({ WORKER_DATABASE_URL: URL_OK, [name]: value })).toEqual([`${name} is not a whole number`]);
  });

  it.each(NUMBER_NAMES)("%s: one below the least and one above the most are out of range", (name) => {
    const [, min, max] = WORKER_NUMBERS[name];
    const outside = [String(max + 1), ...(min > 0 ? [String(min - 1)] : [])];
    for (const value of outside) {
      const found = problems({ WORKER_DATABASE_URL: URL_OK, [name]: value });
      expect(found, `${name}=${value}`).toContain(`${name} is out of range`);
    }
  });

  it.each(NUMBER_NAMES)("%s: the least and the most are accepted", (name) => {
    const [, min, max] = WORKER_NUMBERS[name];
    // The deadline is also bound by the expiry; give it room either way.
    const room = { WORKER_JOB_EXPIRE_SECONDS: "3600", WORKER_JOB_DEADLINE_MS: "1" };
    for (const value of [min, max]) {
      const env = { WORKER_DATABASE_URL: URL_OK, ...room, [name]: String(value) };
      if (name === "WORKER_JOB_EXPIRE_SECONDS") env.WORKER_JOB_DEADLINE_MS = String(value * 1000 - 1);
      expect(problems(env), `${name}=${value}`).toEqual([]);
    }
  });

  it.each([
    ["equal to the expiry", "2", "2000"],
    ["above the expiry", "2", "2001"],
    ["the default deadline against a short expiry", "30", undefined],
  ])("a deadline %s is refused: the handler must stop before the queue takes the job back", (_label, expire, deadline) => {
    const env = { WORKER_DATABASE_URL: URL_OK, WORKER_JOB_EXPIRE_SECONDS: expire, WORKER_JOB_DEADLINE_MS: deadline };
    expect(problems(env)).toEqual(["WORKER_JOB_DEADLINE_MS is not below WORKER_JOB_EXPIRE_SECONDS"]);
  });

  it("a deadline one millisecond below the expiry is accepted", () => {
    const env = { WORKER_DATABASE_URL: URL_OK, WORKER_JOB_EXPIRE_SECONDS: "2", WORKER_JOB_DEADLINE_MS: "1999" };
    expect(problems(env)).toEqual([]);
  });
});

describe("worker environment: the whole", () => {
  it("only the address set gives the defaults", () => {
    expect(parseWorkerEnvironment({ WORKER_DATABASE_URL: URL_OK })).toEqual({
      ok: true,
      settings: {
        pollMs: 1000,
        queue: {
          connectionString: URL_OK,
          retryLimit: 3,
          retryDelaySeconds: 30,
          expireSeconds: 120,
          deadlineMs: 60_000,
          deleteAfterSeconds: 7 * 86_400,
          sweepSeconds: 10,
        },
      },
    });
  });

  it("every variable set is read as written", () => {
    const result = parseWorkerEnvironment({
      WORKER_DATABASE_URL: URL_OK,
      WORKER_POLL_MS: "50",
      WORKER_RETRY_LIMIT: "0",
      WORKER_RETRY_DELAY_SECONDS: "0",
      WORKER_JOB_EXPIRE_SECONDS: "5",
      WORKER_JOB_DEADLINE_MS: "4000",
      WORKER_KEEP_SECONDS: "60",
      WORKER_SWEEP_SECONDS: "1",
    });
    expect(result).toEqual({
      ok: true,
      settings: {
        pollMs: 50,
        queue: {
          connectionString: URL_OK,
          retryLimit: 0,
          retryDelaySeconds: 0,
          expireSeconds: 5,
          deadlineMs: 4000,
          deleteAfterSeconds: 60,
          sweepSeconds: 1,
        },
      },
    });
  });

  it("every problem is reported at once, each by the name of its variable", () => {
    const found = problems({
      WORKER_DATABASE_URL: "http://db.example/synthetic-pass",
      WORKER_POLL_MS: "1",
      WORKER_RETRY_LIMIT: "many",
      WORKER_SWEEP_SECONDS: "0",
    });
    expect(found).toEqual([
      "WORKER_DATABASE_URL is not a postgres URL",
      "WORKER_POLL_MS is out of range",
      "WORKER_RETRY_LIMIT is not a whole number",
      "WORKER_SWEEP_SECONDS is out of range",
    ]);
  });

  it("no problem ever carries a value: only names of variables and fixed words", () => {
    const shape = /^WORKER_[A-Z_]+ (is not set|is not a URL|is not a postgres URL|names no host|is not a whole number|is out of range|is not below WORKER_JOB_EXPIRE_SECONDS)$/;
    const hostile = [SECRET, `http://db.example/${SECRET}`, `postgres:///${SECRET}`, `${SECRET} 12`, "99999999", "0"];
    for (const value of hostile) {
      const env: Record<string, string> = { WORKER_DATABASE_URL: value };
      for (const name of NUMBER_NAMES) env[name] = value;
      const found = problems(env);
      expect(found.length).toBeGreaterThan(0);
      for (const problem of found) {
        expect(problem).toMatch(shape);
        expect(problem).not.toContain(SECRET);
      }
    }
  });

  it("variables the worker does not read change nothing", () => {
    const result = parseWorkerEnvironment({ WORKER_DATABASE_URL: URL_OK, APP_DATABASE_URL: "nonsense", WORKER_OTHER: "x" });
    expect(result.ok).toBe(true);
  });
});
