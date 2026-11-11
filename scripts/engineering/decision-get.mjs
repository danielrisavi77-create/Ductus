// Prints one decision from docs/DECISIONS.md instead of the whole register
// (about 300 kB): the table row or the heading section that defines the ID,
// with its line number. Read-only.
//
//   node scripts/engineering/decision-get.mjs D-188 [D-101 ...]
//   exit 0 = every ID found, 1 = some ID is not defined, 2 = usage or read error
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const INDEX = "docs/DECISIONS.md";
const ID_RE = /^D-\d{2,}$/;
// Same shapes decisions-index.mjs accepts as a definition: a table row or a heading.
const rowId = (line) => /^ {0,3}\| *(D-\d{2,}) *\|/.exec(line)?.[1] ?? null;
const heading = (line) => /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
const headingId = (line) => /^ {0,3}#{1,6}[ \t]+(D-\d{2,})(?![0-9])/.exec(line)?.[1] ?? null;

/** Every definition of `id` in the register text: `{ line, text }`, line is 1-based. */
export function findDecision(text, id) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (rowId(lines[i]) === id) out.push({ line: i + 1, text: lines[i] });
    else if (headingId(lines[i]) === id) {
      const level = heading(lines[i])[1].length;
      let end = i + 1;
      // The section runs to the next heading of the same or a higher level.
      while (end < lines.length && !(heading(lines[end]) && heading(lines[end])[1].length <= level)) end += 1;
      out.push({ line: i + 1, text: lines.slice(i, end).join("\n").trimEnd() });
    }
  }
  return out;
}

export function main(argv, { read = () => readFileSync(INDEX, "utf8"), log = console.log, error = console.error } = {}) {
  if (!argv.length || argv.some((a) => !ID_RE.test(a))) {
    error("usage: decisions:get <D-NN> [D-NN ...]");
    return 2;
  }
  let text;
  try {
    text = read();
  } catch (e) {
    error(`decision-get failed: ${e.message}`);
    return 2;
  }
  let missing = 0;
  for (const id of argv) {
    const found = findDecision(text, id);
    if (!found.length) {
      missing += 1;
      error(`${id}: not defined in ${INDEX}`);
    }
    for (const f of found) log(`${INDEX}:${f.line}\n${f.text}\n`);
  }
  return missing ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
