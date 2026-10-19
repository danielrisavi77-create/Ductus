import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  PublicVerificationKey,
  SignatureEnvelope,
  SigningKeyProvider,
} from "@/application/ports/signing-key-provider";

// Runtime imports stay `node:*` only: db/local/evidence-signing-key.mjs loads
// this file directly through Node's type stripping, without a build step.

/** Absolute path of the 32-byte development seed, outside the repository. */
export const DEV_SIGNING_KEY_FILE = "DUCTUS_DEV_SIGNING_KEY_FILE";

export type DevelopmentSigningKeyFault =
  | "signing_key_production"
  | "signing_key_not_configured"
  | "signing_key_path_not_absolute"
  | "signing_key_in_repository"
  | "signing_key_missing"
  | "signing_key_not_regular_file"
  | "signing_key_permissions"
  | "signing_key_malformed";

/** The message is the closed code; it never holds the path or a key byte. */
export class DevelopmentSigningKeyError extends Error {
  override name = "DevelopmentSigningKeyError";
  readonly code: DevelopmentSigningKeyFault;
  constructor(code: DevelopmentSigningKeyFault) {
    super(code);
    this.code = code;
  }
}

const SEED_BYTES = 32;
// RFC 8410 PKCS#8 header of an Ed25519 private key; the seed follows it.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * Key label and version derived from the public key (BACKEND 4.13 t. 7): the
 * same seed gives the same identity in every process and in the db/local
 * script, which imports this function rather than repeating it.
 */
export function developmentKeyIdentity(spkiDer: Uint8Array): { keyId: string; keyVersion: string } {
  const fingerprint = createHash("sha256").update(spkiDer).digest("hex");
  return { keyId: `dev-ed25519-${fingerprint.slice(0, 16)}`, keyVersion: `spki-sha256-${fingerprint}` };
}

/** The seed path as both the signer and the db/local script use it: absolute, with ".." folded. */
export function developmentSeedPath(path: string): string {
  return resolve(path);
}

type LoadedKey = { privateKey: KeyObject; publicKey: KeyObject; keyId: string; keyVersion: string; spki: Buffer };

function fail(code: DevelopmentSigningKeyFault): never {
  throw new DevelopmentSigningKeyError(code);
}

/**
 * The real location of `path` even where its end does not exist yet: the
 * nearest existing ancestor is resolved, links included, and the rest is
 * appended. A link to the repository above a directory still to be made is
 * thus judged by where it leads.
 */
async function realLocation(path: string): Promise<string> {
  const rest: string[] = [];
  let at = path;
  for (;;) {
    const real = await realpath(at).catch(() => null);
    if (real !== null) return join(real, ...rest.reverse());
    const parent = dirname(at);
    if (parent === at) return path;
    rest.push(basename(at));
    at = parent;
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  // Outside only by a whole ".." segment: "..keys" is a directory in the root.
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * Development and demo signer whose Ed25519 key survives a process restart
 * (BACKEND 4.13 t. 7, owner decision of 19 October 2026). The key comes only
 * from the seed file a local script made; this class never makes one, so a
 * missing file is a closed fault on every call, which ingest answers as
 * 503 `signing`. Construction is refused when NODE_ENV is production.
 */
export class PersistentDevelopmentEd25519SigningKeyProvider implements SigningKeyProvider {
  private loaded: LoadedKey | undefined;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly repositoryRoot: string;

  /**
   * `repositoryRoot` is the checkout the seed must stay out of. It is always
   * named by the caller: a working directory is not the repository in every
   * way the web process can be started.
   */
  constructor(env: Readonly<Record<string, string | undefined>>, repositoryRoot: string) {
    if (env.NODE_ENV === "production") fail("signing_key_production");
    this.env = env;
    this.repositoryRoot = repositoryRoot;
  }

  /** Read on first use and kept; a fault is not kept, so a later call reads again. */
  private async key(): Promise<LoadedKey> {
    this.loaded ??= await this.load();
    return this.loaded;
  }

  private async load(): Promise<LoadedKey> {
    const named = this.env[DEV_SIGNING_KEY_FILE];
    if (named === undefined || named === "") fail("signing_key_not_configured");
    if (!isAbsolute(named)) fail("signing_key_path_not_absolute");
    // ".." is folded first, as the db/local script folds it before mkdir: a
    // ".." after a directory that does not exist yet is then judged by where
    // the rest of the path leads, links included, before anything is made.
    const path = developmentSeedPath(named);
    const root = await realLocation(this.repositoryRoot);
    if (isInside(root, await realLocation(dirname(path)))) fail("signing_key_in_repository");
    const linkStat = await lstat(path).catch(() => fail("signing_key_missing"));
    if (!linkStat.isFile()) fail("signing_key_not_regular_file");
    // Read from the one descriptor that was judged: O_NOFOLLOW (where the
    // platform has it) refuses a link put in place after lstat.
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() =>
      fail("signing_key_not_regular_file"),
    );
    let seed: Buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) fail("signing_key_not_regular_file");
      if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) fail("signing_key_permissions");
      // Judged before reading, so a path to a large file reads nothing of it.
      if (stat.size !== SEED_BYTES) fail("signing_key_malformed");
      seed = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (seed.byteLength !== SEED_BYTES) fail("signing_key_malformed");
    const privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
      format: "der",
      type: "pkcs8",
    });
    seed.fill(0);
    const publicKey = createPublicKey(privateKey);
    const spki = publicKey.export({ type: "spki", format: "der" });
    return { privateKey, publicKey, spki, ...developmentKeyIdentity(spki) };
  }

  async sign(message: Uint8Array): Promise<SignatureEnvelope> {
    const key = await this.key();
    return {
      algorithm: "Ed25519",
      keyId: key.keyId,
      keyVersion: key.keyVersion,
      signatureEncoding: "raw",
      signatureBase64Url: nodeSign(null, Buffer.from(message), key.privateKey).toString("base64url"),
    };
  }

  async publicVerificationKey(): Promise<PublicVerificationKey> {
    const key = await this.key();
    return {
      algorithm: "Ed25519",
      keyId: key.keyId,
      keyVersion: key.keyVersion,
      encoding: "spki-der",
      keyBase64Url: key.spki.toString("base64url"),
    };
  }

  async verify(message: Uint8Array, signature: SignatureEnvelope): Promise<boolean> {
    const key = await this.key();
    if (
      signature.algorithm !== "Ed25519" ||
      signature.signatureEncoding !== "raw" ||
      signature.keyId !== key.keyId ||
      signature.keyVersion !== key.keyVersion
    ) {
      return false;
    }
    return nodeVerify(
      null,
      Buffer.from(message),
      key.publicKey,
      Buffer.from(signature.signatureBase64Url, "base64url"),
    );
  }
}
