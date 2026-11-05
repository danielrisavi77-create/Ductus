import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";

import { evidencePayloadReader, type ProcessEvidencePayloads } from "./payload-reader";
import { createEvidenceReceiptSigner } from "./receipt-signer";

let signer: SigningKeyProvider | undefined;

/**
 * The signer and the storage of the ingest routes, one of each per process.
 * The signer's root is the directory the server runs from (Next starts in the
 * project root), so a seed inside the project is refused. NODE_ENV is the one
 * the build wrote, as for login (src/server/auth/deps.ts): `next build`
 * fixes "production", so no value given to `next start` selects the
 * development signer.
 */
export function evidenceIngestDeps(): { signer: SigningKeyProvider; payloads: ProcessEvidencePayloads } {
  signer ??= createEvidenceReceiptSigner({ ...process.env, NODE_ENV: process.env.NODE_ENV }, process.cwd());
  return { signer, payloads: evidencePayloadReader() };
}
