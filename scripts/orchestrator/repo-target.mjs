// DAN-734 (S-0.21): `--repo <owner/name>` for the orch:* commands. Pure parser
// plus the list of tracked repositories (tracked-repos.json, names only). A
// command without `--repo` reads the repository of its working directory, as
// before; with it, gh.mjs reads only the named repository (setTargetRepo).
import { readFileSync } from "node:fs";

// GitHub owner: letters, digits and single inner hyphens; repository name:
// letters, digits, '.', '_', '-', never "." or "..". No braces, so a value can
// never smuggle in gh's {owner}/{repo} placeholders.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
export function isSlug(value) {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 2 && OWNER.test(parts[0]) && NAME.test(parts[1]) && parts[1] !== "." && parts[1] !== "..";
}

/** The tracked list from the JSON text; throws on anything but {"repositories": [unique slugs]}. */
export function parseTrackedRepos(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("tracked-repos.json: not an object");
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "repositories") throw new Error("tracked-repos.json: only the key \"repositories\" is allowed");
  const list = raw.repositories;
  if (!Array.isArray(list) || list.length === 0) throw new Error("tracked-repos.json: \"repositories\" must be a non-empty list");
  const seen = new Set();
  for (const r of list) {
    if (!isSlug(r)) throw new Error(`tracked-repos.json: ${JSON.stringify(r)} is not owner/name`);
    if (seen.has(r.toLowerCase())) throw new Error(`tracked-repos.json: ${r} is listed twice`);
    seen.add(r.toLowerCase());
  }
  return list;
}

export const TRACKED_REPOS = Object.freeze(parseTrackedRepos(readFileSync(new URL("./tracked-repos.json", import.meta.url), "utf8")));

/**
 * Takes `--repo X` or `--repo=X` out of argv. Returns {repo, rest}: repo is the
 * canonical tracked spelling (GitHub names ignore letter case) or null when
 * absent; rest keeps the other arguments in order. Throws on a missing or
 * flag-like value, a repeat, a look-alike flag (--repos, --repository, ...;
 * the commands ignore unknown flags, which would silently read the default
 * repository) and any value that is malformed or not tracked.
 */
export function takeRepoArg(argv, tracked = TRACKED_REPOS) {
  let repo = null;
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    let value;
    if (arg === "--repo") {
      value = argv[i + 1];
      if (value === undefined || value === "" || value.startsWith("-")) throw new Error("--repo needs a value: --repo <owner/name>");
      i += 1;
    } else if (arg.startsWith("--repo=")) {
      value = arg.slice("--repo=".length);
      if (value === "") throw new Error("--repo needs a value: --repo <owner/name>");
    } else if (arg.startsWith("--repo")) {
      throw new Error(`unknown argument ${arg.split("=")[0]} (did you mean --repo?)`);
    } else {
      rest.push(arg);
      continue;
    }
    if (repo !== null) throw new Error("--repo given more than once");
    if (!isSlug(value)) throw new Error(`--repo ${JSON.stringify(value)} is not owner/name`);
    const found = tracked.find((r) => r.toLowerCase() === value.toLowerCase());
    if (!found) throw new Error(`--repo ${value} is not a tracked repository (scripts/orchestrator/tracked-repos.json: ${tracked.join(", ")})`);
    repo = found;
  }
  return { repo, rest };
}
