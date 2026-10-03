import fc from "fast-check";

// FC_NUM_RUNS scales every property test at once (CI nightly can raise it).
const numRuns = Number(process.env.FC_NUM_RUNS ?? 100);
fc.configureGlobal({ numRuns });
