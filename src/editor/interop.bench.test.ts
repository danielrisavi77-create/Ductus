// @vitest-environment node
/**
 * Keystroke → projection latency tripwire (F1-11).
 *
 * Every debounced keystroke window in the editor runs the same two things:
 * the canonical document is projected into Tiptap JSON, and what Tiptap hands
 * back is projected into a canonical document again (`tiptapToCanonical`,
 * which normalises and validates on the way). If either side ever becomes
 * quadratic in the number of blocks, a long thesis chapter starts dropping
 * frames while the author types — and nothing else in the suite would notice,
 * because every other interop test uses documents of three or four blocks.
 *
 * This is a tripwire, not a benchmark. It is written with plain `it()` and
 * `performance.now()` rather than vitest's `bench` API on purpose: `bench`
 * reports numbers, it does not fail a build. The thresholds below are
 * deliberately an order of magnitude above the measured cost on CI-class
 * hardware, so what trips them is an algorithmic regression, not a noisy
 * neighbour on a shared runner. If you are tempted to raise them, root-cause
 * the hot path first and say here what machine variance justified the change.
 */
import { describe, expect, it } from "vitest";

import {
  headingNode,
  normalizeDocument,
  paragraphNode,
  textNode,
  validateDocument,
  DOCUMENT_SCHEMA_VERSION,
  type CanonicalDocument,
  type NodeId,
} from "../domain/document";

import { canonicalToTiptap, tiptapToCanonical } from "./interop";

/** Blocks in the fixture document, as named in F1_STATE for this step. */
const BLOCKS = 200;

/** Samples per measurement. Enough for a stable p50, cheap enough for CI. */
const ITERATIONS = 50;

/** Generous ceilings: they catch O(n²), not micro-noise. See the header. */
const P50_LIMIT_MS = 25;
const P95_LIMIT_MS = 60;

/**
 * Deterministic, structurally valid node ids. `newNodeId` would do, but a
 * sequence keeps the fixture identical between runs, so a failure here is
 * about time and never about which document happened to be generated.
 */
function seqId(n: number): NodeId {
  const tail = String(n).padStart(12, "0");
  return `11111111-1111-4111-8111-${tail}` as NodeId;
}

/**
 * A document shaped like real academic prose rather than like a unit fixture:
 * a heading every tenth block, paragraphs of several sentences, and inline
 * runs that actually carry marks — including adjacent runs with identical
 * marks, which is exactly what an editing session produces and what
 * `normalizeDocument` has to merge.
 */
function realisticDocument(blocks: number): CanonicalDocument {
  const nodes: CanonicalDocument["nodes"] = [];

  for (let i = 0; i < blocks; i += 1) {
    const id = seqId(i + 1);

    if (i % 10 === 0) {
      nodes.push(headingNode(id, ((i % 30) / 10 + 1) as 1 | 2 | 3, [
        textNode(`Poglavlje ${i / 10 + 1}. Rasprava o metodi`),
      ]));
      continue;
    }

    nodes.push(
      paragraphNode(id, [
        textNode(
          `Odlomak ${i}. U ovom se dijelu rada razmatra odnos između izvora i ` +
            `tvrdnje koja se iz njega izvodi, uz osvrt na metodološka ` +
            `ograničenja korištenoga pristupa. `,
        ),
        textNode("Ključni pojam", ["bold"]),
        textNode(" ovdje je ", []),
        textNode("autorstvo", ["italic"]),
        textNode(
          ", koje se u ovom okviru ne poistovjećuje s identitetom pisca, nego " +
            "se promatra kao trag procesa nastanka teksta. ",
        ),
        textNode("Napomena", ["bold", "italic"]),
        textNode(
          `: navedeni primjeri (${i}) služe kao ilustracija, a ne kao dokaz.`,
        ),
      ]),
    );
  }

  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes };
}

/** Linear-interpolation-free percentile: the sample at the nearest rank. */
function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/** Runs `fn` `ITERATIONS` times and returns the per-run durations in ms. */
function measure(fn: () => void): number[] {
  // One untimed run so the first sample does not pay for JIT warm-up alone.
  fn();

  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return samples;
}

function report(name: string, samples: readonly number[]): void {
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  // Printed so docs/PERF_BUDGET.md can be refreshed from a real run rather
  // than from memory.
  console.log(
    `[perf] ${name}: p50 ${p50.toFixed(2)}ms, p95 ${p95.toFixed(2)}ms ` +
      `(${BLOCKS} blocks, ${ITERATIONS} iterations)`,
  );
}

describe(`interop latency on a ${BLOCKS}-block document`, () => {
  const doc = realisticDocument(BLOCKS);

  it("builds a fixture the domain accepts, so the numbers mean something", () => {
    expect(doc.nodes).toHaveLength(BLOCKS);
    const validated = validateDocument(normalizeDocument(doc));
    expect(validated.ok).toBe(true);
  });

  it("round-trips canonical → Tiptap → canonical within the latency budget", () => {
    const samples = measure(() => {
      const candidate = tiptapToCanonical(canonicalToTiptap(doc));
      if (!candidate.ok) {
        throw new Error("round trip rejected the fixture document");
      }
    });

    report("round trip", samples);
    expect(percentile(samples, 50)).toBeLessThan(P50_LIMIT_MS);
    expect(percentile(samples, 95)).toBeLessThan(P95_LIMIT_MS);
  });

  it("normalises within the latency budget on its own", () => {
    const samples = measure(() => {
      normalizeDocument(doc);
    });

    report("normalizeDocument", samples);
    expect(percentile(samples, 50)).toBeLessThan(P50_LIMIT_MS);
    expect(percentile(samples, 95)).toBeLessThan(P95_LIMIT_MS);
  });
});
