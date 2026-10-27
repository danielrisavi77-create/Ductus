import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// DAN-344 P1-b (addendum c.6435323774 on #923): the timing migration copies
// the live acceptance and replay source and changes only the named lines. The
// copies are checked here instead of by eye, on the way up and on the way down.
const DIRECTORY = new URL("../../db/migrations/", import.meta.url);
const NAME = "20261028140000_evidence_segment_timing.sql";

function migration(name: string): string {
  return readFileSync(new URL(name, DIRECTORY), "utf8");
}
function upOf(text: string): string {
  const down = text.indexOf("-- migrate:down");
  return down < 0 ? text : text.slice(0, down);
}
function downOf(text: string): string {
  const down = text.indexOf("-- migrate:down");
  expect(down).toBeGreaterThanOrEqual(0);
  return text.slice(down);
}

const ACCEPTANCE = "FUNCTION app.commit_evidence_segment(";
const SOURCE = "FUNCTION app.read_replay_source(";

/** The one definition of `name` in `text`, from CREATE to the closing `$$;`. */
function definitionOf(text: string, name: string): string {
  const starts = [`CREATE ${name}`, `CREATE OR REPLACE ${name}`].flatMap((header) => {
    const found: number[] = [];
    for (let at = text.indexOf(header); at >= 0; at = text.indexOf(header, at + 1)) found.push(at);
    return found;
  });
  expect(starts).toHaveLength(1);
  const end = text.indexOf("\n$$;", starts[0]);
  expect(end).toBeGreaterThan(starts[0]);
  return text.slice(starts[0], end + "\n$$;".length);
}

/** `text` with each `[from, to]` replaced, each `from` found exactly `times` times. */
function changed(text: string, swaps: [string, string, number?][]): string {
  return swaps.reduce((out, [from, to, times = 1]) => {
    expect(out.split(from).length - 1).toBe(times);
    return out.split(from).join(to);
  }, text);
}

const LIVE_ACCEPTANCE = definitionOf(upOf(migration("20261028000000_evidence_segment_v3.sql")), ACCEPTANCE).replace(
  /^CREATE OR REPLACE FUNCTION /,
  "CREATE FUNCTION ",
);
const LIVE_SOURCE = definitionOf(upOf(migration("20261028110000_replay_source.sql")), SOURCE);
const TIMING = migration(NAME);

describe("evidence segment timing migration", () => {
  it("copies the latest definition of each function before it", () => {
    const earlier = readdirSync(DIRECTORY)
      .filter((name) => name.endsWith(".sql") && name < NAME)
      .sort();
    const defines = (text: string, name: string) =>
      text.includes(`CREATE ${name}`) || text.includes(`CREATE OR REPLACE ${name}`);
    const lastDefining = (name: string) => earlier.filter((file) => defines(upOf(migration(file)), name)).at(-1);
    expect(lastDefining(ACCEPTANCE)).toBe("20261028000000_evidence_segment_v3.sql");
    expect(lastDefining(SOURCE)).toBe("20261028110000_replay_source.sql");
  });

  it("adds only the timing parameter, its check and its column to the acceptance", () => {
    expect(definitionOf(upOf(TIMING), ACCEPTANCE)).toBe(
      changed(LIVE_ACCEPTANCE, [
        ["  p_snapshot text\n) RETURNS TABLE (", "  p_snapshot text,\n  p_timing_sha256 text DEFAULT NULL\n) RETURNS TABLE ("],
        [
          " NOT BETWEEN 1 AND 2097152 THEN\n",
          " NOT BETWEEN 1 AND 2097152\n     OR (p_timing_sha256 IS NOT NULL AND p_timing_sha256 !~ '^[0-9a-f]{64}$') THEN\n",
        ],
        ["    storage_ref, accepted_at\n", "    storage_ref, accepted_at, timing_sha256\n"],
        ["p_storage_ref, v_now\n  );", "p_storage_ref, v_now, p_timing_sha256\n  );"],
      ]),
    );
  });

  it("adds only the timing hashes to the replay source", () => {
    expect(definitionOf(upOf(TIMING), SOURCE)).toBe(
      changed(LIVE_SOURCE, [
        ["segment_hashes text[])", "segment_hashes text[],\n               timing_hashes text[])"],
        ["NULL::text, NULL::text[];", "NULL::text, NULL::text[], NULL::text[];", 3],
        [
          "evidence_package_id, segment_hashes;",
          "evidence_package_id, segment_hashes,\n    app.replay_segment_timings(evidence_package_id, segment_hashes);",
        ],
      ]),
    );
  });

  it("restores both live definitions verbatim on the way down", () => {
    expect(definitionOf(downOf(TIMING), ACCEPTANCE)).toBe(LIVE_ACCEPTANCE);
    expect(definitionOf(downOf(TIMING), SOURCE)).toBe(LIVE_SOURCE);
    expect(downOf(TIMING)).toContain("DROP FUNCTION app.replay_segment_timings(text, text[]);");
    expect(downOf(TIMING)).toContain("ALTER TABLE evidence.segment DROP COLUMN timing_sha256;");
  });

  it("grants EXECUTE only to the role each function is for", () => {
    const up = upOf(TIMING);
    expect(up.match(/^GRANT EXECUTE .*$/gm)).toEqual([
      "GRANT EXECUTE ON FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text, text, text)",
      "GRANT EXECUTE ON FUNCTION app.replay_segment_timings(text, text[]) TO ductus_identity;",
      "GRANT EXECUTE ON FUNCTION app.read_replay_source(text) TO ductus_app;",
    ]);
    expect(up).toContain("text, text, text, text)\n  TO ductus_app;");
    expect(up.match(/^REVOKE ALL ON FUNCTION .* FROM PUBLIC;$/gm)).toHaveLength(3);
    expect(up).not.toMatch(/SECURITY INVOKER|OWNER TO|GRANT (SELECT|INSERT|UPDATE|DELETE|USAGE)/);
  });
});
