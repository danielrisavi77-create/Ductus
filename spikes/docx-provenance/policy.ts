// M8.8-P01 (DAN-435), attack plan #1597: the reviewed dependency set of this
// spike and the static checks that hold the manifest, the npm lockfile and the
// offline generator (pinned by content hash) to it. A review aid that fails loudly, not a sandbox:
// runtime isolation of parsing is ARCHITECTURE §5c and M8.8-P02.

export type Reviewed = { name: string; version: string; integrity: string; license: string; published: string; direct: boolean };

// Every package the lockfile may hold. Integrity and licence were checked
// against the registry tarballs; see docs/spikes/M8.8-P01.md.
export const REVIEWED: readonly Reviewed[] = [
  { name: "fflate", version: "0.8.3", license: "MIT", published: "2026-05-16", direct: true,
    integrity: "sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==" },
  { name: "saxes", version: "6.0.0", license: "ISC", published: "2021-11-07", direct: true,
    integrity: "sha512-xAg7SOnEhrm5zI3puOOKyy1OMcMlIJZYNJY7xLBwSze0UjhPLnWfj2GF2EpT0jmzaJKIWKHLsaSSajf35bcYnA==" },
  { name: "xmlchars", version: "2.2.0", license: "MIT", published: "2019-09-06", direct: false,
    integrity: "sha512-JZnDKK8B0RCDw84FNdDAIpZK+JuJw+s7Lz8nksI7SIuU3UXJJslUthsi+uWBUYOwPFwW7W7PRLRfUKpxjtjFCw==" },
];

// Permissive subset of allow-licenses in .github/workflows/dependency-review.yml
// (the test keeps it a subset). A licence outside it needs an owner decision.
export const ALLOWED_LICENSES = ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD"];

// The generator is pinned to the exact bytes reviewed in #1600 (orchestrator c.6676693291): a list of
// forbidden forms cannot be completed by text checks, a content hash can. Any change to gen.mjs fails
// here and needs a new review that updates this pin in the same PR.
export const GENERATOR_PIN = {
  path: "spikes/docx-provenance/gen.mjs",
  sha256: "ac94b45086a170ab94ce2f98c754d75ec7f0b48aaaf8a1814d7266fdd338049d",
  reason: "pregledano u #1600",
} as const;
// Modules the generator may load statically; network, process, worker and vm modules are not here.
const GENERATOR_IMPORTS = new Set(["node:fs", "node:path", "node:url", ...REVIEWED.filter((p) => p.direct).map((p) => p.name)]);
// Module loaders other than a static import statement.
const GENERATOR_LOADERS: [RegExp, string][] = [
  [/\brequire\b/, "require"], [/\bcreateRequire\b/, "createRequire"],
  [/\bimport\s*\.\s*meta\b(?!\s*\.\s*url\b)/, "import.meta other than import.meta.url"],
];
const OTHER_DEP_FIELDS = ["devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta",
  "bundleDependencies", "bundledDependencies", "overrides", "resolutions", "workspaces"];
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "preprepare", "postprepare", "prepublish", "dependencies"];
const ENTRY_FLAGS = ["hasInstallScript", "link", "dev", "optional", "devOptional", "peer", "inBundle"];

const byName = new Map(REVIEWED.map((p) => [p.name, p]));
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Exactly X.Y.Z with decimal integers and no leading zeros: no range, tag, prerelease or build metadata. */
export const isExactVersion = (v: unknown): boolean =>
  typeof v === "string" && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(v);

/** Null for a single allowed SPDX id; an error for anything else, expressions included. */
export function licenseError(license: unknown): string | null {
  if (typeof license !== "string" || !/^[A-Za-z0-9.+-]+$/.test(license)) return `licence ${JSON.stringify(license)} is not a single SPDX id`;
  return ALLOWED_LICENSES.includes(license) ? null : `licence ${license} is not allowed`;
}

export const tarballUrl = (name: string, version: string) =>
  `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;

export function checkManifest(pkg: unknown): string[] {
  if (!isObj(pkg)) return ["package.json is not an object"];
  const errors: string[] = [];
  if (pkg.private !== true) errors.push("package.json must be private");
  for (const f of OTHER_DEP_FIELDS) if (f in pkg) errors.push(`package.json has ${f}`);
  if (isObj(pkg.scripts)) for (const s of INSTALL_SCRIPTS) if (Object.hasOwn(pkg.scripts, s)) errors.push(`package.json has a ${s} script`);
  const deps = pkg.dependencies;
  if (!isObj(deps)) return [...errors, "package.json has no dependencies object"];
  for (const [name, spec] of Object.entries(deps)) {
    const r = byName.get(name);
    if (!r?.direct) errors.push(`dependency ${name} is not reviewed as direct`);
    else if (!isExactVersion(spec) || spec !== r.version) errors.push(`dependency ${name} must be exactly ${r.version}, got ${JSON.stringify(spec)}`);
  }
  for (const r of REVIEWED) if (r.direct && !Object.hasOwn(deps, r.name)) errors.push(`dependency ${r.name} is missing`);
  return errors;
}

export function checkLockfile(lock: unknown, pkg: unknown): string[] {
  if (!isObj(lock) || !isObj(lock.packages)) return ["lockfile has no packages"];
  if (!isObj(pkg)) return ["package.json is not an object"];
  const errors: string[] = [];
  if (lock.lockfileVersion !== 3) errors.push("lockfileVersion must be 3");
  const root = lock.packages[""];
  const sorted = (o: unknown) => JSON.stringify(isObj(o) ? Object.entries(o).sort() : o);
  if (!isObj(root) || root.name !== pkg.name || sorted(root.dependencies) !== sorted(pkg.dependencies)) {
    errors.push("lockfile root does not match package.json");
  } else for (const f of OTHER_DEP_FIELDS) if (f in root) errors.push(`lockfile root has ${f}`);
  const seen = new Set<string>();
  for (const [key, e] of Object.entries(lock.packages)) {
    if (key === "") continue;
    const name = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key)?.[1];
    const r = name ? byName.get(name) : undefined;
    if (!name || !r) { errors.push(`lockfile entry ${key} is not a reviewed package`); continue; }
    seen.add(name);
    if (!isObj(e)) { errors.push(`${name}: entry is not an object`); continue; }
    if (e.version !== r.version) errors.push(`${name}: version ${String(e.version)} is not ${r.version}`);
    if (typeof e.integrity !== "string" || !e.integrity.startsWith("sha512-") || e.integrity !== r.integrity) errors.push(`${name}: integrity differs`);
    if (e.resolved !== tarballUrl(name, r.version)) errors.push(`${name}: resolved is not the npm registry tarball`);
    for (const f of ENTRY_FLAGS) if (e[f]) errors.push(`${name}: ${f} is set`);
    const le = licenseError(e.license);
    if (le) errors.push(`${name}: ${le}`);
    else if (e.license !== r.license) errors.push(`${name}: licence ${String(e.license)} is not the reviewed ${r.license}`);
  }
  for (const r of REVIEWED) if (!seen.has(r.name)) errors.push(`${r.name} is missing from the lockfile`);
  return errors;
}

// SHA-256 (FIPS 180-4) without imports, so the policy stays free of modules; the test checks it against node:crypto.
const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every((q) => n % q !== 0)) PRIMES.push(n);
const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = PRIMES.map((p) => frac32(Math.cbrt(p)));
const H0 = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(bytes: Uint8Array): string {
  const len = bytes.length;
  const block = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  block.set(bytes);
  block[len] = 0x80;
  const view = new DataView(block.buffer);
  view.setUint32(block.length - 8, Math.floor(len / 2 ** 29));
  view.setUint32(block.length - 4, (len * 8) >>> 0);
  const h = [...H0];
  const w = new Uint32Array(64);
  for (let off = 0; off < block.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [k, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, k].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** Static import checks: every import is a recognised statement of an allowed module, no other loader, no re-export. */
export function checkGeneratorImports(source: string): string[] {
  const errors = GENERATOR_LOADERS.filter(([re]) => re.test(source)).map(([, what]) => `generator uses ${what}`);
  const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);
  for (const s of specifiers) if (!GENERATOR_IMPORTS.has(s)) errors.push(`generator imports ${s}`);
  // Every import keyword must be a statement the patterns above understood; this also rejects import().
  const keywords = source.match(/\bimport\b(?!\s*\.\s*meta)/g)?.length ?? 0;
  const statements = source.match(/\bimport\s+(?:[\w*{}\s,$]+?\s+from\s*)?["'][^"']+["']|\bimport\s*["'][^"']+["']/g)?.length ?? 0;
  if (keywords !== statements) errors.push("generator has an import the check does not recognise");
  // A re-export loads a module too, and a comment can hide its specifier: every export must be a declaration.
  if (/\bexport\b(?!\s+(?:const|let|var|class|function|async\s+function)\b)/.test(source)) errors.push("generator has an export that is not a declaration");
  return errors;
}

/** The generator must be byte for byte the pinned reviewed file (bytes as stored, LF) and pass the import checks. */
export function checkGenerator(generator: string | Uint8Array): string[] {
  const bytes = typeof generator === "string" ? new TextEncoder().encode(generator) : generator;
  if (bytes.length === 0) return ["generator is empty"];
  const errors: string[] = [];
  const digest = sha256Hex(bytes);
  if (digest !== GENERATOR_PIN.sha256) {
    errors.push(`${GENERATOR_PIN.path} has sha256 ${digest}, not the pinned ${GENERATOR_PIN.sha256} (${GENERATOR_PIN.reason}): `
      + "a change to the generator needs a new review and a new pin");
  }
  return [...errors, ...checkGeneratorImports(new TextDecoder().decode(bytes))];
}

export type SpikeFiles = { manifest: string; lockfile: string; generator: string | Uint8Array };
const parse = (text: string, what: string, errors: string[]): unknown => {
  try { return JSON.parse(text); } catch { errors.push(`${what} is not JSON`); return undefined; }
};

/** All findings for the three spike files; an empty list means the set matches the review. */
export function checkSpike(files: SpikeFiles): string[] {
  const errors: string[] = [];
  const pkg = parse(files.manifest, "package.json", errors);
  const lock = parse(files.lockfile, "package-lock.json", errors);
  return [...errors, ...checkManifest(pkg), ...checkLockfile(lock, pkg), ...checkGenerator(files.generator)];
}
