import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEV_SIGNING_KEY_FILE,
  DevelopmentSigningKeyError,
  PersistentDevelopmentEd25519SigningKeyProvider,
  developmentKeyIdentity,
} from "./persistent-development-ed25519-signer";

// Invented seed bytes; no key here belongs to anyone.
const SEED = Buffer.alloc(32, 7);
const MESSAGE = new TextEncoder().encode("ductus-evidence-receipt-v2\nsynthetic");

let dir: string;
let repo: string;
const file = (name: string) => join(dir, name);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ductus-dev-key-"));
  repo = join(dir, "repo");
  await mkdir(repo);
  await writeFile(file("seed"), SEED, { mode: 0o600 });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const signer = (path: string | undefined, nodeEnv = "test") =>
  new PersistentDevelopmentEd25519SigningKeyProvider({ NODE_ENV: nodeEnv, [DEV_SIGNING_KEY_FILE]: path }, repo);

async function fault(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DevelopmentSigningKeyError);
  return (error as DevelopmentSigningKeyError).code;
}

describe("persistent development signer", () => {
  it("gives the same key, identity and signature from the same seed in two instances", async () => {
    const [a, b] = [signer(file("seed")), signer(file("seed"))];
    const keyA = await a.publicVerificationKey();
    expect(await b.publicVerificationKey()).toEqual(keyA);
    expect(await b.sign(MESSAGE)).toEqual(await a.sign(MESSAGE));

    const spki = Buffer.from(keyA.keyBase64Url, "base64url");
    const fingerprint = createHash("sha256").update(spki).digest("hex");
    expect(keyA).toMatchObject({
      algorithm: "Ed25519",
      encoding: "spki-der",
      keyId: `dev-ed25519-${fingerprint.slice(0, 16)}`,
      keyVersion: `spki-sha256-${fingerprint}`,
    });
    expect(developmentKeyIdentity(spki)).toEqual({ keyId: keyA.keyId, keyVersion: keyA.keyVersion });
    // The canonical 44-byte SPKI the registry takes.
    expect(keyA.keyBase64Url).toMatch(/^MCowBQYDK2VwAyEA[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
  });

  it("signs what node:crypto verifies with the exported public key, and verifies its own signature only", async () => {
    const s = signer(file("seed"));
    const signature = await s.sign(MESSAGE);
    const publicKey = createPublicKey({
      key: Buffer.from((await s.publicVerificationKey()).keyBase64Url, "base64url"),
      format: "der",
      type: "spki",
    });
    expect(nodeVerify(null, MESSAGE, publicKey, Buffer.from(signature.signatureBase64Url, "base64url"))).toBe(true);
    expect(await s.verify(MESSAGE, signature)).toBe(true);
    expect(await s.verify(new TextEncoder().encode("other"), signature)).toBe(false);
    expect(await s.verify(MESSAGE, { ...signature, keyVersion: "1" })).toBe(false);
  });

  it("refuses construction in production (T9)", () => {
    expect(() => signer(file("seed"), "production")).toThrow(DevelopmentSigningKeyError);
  });

  it.each([
    ["no path", undefined, "signing_key_not_configured"],
    ["an empty path", "", "signing_key_not_configured"],
    ["a relative path", "seed", "signing_key_path_not_absolute"],
    ["a missing file", "missing", "signing_key_missing"],
    ["a directory", "repo", "signing_key_not_regular_file"],
    ["a short seed", "short", "signing_key_malformed"],
    ["a long seed", "long", "signing_key_malformed"],
    ["a file in the repository", "repo/seed", "signing_key_in_repository"],
    ["a file under a repository directory named like ..", "repo/..keys/seed", "signing_key_in_repository"],
  ])("never makes a key for %s, on every call (T5)", async (_, name, code) => {
    await writeFile(file("short"), SEED.subarray(0, 31), { mode: 0o600 });
    await writeFile(file("long"), Buffer.concat([SEED, Buffer.from([0])]), { mode: 0o600 });
    await writeFile(file("repo/seed"), SEED, { mode: 0o600 });
    const path = name === undefined || name === "" || name === "seed" ? name : file(name);
    const s = signer(path);
    expect(await fault(s.sign(MESSAGE))).toBe(code);
    expect(await fault(s.publicVerificationKey())).toBe(code);
    expect(await fault(s.verify(MESSAGE, await signer(file("seed")).sign(MESSAGE)))).toBe(code);
  });

  it("judges a seed under a link to the repository by where it leads, also before its directory exists", async () => {
    // A directory link; a junction on Windows, which needs no privilege.
    await symlink(repo, file("repo-link"), process.platform === "win32" ? "junction" : "dir");
    // ".." after a directory that does not exist is folded first (review465b);
    // written by hand, because join() would fold it itself.
    const behindDotDot = [dir, "not-yet", "..", "repo-link", "seed-dir", "seed"].join(sep);
    for (const path of [file("repo-link/not-yet/seed"), file("repo-link/not-yet/deeper/seed"), file("repo-link/seed"), behindDotDot]) {
      expect(await fault(signer(path).sign(MESSAGE))).toBe("signing_key_in_repository");
    }
    // A missing directory outside the repository is only missing.
    expect(await fault(signer(file("not-yet/seed")).sign(MESSAGE))).toBe("signing_key_missing");
  });

  it("names no path or key byte in a fault", async () => {
    const canary = file("canary-path-7f3a");
    const error = await signer(canary).sign(MESSAGE).catch((e: unknown) => e as Error);
    expect(String(error)).not.toContain("canary");
    expect(JSON.stringify({ ...(error as object), message: (error as Error).message })).not.toContain("canary");
  });

  it("reads the file again after a fault, so a key made later is used", async () => {
    const s = signer(file("late"));
    expect(await fault(s.sign(MESSAGE))).toBe("signing_key_missing");
    await writeFile(file("late"), SEED, { mode: 0o600 });
    expect((await s.publicVerificationKey()).keyId).toBe((await signer(file("seed")).publicVerificationKey()).keyId);
  });

  // POSIX permission bits do not mean the same on Windows, so there the seed
  // is not judged by them (known limit 1); CI runs the POSIX branch.
  it("refuses a seed others can read on POSIX", async () => {
    await writeFile(file("open"), SEED);
    await chmod(file("open"), 0o644);
    const loaded = signer(file("open")).publicVerificationKey();
    if (process.platform === "win32") {
      expect((await loaded).keyBase64Url).toBe((await signer(file("seed")).publicVerificationKey()).keyBase64Url);
    } else {
      expect(await fault(loaded)).toBe("signing_key_permissions");
    }
  });

  it("refuses a link to a seed", async () => {
    // Creating a file link on Windows needs a privilege; a junction stands in.
    const made = await symlink(file("seed"), file("link"), "file").then(
      () => file("link"),
      async () => {
        await symlink(repo, file("junction"), "junction");
        return file("junction");
      },
    );
    expect(await fault(signer(made).sign(MESSAGE))).toBe("signing_key_not_regular_file");
  });
});
