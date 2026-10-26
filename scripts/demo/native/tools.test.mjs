import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loopbackArgs } from "./loopback-listen.mjs";
import { MANIFEST, ensureTool, treeDigest, verifyTree } from "./tools.mjs";

const sha = (data) => createHash("sha256").update(data).digest("hex");

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "ductus-native-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A tool tree with two invented files, and a manifest entry that matches it. */
async function fixtureTool(base) {
  const dir = join(base, "demo-1.0.0");
  await mkdir(join(dir, "bin"), { recursive: true });
  await writeFile(join(dir, "bin", "tool.exe"), "invented binary");
  await writeFile(join(dir, "license.txt"), "invented license");
  const { files, digest } = await treeDigest(dir);
  const zip = Buffer.from("invented zip");
  const manifest = {
    demo: { version: "1.0.0", url: "https://example.invalid/demo.zip", size: zip.length, sha256: sha(zip), members: ["bin"], files, tree: digest },
  };
  return { dir, manifest, zip };
}

test("the manifest pins both tools by size, digest and tree", () => {
  for (const entry of Object.values(MANIFEST)) {
    assert.match(entry.url, /^https:\/\//);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.match(entry.tree, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(entry.size) && entry.size > 0 && entry.files > 0);
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.members));
  }
  assert.ok(Object.isFrozen(MANIFEST));
});

test("the tree digest is sha256sum lines sorted and hashed", async (t) => {
  const { dir } = await fixtureTool(await tempDir(t));
  const lines = [`${sha("invented binary")}  bin/tool.exe\n`, `${sha("invented license")}  license.txt\n`].sort();
  assert.deepEqual(await treeDigest(dir), { files: 2, digest: sha(lines.join("")) });
});

test("one changed byte, an extra file or a changed manifest refuses the tool", async (t) => {
  const { dir, manifest } = await fixtureTool(await tempDir(t));
  await verifyTree("demo", dir, manifest);
  const refused = /does not match the manifest; nothing was started/;

  await assert.rejects(verifyTree("demo", dir, { demo: { ...manifest.demo, tree: "0".repeat(64) } }), refused);
  await assert.rejects(verifyTree("demo", dir, { demo: { ...manifest.demo, files: 3 } }), refused);

  await writeFile(join(dir, "bin", "tool.exe"), "invented binarY");
  await assert.rejects(verifyTree("demo", dir, manifest), refused);
  await writeFile(join(dir, "bin", "tool.exe"), "invented binary");

  await writeFile(join(dir, "bin", "extra.dll"), "x");
  await assert.rejects(verifyTree("demo", dir, manifest), refused);
});

test("a link inside the tool tree is refused, not followed", async (t) => {
  const { dir, manifest } = await fixtureTool(await tempDir(t));
  await symlink(join(dir, "license.txt"), join(dir, "bin", "link.txt"));
  await assert.rejects(treeDigest(dir), /not a plain file/);
  await assert.rejects(verifyTree("demo", dir, manifest), /does not match the manifest/);
});

test("an unpacked tool is verified before use and never downloaded again", async (t) => {
  const base = await tempDir(t);
  const { dir, manifest } = await fixtureTool(base);
  const fetchImpl = () => assert.fail("no download for an unpacked tool");
  assert.equal(await ensureTool("demo", base, { manifest, fetchImpl, tar: "unused" }), dir);

  await writeFile(join(dir, "license.txt"), "tampered");
  await assert.rejects(ensureTool("demo", base, { manifest, fetchImpl, tar: "unused" }), /does not match the manifest/);
});

test("a download of the wrong size or digest is deleted and nothing is unpacked", async (t) => {
  const base = await tempDir(t);
  const { manifest } = await fixtureTool(join(base, "elsewhere"));
  const log = () => {};
  for (const body of ["invented zap", "invented zip!"]) {
    const fetchImpl = async () => new Response(body);
    const tar = join(base, "no-such-tar");
    await assert.rejects(ensureTool("demo", base, { manifest, fetchImpl, tar, log }), /downloaded demo does not match the manifest/);
    assert.deepEqual(await readdir(join(base, ".download")), []);
    assert.ok(!(await readdir(base)).includes("demo-1.0.0"));
  }
  await assert.rejects(ensureTool("demo", base, { manifest, fetchImpl: async () => new Response("", { status: 404 }), log }), /could not be downloaded \(404\)/);
});

test("a tampered cached zip is deleted and fetched again", async (t) => {
  const base = await tempDir(t);
  const { manifest, zip } = await fixtureTool(join(base, "elsewhere"));
  await mkdir(join(base, ".download"));
  await writeFile(join(base, ".download", "demo.zip"), "invented zap");
  let fetched = 0;
  const fetchImpl = async () => {
    fetched += 1;
    return new Response(zip);
  };
  // The fresh zip matches; unpacking then fails because the tar given here does not exist.
  await assert.rejects(ensureTool("demo", base, { manifest, fetchImpl, tar: join(base, "no-such-tar"), log: () => {} }), /could not be unpacked/);
  assert.equal(fetched, 1);
  assert.deepEqual(await readdir(join(base, ".download")), ["demo.zip"]);
  assert.ok(!(await readdir(base)).includes("demo-1.0.0"));
});

test("every TCP listen of the fake OIDC process is bound to 127.0.0.1", () => {
  const cb = () => {};
  assert.deepEqual(loopbackArgs([]), [0, "127.0.0.1"]);
  assert.deepEqual(loopbackArgs([cb]), [0, "127.0.0.1", cb]);
  assert.deepEqual(loopbackArgs([8090, cb]), [8090, "127.0.0.1", cb]);
  assert.deepEqual(loopbackArgs(["8090", cb]), ["8090", "127.0.0.1", cb]);
  assert.deepEqual(loopbackArgs([8090, "0.0.0.0", cb]), [8090, "127.0.0.1", cb]);
  assert.deepEqual(loopbackArgs([8090, "::", 511, cb]), [8090, "127.0.0.1", 511, cb]);
  assert.deepEqual(loopbackArgs([{ port: 8090, host: "::" }, cb]), [{ port: 8090, host: "127.0.0.1" }, cb]);
  assert.deepEqual(loopbackArgs([{ path: "pipe" }]), [{ path: "pipe" }]);
});

test("the preloaded patch binds a server that asks for every interface to loopback", async () => {
  await import("./loopback-listen.mjs");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  try {
    assert.equal(server.address().address, "127.0.0.1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
