// Shared helpers for the B0.2 spike. The schema is a stand-in until the editor
// core is ported from pisac-editor; numbers are indicative, not final.
import { createHash } from 'node:crypto';
import { schema } from 'prosemirror-schema-basic';

export { schema };

// RFC 8785 (JCS) for the value space ProseMirror JSON uses: objects, arrays,
// strings, integers, booleans and null. Floats never occur in document JSON.
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      throw new Error('non-integer number in document JSON');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// mulberry32: small deterministic PRNG so every run replays the same session.
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function countWords(doc) {
  return doc.textBetween(0, doc.content.size, ' ').split(/\s+/).filter(Boolean).length;
}

export function emptyDoc() {
  return schema.node('doc', null, [schema.node('paragraph')]);
}
