import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Step } from 'prosemirror-transform';
import { schema, canonicalize, sha256, emptyDoc } from './lib.mjs';
import { generateSession } from './gen.mjs';

test('canonicalize sorts keys recursively and rejects floats', () => {
  assert.equal(canonicalize({ b: 1, a: [{ d: 'č', c: null }] }), '{"a":[{"c":null,"d":"č"}],"b":1}');
  assert.throws(() => canonicalize({ x: 1.5 }));
});

for (const granularity of ['char', 'word']) {
  test(`${granularity} session is deterministic and replays to the same document`, () => {
    const collect = () => {
      const steps = [];
      const session = generateSession({ words: 500, granularity, seed: 7 }, (s) => steps.push(s.toJSON()));
      return { steps, session };
    };
    const a = collect();
    const b = collect();
    assert.deepEqual(a.steps, b.steps);
    assert.ok(a.session.words >= 500);

    let doc = emptyDoc();
    for (const json of a.steps) {
      const result = Step.fromJSON(schema, JSON.parse(JSON.stringify(json))).apply(doc);
      assert.equal(result.failed, null);
      doc = result.doc;
    }
    assert.equal(sha256(canonicalize(doc.toJSON())), sha256(canonicalize(a.session.doc.toJSON())));
  });
}
