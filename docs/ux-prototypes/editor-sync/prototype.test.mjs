import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="scratch-model">([\s\S]*?)<\/script>/)?.[1];
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
