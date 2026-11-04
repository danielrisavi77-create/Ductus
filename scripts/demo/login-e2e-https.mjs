// The login E2E runs the app over https (DAN-232, owner decision on #87). The
// session cookie is `Secure` in every environment and WebKit does not store a
// Secure cookie on http://localhost. The certificate is made per run, in a
// private temporary directory, for localhost only; no key is ever committed.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LOGIN_PORT = 3000;

/** Retain compiled pages only in the login launcher's development process. */
export function loginDevEntries(env = process.env) {
  return env.NODE_ENV === "development" && env.DUCTUS_LOGIN_E2E_PRECOMPILE === "1"
    ? { maxInactiveAge: 15 * 60_000, pagesBufferLength: 64 }
    : undefined;
}

/** Anonymous representative URLs for every app page; API handlers are excluded. */
export function loginPagePaths(files) {
  const paths = files.filter((file) => /(^|\/)page\.tsx$/.test(file.replaceAll("\\", "/"))).map((file) => {
    const parts = file.replaceAll("\\", "/").split("/").slice(0, -1);
    return "/" + parts.map((part) => {
      if (/^\[[a-zA-Z][a-zA-Z0-9]*\]$/.test(part)) return "00000000-0000-4000-8000-000000000000";
      if (!/^[a-zA-Z0-9-]+$/.test(part)) throw new Error(`login warmup: unsupported page segment ${part}`);
      return part;
    }).join("/");
  });
  if (paths.length === 0) throw new Error("login warmup: empty page inventory");
  return [...new Set(paths)].sort();
}

/** Complete compilation before a browser connects to dev HMR. No authenticated requests. */
export async function warmLoginPages(request, origin, paths) {
  for (const path of paths) {
    const response = await request.get(path);
    const headers = response.headers();
    if (response.status() !== 200 || new URL(response.url()).origin !== origin ||
        !headers["content-type"]?.includes("text/html") || headers["set-cookie"] ||
        !(await response.text()).includes("/_next/static/chunks/")) {
      throw new Error(`login warmup: invalid anonymous app response for ${path} (HTTP ${response.status()})`);
    }
  }
}

/**
 * The one origin of the login stack. Our own server runs over https, at the
 * address 127.0.0.1: the app sends Strict-Transport-Security, WebKit keeps it
 * per host name and then upgrades the redirect to the fake provider
 * (http://localhost:8090, http only) to https, which fails the handshake. An IP
 * address is never noted as an HSTS host (RFC 6797 §8.1). With E2E_REUSE_SERVER=1
 * the server is one started elsewhere (`pnpm demo:up`, the native runner),
 * which stays on http://localhost as it always was.
 */
export function loginOrigin(env = process.env) {
  return env.E2E_REUSE_SERVER === "1" ? `http://localhost:${LOGIN_PORT}` : `https://127.0.0.1:${LOGIN_PORT}`;
}

/** The openssl request for a self-signed certificate that is good for two days. */
export function opensslArgs({ key, cert }) {
  return [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ];
}

/** Makes key.pem (owner only) and cert.pem in `dir`; throws, leaving no key, when openssl fails. */
export function createLoginCertificate(dir, run = spawnSync) {
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  const result = run("openssl", opensslArgs({ key, cert }), { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  if (result.error || result.status !== 0) {
    rmSync(key, { force: true });
    rmSync(cert, { force: true });
    throw new Error(`openssl could not make the login certificate: ${result.error?.message ?? result.stderr ?? `status ${result.status}`}`);
  }
  if (!existsSync(key) || !existsSync(cert)) throw new Error("openssl could not make the login certificate: no files written");
  chmodSync(key, 0o600);
  return { key, cert };
}

export function nextDevArgs({ key, cert }) {
  return ["dev", "--port", String(LOGIN_PORT), "--experimental-https", "--experimental-https-key", key, "--experimental-https-cert", cert];
}

/** `next dev` over https with a certificate that lives only as long as the server. */
function main() {
  const dir = mkdtempSync(join(tmpdir(), "ductus-login-https-"));
  chmodSync(dir, 0o700);
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  let child;
  try {
    const files = createLoginCertificate(dir);
    const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
    // The server trusts its own certificate for any call it makes to itself.
    child = spawn(process.execPath, [next, ...nextDevArgs(files)], { stdio: "inherit", env: { ...process.env, NODE_EXTRA_CA_CERTS: files.cert, DUCTUS_LOGIN_E2E_PRECOMPILE: "1" } });
  } catch (error) {
    cleanup();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => {
    cleanup();
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
