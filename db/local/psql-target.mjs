// Where the db/local scripts run psql (DAN-324). Their default stays the
// docker invocation of the compose postgres container. A caller that imports a
// script (the native demo runner) may pass a native psql target instead; no
// environment variable chooses it, so demo:up and demo:prepare keep docker.

const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
// A socket directory: POSIX `/...` or a Windows drive path, the two forms libpq
// takes as a socket rather than a host name. No comma, which would list a second host.
const SOCKET_DIR = /^(?:\/|[A-Za-z]:[\\/])[^,]*$/;
const PORT = /^[1-9][0-9]{0,4}$/;
// The only options a native target may carry, each as its own element followed by its value.
const ALLOWED = {
  "-h": (value) => SOCKET_DIR.test(value),
  "-p": (value) => PORT.test(value) && Number(value) <= 65535,
  "-U": (value) => value === "ductus",
  "-d": (value) => value === "ductus",
};
// Environment variables libpq would read, except a password, which chooses no host.
const KEPT_PG = new Set(["PGPASSWORD", "PGPASSFILE"]);

/** The docker prefix: the compose postgres service, or DUCTUS_PSQL_CONTAINER (a private test database). */
export function dockerExecArgs(env) {
  const container = env.DUCTUS_PSQL_CONTAINER;
  if (container !== undefined && !CONTAINER.test(container)) throw new Error("DUCTUS_PSQL_CONTAINER is not a container name");
  return container ? ["exec", "-i", container] : ["compose", "exec", "-T", "postgres"];
}

/**
 * Judges a native target `{ command, args }`. The args are an allowlist:
 * `-h <socket directory>` exactly once, and at most once each `-p <port>`,
 * `-U ductus` and `-d ductus`, every option and value its own element. Nothing
 * else (joined short options, `--long=`, conninfo, URI, service) gets through,
 * so psql reaches the local socket and never TCP. Returns a copy with the
 * environment psql runs in: `env` without the PG* variables (PGHOST,
 * PGHOSTADDR, PGSERVICE...) that could still pick a host.
 */
export function nativePsqlTarget(psql, env = {}) {
  const command = psql?.command;
  const args = psql?.args;
  if (typeof command !== "string" || command.length === 0 || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new Error("the psql target is not { command, args }");
  }
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!Object.hasOwn(ALLOWED, option) || seen.has(option) || value === undefined || !ALLOWED[option](value)) {
      throw new Error("the psql target must name one local socket directory with -h and only -p, -U ductus, -d ductus");
    }
    seen.add(option);
  }
  if (!seen.has("-h")) throw new Error("the psql target must name one local socket directory with -h and only -p, -U ductus, -d ductus");
  return { command, args: [...args], env: nativePsqlEnv(env) };
}

/** `env` without the libpq variables that could choose a host, whatever their case (Windows). */
function nativePsqlEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.toUpperCase().startsWith("PG") || KEPT_PG.has(name.toUpperCase())),
  );
}
