// B0.2 workload on the real code (DAN-388, M3.4-P01): a deterministic writing
// session typed into a headless Tiptap editor with the product's extensions
// and recorded by the product's EvidenceRecorder, so steps, events, hashes and
// segments are the ones the browser writes. No real text: words are built
// from syllables. Time is simulated: a pause over 400 ms closes an event and
// the drain takes segments every 30 s of writing.
import {
  Editor, EvidenceRecorder, changeOf, createEditorExtensions, tiptapToCanonical,
} from '../out/real/real.mjs';

const SYLLABLES = [
  'ka', 'ro', 'vi', 'na', 'še', 'đu', 'po', 'sta', 'nje', 'li', 'če', 'ći',
  'mo', 'žu', 'ra', 'de', 'ti', 'pre', 'ko', 'u', 'ja', 'go', 'bi', 'zna',
];
const LETTERS = 'abcdefghijklmnoprstuvzčćšžđ';
const T0 = Date.parse('2026-11-02T09:00:00.000Z');
const DRAIN_MS = 30_000;

/** mulberry32: the same sequence on every machine. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function canonicalOf(editor) {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error('generated document is not canonical');
  return candidate.doc;
}

/**
 * Types about `words` words. `granularity` 'char' is one transaction per key
 * (the upper bound), 'word' one per word (batched input). `onSegment` gets
 * every BuiltSegment in order. Returns the session's counts.
 */
export async function generateSession({ words: target, granularity = 'char', seed = 1 }, onSegment) {
  const rand = prng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  let n = 0;
  const editor = new Editor({
    element: null,
    // Ids from a counter instead of random UUIDs, so a seed gives the same bytes.
    extensions: createEditorExtensions().map((extension) => (extension.name === 'nodeIdentity'
      ? extension.configure({ mint: () => uuid('aaaaaaaa', ++n) }) : extension)),
    // The stored empty draft the session opens: its one block already has an id.
    content: { type: 'doc', content: [{ type: 'paragraph', attrs: { nodeId: uuid('aaaaaaaa', ++n) } }] },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const initial = canonicalOf(editor);
  const recorder = new EvidenceRecorder();
  let source = 'editor';
  let at = T0;
  let nextDrain = T0 + DRAIN_MS;
  const counts = { segments: 0, events: 0, steps: 0, transactions: 0 };
  let sequence = 1;
  let predecessor = null;

  editor.on('transaction', ({ transaction, appendedTransactions }) => {
    const all = [transaction, ...appendedTransactions];
    if (all.some((tr) => tr.docChanged)) {
      counts.transactions++;
      recorder.record(changeOf(all, source, at));
    }
  });

  async function drain() {
    recorder.close();
    for (;;) {
      const built = await recorder.takeSegment({
        documentId: uuid('dddddddd', seed), sessionId: uuid('eeeeeeee', seed),
        segmentId: uuid('55555555', counts.segments + 1), evidenceProfileId: 'profil-izmisljeni',
        sequenceFrom: sequence, predecessorSegmentHash: predecessor,
      });
      if (!built) return;
      counts.segments++;
      counts.events += built.eventCount;
      counts.steps += built.segment.events.reduce((sum, event) => sum + event.steps.length, 0);
      sequence += built.eventCount;
      predecessor = built.sha256;
      await onSegment(built);
    }
  }

  /** Advances the clock; the drain runs when its time has come, as in the browser. */
  async function wait(ms) {
    at += ms;
    if (at >= nextDrain) {
      await drain();
      nextDrain = at + DRAIN_MS;
    }
  }

  const run = (build) => editor.view.dispatch(build(editor.state.tr));
  const cursor = () => editor.state.selection.from;
  const insert = (text) => run((tr) => tr.insertText(text));
  const backspace = (count) => run((tr) => tr.delete(cursor() - count, cursor()));

  async function typeText(text) {
    if (granularity === 'word') {
      if (rand() < 0.03) {
        const wrong = `${pick(SYLLABLES)}${pick(SYLLABLES)} `;
        insert(wrong);
        await wait(between(150, 350));
        backspace(wrong.length);
      }
      insert(text);
      await wait(between(150, 600));
      return;
    }
    for (const ch of text) {
      if (rand() < 0.03) {
        insert(pick(LETTERS));
        await wait(between(120, 450));
        backspace(1);
      }
      insert(ch);
      await wait(between(60, 260));
    }
  }

  const wordCount = () => editor.state.doc.textContent.split(/\s+/).filter(Boolean).length;
  let wordsInDoc = 0;
  let wordsInBlock = 0;
  let blockLength = between(40, 180);
  let inHeading = false;
  let revisionLeft = 0;

  for (;;) {
    if (wordsInDoc >= target && (wordsInDoc = wordCount()) >= target) break;
    const word = Array.from({ length: between(1, 4) }, () => pick(SYLLABLES)).join('');
    if (rand() < 0.01) {
      // Pasted passage: one transaction from another source.
      source = 'paste';
      const passage = Array.from({ length: between(5, 20) }, () => pick(SYLLABLES) + pick(SYLLABLES));
      insert(`${passage.join(' ')} `);
      await wait(between(800, 3000));
      source = 'editor';
      wordsInDoc += passage.length;
    }
    await typeText(`${word} `);
    wordsInDoc++;
    if (rand() < 0.1) await wait(between(500, 4000));

    if (revisionLeft > 0) {
      if (--revisionLeft === 0) {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        await wait(between(1000, 3000));
      }
      continue;
    }

    wordsInBlock++;
    const r = rand();
    if (r < 0.02) {
      const end = cursor() - 1;
      editor.chain().setTextSelection({ from: end - word.length, to: end })[rand() < 0.5 ? 'toggleBold' : 'toggleItalic']()
        .setTextSelection(end + 1).run();
      await wait(between(800, 2500));
    } else if (r < 0.035) {
      const length = Math.min(word.length + 1, editor.state.selection.$from.parentOffset);
      if (granularity === 'word') backspace(length);
      else for (let i = 0; i < length; i++) { backspace(1); await wait(between(60, 160)); }
      wordsInDoc--;
    } else if (r < 0.045 && editor.state.doc.childCount >= 3) {
      // Revision earlier in the text: a click into an older block.
      const index = between(0, editor.state.doc.childCount - 2);
      let pos = 0;
      for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
      editor.commands.setTextSelection(pos + 1 + between(0, editor.state.doc.child(index).content.size));
      revisionLeft = between(1, 15);
      await wait(between(1000, 3000));
      continue;
    }

    if (wordsInBlock >= blockLength) {
      editor.commands.splitBlock();
      const heading = !inHeading && rand() < 0.08;
      if (heading) editor.commands.setHeading({ level: between(1, 3) });
      else if (inHeading) editor.commands.setParagraph();
      inHeading = heading;
      wordsInBlock = 0;
      blockLength = heading ? between(3, 8) : between(40, 180);
      await wait(between(600, 5000));
    }
  }
  await drain();
  if (!recorder.intact) throw new Error('recorder stopped');
  const final = canonicalOf(editor);
  editor.destroy();
  return { initial, final, words: wordCount(), blocks: final.nodes?.length ?? null, ...counts, writingMs: at - T0 };
}
