/**
 * The messages a person reads for loading, sending and checkpoints.
 *
 * Only interface text lives here (the forbidden-terms scanner reads every
 * string in this file). Protocol strings and codes stay in `contract.ts`,
 * `checkpoints.ts` and `bootstrap.ts`.
 */

import { CHECKPOINT_NAME_MAX_LENGTH, type CheckpointErrorCode } from "./checkpoints";
import type { ServerSyncErrorCode } from "./contract";

/** Shown when neither source could supply a document. */
export const LOAD_FAILURE_MESSAGE = "Ne mogu učitati dokument. Osvježi stranicu.";

export const SERVER_SYNC_ERROR_MESSAGES: Record<ServerSyncErrorCode, string> = {
  "zapis-neispravan": "Zapis rada nije u ispravnom obliku, pa nije poslan.",
  prevelik: "Dokument je prevelik za spremanje.",
  "rad-nepoznat": "Rad nije pronađen na poslužitelju.",
  citanje: "Rad trenutačno nije moguće dohvatiti s poslužitelja.",
  slanje: "Promjena nije poslana na poslužitelj. Pokušat ćemo ponovno.",
  "odgovor-neispravan": "Poslužitelj je vratio odgovor koji nije moguće pročitati.",
};

export const CHECKPOINT_ERROR_MESSAGES: Record<CheckpointErrorCode, string> = {
  "naziv-prazan": "Kontrolna točka treba naziv.",
  "naziv-dug": `Naziv kontrolne točke smije imati najviše ${CHECKPOINT_NAME_MAX_LENGTH} znakova.`,
  "rad-nepoznat": "Rad nije pronađen na poslužitelju.",
  spremanje: "Kontrolnu točku nije bilo moguće stvoriti. Pokušaj ponovno.",
  citanje: "Popis kontrolnih točaka nije moguće dohvatiti.",
  "odgovor-neispravan": "Poslužitelj je vratio odgovor koji nije moguće pročitati.",
};

/**
 * The sentence shown after a checkpoint is made.
 *
 * It names the revision on purpose. A checkpoint is of the SERVER's revision,
 * and a message that only said "spremljeno" would be exactly the generic
 * claim the constitution forbids — the author could not tell which version
 * they had just bookmarked.
 */
export function checkpointCreatedMessage(name: string, revision: number): string {
  return `Kontrolna točka „${name}” stvorena (revizija ${revision}).`;
}

/**
 * Shown next to that sentence whenever the pending queue is not empty.
 *
 * Not a warning and not an error: it is the honest half of the claim above.
 * The checkpoint holds the server's revision, so whatever is still queued
 * locally is not in it, and the author has to be told before they rely on it.
 */
export const UNSYNCED_CHANGES_NOTE = "Nesinkronizirane promjene nisu uključene.";
