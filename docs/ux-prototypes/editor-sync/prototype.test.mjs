import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="scratch-model">([\s\S]*?)<\/script>/)?.[1];
// Inspects this controlled fixture; not a general HTML parser or sanitizer.
// Include browser-accepted end-tag attributes/slashes, but not script-like names.
const inlineScriptBodies = source => [...source.matchAll(/<script(?=[\t\n\f\r />])[^>]*>([\s\S]*?)<\/script(?=[\t\n\f\r />])[^>]*>/gi)]
  .map(match => match[1]);
const context = {};
if (script) runInNewContext(script, context, { timeout: 1000 });
const model = context.EditorScratch;
const flow = (...events) => events.reduce((s, e) => model.reduce(s, e), model.initial());
const edit = { type: 'EDIT' };
const start = { type: 'LOCAL_START' };
const finish = { type: 'LOCAL_OK', revision: 1 };
const send = { type: 'SEND' };
const ack = { type: 'ACK', revision: 1, signed: true, valid: true };

test('HTML exposes a testable, isolated simulation model', () => {
  assert.ok(model, 'Missing scratch-model: the prototype behaviour is not implemented yet');
});
if (model) {
  test('exactly eight canonical states with distinct device/server labels', () => {
    assert.equal(Object.keys(model.labels).length, 8);
    assert.equal(model.labels.LOCAL_DURABLE[0], 'Spremljeno na uređaju');
    assert.equal(model.labels.SYNCED[0], 'Spremljeno na poslužitelju');
    assert.notEqual(model.labels.LOCAL_DURABLE[1], model.labels.SYNCED[1]);
  });
  test('initial content is editing, not a claim of persistence', () => {
    assert.equal(model.initial().state, 'EDITING');
    assert.equal(model.initial().confirmedRevision, 0);
  });
  test('local success is not server success', () => {
    const s = flow(start, finish);
    assert.equal(s.state, 'LOCAL_DURABLE');
    assert.equal(s.confirmedRevision, 0);
  });
  test('only a signed, valid, matching in-flight receipt gives SYNCED', () => {
    const s = flow(start, finish, send, ack);
    assert.equal(s.state, 'SYNCED');
    assert.equal(s.confirmedRevision, s.revision);
  });
  for (const receipt of [
    { type: 'ACK' }, { ...ack, signed: false }, { ...ack, valid: false },
    { ...ack, signed: 1 }, { ...ack, revision: 0 }, { ...ack, revision: 2 },
  ]) test(`rejects untrusted receipt ${JSON.stringify(receipt)}`, () => {
    assert.equal(flow(start, finish, send, receipt).state, 'SYNCING');
  });
  test('unsolicited receipt cannot save the draft', () => {
    assert.equal(flow(ack).state, 'EDITING');
    assert.equal(flow(start, finish, ack).state, 'LOCAL_DURABLE');
  });
  test('new edit invalidates an older server receipt', () => {
    const s = flow(start, finish, send, edit, ack);
    assert.equal(s.state, 'EDITING');
    assert.equal(s.revision, 2);
    assert.notEqual(s.confirmedRevision, s.revision);
  });
  test('late local completion cannot claim a newer edit is durable', () => {
    const s = flow(start, edit, finish);
    assert.equal(s.state, 'EDITING');
    assert.equal(s.localRevision, 0);
  });
  test('old local completion does not complete a newer save', () => {
    const s = flow(start, edit, start, finish);
    assert.equal(s.state, 'SAVING_LOCAL');
    assert.equal(s.localRevision, 0);
  });
  test('reconnect alone never gives SYNCED', () => {
    const s = flow({ type: 'NETWORK', online: false }, start, finish, { type: 'NETWORK', online: true });
    assert.equal(s.state, 'LOCAL_DURABLE');
  });
  test('offline text stays marked after a successful confirmation', () => {
    const s = flow({ type: 'NETWORK', online: false }, edit, start,
      { type: 'LOCAL_OK', revision: 2 }, { type: 'NETWORK', online: true }, send, { ...ack, revision: 2 });
    assert.equal(s.state, 'SYNCED');
    assert.equal(s.offlineOrigin, true);
  });
  test('cannot send while offline or while local text is unsaved', () => {
    assert.equal(flow(send).state, 'EDITING');
    assert.equal(flow(start, finish, { type: 'NETWORK', online: false }, send).state, 'LOCAL_DURABLE');
  });
  test('network loss during sending is an error, not a confirmation', () => {
    const s = flow(start, finish, send, { type: 'NETWORK', online: false }, ack);
    assert.equal(s.state, 'ERROR');
    assert.equal(s.localRevision, 1);
  });
  test('quota and corruption have different outcomes', () => {
    assert.equal(flow(start, { type: 'LOCAL_FAIL', reason: 'quota' }).state, 'ERROR');
    assert.equal(flow(start, { type: 'LOCAL_FAIL', reason: 'corrupt' }).state, 'RECOVERY_REQUIRED');
  });
  for (const scenario of ['conflict', 'recovery']) test(`${scenario} needs an explicit choice`, () => {
    const s = model.scenario(scenario);
    for (const e of [edit, start, send, ack, { type: 'NETWORK', online: true }]) {
      assert.equal(model.reduce(s, e).state, s.state);
    }
    assert.equal(model.reduce(s, { type: 'KEEP_LOCAL' }).state, 'SAVING_LOCAL');
  });
  test('blocked tab overrides all labels and blocks edit/save', () => {
    for (const key of Object.keys(model.labels)) {
      const s = { ...model.initial(), state: key, blocked: true };
      assert.equal(model.view(s).label, 'Dokument je otvoren u drugoj kartici.');
      assert.equal(model.reduce(s, edit).revision, s.revision);
      assert.equal(model.reduce(s, start).state, key);
    }
  });
  test('loading is separate from the eight save states and disables editing', () => {
    const s = model.scenario('loading');
    assert.equal(model.view(s).editable, false);
    assert.equal(model.reduce(s, edit).revision, s.revision);
    assert.notEqual(s.state, 'SYNCED');
  });
  test('unknown/prototype-chain events and scenarios fail closed', () => {
    for (const type of ['toString', 'constructor', 'arbitrary']) {
      assert.equal(model.reduce(model.initial(), { type }).state, 'EDITING');
      assert.equal(model.scenario(type).state, 'EDITING');
    }
  });
  test('HTML blocks network and has no external dependencies or persistence calls', () => {
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /Prototip — simulirana stanja/);
    assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage)\b/);
    assert.doesNotMatch(html, /<(?:script|link|iframe)[^>]+(?:src|href)=/i);
    assert.match(html, /prefers-reduced-motion/);
  });
  test('reducer does not mutate the input', () => {
    const s = Object.freeze(model.initial());
    model.reduce(s, edit);
    assert.equal(s.revision, 1);
  });
}

// These are artefact/packaging regressions, not production cryptography tests.
test('CSP hashes match every executable inline script byte for byte', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP must be present');
  const directive = csp.split(';').find(part => part.trim().startsWith('script-src '));
  assert.ok(directive, 'explicit script-src required');
  const allowed = [...directive.matchAll(/'sha256-([^']+)'/g)].map(match => match[1]).sort();
  const actual = inlineScriptBodies(html)
    .map(body => createHash('sha256').update(body).digest('base64')).sort();
  assert.equal(actual.length, 2);
  assert.deepEqual(allowed, actual);
  assert.doesNotMatch(directive, /unsafe-inline|unsafe-eval|https?:|\*/);
});
test('canonical state names are exhaustive rather than merely the same count', () => {
  assert.deepEqual(Object.keys(model.labels).sort(), [
    'EDITING', 'SAVING_LOCAL', 'LOCAL_DURABLE', 'SYNCING',
    'SYNCED', 'CONFLICT', 'ERROR', 'RECOVERY_REQUIRED',
  ].sort());
});
test('every selectable scenario has a valid state and display label', () => {
  const scenarios = html.match(/<select id="scenario">([\s\S]*?)<\/select>/)?.[1];
  const names = [...scenarios.matchAll(/value="([^"]+)"/g)].map(match => match[1]);
  assert.equal(names.length, 12);
  for (const name of names) {
    const state = model.scenario(name);
    assert.ok(Object.hasOwn(model.labels, state.state), name);
    assert.ok(model.view(state).label, name);
  }
});
test('all HTML control IDs are unique and every explicit label has a target', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, target] of html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)) {
    assert.ok(ids.includes(target), target);
  }
});
test('network retry still requires a fresh matching receipt', () => {
  const pending = flow(start, finish, send, { type: 'NETWORK', online: false },
    { type: 'NETWORK', online: true }, ack);
  assert.equal(pending.state, 'ERROR');
  assert.equal(pending.confirmedRevision, 0);
  const retried = model.reduce(pending, send);
  assert.equal(retried.state, 'SYNCING');
  assert.equal(model.reduce(retried, ack).state, 'SYNCED');
});
test('returning the network without a new edit preserves an existing confirmation', () => {
  const saved = flow(start, finish, send, ack, { type: 'NETWORK', online: false },
    { type: 'NETWORK', online: true });
  assert.equal(saved.state, 'SYNCED');
  assert.equal(saved.confirmedRevision, saved.revision);
});

test('CSP inspection includes uppercase and mixed-case script tags', () => {
  assert.deepEqual(inlineScriptBodies(
    '<script>first</script><SCRIPT>second</SCRIPT><ScRiPt>third</sCrIpT >',
  ), ['first', 'second', 'third']);
});

test('CSP inspection recognizes browser-accepted end-tag suffixes', () => {
  for (const ending of ['</script\t\n bar>', '</script foo="bar">', '</script/>']) {
    assert.deepEqual(inlineScriptBodies('<script>body' + ending), ['body'], ending);
  }
});
test('script-like tag names do not delimit an inline script body', () => {
  assert.deepEqual(inlineScriptBodies('<scripture>not a script</scripture>'), []);
  assert.deepEqual(inlineScriptBodies('<script>body</script-foo>tail</script>'), ['body</script-foo>tail']);
});
