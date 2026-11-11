import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_BODY_MAX_BYTES,
  CHECKPOINT_HASHES_MAX,
  createWorkerCheckpointReader,
  type WorkerCheckpointQuery,
} from "./checkpoint-reader";

// Invented ids, texts and hashes (DAN-293, M3.3-P03). The bodies here do not
// hash to their keys: the adapter never hashes, the reconstruction does.
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const PACKAGE = "pkg-a";
const H = (letter: string) => letter.repeat(64);
const ASKED = [H("a"), H("b"), H("c")];

function database(answer: { rows?: unknown[]; fail?: unknown } = {}) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const query: WorkerCheckpointQuery = async (text, values) => {
    calls.push({ text, values });
    if ("fail" in answer) throw answer.fail;
    return { rows: answer.rows ?? [] };
  };
  return { calls, query };
}

function read(
  input: { domain?: unknown; package?: unknown; hashes?: unknown },
  answer: Parameters<typeof database>[0] = {},
) {
  const db = database(answer);
  const reader = createWorkerCheckpointReader({ query: db.query, evidenceDomainId: (input.domain ?? DOMAIN) as string });
  const result = reader.readCheckpoints({
    evidencePackageId: (input.package ?? PACKAGE) as string,
    documentHashes: (input.hashes ?? ASKED) as string[],
  });
  return { db, result };
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

// Input classes I1 to I7: refused before any query, with one closed reason.
describe("checkpoint reader input classes", () => {
  const sorted = (count: number) =>
    Array.from({ length: count }, (_, at) => at.toString(16).padStart(64, "0"));
  const refused: [string, { domain?: unknown; package?: unknown; hashes?: unknown }][] = [
    ["I1 a domain id that is not a v4 uuid", { domain: "not-a-domain" }],
    ["I1 an upper-case domain id", { domain: DOMAIN.toUpperCase() }],
    ["I1 an empty domain id", { domain: "" }],
    ["I2 a package id with upper case", { package: "Pkg-a" }],
    ["I2 an empty package id", { package: "" }],
    ["I2 a package id with a path", { package: "pkg/../b" }],
    ["I2 a package id that is not a string", { package: 7 }],
    ["I3 an empty hash list", { hashes: [] }],
    ["I3 a hash list that is not an array", { hashes: H("a") }],
    ["I4 an unsorted hash list", { hashes: [H("b"), H("a")] }],
    ["I5 a repeated hash", { hashes: [H("a"), H("a")] }],
    ["I6 an upper-case hash", { hashes: [H("A")] }],
    ["I6 a short hash", { hashes: ["a".repeat(63)] }],
    ["I6 a long hash", { hashes: ["a".repeat(65)] }],
    ["I6 a hash that is not hex", { hashes: [H("g")] }],
    ["I6 a hash that is not a string", { hashes: [null] }],
    ["I7 more than 256 hashes (contract c.6790948680)", { hashes: sorted(257) }],
  ];

  it.each(refused)("%s is refused without a query", async (_label, input) => {
    const { db, result } = read(input);
    await expect(result).resolves.toEqual({ status: "unavailable", reason: "invalid_checkpoint_request" });
    expect(db.calls).toEqual([]);
  });

  it("I8 a valid request makes one query with the domain, the package and the hashes", async () => {
    const { db, result } = read({});
    await expect(result).resolves.toEqual({ status: "found", checkpoints: new Map() });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].text).toMatch(/app\.worker_package_checkpoints\(\$1::uuid, \$2, \$3::text\[\]\)/);
    expect(db.calls[0].values).toEqual([DOMAIN, PACKAGE, ASKED]);
  });

  it("I8 exactly 256 hashes, the limit, are accepted", async () => {
    expect(CHECKPOINT_HASHES_MAX).toBe(256);
    const { db, result } = read({ hashes: sorted(256) });
    await expect(result).resolves.toMatchObject({ status: "found" });
    expect(db.calls).toHaveLength(1);
  });
});

// Row classes R1 to R8.
describe("checkpoint reader rows", () => {
  it("R1 no row is found with no checkpoint", async () => {
    await expect(read({}, { rows: [] }).result).resolves.toEqual({ status: "found", checkpoints: new Map() });
  });

  it("R2 each row becomes the UTF-8 bytes of its body under its hash", async () => {
    const { result } = read({}, {
      rows: [
        { content_hash: H("a"), body: "Prva inačica" },
        { content_hash: H("c"), body: "Treća" },
      ],
    });
    const found = await result;
    expect(found.status).toBe("found");
    if (found.status !== "found") return;
    expect([...found.checkpoints.keys()]).toEqual([H("a"), H("c")]);
    expect(text(found.checkpoints.get(H("a"))!)).toBe("Prva inačica");
    expect(found.checkpoints.get(H("a"))).toEqual(new TextEncoder().encode("Prva inačica"));
    expect(found.checkpoints.has(H("b"))).toBe(false);
  });

  it("R6 a body of exactly the limit is accepted", async () => {
    const body = "x".repeat(CHECKPOINT_BODY_MAX_BYTES);
    const found = await read({}, { rows: [{ content_hash: H("a"), body }] }).result;
    expect(found.status === "found" && found.checkpoints.get(H("a"))?.byteLength).toBe(CHECKPOINT_BODY_MAX_BYTES);
  });

  const refusedRows: [string, unknown[]][] = [
    ["R3 a row under a hash that was not asked", [{ content_hash: H("d"), body: "x" }]],
    ["R4 two rows under one hash", [{ content_hash: H("a"), body: "x" }, { content_hash: H("a"), body: "y" }]],
    ["R5 a body that is not a string", [{ content_hash: H("a"), body: 1 }]],
    ["R5 a null body", [{ content_hash: H("a"), body: null }]],
    ["R5 a hash that is not a string", [{ content_hash: null, body: "x" }]],
    ["R5 an empty body", [{ content_hash: H("a"), body: "" }]],
    ["R6 a body over the limit", [{ content_hash: H("a"), body: "x".repeat(CHECKPOINT_BODY_MAX_BYTES + 1) }]],
    ["R6 a body over the limit in UTF-8 bytes only", [{ content_hash: H("a"), body: "č".repeat(CHECKPOINT_BODY_MAX_BYTES / 2 + 1) }]],
    ["R8 a row with a key more", [{ content_hash: H("a"), body: "x", institution_id: DOMAIN }]],
    ["R8 a row without a body", [{ content_hash: H("a") }]],
    ["R8 a row that is not an object", ["x"]],
    ["R8 a null row", [null]],
  ];

  it.each(refusedRows)("%s makes the whole read unavailable, never a partial map", async (_label, rows) => {
    await expect(read({}, { rows }).result).resolves.toEqual({ status: "unavailable", reason: "invalid_checkpoint_row" });
  });

  it("R8 an answer without a row list is unavailable", async () => {
    const db = { query: (async () => ({})) as unknown as WorkerCheckpointQuery };
    const reader = createWorkerCheckpointReader({ query: db.query, evidenceDomainId: DOMAIN });
    await expect(reader.readCheckpoints({ evidencePackageId: PACKAGE, documentHashes: ASKED })).resolves.toEqual({
      status: "unavailable",
      reason: "invalid_checkpoint_row",
    });
  });

  it.each([
    ["a driver error that names the text", new Error('relation "evidence.document_checkpoint": body "Tajna"')],
    ["a permission error", Object.assign(new Error("permission denied"), { code: "42501" })],
    ["a thrown value that is not an error", "x"],
  ])("R7 %s is unavailable with a closed reason and no driver text", async (_label, fail) => {
    const result = await read({}, { fail }).result;
    expect(result).toEqual({ status: "unavailable", reason: "checkpoints_failed" });
    expect(JSON.stringify(result)).not.toMatch(/Tajna|permission|relation/);
  });
});
