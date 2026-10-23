import {
  EvidenceStorageConfigError,
  loadEvidenceStorageConfig,
} from "@/adapters/evidence/evidence-storage-config";
import { InstitutionRoutedPayloadStore } from "@/adapters/evidence/institution-routed-payload-store";
import type { InstitutionEvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import type { EvidencePayloadLocator, EvidencePayloadStore } from "@/application/ports/evidence-trust";

type Env = Readonly<Record<string, string | undefined>>;
type Log = (message: string, code: string) => void;

/** Read, write and name objects: what the summary and the ingest routes take. */
export type ProcessEvidencePayloads = InstitutionEvidencePayloadReader & EvidencePayloadStore & EvidencePayloadLocator;

/**
 * Storage that is not configured, or whose configuration was refused: every
 * read, write and reference is unavailable, so a record with segments is
 * never summarised from a guess, no object is written anywhere and nothing
 * falls back to another bucket (BACKEND 4.1, P2).
 */
export const STORAGE_NOT_CONFIGURED: ProcessEvidencePayloads = Object.freeze({
  async readImmutable() {
    return { status: "unavailable", reason: "storage_not_configured" } as const;
  },
  async putImmutable() {
    return { status: "unavailable", reason: "storage_not_configured" } as const;
  },
  async storageRefFor() {
    return { status: "unavailable", reason: "storage_not_configured" } as const;
  },
});

/**
 * The storage domains of the web process (B-8i, B2): the router of #461 over
 * `EVIDENCE_STORAGE_DOMAINS`. It reads and writes only in the domain of the
 * institution it is asked for, after that domain's identity label was read
 * and matched; the caller binds the institution from a row read under
 * withActor (`bindPayloadReader`, the ingest commit context).
 *
 * A configuration fault does not stop the web process: the summary and the
 * ingest routes then answer unavailable to everyone, and the log carries only
 * the closed message of the configuration error, which names variables and
 * fields and never a value (EvidenceStorageConfigError). Plain http is
 * allowed only to loopback outside production, the adapter's own rule.
 */
export function createEvidencePayloadReader(
  env: Env = process.env,
  log: Log = (message, code) => console.error(message, code),
): ProcessEvidencePayloads {
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

let processPayloads: ProcessEvidencePayloads | undefined;

/**
 * One router per process, built on first use and shared by reading and
 * writing, so both see the same verified labels; a changed configuration
 * needs a restart. Domain identity labels are checked lazily on first use.
 */
export function evidencePayloadReader(): ProcessEvidencePayloads {
  processPayloads ??= createEvidencePayloadReader();
  return processPayloads;
}
