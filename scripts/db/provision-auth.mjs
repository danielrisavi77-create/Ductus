import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SQL_FILE = fileURLToPath(new URL("../../db/local/auth-login.sql", import.meta.url));

/** Build the docker invocation; the password travels as an argv element, never through a shell. */
export function authProvisionInvocation(env) {
  const password = env.DUCTUS_AUTH_LOCAL_PASSWORD;
  if (typeof password !== "string" || password.length < 16) {
    throw new Error("DUCTUS_AUTH_LOCAL_PASSWORD must be set to at least 16 characters.");
  }
  return {
    command: "docker",
    args: [
      "compose", "exec", "-T", "postgres",
      "psql", "-U", "ductus", "-d", "ductus", "-v", "ON_ERROR_STOP=1", "-q",
      "-v", `auth_password=${password}`,
    ],
    stdinFile: SQL_FILE,
  };
}

function main() {
  let invocation;
  try {
    invocation = authProvisionInvocation(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const child = spawn(invocation.command, invocation.args, {
    cwd: root,
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
  });
  child.once("error", () => {
    console.error("Could not start docker compose.");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  createReadStream(invocation.stdinFile).pipe(child.stdin);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
