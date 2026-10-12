import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  // Every non-test `.ts` file in the directory except messages.ts. A file that is
  // not in `allowedByFile` is a problem in itself, so a new module cannot slip
  // past the narrowed scanner list.
  function problems(dir: string, allowedByFile: Record<string, readonly string[]>): string[] {
    const found: string[] = [];
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts") && !/\.(?:test|spec)\.ts$/.test(name) && name !== "messages.ts");
    for (const file of files.sort()) {
      const allowed = allowedByFile[file];
      if (!allowed) {
        found.push(`${file}: not listed; add it to PROTOCOL_STRINGS or put user messages in messages.ts`);
        continue;
      }
      const content = readFileSync(path.join(dir, file), "utf8");
      for (const piece of extractUiText(`src/domain/serverSync/${file}`, content, "catalogue")) {
        if (!allowed.includes(piece.text)) found.push(`${file}: ${JSON.stringify(piece.text)}`);
      }
    }
    return found;
  }

  it("every module in src/domain/serverSync holds only listed protocol strings and identifiers", () => {
    expect(problems(path.join(ROOT, "src", "domain", "serverSync"), PROTOCOL_STRINGS)).toEqual([]);
  });

  it("fails on a new module that is not listed, and on a new string in a listed one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ductus-serversync-"));
    try {
      writeFileSync(path.join(dir, "errors.ts"), 'export const NOTE = "Hidden changes";\n');
      writeFileSync(path.join(dir, "bootstrap.ts"), 'export const NOTE = "Risk score";\nexport const MODE = "edit";\n');
      writeFileSync(path.join(dir, "errors.test.ts"), 'export const NOTE = "Saved";\n');
      writeFileSync(path.join(dir, "messages.ts"), 'export const NOTE = "Anything";\n');
      expect(problems(dir, { "bootstrap.ts": PROTOCOL_STRINGS["bootstrap.ts"] })).toEqual([
        'bootstrap.ts: "Risk score"',
        "errors.ts: not listed; add it to PROTOCOL_STRINGS or put user messages in messages.ts",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
