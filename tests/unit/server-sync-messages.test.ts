import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractUiText } from "../../scripts/forbidden-terms/scan";
import { CHECKPOINT_NAME_MAX_LENGTH } from "../../src/domain/serverSync/checkpoints";
import {
  CHECKPOINT_ERROR_MESSAGES,
  LOAD_FAILURE_MESSAGE,
  SERVER_SYNC_ERROR_MESSAGES,
  UNSYNCED_CHANGES_NOTE,
  checkpointCreatedMessage,
} from "../../src/domain/serverSync/messages";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Moved from bootstrap.ts, checkpoints.ts and contract.ts by DAN-117. These are
// the values on origin/main 610a248, character for character.
describe("serverSync messages (DAN-117)", () => {
  it("keep the exact text they had before the move", () => {
    expect(LOAD_FAILURE_MESSAGE).toBe("Ne mogu učitati dokument. Osvježi stranicu.");
    expect(UNSYNCED_CHANGES_NOTE).toBe("Nesinkronizirane promjene nisu uključene.");
    expect(checkpointCreatedMessage("Prije lekture", 7)).toBe("Kontrolna točka „Prije lekture” stvorena (revizija 7).");
    expect(SERVER_SYNC_ERROR_MESSAGES).toEqual({
      "zapis-neispravan": "Zapis rada nije u ispravnom obliku, pa nije poslan.",
      prevelik: "Dokument je prevelik za spremanje.",
      "rad-nepoznat": "Rad nije pronađen na poslužitelju.",
      citanje: "Rad trenutačno nije moguće dohvatiti s poslužitelja.",
      slanje: "Promjena nije poslana na poslužitelj. Pokušat ćemo ponovno.",
      "odgovor-neispravan": "Poslužitelj je vratio odgovor koji nije moguće pročitati.",
    });
    expect(CHECKPOINT_ERROR_MESSAGES).toEqual({
      "naziv-prazan": "Kontrolna točka treba naziv.",
      "naziv-dug": `Naziv kontrolne točke smije imati najviše ${CHECKPOINT_NAME_MAX_LENGTH} znakova.`,
      "rad-nepoznat": "Rad nije pronađen na poslužitelju.",
      spremanje: "Kontrolnu točku nije bilo moguće stvoriti. Pokušaj ponovno.",
      citanje: "Popis kontrolnih točaka nije moguće dohvatiti.",
      "odgovor-neispravan": "Poslužitelj je vratio odgovor koji nije moguće pročitati.",
    });
    expect(CHECKPOINT_NAME_MAX_LENGTH).toBe(120);
  });
});

// The scanner reads these three modules only against its Croatian entries (they
// are not on UI_TEXT_MODULES), so an English forbidden term in a new string
// would pass. This list closes that: every string in them must be a protocol
// string or an identifier named here, so a new string, message or not, fails
// this test until a reviewer reads it. Messages go to messages.ts.
describe("serverSync protocol strings", () => {
  const PROTOCOL_STRINGS: Record<string, readonly string[]> = {
    "bootstrap.ts": ["edit", "error", "journal", "server"],
    "checkpoints.ts": [
      "",
      "checkpointId",
      "created",
      "created_at",
      "empty",
      "id",
      "invalid",
      "invalid_name",
      "name",
      "naziv-dug",
      "naziv-prazan",
      "not_found",
      "number",
      "revision",
      "status",
      "string",
      "too_long",
      "unauthenticated",
    ],
    "contract.ts": [
      "",
      "REPLACE_DOCUMENT",
      "committed",
      "currentRevision",
      "document",
      "documentId",
      "duplicate",
      "invalid",
      "invalid_client_transaction_id",
      "invalid_document",
      "not_found",
      "number",
      "ok",
      "pending_signature",
      "receipt",
      "revision",
      "signed",
      "signedReceipt",
      "stale_base",
      "status",
      "string",
      "too_large",
      "txid_reused",
      "unauthenticated",
    ],
  };

  for (const [file, allowed] of Object.entries(PROTOCOL_STRINGS)) {
    it(`${file} holds no string beyond the listed protocol strings and identifiers`, () => {
      const relative = `src/domain/serverSync/${file}`;
      const content = readFileSync(path.join(ROOT, relative), "utf8");
      const found = new Set(extractUiText(relative, content, "catalogue").map((piece) => piece.text));
      expect([...found].sort()).toEqual([...found].filter((text) => allowed.includes(text)).sort());
    });
  }
});
