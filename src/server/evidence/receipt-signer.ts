import {
  DevelopmentSigningKeyError,
  PersistentDevelopmentEd25519SigningKeyProvider,
  type DevelopmentSigningKeyFault,
} from "@/adapters/crypto/persistent-development-ed25519-signer";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { isNonProductionBuild } from "@/server/auth/config";

/**
 * The receipt signer of the web process in the demo (BACKEND 4.13 t. 7): the
 * persistent development key, whose seed lies outside `repositoryRoot`. The
 * caller names the root; no working directory is assumed. The signer exists
 * only behind the deployment gate of the fake login provider: NODE_ENV must
 * be development or test, and an unset or misspelt value counts as
 * production. Elsewhere every call is refused with the same closed code, so
 * ingest answers 503 `signing`. There is no fallback to a key made in memory:
 * a receipt signed with one would verify against no key in the registry
 * after a restart.
 */
export function createEvidenceReceiptSigner(
  env: Readonly<Record<string, string | undefined>>,
  repositoryRoot: string,
): SigningKeyProvider {
  if (!isNonProductionBuild(env.NODE_ENV)) return refusing("signing_key_production");
  try {
    return new PersistentDevelopmentEd25519SigningKeyProvider(env, repositoryRoot);
  } catch (error) {
    return refusing(error instanceof DevelopmentSigningKeyError ? error.code : "signing_key_production");
  }
}

function refusing(code: DevelopmentSigningKeyFault): SigningKeyProvider {
  const refuse = () => Promise.reject(new DevelopmentSigningKeyError(code));
  return { sign: refuse, verify: refuse, publicVerificationKey: refuse };
}
