#!/usr/bin/env node
// Guard for the production images (DAN-298, attack plan #1687; #1691 c.6710912430).
// Static: every infra/docker/<name>.Dockerfile is read line by line against a
// whitelist of anchored forms (no continuations, quotes outside CMD, flags other
// than COPY --from, heredocs or parser directives); anything else fails closed as
// not-canonical. Only a canonical file is then checked for values: images pinned by
// registry and digest in ARG, FROM only from such an ARG, a numeric non-root final
// user, NODE_ENV=production, no secret or local-only (D-09) name, no copied .env,
// .git or infra. With its <name>.Dockerfile.dockerignore. Authoritative:
// `--image-config <file>` checks `docker image inspect` of the built image.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PINNED_IMAGE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?\/[a-z0-9._/-]+(?::[\w.-]+)?@sha256:[a-f0-9]{64}$/;
const SECRET_NAME = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|DATABASE_URL|(?:^|_)KEY(?:$|_)/i;
const LOCAL_ONLY_NAME = /^(?:DUCTUS_AUTH_PROVIDER|DUCTUS_LOCAL_DEMO_JOURNAL|OIDC_\w*)$/i;
const NON_ROOT_USER = /^[1-9]\d*(?::[1-9]\d*)?$/;
const FORBIDDEN_SOURCE = /(?:^|\/)(?:infra|\.git)(?:\/|$)|(?:^|\/)\.env/;

// The whitelist, one anchored form per instruction. Printable ASCII only, no backslash.
const NAME = "[A-Z][A-Z0-9_]*";
const PAIR = `${NAME}=[A-Za-z0-9._:/@+,-]+`;
const PATH = "[A-Za-z0-9._/][A-Za-z0-9._/-]*";
const WORD = '"[A-Za-z0-9._/:=-]*"';
const FORMS = {
  ARG: new RegExp(`^ARG (${NAME})=([A-Za-z0-9._:/@-]+)$`),
  FROM: new RegExp(`^FROM \\$\\{(${NAME})\\} AS ([a-z][a-z0-9-]*)$`),
  WORKDIR: /^WORKDIR \/[A-Za-z0-9._/-]*$/,
  ENV: new RegExp(`^ENV ${PAIR}(?: ${PAIR})*$`),
  RUN: /^RUN [A-Za-z0-9][A-Za-z0-9 ._/:=@+,&-]*$/,
  COPY: new RegExp(`^COPY (?:--from=([a-z][a-z0-9-]*) )?(${PATH}(?: ${PATH})+)$`),
  USER: /^USER [1-9][0-9]*(?::[1-9][0-9]*)?$/,
  EXPOSE: /^EXPOSE [1-9][0-9]{0,4}$/,
  CMD: new RegExp(`^CMD \\[${WORD}(?:, ${WORD})*\\]$`),
};
const COMMENT = /^#(?: .*)?$/;
const DIRECTIVE = /^#\s*[A-Za-z][A-Za-z0-9]*\s*=/;

const finding = (code, line, detail) => ({ code, line, detail });

/** The instruction a line is, by the whitelist; null for a blank line or comment, undefined if off the list. */
function classify(raw) {
  if (/[^\x20-\x5B\x5D-\x7E]/.test(raw) || DIRECTIVE.test(raw)) return undefined;
  if (raw === "" || COMMENT.test(raw)) return null;
  const keyword = raw.slice(0, raw.indexOf(" "));
  const match = Object.hasOwn(FORMS, keyword) ? raw.match(FORMS[keyword]) : null;
  return match ? { keyword, match, args: raw.slice(keyword.length + 1) } : undefined;
}

export function checkDockerfile(text) {
  const lines = text.split("\n").map((raw, index) => ({ line: index + 1, raw, step: classify(raw) }));
  const off = lines.filter(({ step }) => step === undefined);
  if (off.length > 0) return off.map(({ line, raw }) => finding("not-canonical", line, JSON.stringify(raw.slice(0, 80))));

  const findings = [];
  const args = new Set();
  const stages = [];
  const names = (line, list) => {
    for (const name of list) {
      if (SECRET_NAME.test(name)) findings.push(finding("secret-name", line, name));
      if (LOCAL_ONLY_NAME.test(name)) findings.push(finding("local-only-env", line, name));
    }
  };
  for (const { line, step } of lines) {
    if (step === null) continue;
    const { keyword, match, args: rest } = step;
    const stage = stages.at(-1);
    if (keyword === "ARG") {
      if (stage) findings.push(finding("arg-after-from", line, match[1]));
      else if (!PINNED_IMAGE.test(match[2])) findings.push(finding("unpinned-image", line, match[2]));
      names(line, [match[1]]);
      args.add(match[1]);
    } else if (keyword === "FROM") {
      if (!args.has(match[1])) findings.push(finding("unresolved-image", line, match[1]));
      if (stages.some((s) => s.name === match[2])) findings.push(finding("duplicate-stage", line, match[2]));
      stages.push({ name: match[2], line });
    } else if (!stage) {
      findings.push(finding("before-from", line, keyword));
    } else if (keyword === "ENV") {
      const pairs = rest.split(" ").map((pair) => pair.split("="));
      names(line, pairs.map(([name]) => name));
      for (const [name, value] of pairs) {
        if (name !== "NODE_ENV") continue;
        if (value !== "production") findings.push(finding("node-env", line, value));
        stage.nodeEnv = value;
      }
    } else if (keyword === "COPY") {
      const from = match[1];
      if (from !== undefined && !stages.slice(0, -1).some((s) => s.name === from)) findings.push(finding("copy-from", line, from));
      for (const source of match[2].split(" ").slice(0, -1)) {
        if (FORBIDDEN_SOURCE.test(source)) findings.push(finding("forbidden-copy", line, source));
      }
    } else if (keyword === "USER") {
      stage.user = rest;
    }
  }
  const final = stages.at(-1);
  if (!final) return [...findings, finding("no-from", 1, "no FROM")];
  if (final.user === undefined) findings.push(finding("final-user", final.line, "unset"));
  if (final.nodeEnv !== "production") findings.push(finding("node-env", final.line, final.nodeEnv ?? "unset"));
  return findings;
}

/** The config of a built image (`docker image inspect`): no local-only or secret name, NODE_ENV=production, numeric non-root user. */
export function checkImageConfig(inspect) {
  const image = Array.isArray(inspect) ? (inspect.length === 1 ? inspect[0] : undefined) : inspect;
  const config = image?.Config;
  if (!config || typeof config !== "object") return [finding("no-config", 0, "no single image config")];
  const findings = [];
  let nodeEnv;
  for (const entry of Array.isArray(config.Env) ? config.Env : []) {
    const at = String(entry).indexOf("=");
    const name = at === -1 ? String(entry) : String(entry).slice(0, at);
    if (LOCAL_ONLY_NAME.test(name)) findings.push(finding("local-only-env", 0, name));
    if (SECRET_NAME.test(name)) findings.push(finding("secret-name", 0, name));
    if (name === "NODE_ENV") nodeEnv = String(entry).slice(at + 1);
  }
  if (nodeEnv !== "production") findings.push(finding("node-env", 0, nodeEnv ?? "unset"));
  if (!NON_ROOT_USER.test(typeof config.User === "string" ? config.User : "")) findings.push(finding("final-user", 0, String(config.User ?? "unset")));
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
  const report = (file, results) => {
    for (const f of results) console.error(`${file}:${f.line}: ${f.code} (${f.detail})`);
    return results.length > 0;
  };
  const at = process.argv.indexOf("--image-config");
  if (at !== -1) {
    const file = process.argv[at + 1];
    if (!file) {
      console.error("usage: production-image.mjs --image-config <docker image inspect JSON>");
      process.exit(2);
    }
    if (report(file, checkImageConfig(JSON.parse(readFileSync(file, "utf8"))))) process.exit(1);
    console.log(`Image config OK: ${file}`);
    process.exit(0);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const images = productionImages(root);
  let failed = images.length === 0;
  if (failed) console.error("No production image under infra/docker");
  for (const image of images) {
    failed = report(image.dockerfile, checkDockerfile(readFileSync(image.dockerfile, "utf8"))) || failed;
    const ignore = existsSync(image.dockerignore)
      ? checkDockerignore(readFileSync(image.dockerignore, "utf8"))
      : [finding("ignore-missing", 1, "no .dockerignore")];
    failed = report(image.dockerignore, ignore) || failed;
  }
  if (failed) process.exit(1);
  console.log(`Production images OK: ${images.length}`);
}
