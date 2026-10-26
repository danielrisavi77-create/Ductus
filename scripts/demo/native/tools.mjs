// DAN-324 (#799): the pinned Windows binaries of the native demo runner. The
// runner downloads each archive once from its publisher, checks size and
// SHA-256 before it is unpacked, and checks the tree hash of the unpacked
// files before every start, so no binary runs whose bytes differ from the
// ones measured here. Nothing is downloaded into the repository.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Archives measured on 25 October 2026. `tree` is the hash of the unpacked
 * files (treeHash below): every file, its path and its SHA-256, nothing else.
 */
export const TOOLS = Object.freeze({
  postgres: Object.freeze({
    version: "17.11-1",
    url: "https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip",
    size: 340_719_294,
    sha256: "6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3",
    // Only the server and the client tools; pgAdmin and StackBuilder stay in the archive.
    members: Object.freeze(["pgsql/bin", "pgsql/lib", "pgsql/share"]),
    strip: 1,
    tree: "07d3ef12d49112d5a0b62be6605e89f5bbb8b79e2ff59ddb9721baae175fc8d9",
  }),
  rustfs: Object.freeze({
    version: "1.0.0",
    url: "https://github.com/rustfs/rustfs/releases/download/1.0.0/rustfs-windows-x86_64-v1.0.0.zip",
    size: 105_040_603,
    sha256: "4ccf5858ce8e6f70f01af2394c8cc0e0878ee77faa6c20d3179153476554b7d8",
    members: Object.freeze(["rustfs.exe"]),
    strip: 0,
    tree: "226bb8d4d57cc1e602d858d8cce5dbdac0cd2bba65691b67dc78a1c912fbbb99",
  }),
});

/** %LOCALAPPDATA%\Ductus: tools in native\, data in native-data\, both outside the repository. */
export function ductusHome(env) {
  const base = env.LOCALAPPDATA;
  if (typeof base !== "string" || !isAbsolute(base)) throw new Error("LOCALAPPDATA must be an absolute path");
  return join(base, "Ductus");
}

export const toolDir = (home, name) => join(home, "native", `${name}-${TOOLS[name].version}`);

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function listFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
    else if (!entry.isDirectory()) throw new Error(`unexpected entry in ${dir}`);
  }
  return files;
}

/** One hash over every file of a directory: `path NUL sha256 LF` per file, paths with `/`, sorted. */
export async function treeHash(dir) {
  const lines = [];
  for (const file of await listFiles(dir)) {
    lines.push(`${relative(dir, file).split(sep).join("/")}\0${await sha256File(file)}\n`);
  }
  lines.sort();
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** Download to a .part file, checking size and SHA-256 while it streams; the file keeps its name only if both match. */
export async function download(tool, dest, fetchImpl = fetch) {
  const part = `${dest}.part`;
  const response = await fetchImpl(tool.url, { redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${tool.url}`);
  const hash = createHash("sha256");
  let size = 0;
  const body = Readable.fromWeb(response.body);
  body.on("data", (chunk) => {
    hash.update(chunk);
    size += chunk.length;
  });
  await pipeline(body, createWriteStream(part));
  const digest = hash.digest("hex");
  if (size !== tool.size || digest !== tool.sha256) {
    await rm(part, { force: true });
    throw new Error(`the download of ${tool.url} does not match the pinned SHA-256; nothing was unpacked`);
  }
  await rename(part, dest);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
    child.once("error", () => reject(new Error(`could not start ${command}`)));
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`))));
  });
}

/** tar.exe of Windows 10 1803+ and 11, by absolute path, never through a shell or PATH. */
export function windowsTar(env) {
  const root = env.SystemRoot;
  if (typeof root !== "string" || !isAbsolute(root)) throw new Error("SystemRoot must be an absolute path");
  return join(root, "System32", "tar.exe");
}

/**
 * The verified directory of a tool. A directory whose tree hash differs is
 * refused, never repaired: it is reported, and the runner starts nothing.
 */
export async function ensureTool(name, { home, tar, fetchImpl = fetch, log = console.log }) {
  const tool = TOOLS[name];
  const dir = toolDir(home, name);
  const present = await stat(dir).then(() => true, () => false);
  if (!present) {
    const downloads = join(home, "native", "downloads");
    await mkdir(downloads, { recursive: true });
    const archive = join(downloads, `${name}-${tool.version}.zip`);
    log(`Downloading ${name} ${tool.version} (${Math.round(tool.size / 1e6)} MB) and checking its SHA-256.`);
    await download(tool, archive, fetchImpl);
    const staging = `${dir}.unpack`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const strip = tool.strip ? ["--strip-components", String(tool.strip)] : [];
    await run(tar, ["-xf", archive, "-C", staging, ...strip, ...tool.members]);
    await rm(archive, { force: true });
    await rename(staging, dir);
  }
  if ((await treeHash(dir)) !== tool.tree) {
    throw new Error(`${dir} does not match the pinned files of ${name} ${tool.version}; delete that folder and run again`);
  }
  return dir;
}
