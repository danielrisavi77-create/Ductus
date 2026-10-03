// Deterministic synthetic writing session. Produces ProseMirror steps the way
// a student would: mostly typing forward, typo fixes, paragraphs, headings,
// some emphasis, and occasional revisions earlier in the text. No real text:
// words are built from syllables, with Croatian diacritics for realistic UTF-8.
import { Transform } from 'prosemirror-transform';
import { schema, prng, emptyDoc, countWords } from './lib.mjs';

const SYLLABLES = [
  'ka', 'ro', 'vi', 'na', 'še', 'đu', 'po', 'sta', 'nje', 'li', 'če', 'ći',
  'mo', 'žu', 'ra', 'de', 'ti', 'pre', 'ko', 'u', 'ja', 'go', 'bi', 'zna',
];
const LETTERS = 'abcdefghijklmnoprstuvzčćšžđ';

// granularity 'char': one step per keystroke (upper bound of step count).
// granularity 'word': one step per word (what batched input would produce).
export function generateSession({ words: target, granularity = 'char', seed = 1 }, emit) {
  const rand = prng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  let doc = emptyDoc();
  let cursor = 1;
  let steps = 0;
  let wordsInDoc = 0;
  let wordsInBlock = 0;
  let blockLength = between(40, 180);
  let inHeading = false;
  let revisionLeft = 0;

  function run(build) {
    const tr = new Transform(doc);
    build(tr);
    for (const step of tr.steps) emit(step);
    steps += tr.steps.length;
    doc = tr.doc;
    cursor = tr.mapping.map(cursor);
  }

  const insert = (text) => run((tr) => tr.insert(cursor, schema.text(text)));
  const backspace = (n) => run((tr) => tr.delete(cursor - n, cursor));

  function typeWord(word) {
    const text = `${word} `;
    if (granularity === 'word') {
      if (rand() < 0.03) {
        const wrong = `${pick(SYLLABLES)}${pick(SYLLABLES)} `;
        insert(wrong);
        backspace(wrong.length);
      }
      insert(text);
      return;
    }
    for (const ch of text) {
      if (rand() < 0.03) {
        insert(pick(LETTERS));
        backspace(1);
      }
      insert(ch);
    }
  }

  function deleteLastWord(word) {
    const len = Math.min(word.length + 1, doc.resolve(cursor).parentOffset);
    if (granularity === 'word') {
      if (len > 0) backspace(len);
      return;
    }
    for (let i = 0; i < len; i++) backspace(1);
  }

  function jumpToEarlierBlock() {
    const blocks = [];
    doc.descendants((node, pos) => {
      if (node.isTextblock) {
        blocks.push([pos + 1, pos + 1 + node.content.size]);
        return false;
      }
      return true;
    });
    if (blocks.length < 3) return false;
    const [from, to] = pick(blocks.slice(0, -1));
    cursor = between(from, to);
    revisionLeft = between(1, 15);
    return true;
  }

  function endOfDocument() {
    cursor = doc.content.size - 1;
  }

  for (;;) {
    // The running count drifts (revisions split words); recount before stopping.
    if (wordsInDoc >= target && (wordsInDoc = countWords(doc)) >= target) break;
    const word = Array.from({ length: between(1, 4) }, () => pick(SYLLABLES)).join('');
    typeWord(word);
    wordsInDoc++;

    if (revisionLeft > 0) {
      if (--revisionLeft === 0) endOfDocument();
      continue;
    }

    wordsInBlock++;
    const r = rand();
    if (r < 0.02) {
      const at = cursor - 1;
      run((tr) => tr.addMark(at - word.length, at, schema.marks[rand() < 0.5 ? 'em' : 'strong'].create()));
    } else if (r < 0.035) {
      deleteLastWord(word);
      wordsInDoc--;
    } else if (r < 0.045) {
      jumpToEarlierBlock();
      continue;
    }

    if (inHeading && wordsInBlock >= blockLength) {
      run((tr) => tr.split(cursor, 1, [{ type: schema.nodes.paragraph }]));
      inHeading = false;
      wordsInBlock = 0;
      blockLength = between(40, 180);
    } else if (!inHeading && wordsInBlock >= blockLength) {
      inHeading = rand() < 0.08;
      const type = inHeading ? schema.nodes.heading : schema.nodes.paragraph;
      run((tr) => tr.split(cursor, 1, [{ type, attrs: inHeading ? { level: between(1, 3) } : null }]));
      wordsInBlock = 0;
      blockLength = inHeading ? between(3, 8) : between(40, 180);
    }

    if (wordsInDoc % 1000 === 0) wordsInDoc = countWords(doc);
  }

  return { doc, steps, words: countWords(doc) };
}
