// P6 (#87 c.6582691826), DAN-499: dbmate migration versions must not collide.
// A pull request fails when a migration it introduces in db/migrations has a
// version (the leading digits of the name, as dbmate reads it) that main or
// another open pull request already uses. Every event also fails on two files
// of one version in the checkout (on a PR that is the merge commit).
//
//   node scripts/engineering/migration-versions.mjs
//
// On a pull_request event it reads GITHUB_EVENT_PATH, GITHUB_TOKEN and
// GITHUB_REPOSITORY. Any API error, incomplete file list, head that moves
// while a PR is read, or main and the PRs changing during both reads of the
// inventory fails the step: the check is fail-closed.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createApi } from "./review-gate-api.mjs";

const DIR = "db/migrations";
// dbmate's own pattern for a migration file name; the first group is the version.
const MIGRATION = /^(\d+).*\.sql$/;
const INTRODUCING = new Set(["added", "renamed", "copied"]);
const PER_PAGE = 100;
const FILE_PAGES = 30; // GitHub lists at most 3000 files of a pull request.
const READS = 2; // A PR (or the inventory) that moves during both reads fails the step.
const ALL_PAGES = 100; // At most 10000 PRs, open or not, in the inventory.

/** Version of a repository path that dbmate would run as a migration, else null. */
export function migrationVersion(file) {
  const dir = path.posix.dirname(file);
  if (dir !== DIR) return null;
  return MIGRATION.exec(path.posix.basename(file))?.[1] ?? null;
}

/** Migrations a REST files list introduces: new, renamed or copied into db/migrations. */
function introduced(files) {
  return (files ?? [])
    .filter((f) => INTRODUCING.has(f.status) && migrationVersion(f.filename) !== null)
    .map((f) => ({ file: f.filename, sha: f.sha, version: migrationVersion(f.filename) }));
}

/**
 * Collisions of the migrations `self` introduces with `main` ([{name, sha}] of
 * db/migrations on main), with each other, and with the open pulls in `pulls`
 * ([{number, state, files}]). One file name with one blob is one migration
 * (a stacked PR, or main already holding it), not a collision.
 */
export function findCollisions({ self, main, pulls }) {
  const mine = introduced(self.files);
  if (mine.length === 0) return [];
  // A main migration this PR renames or removes is the D-91 ledger's case.
  const leaving = new Set(
    (self.files ?? []).flatMap((f) => (f.status === "removed" ? [f.filename] : f.status === "renamed" ? [f.previous_filename] : [])),
  );
  const others = [
    { by: "main", entries: main.map((m) => ({ file: `${DIR}/${m.name}`, sha: m.sha })).filter((m) => !leaving.has(m.file)) },
    ...pulls.filter((p) => p.state === "open" && p.number !== self.number).map((p) => ({ by: p.number, entries: introduced(p.files) })),
  ];
  const collisions = [];
  for (const m of mine) {
    for (const other of mine) {
      if (other !== m && other.version === m.version) collisions.push({ ...m, by: "this PR", other: other.file });
    }
    for (const { by, entries } of others) {
      for (const e of entries) {
        if (migrationVersion(e.file) !== m.version || (e.file === m.file && e.sha === m.sha)) continue;
        collisions.push({ ...m, by, other: e.file });
      }
    }
  }
  return collisions;
}

export function formatCollision(c) {
  const owner = typeof c.by === "number" ? `#${c.by}` : c.by;
  return `${c.file}: version ${c.version} is also used by ${owner} (${c.other}); pick a newer timestamp than main and every open PR (P6).`;
}

/** Plain migration file names in `dir`; directories are not migrations to dbmate. */
export function readLocalNames(dir) {
  return readdirSync(dir).filter((name) => lstatSync(path.join(dir, name)).isFile());
}

/** Versions held by more than one migration file name. */
export function localDuplicates(names) {
  const byVersion = new Map();
  for (const name of [...names].sort()) {
    const version = migrationVersion(`${DIR}/${name}`);
    if (version !== null) byVersion.set(version, [...(byVersion.get(version) ?? []), `${DIR}/${name}`]);
  }
  return [...byVersion].filter(([, files]) => files.length > 1).map(([version, files]) => ({ version, files }));
}

async function pages(api, url, maxPages) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await api(`${url}${url.includes("?") ? "&" : "?"}per_page=${PER_PAGE}&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`GitHub answer for ${url} is not a list.`);
    items.push(...batch);
    if (batch.length < PER_PAGE) return { items, complete: true };
  }
  return { items, complete: false };
}

/**
 * Files of one PR, read between two reads of its head. The list counts only
 * when the head did not move, the last page was short and it holds at least
 * changed_files entries; a moved head is read once more, anything else throws.
 */
export async function readPull(api, base, number) {
  for (let read = 1; read <= READS; read += 1) {
    const before = await api(`${base}/pulls/${number}`);
    if (!before?.head?.sha) throw new Error(`#${number} has no head.`);
    const files = await pages(api, `${base}/pulls/${number}/files`, FILE_PAGES);
    const after = await api(`${base}/pulls/${number}`);
    if (after?.head?.sha !== before.head.sha) continue;
    if (!files.complete || !(after.changed_files <= files.items.length)) throw new Error(`File list of #${number} is incomplete.`);
    return { number, head: after.head.sha, state: after.state, files: files.items };
  }
  throw new Error(`#${number} kept changing while its files were read; rerun the check.`);
}

/**
 * One state of the repository: main's SHA and every PR, read oldest first
 * (`state=all`, so a PR that closes or merges between two pages stays in place
 * and shifts no page; new PRs come last). `key` compares two states: main and
 * every open PR with its head.
 */
export async function inventory(api, base) {
  const main = (await api(`${base}/git/ref/heads/main`))?.object?.sha;
  if (!main) throw new Error("Cannot read the SHA of main.");
  const all = await pages(api, `${base}/pulls?state=all&sort=created&direction=asc`, ALL_PAGES);
  if (!all.complete) throw new Error("Cannot read every PR, so not every open PR is known.");
  const open = all.items.filter((p) => p.state === "open").map((p) => ({ number: p.number, head: p.head?.sha ?? null }));
  return { main, open, key: JSON.stringify([main, ...open.map((p) => [p.number, p.head]).sort(([a], [b]) => a - b)]) };
}

/**
 * Reads the PR, then (when it introduces a migration) main at a fixed SHA and
 * every open PR between two reads of the inventory. A result counts only when
 * both inventories are equal and every PR was read open at its listed head;
 * otherwise everything is read once more, and a second change throws.
 */
export async function checkPullRequest({ api, owner, repo, number, headSha }) {
  const base = `/repos/${owner}/${repo}`;
  const self = await readPull(api, base, number);
  if (self.head !== headSha) throw new Error("PR changed after this CI run started; a newer run decides.");
  if (introduced(self.files).length === 0) return [];

  for (let read = 1; read <= READS; read += 1) {
    const before = await inventory(api, base);
    const listing = await api(`${base}/contents/${DIR}?ref=${before.main}`);
    // The contents API lists at most 1000 entries of a directory.
    if (!Array.isArray(listing) || listing.length >= 1000) throw new Error(`Cannot list ${DIR} on main completely.`);
    const main = listing.filter((e) => e.type === "file").map((e) => ({ name: e.name, sha: e.sha }));
    const pulls = [];
    let stable = true;
    for (const p of before.open) {
      if (p.number === number) continue;
      const pull = await readPull(api, base, p.number);
      if (pull.state !== "open" || pull.head !== p.head) stable = false;
      pulls.push(pull);
    }
    if (stable && (await inventory(api, base)).key === before.key) return findCollisions({ self, main, pulls });
  }
  throw new Error("main or the PRs changed during both reads of the inventory; rerun the check.");
}

async function main() {
  const errors = localDuplicates(readLocalNames(DIR)).map(
    (d) => `version ${d.version} is used by more than one migration: ${d.files.join(", ")} (P6).`,
  );
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  if (event.pull_request) {
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository } = process.env;
    if (!token || !repository) throw new Error("Missing GitHub runtime environment.");
    const [owner, repo] = repository.split("/");
    const api = createApi({ token, baseUrl: process.env.GITHUB_API_URL ?? "https://api.github.com" });
    const collisions = await checkPullRequest({
      api,
      owner,
      repo,
      number: event.pull_request.number,
      headSha: event.pull_request.head?.sha,
    });
    errors.push(...collisions.map(formatCollision));
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`Migration version collision: ${error}`);
    process.exit(1);
  }
  console.log(
    event.pull_request
      ? "Migration versions: no collision in the checkout, with main or with an open PR."
      : "Migration versions: no collision in the checkout (not a pull_request event).",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
