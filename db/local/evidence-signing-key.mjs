// Local stack and CI only (docs/BACKEND.md 4.13 t. 7, owner decision of
// 19 October 2026): makes the development signing seed and registers its
// public key, through evidence-signing-key.sql, as the receipt key of the
// institution's evidence domain. Never a migration, never production.
//
//   DUCTUS_DEV_SIGNING_KEY_FILE=/absolute/path/outside/the/repo \
//     node db/local/evidence-signing-key.mjs        (after pnpm db:seed)
//
// The seed (32 random bytes) is written only when the file does not exist,
// with mode 0600, and never overwritten. The key label and version come from
// the signer adapter itself, so the registry holds what the signer signs
// with. psql runs as the compose superuser inside the postgres container, as
// for the other db/local scripts; DUCTUS_PSQL_CONTAINER names another local
// container instead (a private test database), and an importing caller may
// pass a native psql target on the local socket (psql-target.mjs). Prints
// only public values.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { dockerExecArgs, nativePsqlTarget } from "./psql-target.mjs";

import {
  DEV_SIGNING_KEY_FILE,
  PersistentDevelopmentEd25519SigningKeyProvider,
  developmentSeedPath,
} from "../../src/adapters/crypto/persistent-development-ed25519-signer.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SQL_FILE = fileURLToPath(new URL("./evidence-signing-key.sql", import.meta.url));
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The psql invocation (docker, or the native target); every value travels as one argv element, never through a shell. */
export function registrationInvocation(env, slug, key, psql) {
  const vars = { institution_slug: slug, key_id: key.keyId, key_version: key.keyVersion, key_base64url: key.keyBase64Url };
  const options = [
    "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
    ...Object.entries(vars).flatMap(([name, value]) => ["-v", `${name}=${value}`]),
  ];
  if (psql !== undefined) {
    const native = nativePsqlTarget(psql);
    return { command: native.command, args: [...native.args, ...options] };
  }
  return { command: "docker", args: [...dockerExecArgs(env), "psql", "-U", "ductus", "-d", "ductus", ...options] };
}

function runPsql({ command, args }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.once("error", () => reject(new Error("could not start psql")));
    child.once("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error("registration failed"))));
    createReadStream(SQL_FILE).pipe(child.stdin);
  });
}

export async function main(env = process.env, argv = process.argv.slice(2), psql = undefined) {
  if (env.NODE_ENV === "production") throw new Error("the development signing key is refused in production");
  // Nothing, or exactly `--institution <slug>`: any other argument is refused, never ignored.
  if (!(argv.length === 0 || (argv.length === 2 && argv[0] === "--institution"))) {
    throw new Error("the only argument is --institution <slug>");
  }
  const slug = argv.length === 0 ? "demo-fakultet" : argv[1];
  if (typeof slug !== "string" || slug.length > 64 || !SLUG.test(slug)) throw new Error("--institution needs a slug");

  // The signer judges the path (set, absolute, outside the repository) before
  // anything is written, so a bad path makes no file.
  const signer = new PersistentDevelopmentEd25519SigningKeyProvider(env, ROOT);
  const fault = await signer.publicVerificationKey().then(() => null, (error) => error);
  if (fault !== null && fault.code !== "signing_key_missing") throw fault;
  if (fault !== null) {
    // The one path the signer judged, ".." folded, so mkdir makes nothing it did not judge.
    const path = developmentSeedPath(env[DEV_SIGNING_KEY_FILE]);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Judged again where the directory now exists, before a byte is written.
    const again = await signer.publicVerificationKey().then(() => null, (error) => error);
    if (again !== null && again.code !== "signing_key_missing") throw again;
    await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 }).catch((error) => {
      if (error?.code !== "EEXIST") throw new Error("the seed file could not be written");
    });
  }
  const key = await signer.publicVerificationKey();
  const evidenceDomainId = await runPsql(registrationInvocation(env, slug, key, psql));
  return { evidenceDomainId, keyId: key.keyId, keyVersion: key.keyVersion };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (registered) => console.log(JSON.stringify(registered)),
    (error) => {
      // Closed messages only: the signer's codes and the texts above.
      console.error(error instanceof Error ? error.message : "failed");
      process.exitCode = 1;
    },
  );
}
