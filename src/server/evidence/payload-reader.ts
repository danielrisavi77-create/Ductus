import {
  EvidenceStorageConfigError,
  loadEvidenceStorageConfig,
} from "@/adapters/evidence/evidence-storage-config";
import { InstitutionRoutedPayloadStore } from "@/adapters/evidence/institution-routed-payload-store";
import type { InstitutionEvidencePayloadReader } from "@/application/ports/evidence-reconstruction";

type Env = Readonly<Record<string, string | undefined>>;
type Log = (message: string, code: string) => void;

/**
 * Storage that is not configured, or whose configuration was refused: every
 * read is unavailable, so a record with segments is never summarised from a
 * guess and nothing falls back to another bucket (BACKEND 4.1, P2).
 */
export const STORAGE_NOT_CONFIGURED: InstitutionEvidencePayloadReader = Object.freeze({
  async readImmutable() {
    return { status: "unavailable", reason: "storage_not_configured" } as const;
  },
});

/**
 * The read side of the storage domains for the web process (B-8i, B2): the
 * router of #461 over `EVIDENCE_STORAGE_DOMAINS`. It reads only from the
 * domain of the institution it is asked for, after that domain's identity
 * label was read and matched; the caller binds the institution from a row
 * read under withActor (`bindPayloadReader`).
 *
 * A configuration fault does not stop the web process: the summary route
 * then answers unavailable to everyone, and the log carries only the closed
 * message of the configuration error, which names variables and fields and
 * never a value (EvidenceStorageConfigError). Plain http is allowed only to
 * loopback outside production, the adapter's own rule.
 */
export function createEvidencePayloadReader(
  env: Env = process.env,
  log: Log = (message, code) => console.error(message, code),
): InstitutionEvidencePayloadReader {
  try {
    return InstitutionRoutedPayloadStore.fromConfig(loadEvidenceStorageConfig(env), {
      allowPlainHttpOnLoopback: env.NODE_ENV !== "production",
    });
  } catch (error) {
    const code = error instanceof EvidenceStorageConfigError ? error.message : "storage_config_failed";
    log("evidence storage is not configured", code);
    return STORAGE_NOT_CONFIGURED;
  }
}

let processReader: InstitutionEvidencePayloadReader | undefined;

/**
 * One reader per process, built on first use; a changed configuration needs
 * a restart. Domain identity labels are checked lazily on first read.
 */
export function evidencePayloadReader(): InstitutionEvidencePayloadReader {
  processReader ??= createEvidencePayloadReader();
  return processReader;
}
