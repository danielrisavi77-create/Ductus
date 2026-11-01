import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertNoParameterLogging, withLogCheck } from "@/server/db/log-settings";
import { createWithActor } from "@/server/db/with-actor";

// The logging check of the web process (F-036, DAN-169) against the compose
// stack, read through a real ductus_app login. Settings are placed on that
// login with ALTER ROLE, as a provider or an operator would, so they are what
// the login sees at connect time. The password is random and synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const APP_URL = process.env.APP_DATABASE_URL ?? "";
// The login exists only while this file runs: pgTAP (010) lists every
// membership in a ductus_* role, and logins belong to the environment.
const LOGIN = "it_log_settings_login";
const password = randomBytes(24).toString("hex");

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });

/** A fresh pool of the test login, so each test sees the role settings of that moment. */
async function withLoginPool<T>(fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const url = new URL(ADMIN_URL);
  url.username = LOGIN;
  url.password = password;
  const pool = new pg.Pool({ connectionString: url.href, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function setOnLogin(settings: Record<string, string | null>) {
  for (const [name, value] of Object.entries(settings)) {
    const ddl = value === null
      ? await admin.query<{ ddl: string }>("SELECT format('ALTER ROLE %I RESET %I', $1::text, $2::text) AS ddl", [LOGIN, name])
      : await admin.query<{ ddl: string }>("SELECT format('ALTER ROLE %I SET %I = %L', $1::text, $2::text, $3::text) AS ddl", [
          LOGIN, name, value,
        ]);
    await admin.query(ddl.rows[0].ddl);
  }
}

beforeAll(async () => {
  await admin.query(`DROP ROLE IF EXISTS ${LOGIN}`);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [LOGIN, password],
  );
  await admin.query(ddl.rows[0].ddl);
});

afterAll(async () => {
  await admin.query(`DROP ROLE IF EXISTS ${LOGIN}`);
  await admin.end();
});

describe("database logging check", () => {
  it("passes the application login of the local stack", async () => {
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(assertNoParameterLogging(pool)).resolves.toBeUndefined();
    } finally {
      await pool.end();
    }
  });

  it("passes a fresh login with the server defaults", async () => {
    await withLoginPool(async (pool) => {
      await expect(assertNoParameterLogging(pool)).resolves.toBeUndefined();
    });
  });

  it("refuses statement logging that writes parameters, naming the setting", async () => {
    await setOnLogin({ log_min_duration_statement: "0" });
    try {
      await withLoginPool(async (pool) => {
        await expect(assertNoParameterLogging(pool)).rejects.toThrow("(log_min_duration_statement)");
      });
      await setOnLogin({ log_parameter_max_length: "0" });
      await withLoginPool(async (pool) => {
        await expect(assertNoParameterLogging(pool)).resolves.toBeUndefined();
      });
    } finally {
      await setOnLogin({ log_min_duration_statement: null, log_parameter_max_length: null });
    }
  });

  it("refuses log_statement = all and parameters written on error", async () => {
    await setOnLogin({ log_statement: "all" });
    try {
      await withLoginPool(async (pool) => {
        await expect(assertNoParameterLogging(pool)).rejects.toThrow("(log_statement)");
      });
    } finally {
      await setOnLogin({ log_statement: null });
    }
    await setOnLogin({ log_parameter_max_length_on_error: "-1" });
    try {
      await withLoginPool(async (pool) => {
        await expect(assertNoParameterLogging(pool)).rejects.toThrow("(log_parameter_max_length_on_error)");
      });
    } finally {
      await setOnLogin({ log_parameter_max_length_on_error: null });
    }
  });

  it("starts no withActor transaction while the login would log the token", async () => {
    await setOnLogin({ log_min_duration_statement: "0" });
    try {
      await withLoginPool(async (pool) => {
        const actor = withLogCheck(() => assertNoParameterLogging(pool), createWithActor(pool));
        let ran = false;
        await expect(
          actor(randomBytes(32).toString("base64url"), async () => {
            ran = true;
          }),
        ).rejects.toThrow("database access stays closed");
        expect(ran).toBe(false);
      });
    } finally {
      await setOnLogin({ log_min_duration_statement: null });
    }
  });
});
