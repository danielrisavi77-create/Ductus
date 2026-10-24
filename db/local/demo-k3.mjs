// K-3b2 / DAN-88 (#635): loads the invented K-3 course, assignment and
// enrolment (demo-k3.sql) into the local compose database. `pnpm demo:up`
// runs it after the seed and before the app; it can also run alone:
//
//   node db/local/demo-k3.mjs        (after pnpm db:seed)
//
// psql runs as the compose superuser inside the postgres container, as for
// the other db/local scripts; the SQL refuses any other target itself. A
// rerun changes nothing. Prints no token, code or identifier.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SQL_FILE = fileURLToPath(new URL("./demo-k3.sql", import.meta.url));

/** The docker invocation; every value is one argv element, never a shell. */
export const PSQL_ARGS = Object.freeze([
  "compose", "exec", "-T", "postgres",
  "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "ductus", "-d", "ductus",
]);

export function main(env = process.env) {
  if (env.NODE_ENV === "production") return Promise.reject(new Error("K-3 demo data is refused in production"));
  return new Promise((resolve, reject) => {
    // psql errors name the failing step; the functions' errors carry no input
    // and the tokens are PL/pgSQL variables, which an error context does not print.
    const child = spawn("docker", PSQL_ARGS, { cwd: ROOT, env, stdio: ["pipe", "ignore", "inherit"], windowsHide: true });
    child.once("error", () => reject(new Error("could not start docker")));
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("K-3 demo data was not loaded"))));
    createReadStream(SQL_FILE).pipe(child.stdin);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => console.log("K-3 demo course, assignment and enrolment are in place."),
    (error) => {
      console.error(`${error instanceof Error ? error.message : "failed"}; check that the local stack is up and seeded.`);
      process.exitCode = 1;
    },
  );
}
