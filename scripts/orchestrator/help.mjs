// `--help` for the orch:* commands. Imported first by each entry script, for its
// side effect: with `--help` or `-h` among the arguments it prints the comment
// block at the top of the script that was started and exits 0 before the script
// reads GitHub or changes anything. Without the flag it does nothing.
import { readFileSync } from "node:fs";
import process from "node:process";

/** The leading `//` comment block of a script source, without the markers. */
export function usageOf(source) {
  const out = [];
  for (const line of String(source).split(/\r?\n/)) {
    if (out.length === 0 && line.startsWith("#!")) continue;
    if (!line.startsWith("//")) break;
    out.push(line.replace(/^\/\/ ?/, ""));
  }
  return out.join("\n");
}

export const wantsHelp = (args) => args.includes("--help") || args.includes("-h");

if (process.argv[1] && wantsHelp(process.argv.slice(2))) {
  let text = "";
  try {
    text = usageOf(readFileSync(process.argv[1], "utf8"));
  } catch {
    // an unreadable script has no usage text
  }
  console.log(text || "no usage text in this script");
  process.exit(0);
}
