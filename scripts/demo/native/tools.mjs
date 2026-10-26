// DAN-324 (#799): the pinned Windows binaries of `pnpm demo:up:native`, and
// how they are fetched, checked, unpacked and started. A binary runs only
// from a directory whose every file matches the manifest's tree digest, so
// one changed byte, an extra file or a changed manifest value refuses the
// start before anything runs. EDB publishes no checksum for its zip; its
// SHA-256 is fixed from two independent downloads (the writer session and
// the Windows CI job). The rustfs value is the one in the release's SHA256SUMS.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, openSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { connect } from "node:net";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MANIFEST = Object.freeze({
  postgres: Object.freeze({
    version: "17.11-1",
    url: "https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip",
    size: 340719294,
    sha256: "6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3",
    // Only what the runner needs; pgAdmin, StackBuilder and the docs stay in the zip.
    members: Object.freeze(["pgsql/bin", "pgsql/lib", "pgsql/share", "pgsql/server_license.txt"]),
    files: 1564,
    tree: "42591da22086a04a30831528dff66090d42f3e3ffb52b6a7881cfd290a580645",
  }),
  rustfs: Object.freeze({
    version: "1.0.0",
    url: "https://github.com/rustfs/rustfs/releases/download/1.0.0/rustfs-windows-x86_64-v1.0.0.zip",
    size: 105040603,
    sha256: "4ccf5858ce8e6f70f01af2394c8cc0e0878ee77faa6c20d3179153476554b7d8",
    members: Object.freeze(["rustfs.exe"]),
    files: 1,
    tree: "c226ff64a8f0475a1ba35ea8409d064e857709b237d3d675837bd27421bfee19",
  }),
});

const sha256 = () => createHash("sha256");

export async function fileSha256(path) {
  const hash = sha256();
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * sha256sum lines ("<hex>  <path with />") of every file under dir, sorted, and
 * hashed. Anything but plain files and directories (a link, a junction) is refused.
 */
export async function treeDigest(dir) {
  const lines = [];
  async function walk(relative) {
    for (const entry of await readdir(join(dir, relative), { withFileTypes: true })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) lines.push(`${await fileSha256(join(dir, path))}  ${path}\n`);
      else throw new Error(`${path} is not a plain file`);
    }
  }
  await walk("");
  lines.sort();
  return { files: lines.length, digest: sha256().update(lines.join("")).digest("hex") };
}

export async function verifyTree(name, dir, manifest = MANIFEST) {
  const expected = manifest[name];
  const found = await treeDigest(dir).catch(() => undefined);
  if (found === undefined || found.files !== expected.files || found.digest !== expected.tree) {
    throw new Error(`${name} in ${dir} does not match the manifest; nothing was started. Delete that folder and run again.`);
  }
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

/** The zip, streamed to disk and hashed on the way; a wrong size or digest deletes it. */
async function download(name, file, manifest, fetchImpl) {
  const { url, size, sha256: expected } = manifest[name];
  const partial = `${file}.partial`;
  await rm(partial, { force: true });
  const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok || response.body === null) throw new Error(`${name} could not be downloaded (${response.status})`);
  const hash = sha256();
  let bytes = 0;
  const count = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), count, createWriteStream(partial));
    if (bytes !== size || hash.digest("hex") !== expected) {
      throw new Error(`the downloaded ${name} does not match the manifest; nothing was started`);
    }
    await rename(partial, file);
  } finally {
    await rm(partial, { force: true });
  }
}

/** The verified tool directory, fetched and unpacked first if it is not there. */
export async function ensureTool(name, base, { manifest = MANIFEST, fetchImpl = fetch, tar, log = console.log } = {}) {
  const entry = manifest[name];
  const dir = join(base, `${name}-${entry.version}`);
  if (await exists(dir)) {
    await verifyTree(name, dir, manifest);
    return dir;
  }
  const downloads = join(base, ".download");
  await mkdir(downloads, { recursive: true });
  const zip = join(downloads, basename(new URL(entry.url).pathname));
  const cached = (await exists(zip)) && (await stat(zip)).size === entry.size && (await fileSha256(zip)) === entry.sha256;
  if (!cached) {
    await rm(zip, { force: true });
    log(`Downloading ${name} ${entry.version} (${Math.round(entry.size / 1e6)} MB) from ${new URL(entry.url).host}.`);
    await download(name, zip, manifest, fetchImpl);
  }
  const partial = `${dir}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  if ((await run(tar, ["-x", "-f", zip, "-C", partial, ...entry.members], { stdio: "ignore" })) !== 0) {
    throw new Error(`${name} could not be unpacked with ${tar}`);
  }
  await verifyTree(name, partial, manifest);
  await rename(partial, dir);
  return dir;
}

/** Windows' own tar.exe (bsdtar, reads zip), never one found on PATH. */
export function windowsTar(env) {
  return join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
}

/** Exit code of a child started without a shell. */
export function run(command, args, { env, input, stdio = "inherit", cwd, detached = false } = {}) {
  return new Promise((resolve) => {
    const options = { cwd, env, detached, windowsHide: true, stdio: input === undefined ? stdio : ["pipe", "inherit", "inherit"] };
    const child = spawn(command, args, options);
    child.once("error", () => resolve(127));
    child.once("exit", (code) => resolve(code ?? 1));
    if (typeof input === "string") child.stdin.end(input);
    else if (input !== undefined) input.pipe(child.stdin);
  });
}

/** A long-running service, detached from this console and logged to a file; resolves to its pid. */
export function startService(command, args, { env, log, cwd }) {
  const fd = openSync(log, "a");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, windowsHide: true, stdio: ["ignore", fd, fd] });
    child.once("error", () => reject(new Error(`could not start ${basename(command)}`)));
    child.once("spawn", () => {
      child.unref();
      resolve(child.pid);
    });
  }).finally(() => closeSync(fd));
}

/** True when something already accepts connections on 127.0.0.1:port. */
export function portInUse(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (used) => {
      socket.destroy();
      resolve(used);
    };
    socket.setTimeout(timeoutMs, () => done(true));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export async function waitFor(label, check, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} did not become ready in ${Math.round(timeoutMs / 1000)} s`);
}
