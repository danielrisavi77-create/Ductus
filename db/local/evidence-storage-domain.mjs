// Local stack and CI only (docs/BACKEND.md 4.1 and 4.13): gives an
// institution its evidence storage domain in the local S3-compatible store of
// compose.yaml. It makes the bucket, writes the bucket's identity label once
// and prints the operator configuration the web process reads:
//
//   node db/local/evidence-storage-domain.mjs    (after pnpm db:seed)
//   -> EVIDENCE_STORAGE_DOMAINS={...}            (into .env.local)
//
// Credentials come from EVIDENCE_S3_LOCAL_KEY_ID and EVIDENCE_S3_LOCAL_SECRET
// (.env.example); the output names those variables, never their values. A
// label is written only if there is none (If-None-Match) and never replaced:
// a bucket labelled for another institution or region stops the script. No
// evidence object is written or removed. A second run changes nothing.
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

import { signS3Request } from "../../src/adapters/evidence/s3-signature.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const REGION = "us-east-1";
const KEY_ID_VAR = "EVIDENCE_S3_LOCAL_KEY_ID";
const SECRET_VAR = "EVIDENCE_S3_LOCAL_SECRET";
const IDENTITY_KEY = "ductus-storage-identity.json";
// The record of the local store's contract test (s3-evidence-payload-store
// integration test against compose.yaml), as the other integration tests use it.
const capabilityFor = (endpoint) => ({
  provider: "rustfs-local",
  endpoint,
  conditionalWrite: "verified",
  checksumEcho: "verified",
  verifiedOn: "2026-10-11",
  contractTest: "local-stack/s3-evidence-payload-store.integration",
});

/** The institution's id, read by psql in the local postgres container (as in 4a). */
function institutionId(env, slug) {
  const container = env.DUCTUS_PSQL_CONTAINER;
  if (container !== undefined && !CONTAINER.test(container)) throw new Error("DUCTUS_PSQL_CONTAINER is not a container name");
  const target = container ? ["exec", "-i", container] : ["compose", "exec", "-T", "postgres"];
  const args = [...target, "psql", "-U", "ductus", "-d", "ductus", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", `slug=${slug}`];
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.once("error", () => reject(new Error("could not start docker")));
    child.once("exit", (code) => {
      const id = out.trim();
      if (code !== 0) reject(new Error("the institution could not be read"));
      else if (!UUID.test(id)) reject(new Error(`no institution with slug ${slug}; run pnpm db:seed first`));
      else resolve(id);
    });
    child.stdin.end("SELECT id FROM identity.institution WHERE slug = :'slug';\n");
  });
}

async function s3(method, endpoint, path, credentials, body = new Uint8Array()) {
  const signed = signS3Request({ method, endpoint, path, headers: {}, body, region: REGION, credentials, now: new Date() });
  const response = await fetch(signed.url, {
    method,
    headers: signed.headers,
    body: method === "PUT" ? body : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return { status: response.status, text };
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  if (env.NODE_ENV === "production") throw new Error("the local storage domain is refused in production");
  // Nothing, or exactly `--institution <slug>`: any other argument is refused, never ignored.
  if (!(argv.length === 0 || (argv.length === 2 && argv[0] === "--institution"))) {
    throw new Error("the only argument is --institution <slug>");
  }
  const slug = argv.length === 0 ? "demo-fakultet" : argv[1];
  const bucket = `ductus-evidence-${slug}`;
  const label = `local-${slug}`;
  if (typeof slug !== "string" || !SLUG.test(slug) || bucket.length > 63) throw new Error("--institution needs a short slug");
  let endpoint;
  try {
    endpoint = new URL(env.S3_ENDPOINT || "http://127.0.0.1:9100");
  } catch {
    throw new Error("S3_ENDPOINT is not a URL");
  }
  if (!["http:", "https:"].includes(endpoint.protocol) || !LOOPBACK.has(endpoint.hostname) || endpoint.href !== `${endpoint.origin}/`) {
    throw new Error("S3_ENDPOINT must be the local store on loopback");
  }
  const accessKeyId = env[KEY_ID_VAR];
  const secretAccessKey = env[SECRET_VAR];
  if (!accessKeyId || !secretAccessKey) throw new Error(`${KEY_ID_VAR} and ${SECRET_VAR} must be set`);
  const credentials = { accessKeyId, secretAccessKey };

  const id = await institutionId(env, slug);
  const made = await s3("PUT", endpoint, [bucket], credentials);
  if (made.status !== 200 && !(made.status === 409 && made.text.includes("BucketAlreadyOwnedByYou"))) {
    throw new Error(`the bucket could not be made (${made.status})`);
  }
  const identity = JSON.stringify({ institutionId: id, region: REGION });
  const written = await s3("PUT", endpoint, [bucket, IDENTITY_KEY], credentials, new TextEncoder().encode(identity));
  if (written.status !== 200) {
    if (written.status !== 412) throw new Error(`the identity label could not be written (${written.status})`);
    // A label is never replaced: the one there must be this institution's.
    const held = await s3("GET", endpoint, [bucket, IDENTITY_KEY], credentials);
    let same = false;
    try {
      const parsed = JSON.parse(held.text);
      same = held.status === 200 && Object.keys(parsed).length === 2 && parsed.institutionId === id && parsed.region === REGION;
    } catch {
      same = false;
    }
    if (!same) throw new Error("the bucket is labelled for another institution or region; nothing was changed");
  }
  const domain = {
    label,
    institutionId: id,
    endpoint: endpoint.origin,
    region: REGION,
    bucket,
    accessKeyIdVar: KEY_ID_VAR,
    secretAccessKeyVar: SECRET_VAR,
    capability: capabilityFor(endpoint.origin),
  };
  return `EVIDENCE_STORAGE_DOMAINS=${JSON.stringify({ requestTimeoutMs: 10_000, domains: [domain] })}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (line) => console.log(line),
    (error) => {
      // Closed messages only; no credential or response body is printed.
      console.error(error instanceof Error ? error.message : "failed");
      process.exitCode = 1;
    },
  );
}
