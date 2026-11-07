#!/usr/bin/env node
// Static guard for the production images (DAN-298, attack plan #1687). Every
// infra/docker/<name>.Dockerfile, with its <name>.Dockerfile.dockerignore, must:
// pin each external image by registry and digest, run its final stage as a
// numeric non-root user, name no secret in ARG or ENV, carry no local-only
// login switch (D-09) and copy no .env, .git or infra/. What the guard cannot
// read (heredocs, ONBUILD, a changed escape character) fails closed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INSTRUCTIONS = new Set([
  "ADD", "ARG", "CMD", "COPY", "ENTRYPOINT", "ENV", "EXPOSE", "FROM", "HEALTHCHECK",
  "LABEL", "ONBUILD", "RUN", "SHELL", "STOPSIGNAL", "USER", "VOLUME", "WORKDIR",
]);
const PINNED_IMAGE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?\/[a-z0-9._/-]+(?::[\w.-]+)?@sha256:[a-f0-9]{64}$/;
const SECRET_NAME = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|DATABASE_URL|(?:^|_)KEY(?:$|_)/i;
const LOCAL_ONLY_NAME = /^(?:DUCTUS_AUTH_PROVIDER|DUCTUS_LOCAL_DEMO_JOURNAL|OIDC_\w*)$/i;
const NON_ROOT_USER = /^[1-9]\d*(?::[1-9]\d*)?$/;
const FORBIDDEN_SOURCE = /^(?:\.\/)*(?:infra|\.git)(?:\/|$)|(?:^|\/)\.env/;
const HEREDOC = /<<-?\s*["']?[A-Za-z_]\w*["']?/;

const finding = (code, line, detail) => ({ code, line, detail });

/** Logical instructions: comments dropped, continuation lines joined as BuildKit does, with nothing inserted. */
function instructions(text) {
  const result = [];
  let pending = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    if (/^\s*#/.test(raw) || raw.trim() === "") return;
    const continued = /\\\s*$/.test(raw);
    const part = continued ? raw.replace(/\\\s*$/, "") : raw;
    pending = pending === null ? { line: index + 1, text: part } : { ...pending, text: pending.text + part };
    if (!continued) {
      result.push(pending);
      pending = null;
    }
  });
  if (pending !== null) result.push(pending);
  return result.map(({ line, text: body }) => {
    const match = body.trim().match(/^(\S+)\s*(.*)$/s);
    return { line, keyword: match[1].toUpperCase(), args: match[2].trim() };
  });
}

/** Leading --flag words and the words after them. */
function leadingFlags(args) {
  const words = args.split(/\s+/).filter(Boolean);
  const flags = [];
  while (words.length > 0 && words[0].startsWith("--")) flags.push(words.shift());
  return { flags, words };
}

/** Splits leading --flags off; returns them as a map and the rest as words. */
function flagsAndWords(args) {
  const { flags: list, words } = leadingFlags(args);
  const flags = new Map();
  for (const flag of list) {
    const [name, ...value] = flag.slice(2).split("=");
    flags.set(name.toLowerCase(), value.join("="));
  }
  return { flags, words };
}

/** Words split on unquoted whitespace, quotes and escapes kept (Docker's parseWords). */
function shellWords(text) {
  const words = [];
  let word = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === null && /\s/.test(ch)) {
      if (word !== "") words.push(word);
      word = "";
      continue;
    }
    word += ch;
    if (ch === "\\" && quote !== "'" && i + 1 < text.length) word += text[(i += 1)];
    else if (ch === quote) quote = null;
    else if (quote === null && (ch === '"' || ch === "'")) quote = ch;
  }
  if (word !== "") words.push(word);
  return words;
}

/** A word with quotes and escapes removed, as Docker expands it; null if a quote is open. */
function unquote(word) {
  let out = "";
  let quote = null;
  for (let i = 0; i < word.length; i += 1) {
    const ch = word[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else out += ch;
    } else if (ch === "\\" && i + 1 < word.length) out += word[(i += 1)];
    else if (ch === '"') quote = quote === '"' ? null : '"';
    else if (ch === "'") quote = "'";
    else out += ch;
  }
  return quote === null ? out : null;
}

/**
 * Names and values of ENV or ARG: `K=V K2=V2`, legacy `K V`, or `K`. Docker
 * expands names too, so a quoted or escaped name is read unquoted; `name` is
 * null when it is not a plain identifier after that (a variable, an open quote).
 */
function assignments(keyword, args) {
  const words = shellWords(args);
  const pairs =
    keyword === "ENV" && words.length > 0 && !words[0].includes("=")
      ? [[words[0], args.slice(words[0].length).trim()]]
      : words.map((word) => {
          const at = word.indexOf("=");
          return at === -1 ? [word, undefined] : [word.slice(0, at), word.slice(at + 1)];
        });
  return pairs.map(([raw, value]) => {
    const name = unquote(raw);
    return {
      raw,
      name: name !== null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : null,
      value: value === undefined ? undefined : unquote(value),
    };
  });
}

/** An image reference resolved against the global ARG defaults, or null. */
function resolveImage(reference, globalArgs) {
  const variable = reference.match(/^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))$/);
  if (variable) return globalArgs.get(variable[1] ?? variable[2]) ?? null;
  return reference.includes("$") ? null : reference;
}

export function checkDockerfile(text) {
  const directive = text.match(/^\s*#\s*(escape|syntax)\s*=/im);
  if (directive) return [finding(`${directive[1].toLowerCase()}-directive`, 1, `parser directive ${directive[1]}`)];
  const parsed = instructions(text);
  const heredoc = parsed.find((step) => HEREDOC.test(step.args));
  if (heredoc) return [finding("heredoc", heredoc.line, "heredocs are not checked")];

  const findings = [];
  const globalArgs = new Map();
  const stages = [];
  const imageFinding = (reference, line) => {
    const image = resolveImage(reference, globalArgs);
    if (image === null) findings.push(finding("unresolved-image", line, reference));
    else if (!PINNED_IMAGE.test(image)) findings.push(finding("unpinned-image", line, image));
  };

  for (const step of parsed) {
    const stage = stages.at(-1);
    if (!INSTRUCTIONS.has(step.keyword)) {
      findings.push(finding("unknown-instruction", step.line, step.keyword));
      continue;
    }
    // BuildKit strips quotes and escapes in every leading flag; the guard reads none of them.
    const quoted = leadingFlags(step.args).flags.filter((flag) => /["'\\]/.test(flag));
    if (quoted.length > 0) {
      findings.push(...quoted.map((flag) => finding("quoted-flag", step.line, flag)));
      continue;
    }
    if (step.keyword === "FROM") {
      const { words } = flagsAndWords(step.args);
      const [reference = "", as, name] = words;
      const parent = stages.find((s) => s.name !== undefined && s.name === reference.toLowerCase());
      if (!parent && reference.toLowerCase() !== "scratch") imageFinding(reference, step.line);
      stages.push({
        name: as?.toUpperCase() === "AS" ? name?.toLowerCase() : undefined,
        user: parent?.user,
        nodeEnv: parent?.nodeEnv,
        line: step.line,
      });
      continue;
    }
    if (!stage && step.keyword !== "ARG") {
      findings.push(finding("before-from", step.line, step.keyword));
      continue;
    }
    switch (step.keyword) {
      case "ONBUILD":
        findings.push(finding("onbuild", step.line, step.args));
        break;
      case "ADD":
        findings.push(finding("add", step.line, "use COPY"));
        break;
      case "USER":
        stage.user = step.args;
        break;
      case "RUN":
        // A bind or cache mount can read from another image: same pin rule as COPY --from.
        // BuildKit keeps the last of a repeated key, so a repeated key fails closed.
        for (const flag of leadingFlags(step.args).flags) {
          const options = flag.match(/^--mount=(.*)$/i)?.[1].split(",") ?? [];
          const keys = options.map((option) => option.split("=")[0].toLowerCase());
          if (new Set(keys).size !== keys.length) {
            findings.push(finding("repeated-mount-key", step.line, flag));
            continue;
          }
          const from = options.find((option) => /^from=/i.test(option))?.slice(5);
          if (from !== undefined && !/^\d+$/.test(from) && !stages.some((s) => s.name === from.toLowerCase())) {
            imageFinding(from, step.line);
          }
        }
        break;
      case "ARG":
      case "ENV":
        for (const { raw, name, value } of assignments(step.keyword, step.args)) {
          if (name === null) {
            findings.push(finding("unparsed-name", step.line, raw));
            continue;
          }
          if (SECRET_NAME.test(name)) findings.push(finding("secret-name", step.line, name));
          if (LOCAL_ONLY_NAME.test(name)) findings.push(finding("local-only-env", step.line, name));
          if (name === "NODE_ENV" && step.keyword === "ENV") {
            if (value !== "production") findings.push(finding("node-env", step.line, value));
            stage.nodeEnv = value;
          }
          if (step.keyword === "ARG" && !stage) globalArgs.set(name, value);
        }
        break;
      case "COPY": {
        let sources;
        let from;
        if (/^(?:--\S+\s+)*\[/.test(step.args)) {
          const flags = step.args.match(/^((?:--\S+\s+)*)/)[1];
          from = flagsAndWords(flags).flags.get("from");
          try {
            sources = JSON.parse(step.args.slice(flags.length)).slice(0, -1);
          } catch {
            findings.push(finding("unknown-instruction", step.line, "COPY with invalid JSON"));
            break;
          }
        } else {
          const parts = flagsAndWords(step.args);
          from = parts.flags.get("from");
          sources = parts.words.slice(0, -1);
        }
        if (from !== undefined && !/^\d+$/.test(from) && !stages.some((s) => s.name === from.toLowerCase())) {
          imageFinding(from, step.line);
        }
        for (const source of sources) {
          if (FORBIDDEN_SOURCE.test(String(source))) findings.push(finding("forbidden-copy", step.line, source));
        }
        break;
      }
      default:
        break;
    }
  }

  const final = stages.at(-1);
  if (!final) return [...findings, finding("no-from", 1, "no FROM")];
  if (!NON_ROOT_USER.test(final.user ?? "")) findings.push(finding("final-user", final.line, final.user ?? "unset"));
  if (final.nodeEnv !== "production") findings.push(finding("node-env", final.line, final.nodeEnv ?? "unset"));
  return findings;
}

// Paths that never enter the build context, whatever the allowlist says.
const NEVER_INCLUDED = new Set(["infra", "e2e", "tests", "docs", "node_modules", "scripts", "spikes", "plugins", "db"]);

export function checkDockerignore(text) {
  const patterns = text
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) => entry.text !== "" && !entry.text.startsWith("#"));
  const findings = [];
  if (patterns[0]?.text !== "*") findings.push(finding("ignore-not-allowlist", patterns[0]?.line ?? 1, "first pattern must be *"));
  let lastInclude = -1;
  let envTail = -1;
  patterns.forEach((entry, index) => {
    if (entry.text === "**/.env*") envTail = index;
    if (!entry.text.startsWith("!")) return;
    lastInclude = index;
    const path = entry.text.slice(1);
    const segments = path.split("/");
    if (
      !/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(path) ||
      segments.some((segment) => segment === "" || segment.startsWith(".")) ||
      NEVER_INCLUDED.has(segments[0])
    ) {
      findings.push(finding("ignore-reinclude", entry.line, path));
    }
  });
  if (envTail < lastInclude || envTail === -1) findings.push(finding("ignore-env-tail", patterns.at(-1)?.line ?? 1, "**/.env* must follow the last re-include"));
  return findings;
}

/** Every production image of the repository and the ignore file it builds with. */
export function productionImages(root) {
  const directory = join(root, "infra/docker");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".Dockerfile"))
    .sort()
    .map((name) => ({ dockerfile: join(directory, name), dockerignore: join(directory, `${name}.dockerignore`) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const images = productionImages(root);
  let failed = images.length === 0;
  if (failed) console.error("No production image under infra/docker");
  for (const image of images) {
    const results = [
      ...checkDockerfile(readFileSync(image.dockerfile, "utf8")).map((f) => ({ ...f, file: image.dockerfile })),
      ...(existsSync(image.dockerignore)
        ? checkDockerignore(readFileSync(image.dockerignore, "utf8")).map((f) => ({ ...f, file: image.dockerignore }))
        : [finding("ignore-missing", 1, "no .dockerignore")].map((f) => ({ ...f, file: image.dockerignore }))),
    ];
    for (const f of results) console.error(`${f.file}:${f.line}: ${f.code} (${f.detail})`);
    failed ||= results.length > 0;
  }
  if (failed) process.exit(1);
  console.log(`Production images OK: ${images.length}`);
}
