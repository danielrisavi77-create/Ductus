// DAN-666: a strict reader for the one shape .gitguardian.yaml may have, and the single list of files it may exclude.
// Anything else (a glob, a directory, another key, another version) is refused, so the exclusion cannot widen by accident.

/** The only paths `secret.ignored_paths` may name: exact test files whose credentials are invented. */
export const ALLOWED_IGNORED_PATHS = ["scripts/db/native-db.test.mjs"];

const fail = (message) => { throw new Error(`.gitguardian.yaml: ${message}`); };

/** Parses `version: 2` + `secret.ignored_paths` (a list of plain paths) and nothing else. */
export function parseGitGuardianConfig(text) {
  const source = String(text);
  // PyYAML (used by ggshield) ends a line, and so a comment, at more characters than \n: lone CR, VT, FF, U+0085,
  // U+2028 and U+2029. Stripping comments here would hide an entry behind one of them, so only printable ASCII,
  // tab (refused per line below) and \n or \r\n line ends are accepted.
  const bad = /[^\x20-\x7E\t\n]|\r(?!\n)/.exec(source.replace(/\r\n/g, "\n"));
  if (bad) fail(`unsupported character U+${bad[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
  const lines = source.split(/\r?\n/)
    .map((raw) => ({ raw, body: raw.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, "") }))
    .filter(({ body }) => body.trim() !== "");
  let version = null;
  let section = null;
  let key = null;
  const ignoredPaths = [];
  for (const { raw, body } of lines) {
    if (/\t/.test(raw)) fail(`unsupported tab indentation in "${raw.trim()}"`);
    const top = /^([A-Za-z_-]+):\s*(.*)$/.exec(body);
    const nested = /^ {2}([A-Za-z_-]+):\s*(.*)$/.exec(body);
    const item = /^ {4}- (.+)$/.exec(body);
    if (top) {
      section = null; key = null;
      if (top[1] === "version") {
        if (version !== null) fail("duplicate key \"version\"");
        version = top[2].trim();
        continue;
      }
      if (top[1] !== "secret" || top[2].trim() !== "") fail(`unknown key "${top[1]}"`);
      section = "secret";
    } else if (nested && section === "secret") {
      key = nested[1];
      if (key !== "ignored_paths") fail(`unknown key "secret.${key}"`);
      const inline = nested[2].trim();
      if (inline !== "" && inline !== "[]") fail("ignored_paths must be a block list");
    } else if (item && key === "ignored_paths") {
      const value = item[1].trim().replace(/^(['"])(.*)\1$/, "$2");
      if (ignoredPaths.includes(value)) fail(`duplicate entry "${value}"`);
      if (!ALLOWED_IGNORED_PATHS.includes(value)) fail(`path "${value}" is not allowed (allowed: ${ALLOWED_IGNORED_PATHS.join(", ")})`);
      ignoredPaths.push(value);
    } else {
      fail(`unsupported line "${raw.trim()}"`);
    }
  }
  if (version !== "2") fail("version must be 2");
  if (ignoredPaths.length === 0) fail("no ignored paths listed (an empty exclusion has no purpose)");
  return { version: 2, ignoredPaths };
}
