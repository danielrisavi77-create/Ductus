// Z5 (F-10 contract, #476): the web server of the full login E2E (playwright.login.config.ts)
// gets the evidence signer and the storage domain that `pnpm demo:up` hands to the app, so the
// evidence routes (open, commit, submission) work in that run. `pnpm demo:prepare` registers the
// signing key and the storage domain in the local database (CI does it before the E2E); the
// web server also needs the seed file path, the local store credentials and the one
// EVIDENCE_STORAGE_DOMAINS line, which the storage script prints and nothing else keeps.
// Local stack and CI only; nothing here is read by a production process.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createDemoEnvironment, parseStorageDomainsLine } from "./up.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const STORAGE_SCRIPT = "db/local/evidence-storage-domain.mjs";
// Only the evidence variables; the auth password and the database URLs of the demo
// environment are not passed on (the login config sets its own).
const KEYS = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "EVIDENCE_S3_LOCAL_KEY_ID",
  "EVIDENCE_S3_LOCAL_SECRET",
  "DUCTUS_DEV_SIGNING_KEY_FILE",
];

function runStorageScript(env) {
  const run = spawnSync(process.execPath, [STORAGE_SCRIPT], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  return { status: run.status, stdout: String(run.stdout ?? "") };
}

/**
 * The variables the login E2E web server needs for evidence, or {} when the local stack
 * cannot give them (the other login specs do not use evidence and keep running; a spec that
 * does fails on its own and says so). `run` is injectable for tests.
 */
export function evidenceServerEnvironment(source = process.env, run = runStorageScript) {
  let env;
  try {
    env = createDemoEnvironment(source);
  } catch (error) {
    console.warn(`Login E2E: no evidence environment (${error.message})`);
    return {};
  }
  const printed = run(env);
  const domains = printed.status === 0 ? parseStorageDomainsLine(printed.stdout) : undefined;
  if (domains === undefined) {
    console.warn("Login E2E: no evidence environment (the storage domain could not be read from the local stack).");
    return {};
  }
  return { ...Object.fromEntries(KEYS.map((key) => [key, env[key]])), EVIDENCE_STORAGE_DOMAINS: domains };
}
