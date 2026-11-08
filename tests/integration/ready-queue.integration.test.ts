import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { withActor } from "@/server/db";

import { GET } from "../../app/api/ready/route";
import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-585: the queue capability of /api/ready against the real catalogue, as
// the web role reads it through withActor. A synthetic login that inherits
// ductus_worker stands in for the worker; it is made and dropped here.
const ADMIN_URL = requireLoopbackDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
  "DATABASE_URL must point at this machine",
);
const WORKER_LOGIN = "it_ready_queue_worker";
const password = randomBytes(24).toString("hex");

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
let worker: pg.Client | undefined;

function loginUrl(): string {
  const url = new URL(ADMIN_URL);
  url.username = WORKER_LOGIN;
  url.password = password;
  return url.toString();
}

async function queue(): Promise<unknown> {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const body = await (await GET()).json();
  vi.restoreAllMocks();
  expect(body.capabilities.database).toBe("ok");
  return body.capabilities.queue;
}

beforeAll(async () => {
  await admin.query(`DROP ROLE IF EXISTS ${WORKER_LOGIN}`);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_worker', $1::text, $2::text) AS ddl",
    [WORKER_LOGIN, password],
  );
  await admin.query(ddl.rows[0].ddl);
});

afterAll(async () => {
  await worker?.end().catch(() => {});
  await admin.query(`DROP ROLE IF EXISTS ${WORKER_LOGIN}`);
  await admin.end();
});

describe("/api/ready queue capability", () => {
  it("sees background rows whose usename and datname are NULL, and they never count as a worker", async () => {
    const visible = await withActor(null, async (tx) =>
      (await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE usename IS NULL AND datname IS NULL",
      )).rows[0].n,
    );
    expect(visible).toBeGreaterThan(0);
    // The synthetic login exists but holds no session: no worker takes jobs.
    expect(await queue()).toBe("nedostupno");
  });

  it("reads ok while a login that inherits ductus_worker is connected, and nedostupno once it leaves", async () => {
    worker = new pg.Client({ connectionString: loginUrl() });
    await worker.connect();
    expect(await queue()).toBe("ok");
    await worker.end();
    worker = undefined;
    // pg_stat_activity drops the session once its backend has exited.
    await expect.poll(queue, { timeout: 5_000, interval: 100 }).toBe("nedostupno");
  });
});
