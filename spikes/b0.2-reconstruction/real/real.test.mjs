// B0.2 workload on the real code (DAN-388, M3.4-P01). Needs `node real/build.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeJcs, createEditStepsV1Replayer, digestCanonicalDocumentV2, replayEvidenceFromCheckpointV2,
  replayEvidenceSegmentsV2, verifyCanonicalEvidencePayloadV2,
} from '../out/real/real.mjs';
import { generateSession } from './gen.mjs';

/** A session as the ingest sees it: every segment verified from its bytes. */
async function record(words, granularity, seed = 11) {
  const built = [];
  const session = await generateSession({ words, granularity, seed }, (segment) => built.push(segment));
  const segments = [];
  for (const { bytes } of built) {
    const verified = await verifyCanonicalEvidencePayloadV2(bytes);
    assert.ok(verified.ok, verified.reason);
    segments.push(verified.segment);
  }
  return { session, segments, hashes: built.map((segment) => segment.sha256) };
}

const replay = (initial, segments) => replayEvidenceSegmentsV2(initial, segments, createEditStepsV1Replayer());

/** Kind of every step: its stepType, the node types it inserts and the mark it adds. */
function stepKinds(segments) {
  const kinds = new Set();
  for (const segment of segments) {
    for (const event of segment.events) {
      for (const step of event.steps) {
        kinds.add(step.stepType);
        if (step.stepType === 'replace' && !step.slice) kinds.add(step.removedSha256 ? 'delete+removedSha256' : 'delete');
        for (const node of step.slice?.content ?? []) kinds.add(`${step.stepType}:${node.type}`);
        if (step.mark) kinds.add(`${step.stepType}:${step.mark.type}`);
      }
    }
  }
  return kinds;
}

for (const granularity of ['char', 'word']) {
  test(`${granularity}: the same seed gives the same segment hashes`, async () => {
    const a = await record(300, granularity);
    const b = await record(300, granularity);
    assert.ok(a.hashes.length > 1);
    assert.deepEqual(a.hashes, b.hashes);
    assert.notDeepEqual((await record(300, granularity, 12)).hashes, a.hashes);
  });

  test(`${granularity}: full replay ends at the last finalDocumentHash and the editor's document`, async () => {
    const { session, segments } = await record(600, granularity);
    const result = await replay(session.initial, segments);
    assert.ok(result.ok, result.reason);
    assert.equal(result.documentSha256, segments.at(-1).finalDocumentHash);
    assert.equal(result.documentSha256, (await digestCanonicalDocumentV2(session.final)).sha256);
  });

  test(`${granularity}: replay from a checkpoint gives the full replay's hash`, async () => {
    const { session, segments } = await record(600, granularity);
    const index = Math.floor(segments.length / 2);
    const before = await replay(session.initial, segments.slice(0, index));
    assert.ok(before.ok, before.reason);
    const checkpoints = new Map([[segments[index].initialDocumentHash, new TextEncoder().encode(before.canonicalDocument)]]);
    const resumed = await replayEvidenceFromCheckpointV2(session.initial, segments, createEditStepsV1Replayer(), checkpoints);
    assert.ok(resumed.ok, resumed.reason);
    assert.equal(resumed.resumedAt, index);
    assert.ok(resumed.resumedAt > 0);
    assert.equal(resumed.documentSha256, segments.at(-1).finalDocumentHash);
    assert.equal(before.canonicalDocument, canonicalizeJcs(JSON.parse(before.canonicalDocument)));
  });

  test(`${granularity}: a changed step text makes the replay fail`, async () => {
    const { session, segments } = await record(300, granularity);
    const tampered = structuredClone(segments);
    const target = tampered.findIndex((segment) => segment.events.some((event) => event.steps.some((step) => step.slice?.content?.[0]?.text)));
    const step = tampered[target].events.flatMap((event) => event.steps).find((s) => s.slice?.content?.[0]?.text);
    // Same length, so every later position still fits: only the hash can tell.
    const text = step.slice.content[0].text;
    step.slice.content[0].text = (text[0] === 'q' ? 'w' : 'q') + text.slice(1);
    const result = await replay(session.initial, tampered);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'document_hash_mismatch');
    assert.equal(result.segmentIndex, target);
  });

  test(`${granularity}: the steps hold every kind of edit the workload claims`, async () => {
    const { segments } = await record(3000, granularity);
    const kinds = stepKinds(segments);
    for (const kind of ['replace:text', 'delete+removedSha256', 'replace:paragraph', 'replace:heading', 'replaceAround:heading',
      'addMark:bold', 'addMark:italic']) {
      assert.ok(kinds.has(kind), `${kind} missing from ${[...kinds].join(', ')}`);
    }
    assert.ok(!kinds.has('delete'), 'a delete without removedSha256');
  });
}
