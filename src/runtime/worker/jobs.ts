// DAN-517 (plan #1826 W-15): the kinds of job this worker takes. Today there
// is one, and it does nothing: it shows that a job passes from the queue
// through the process and back. Reconstruction joins this list with its own
// task (DAN-381); nothing here stands in for it.
import type { JobDefinition } from "@/application/jobs/job-body";
import type { JobHandler } from "@/server/db/job-queue";

/** A kind listed without a handler is still taken, and every attempt fails as `handler_missing`. */
export type WorkerKind = { readonly definition: JobDefinition; readonly handler?: JobHandler };

export const SELF_CHECK: JobDefinition = { name: "worker_selfcheck", fields: ["checkId"], subject: "checkId" };

export const WORKER_KINDS: readonly WorkerKind[] = [{ definition: SELF_CHECK, handler: async () => ({ ok: true }) }];
