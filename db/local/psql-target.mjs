// Where the db/local scripts run psql (DAN-324). Their default stays the
// docker invocation of the compose postgres container. A caller that imports a
// script (the native demo runner) may pass a native psql target instead; no
// environment variable chooses it, so demo:up and demo:prepare keep docker.
import { isAbsolute as isPosixAbsolute } from "node:path/posix";
import { isAbsolute as isWin32Absolute } from "node:path/win32";

const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** The docker prefix: the compose postgres service, or DUCTUS_PSQL_CONTAINER (a private test database). */
export function dockerExecArgs(env) {
  const container = env.DUCTUS_PSQL_CONTAINER;
  if (container !== undefined && !CONTAINER.test(container)) throw new Error("DUCTUS_PSQL_CONTAINER is not a container name");
  return container ? ["exec", "-i", container] : ["compose", "exec", "-T", "postgres"];
}

/**
 * Judges a native target `{ command, args }`, where args carry the connection
 * (`-h <socket directory> -p <port> -U ductus -d ductus`). Exactly one `-h`
 * naming an absolute directory, and no other host or connection string, so
 * psql reaches the local socket and never falls back to TCP; the SQL refuses
 * TCP itself as well. Returns a copy, so a later change by the caller is not used.
 */
export function nativePsqlTarget(psql) {
  const command = psql?.command;
  const args = psql?.args;
  if (typeof command !== "string" || command.length === 0 || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new Error("the psql target is not { command, args }");
  }
  const hosts = args.flatMap((arg, index) => (arg === "-h" ? [args[index + 1]] : []));
  const socket = hosts.length === 1 && typeof hosts[0] === "string" && (isPosixAbsolute(hosts[0]) || isWin32Absolute(hosts[0]));
  const other = args.some((arg) => (arg !== "-h" && /^(-h|--host)/.test(arg)) || arg.includes("://") || /host\s*=/i.test(arg));
  if (!socket || other) throw new Error("the psql target must name one local socket directory with -h");
  return { command, args: [...args] };
}
