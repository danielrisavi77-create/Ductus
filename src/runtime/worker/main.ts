// DAN-517: the worker's composition root. Started by `pnpm worker`
// (scripts/worker/start.mjs); nothing imports it.
import { logEvent } from "@/server/log/logger";

import { parseWorkerEnvironment } from "./environment";
import { WORKER_KINDS } from "./jobs";
import { startWorker } from "./worker";

const environment = parseWorkerEnvironment(process.env);
if (environment.ok) {
  await startWorker(environment.settings, WORKER_KINDS);
} else {
  // Names of variables and fixed words only: the address carries a password.
  logEvent("error", "worker_environment_invalid", { problems: environment.problems });
  process.exit(1);
}
