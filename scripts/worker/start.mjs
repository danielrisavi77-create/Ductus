// DAN-517: `pnpm worker`. The worker reads its settings from the environment
// (src/runtime/worker/environment.ts); WORKER_DATABASE_URL is the only one required.
import "./resolve.mjs";

await import("../../src/runtime/worker/main.ts");
