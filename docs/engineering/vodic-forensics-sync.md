# Vodič za čitanje: evidencija (forensics) i sinkronizacija

Ovaj dokument je karta za čovjeka koji želi čitanjem provjeriti kod u `src/domain/forensics`, `src/domain/sync` i `src/domain/serverSync`. Nije dokument pravila i ne ponavlja kanonske izvore. Pravila i formati su u `docs/backend/evidencija.md` (§4.1 i §4.13), `docs/ARCHITECTURE.md` (§5 "Put jedne promjene", §8 "Ključevi za potpis"), `docs/BACKEND.md` i `docs/DECISIONS.md`. Popis onoga što se ne smije izgubiti je u `STATE.md`.

Svaka tvrdnja u vodiču provjerena je čitanjem koda na commitu `ab7a61b5` (`main`, 11. 11. 2026.). Navode se imena funkcija, ne brojevi redaka. Ono što nije provjereno stoji u zadnjem odjeljku. Kad se vodič i kod ne slažu, vrijedi kod, a vodič treba ispraviti.

## 1. Redoslijed čitanja

Redoslijed prati uvoze: svaka datoteka uvozi samo one iznad sebe (i module izvan ovih mapa, npr. `src/domain/document`).

### 1.1 Evidencija (`src/domain/forensics`)

| # | Datoteka | Što se u njoj čita |
|---|---|---|
| 1 | `jcs.ts` | Kanonski zapis RFC 8785 (`canonicalizeJcs`, `jcsUtf8Bytes`). Nema uvoza. Sve ostalo ovisi o njemu. |
| 2 | `evidence-segment-v2.ts` | Oblik odsječka v2 i v3, zatvoreni skupovi ključeva i izvora, validator `isEvidenceSegment`, hash `digestEvidenceSegment`. |
| 3 | `evidence-chain-v2.ts` | Prihvat bajtova (`verifyCanonicalEvidencePayloadV2`), granica veličine, lanac odsječaka (`verifyEvidenceChainV2`), pravilo ponovljenog slanja (`decideEvidenceRetry`). |
| 4 | `evidence-receipt.ts` | Potvrda prihvata v1 i v2: oblik, kanonski zapis, ulaz u potpis (`digestEvidenceReceiptPayloadV2`). |
| 5 | `evidence-receipt-verifier.ts` i `ed25519-encoding.ts` | Provjera potpisane potvrde v2 (`verifySignedEvidenceReceiptV2`). `ed25519-encoding.ts` sudi o ključu i potpisu iz bajtova, jednako u svakom runtimeu. |
| 6 | `evidence-replay-v2.ts` | Ponavljanje odsječaka nad poznatim dokumentom (`replayEvidenceSegmentsV2`) kroz sučelje `EvidenceStepReplayerV2`. |
| 7 | `evidence-checkpoint-v2.ts` | Kontrolne točke rekonstrukcije i nastavak preko praznine (`verifyEvidenceCheckpointV2`, `replayEvidenceAcrossGapsV2`, `replayEvidenceFromCheckpointV2`). Uvozi 3 i 6. |

Pomoćne datoteke, čitaju se po potrebi: `signature.ts` (oblik ovojnice potpisa i javnog ključa), `crypto.ts` (samo `sha256WebCrypto`, vidi §2), `submission-receipt.ts`, `submission-receipt-v2.ts` i `submission-receipt-verifier-v2.ts` (potvrda predaje, građena po uzoru na potvrdu prihvata), `evidence-timing-v1.ts`, `evidence-profile.ts`, `golden-vectors/` (zamrznuti vektori i njihov učitavač).

Semantika pojedinog koraka uređivanja nije u ovoj mapi. `evidence-replay-v2.ts` ne gleda u korak. Format koraka je u `src/domain/document/edit-step.ts` (`parseEditSteps`), a primjena koraka u `src/adapters/evidence/edit-steps-v1-rules.ts` i `edit-steps-v1-replayer.ts` (te `edit-steps-v2-*` za noviji format).

### 1.2 Sinkronizacija (`src/domain/sync`, `src/domain/serverSync`)

| # | Datoteka | Što se u njoj čita |
|---|---|---|
| 1 | `sync/states.ts` | Osam stanja, jedanaest događaja, tablica `SYNC_TRANSITIONS`, reduktor `syncReducer`. |
| 2 | `serverSync/contract.ts` | Ugovor žice za commit: statusi, `parseCommitOutcome`, `commitRequestFromTransaction`, granica veličine dokumenta. |
| 3 | `sync/drain.ts` | Što se šalje (`planDrain`), što odgovor znači (`outcomeToEvents`), zadržani redak (`nextAwaitingReceipt`), raspored ponavljanja. Uvozi 1 i 2. |
| 4 | `sync/conflict.ts` | Zapis sukoba i izričito rješenje (`buildConflictRecord`, `resolveConflict`, `conflictSummary`). |
| 5 | `sync/recovery.ts` | Plan oporavka iz `RECOVERY_REQUIRED` (`planRecovery`). |

Uz to: `sync/journal-types.ts` (tipovi redaka i meta zapisa), `sync/restore.ts`, `sync/labels.ts` (tekstovi stanja), `serverSync/checkpoints.ts`, `serverSync/bootstrap.ts`, `serverSync/messages.ts`. Domenski kod je čist: IO izvode `src/lib/sync/drain-runner.ts` i `src/lib/journal/atomic-dexie-journal.ts`.

## 2. Živo i naslijeđeno u `src/domain/forensics`

Osnova: `grep` uvoza po `src`, `app` i `scripts`, bez datoteka `*.test.*` i `*.spec.*`, 11. 11. 2026. "Koristi samo test" znači da pretraga nije našla nijedan uvoz izvan testova i izvan same naslijeđene skupine.

| Datoteka ili simbol | Nalaz pretrage |
|---|---|
| `index.ts` (izvozi `ledger`, `integrity`, `replay`, `crypto`) | Nijedan uvoz mape kao cjeline izvan testova. Koristi samo test. |
| `ledger.ts` (`createForensicEvent`, `ForensicEvent`) | Uvoze ga samo `index.ts`, `integrity.ts` i `replay.ts`. Koristi samo test. |
| `replay.ts` (`applyForensicEvent`, `replayUntil`) | Uvozi ga samo `index.ts`. Koristi samo test. |
| `integrity.ts`: `appendToHashChain`, `verifyHashChain` | Nema poziva izvan testova. Koristi samo test. |
| `integrity.ts`: `canonicalize`, tip `HashFn` | Uvozi ih `crypto.ts`. `canonicalize` se poziva samo u `merkleRoot` i `buildProvenanceRoots`. Tip `HashFn` nosi potpis funkcije `sha256WebCrypto`. |
| `crypto.ts`: `merkleRoot`, `buildProvenanceRoots` | U kodu označeni `@deprecated`, "no caller (DAN-302)". Koristi samo test. |
| `crypto.ts`: `sha256WebCrypto` | Živo. Uvoze ga `evidence-segment-v2.ts`, `evidence-receipt.ts`, `evidence-replay-v2.ts`, `evidence-timing-v1.ts`, `src/application/evidence/replay-reader.ts` i preglednički replayeri u `src/adapters/evidence`. |
| `evidence-timing-v1.ts` | Nijedan uvoz izvan vlastitih testova. Koristi samo test. |
| `evidence-profile.ts` (`EVIDENCE_PROFILE_ID`) | Nijedan TypeScript uvoz izvan testova. Vrijednost `standard-v1` pojavljuje se u migracijama i u `golden-vectors/evidence-v2.json`. |
| `submission-receipt-verifier-v2.ts` | `src/server/evidence/submission-receipt.ts` uvozi iz njega samo tip `SubmissionReceiptExpectationV2`. Funkcija `verifySignedSubmissionReceiptV2` nema poziva izvan testova, što kaže i zaglavlje datoteke ("No runtime caller yet"). |
| Sve ostale datoteke iz §1.1 | Žive: uvoze ih `src/application/evidence`, `src/adapters/evidence`, `src/server/evidence` ili `src/client`. |

Posljedica za čitanje: `integrity.ts` nije u cijelosti izvan produkcijskog grafa modula, jer ga `crypto.ts` uvozi. Živa je iz njega samo deklaracija tipa `HashFn`. Naslijeđeni `canonicalize` i JCS iz `jcs.ts` dva su različita zapisa: zaglavlje `jcs.ts` to izričito kaže. Novi kod koristi samo `canonicalizeJcs`.

## 3. Verzije formata

| Format | Oznaka u podacima | Gdje je definiran | Gdje se provjerava |
|---|---|---|---|
| Odsječak v2 | `ductus-evidence-segment-v2` | `evidence-segment-v2.ts`, `EVIDENCE_SEGMENT_SCHEMA_V2` | `isEvidenceSegmentV2`, `isEvidenceSegment` |
| Odsječak v3 | `ductus-evidence-segment-v3` | `evidence-segment-v2.ts`, `EVIDENCE_SEGMENT_SCHEMA_V3` | `isEvidenceSegment`. v3 je v2 s dodatnim izvorom `citation-form`. `evidenceSchemaForEvents` bira v3 samo kad takav događaj postoji. |
| Kanonski zapis i hash | `RFC8785-JCS`, `sha256` | `EVIDENCE_CANONICALIZATION_V2`, `EVIDENCE_HASH_ALGORITHM_V2` | Polja odsječka moraju imati točno te vrijednosti (`isEvidenceSegment`). |
| Format koraka | `ductus-edit-steps-v1` | `src/domain/document/edit-step.ts`, `EDIT_STEP_FORMAT_V1` | `parseEditSteps`, pozvan iz validatora odsječka. |
| Lanac v2 | nema vlastite oznake | `evidence-chain-v2.ts` | `verifyEvidenceChainV2`. Lanac je niz odsječaka i glava (hash i broj). |
| Potvrda prihvata v1 | `ductus-evidence-receipt-v1` | `evidence-receipt.ts` | `isEvidenceReceiptPayloadV1`, `isSignedEvidenceReceipt` |
| Potvrda prihvata v2 | `ductus-evidence-receipt-v2` | `evidence-receipt.ts`, `EVIDENCE_RECEIPT_SCHEMA_V2` | Oblik: `isEvidenceReceiptPayloadV2`, `isSignedEvidenceReceiptV2`. Potpis i vezanje: `verifySignedEvidenceReceiptV2`. |
| Kontrolna točka v2 | nema vlastite oznake | `evidence-checkpoint-v2.ts` | `verifyEvidenceCheckpointV2`. Kontrolna točka su kanonski JCS bajtovi dokumenta, adresirani hashom. |
| Potvrda predaje v1 | `ductus-submission-receipt-v1` | `submission-receipt.ts` | `isSubmissionReceiptPayloadV1`, `isSignedSubmissionReceiptV1` |
| Potvrda predaje v2 | `ductus-submission-receipt-v2` | `submission-receipt-v2.ts` | Oblik: `isSubmissionReceiptPayloadV2`, `isSignedSubmissionReceiptV2`. Potpis: `verifySignedSubmissionReceiptV2`. |
| Vremenski zapis v1 | `ductus-evidence-timing-v1` | `evidence-timing-v1.ts` | `isEvidenceTimingV1`, `verifyEvidenceTimingV1` (vidi §2) |

Rezervirana imena (`RESERVED_EVIDENCE_SOURCES`, `RESERVED_EVIDENCE_EVENT_FIELDS`, `RESERVED_EVIDENCE_RECORD_SCHEMAS`) stoje u `evidence-segment-v2.ts`. Dokazuje ih `format-reservation.test.ts`.

## 4. Invarijante

Oznake zadataka i odluka navode se samo ondje gdje ih komentar u kodu ili `docs/backend/evidencija.md` veže uz to mjesto. Putanje testova bez mape odnose se na mapu datoteke koju dokazuju.

### 4.1 Evidencija

| Invarijanta | Gdje se provodi | Test |
|---|---|---|
| Kanonski zapis je RFC 8785: ključevi poredani po UTF-16 jedinicama, bez razmaka. Vrijednost bez kanonskog oblika (nekonačan broj, usamljeni surogat, ciklus, rijetko polje, dubina iznad `MAX_JCS_DEPTH`) baca grešku. | `jcs.ts`, `canonicalizeJcs` | `jcs.test.ts`, `canonicalization.property.test.ts` |
| Hash odsječka je SHA-256 nad UTF-8 bajtovima JCS zapisa. | `evidence-segment-v2.ts`, `digestEvidenceSegment` | `evidence-segment-v2.test.ts`, `golden-vectors.test.ts` |
| Nepoznato polje odbija se na svakoj razini (odsječak, događaj, kontekst hvatanja). | `evidence-segment-v2.ts`, `isEvidenceSegment` (skupovi `SEGMENT_KEYS`, `EVENT_KEYS`, `CAPTURE_CONTEXT_KEYS`) | `evidence-segment-v2.test.ts` ("rejects unknown envelope fields..."), `evidence-segment-v2.format.property.test.ts` |
| Popis izvora i modela editora je zatvoren (komentar u kodu: B-8, #155). | `evidence-segment-v2.ts`, `EVIDENCE_SOURCES_V2`, `EVIDENCE_SOURCES_V3`, `EVIDENCE_EDITOR_MODELS_V2` | `evidence-segment-v2.test.ts`, `evidence-segment-v3.test.ts` |
| Unutar odsječka redni brojevi su uzastopni, hash dokumenta prije događaja jednak je hashu nakon prethodnog, a zadnji je jednak `finalDocumentHash`. | `evidence-segment-v2.ts`, `isEvidenceSegment` | `evidence-segment-v2.test.ts`, `evidence-segment-v2.property.test.ts` |
| Vrijeme odsječka je cijela UTC minuta. Drukčija vrijednost se odbija, ne zaokružuje. | `evidence-segment-v2.ts`, `isEvidenceMinuteV2` | `evidence-segment-v2.test.ts` |
| Primljeni bajtovi moraju biti strogi UTF-8, valjan odsječak i bajt po bajt jednaki vlastitom JCS zapisu. Klijent prije slanja i poslužitelj prije prihvata koriste istu provjeru. | `evidence-chain-v2.ts`, `verifyCanonicalEvidencePayloadV2` | `evidence-chain-v2.test.ts`, `evidence-payload.fuzz.property.test.ts` |
| Odsječak smije imati najviše 2 MiB kanonskih bajtova, ista konstanta za klijent i poslužitelj (D-96 u `docs/DECISIONS.md`; modul nosi oznaku B-8a). | `evidence-chain-v2.ts`, `MAX_EVIDENCE_SEGMENT_BYTES`, `exceedsEvidenceSegmentLimit` | `evidence-chain-v2.test.ts` ("allows exactly the limit and nothing above it") |
| Lanac: svaki odsječak imenuje hash prethodnika, svi pripadaju istom dokumentu, a zadnji hash i broj jednaki su očekivanoj glavi. Praznine se vraćaju pozivatelju kao `discontinuities`. | `evidence-chain-v2.ts`, `verifyEvidenceChainV2`, `findEvidenceBreakV2` | `evidence-chain-v2.test.ts`, `evidence-chain-v2.property.test.ts` |
| Ponovljeno slanje pod istim ključem: ako prihvaćenog odsječka nema, ishod je `new`. Ako se opisnik ne slaže s prihvaćenim (`descriptorMatches` nije `true`), ishod je `idempotency_conflict`. Ako se opisnik slaže, isti hash sadržaja daje `duplicate`, a drukčiji `invalid`. | `evidence-chain-v2.ts`, `decideEvidenceRetry` | `evidence-chain-v2.test.ts`, `evidence-chain-v2.property.test.ts` |
| D-92: ulaz u potpis potvrde v2 je prefiks `ductus-evidence-receipt-v2`, bajt 0x0A i 32 bajta SHA-256 nad JCS zapisom potvrde, ukupno 59 bajtova. Algoritam je isključivo Ed25519. | `evidence-receipt.ts`, `digestEvidenceReceiptPayloadV2`, `isSignedEvidenceReceiptV2` | `evidence-receipt-v2.test.ts`, `evidence-receipt-v2.property.test.ts`, `golden-vectors.test.ts` |
| Potvrda v2 vrijedi tek kad se slažu oblik, digest, kanonski bajtovi potpisa, ključ (jedinstven `keyId` i `keyVersion`, namjena `receipt`, ista domena, neopozvan, a ako ima `validTo`, vrijedi `acceptedAt < validTo`; `validFrom` se ne uspoređuje s `acceptedAt`), potpis i očekivani commit (`documentId`, `clientTransactionId`, `revision`, domena). Funkcija nikad ne baca grešku. | `evidence-receipt-verifier.ts`, `verifySignedEvidenceReceiptV2` | `evidence-receipt-verifier.test.ts`, `evidence-receipt-v2.property.test.ts` |
| Javni ključ i potpis sude se iz bajtova (RFC 8032), prije poziva kriptografske knjižnice. | `ed25519-encoding.ts`, `isSoundEd25519Point`, `isCanonicalEd25519Signature`, `ed25519KeyFromSpki` | `ed25519-encoding.test.ts` |
| Ponavljanje provjerava hash početnog dokumenta prije svakog odsječka i `afterDocumentHash` nakon svakog događaja (modul nosi oznaku B-14). | `evidence-replay-v2.ts`, `replayEvidenceSegmentsV2` | `src/application/evidence/evidence-thin-slice.test.ts`, `src/adapters/evidence/edit-steps-v1-replayer.test.ts`, `evidence-checkpoint-v2.property.test.ts` |
| B-12: korak `replace` koji uklanja sadržaj (brisanje, izrezivanje, zamjena) nosi `removedSha256`. Parser provjerava prisutnost i oblik polja. | `src/domain/document/edit-step.ts`, `parseEditSteps` | `src/domain/document/edit-step.test.ts`, `edit-step-v2.test.ts`, `edit-step.property.test.ts` |
| B-12: pri ponavljanju se hash stvarno uklonjenog raspona uspoređuje sa zapisanim. Neslaganje prekida ponavljanje s `removed_range_hash`. | `src/adapters/evidence/edit-steps-v1-rules.ts` (`runEditStepsV1`, `removedRangeCanonical`) i `edit-steps-v1-replayer.ts` (`createEditStepsV1Replayer`, metoda `apply`) | `src/adapters/evidence/edit-steps-v1-replayer.test.ts`, `edit-steps-v1-browser-replayer.test.ts`, `edit-steps-v2-replayer.test.ts` |
| Kontrolna točka: granica veličine, strogi UTF-8, kanonski bajtovi i hash jednak očekivanom. Nastavak je dopušten samo preko praznine (`gap`), a praznina ostaje u rezultatu. | `evidence-checkpoint-v2.ts`, `verifyEvidenceCheckpointV2`, `replayEvidenceAcrossGapsV2` | `evidence-checkpoint-v2.property.test.ts` (test s imenom `evidence-checkpoint-v2.test.ts` nije pronađen) |

Naslijeđeni `replay.ts` (`replayUntil`) nije mjesto invarijante B-12. Ona je u replayeru koraka, izvan `src/domain/forensics`.

### 4.2 Sinkronizacija

| Invarijanta | Gdje se provodi | Test |
|---|---|---|
| Reduktor je totalan: nedopušten par stanja i događaja vraća isto stanje. | `sync/states.ts`, `syncReducer`, `isLegalTransition` | `sync/states.test.ts` ("leaves the state untouched for every illegal transition") |
| `SYNCED` se doseže samo događajem `SYNC_ACK` iz `SYNCING` ili izričitom odlukom (`CONFLICT_RESOLVED` s `discard`, `RECOVERED` s `adopt-server`). | `sync/states.ts`, `SYNC_TRANSITIONS` | `sync/states.test.ts` ("keeps SYNCED reachable only by a signed ACK or an explicit decision") |
| `SYNC_ACK` nastaje samo za `committed` ili `duplicate` s potpisanom potvrdom koju je verifikator potvrdio (`verify(...) === true`), za očekivani dokument, ključ transakcije i reviziju. Potvrda koja nedostaje, iznimka verifikatora ili druga revizija ne daju ACK. | `sync/drain.ts`, `outcomeToEvents` | `sync/drain.test.ts` ("committed is an ACK only after verifying the signed receipt", "a missing receipt cannot ACK...", "a verifier exception cannot ACK", "a verifier cannot check a different revision") |
| `pending_signature` nije ACK: nema događaja, a redak ostaje zadržan do potpisane potvrde. | `sync/drain.ts`, `outcomeToEvents`, `nextAwaitingReceipt` | `sync/drain.test.ts`, `sync/drain.pending-receipt.test.ts` |
| Nakon novog `EDIT`-a stanje je `EDITING`. Ishodi starijeg leta (`SYNC_ACK`, `SYNC_STALE_BASE`, `LOCAL_SAVE_OK`) u tom stanju nisu u tablici i ne mijenjaju ga. | `sync/states.ts`, `SYNC_TRANSITIONS` | `sync/states.test.ts` ("does not claim durability for text typed after a local save") |
| Provjerena potvrda za stariji redak ne daje ACK dok je noviji redak u redu čekanja. | `sync/drain.ts`, `earnsAck`, `newerRowsQueued` | `sync/drain.held-ack.test.ts`, `sync/drain.late-answer.test.ts` |
| Odgovor za redak kojeg više nema u redu ne mijenja ništa. | `sync/drain.ts`, `outcomeToEvents` (`isSettled`), `nextAwaitingReceipt` | `sync/drain.late-answer.test.ts` |
| Journal dopušta `SYNCED` samo kad je potvrda provjerena, zadržavanje otpušteno i red prazan, u istoj transakciji. Inače baca `unconfirmed_sync`. | `src/lib/journal/atomic-dexie-journal.ts`, `recordAnswer` | `src/lib/journal/atomic-dexie-journal.sync.test.ts` |
| Parser odgovora ne provjerava potpis. `committed` i `duplicate` bez valjanog oblika potvrde postaju `invalid`. | `serverSync/contract.ts`, `parseCommitOutcome` | `serverSync/contract.test.ts`, `serverSync/receipt-bridge.test.ts` |
| Dokument iznad `MAX_DOCUMENT_BYTES` (1 MiB) ne postaje zahtjev. Odsječak iznad granice iz §4.1 ne šalje se. | `serverSync/contract.ts`, `commitRequestFromTransaction`. `sync/drain.ts`, `planDrain` (`isSendableSegment`) | `serverSync/contract.test.ts`, `sync/drain.evidence.test.ts` |
| Sukob se ne rješava sam. Zapis čuva obje verzije, a rješenje vraća novi zapis. | `sync/conflict.ts`, `resolveConflict` | `sync/conflict.test.ts` |
| Plan oporavka nudi samo dokument koji prolazi `validateDocument` i ne bira umjesto autora. | `sync/recovery.ts`, `planRecovery` | `sync/recovery.test.ts`, `recovery.hardening.test.ts`, `recovery.rebase.test.ts` |

Oznake F-3 i F-8 su zadaci iz `docs/PLAN-DEMO.md`. U kodu ih nose komentari u `sync/drain.ts`, `sync/journal-types.ts`, `sync/restore.ts` i `sync/labels.ts`. Redak "F-3/F-8" u `STATE.md` odgovara prvim pet redaka gornje tablice.

## 5. Automat stanja i pražnjenje reda

### 5.1 Stanja (`sync/states.ts`)

Stanja su `EDITING` (početno), `SAVING_LOCAL`, `LOCAL_DURABLE`, `SYNCING`, `SYNCED`, `CONFLICT`, `ERROR` i `RECOVERY_REQUIRED`. Tablica `SYNC_TRANSITIONS` je podatak, a ne grananje u kodu. Sažetak:

- **Uobičajeni put:** `EDITING`, `SAVING_LOCAL`, `LOCAL_DURABLE`, `SYNCING`, `SYNCED`, tim redom.
- **`EDIT`** vraća u `EDITING` iz svakog stanja osim `CONFLICT` i `RECOVERY_REQUIRED`. Ta dva stanja tipkanje ne napušta.
- **`CONFLICT`** nastaje samo iz `SYNCING` na `SYNC_STALE_BASE`. Izlaz je samo `CONFLICT_RESOLVED`: `rebase` vodi u `SAVING_LOCAL`, `discard` u `SYNCED`.
- **`RECOVERY_REQUIRED`** nastaje na `LOCAL_SAVE_FAILED` s razlogom `corrupt` ili na `SYNC_KEY_DIVERGED`. Izlaz je samo `RECOVERED`: `salvage-local` vodi u `SAVING_LOCAL`, `adopt-server` u `SYNCED`.
- **`ERROR`** nastaje na ostalim neuspjesima lokalnog spremanja i na `SYNC_FAILED`. Iz njega se može ponovno spremiti ili poslati.

### 5.2 Što se šalje (`planDrain`)

`planDrain(pending, meta, awaitingReceipt)` vraća `{ send, supersededUpTo }`. Ne šalje ništa kad je red prazan, kad je stanje `CONFLICT` ili `RECOVERY_REQUIRED`, kad se retci ne mogu poredati, kad red sadrži više dokumenata ili miješa `EVIDENCE_SEGMENT` i `REPLACE_DOCUMENT`, te kad je oznaka zadržavanja neispravna ili označena kao razišla. Za zamjene dokumenta šalje se najnoviji ispravan redak, a stariji se vode kao nadomješteni. Za odsječke evidencije šalje se najstariji redak i ništa se ne preskače. Dok postoji zadržani redak (`AwaitingReceipt`), ponavlja se samo on.

### 5.3 Što odgovor znači (`outcomeToEvents`)

| Ishod | Događaji |
|---|---|
| Let je već podmiren (poslani redak više nije u redu) | nijedan |
| `committed` ili `duplicate`, potvrda nedostaje ili je neispravna | `SYNC_FAILED` (bez ponavljanja) |
| `committed` ili `duplicate`, `pending_signature` | nijedan |
| `committed` ili `duplicate`, potpisana, ali očekivani commit (`verification.expected`) je nepotpun ili mu se revizija ne slaže s odgovorom | `SYNC_FAILED` (bez ponavljanja), verifikator se ne poziva |
| `committed` ili `duplicate`, potpisana, ali očekivani commit ne pripada poslanom retku (`documentId` ili `clientTransactionId`) | `SYNC_FAILED` (bez ponavljanja), verifikator se ne poziva |
| `committed` ili `duplicate`, potpisana, verifikacija ne uspije | `SYNC_FAILED` (bez ponavljanja) |
| `committed` ili `duplicate`, potpisana i provjerena, let čitljiv, nema novijih redaka | `SYNC_ACK` |
| `committed` ili `duplicate`, potpisana i provjerena, postoji noviji redak | nijedan |
| `committed` ili `duplicate`, potpisana i provjerena, let nečitljiv | nijedan (nečitljiv let nikad ne daje `SYNC_ACK`) |
| `stale_base` | `SYNC_STALE_BASE` |
| `transport_error` | `SYNC_FAILED` (s ponavljanjem) |
| `txid_reused` | `SYNC_KEY_DIVERGED` |
| `too_large`, `not_found`, `unauthenticated`, `invalid_document`, `invalid_client_transaction_id`, `invalid`, nepoznat status | `SYNC_FAILED` (bez ponavljanja) |

`earnsAck` se poziva prije verifikatora. Ako očekivani commit ne pripada poslanom retku, vraća `null` i ishod je `SYNC_FAILED` bez provjere potpisa. Inače unaprijed odlučuje hoće li provjerena potvrda dati `SYNC_ACK`: let mora biti čitljiv, a `newerRowsQueued` ne smije naći noviji redak. Nečitljiv let se ne smatra podmirenim, pa se odbijanje ne proguta. `nextAwaitingReceipt(sent, outcome, previous)` zatim odlučuje ostaje li redak zadržan: provjerena potvrda otpušta zadržavanje, neprovjeren `committed` ili `duplicate` ga postavlja, `txid_reused` ga označava kao razišlo, konačno odbijanje ključa ga otpušta, a greška prijenosa ga čuva.

### 5.4 Stanje na razini modula i redoslijed poziva

`drain.ts` drži dvije zbirke na razini modula, obje ključane objektom ishoda:

- `VERIFIED_COMMIT_REVISIONS` (`WeakMap`): ishod čiju je potvrdu `outcomeToEvents` provjerio, s očekivanjem koje je provjereno.
- `NOT_OWED` (`WeakSet`): ishod koji je `outcomeToEvents` zatekao već podmiren.

`outcomeToEvents` ih piše, a `ackedRevision` i `nextAwaitingReceipt` čitaju. Čitatelj zato mora imati na umu redoslijed i identitet objekta:

1. `planDrain` bira redak.
2. Journal prije slanja upisuje `SYNCING` i oznaku zadržavanja (`beginSend`, koristi `awaitingReceiptFor`).
3. Prijenos vraća objekt ishoda.
4. `outcomeToEvents(outcome, verification, flight)`. Na početku briše stare unose za taj objekt.
5. `recordAnswer` u journalu poziva `nextAwaitingReceipt(sent, outcome, previous)` i `ackedRevision(outcome)` s istim objektom ishoda.
6. `scheduleAfterOutcome` određuje sljedeći pokušaj.

Taj redoslijed provodi `sendOnce` u `src/lib/sync/drain-runner.ts`. Komentar uz `recordAnswer` traži isto: "Call `outcomeToEvents` first". Kopija objekta ishoda (npr. nakon serijalizacije) nema unos ni u jednoj zbirci, pa `ackedRevision` za nju vraća `null`. Testovi: `sync/drain.test.ts` ("returns a commit revision only after outcomeToEvents verified its receipt", "is null for anything that is not a verified ACK").

## 6. Granica povjerenja

Domenski kod pokazuje ovo. Klijent računa kanonske bajtove i hash odsječka (`digestEvidenceSegment`) i prije slanja ih provjerava istom funkcijom kojom poslužitelj provjerava prije prihvata (`verifyCanonicalEvidencePayloadV2`), s istom granicom veličine. Ključ idempotencije je trojka dokument, akter i `clientTransactionId`, a aktera prema komentaru u `serverSync/contract.ts` uzima RPC iz sesije, ne iz zahtjeva. Klijent odgovor poslužitelja ne uzima kao dokaz: `parseCommitOutcome` čita samo oblik, a stanje `SYNCED` traži potvrdu koju je `verifySignedEvidenceReceiptV2` provjerio prema očekivanju i ključevima iz izvora koji nije sam odgovor. Verifikator ostavlja pozivatelju usporedbu `principalId` i `segmentHash`, što piše u njegovu zaglavlju. Kako poslužitelj potpisuje, pohranjuje i atomarno rezervira, nije vidljivo iz ovih mapa: to opisuju `docs/backend/evidencija.md` §4.13 i `docs/ARCHITECTURE.md` §5 i §8.

## 7. Kako provjeriti izmjenu

Skripte su iz `package.json`. Vitest prima putanju kao filtar.

1. `pnpm test:unit src/domain/forensics src/domain/sync src/domain/serverSync`: jedinični testovi triju mapa.
2. `pnpm test:property`: svojstveni testovi (`*.property.test.ts`), među njima kanonski zapis, lanac, potvrda i kontrolne točke.
3. Izmjena formata ili hasha: `golden-vectors.test.ts` i `format-reservation.test.ts` moraju proći bez izmjene vektora. Izmjena vektora je izmjena formata i traži odluku (vidi `docs/backend/evidencija.md` §4.1).
4. Izmjena koraka ili replayera: `pnpm test:unit src/adapters/evidence src/domain/document`, zbog `removedSha256` (§4.1).
5. Izmjena `drain.ts` ili `states.ts`: pokreni i `pnpm test:unit src/lib/sync src/lib/journal`, jer se redoslijed iz §5.4 dokazuje ondje. Prođi skill `ductus-sync-states`.
6. Izmjena koja dira prihvat na poslužitelju: `pnpm test:integration` i `pnpm test:db` (traže lokalni stog, vidi `docs/TESTING.md`).
7. Prije predaje: `pnpm typecheck`, `pnpm lint`, `pnpm orch:overlap`. Test se ne briše i ne preskače bez jednakovrijedne zamjene (`CLAUDE.md`).
8. Ako izmjena mijenja ijedan redak tablica u §2 do §5, ispravi ovaj vodič u istom PR-u.

## Nije provjereno

- Testovi u §4 pronađeni su pretragom imena funkcija i naslova testova. Tijela testova nisu čitana redak po redak, pa vodič ne tvrdi da svaki test pokriva svaki rubni slučaj invarijante uz koju stoji.
- `ed25519-encoding.ts`, `signature.ts`, `submission-receipt*.ts`, `evidence-timing-v1.ts`, `sync/journal-types.ts`, `sync/restore.ts`, `sync/labels.ts`, `serverSync/checkpoints.ts`, `serverSync/bootstrap.ts` i `serverSync/messages.ts` pregledani su samo na razini zaglavlja i izvezenih imena.
- `sync/conflict.ts` i `sync/recovery.ts`: pročitana su zaglavlja i dokumentacijski komentari izvezenih funkcija, ne cijela tijela.
- `src/adapters/evidence/edit-steps-v2-*`: potvrđeno je samo da postoje, da uvoze `evidence-replay-v2.ts` i da njihovi testovi spominju `removed_range_hash`. Provjera hasha uklonjenog raspona pročitana je u cijelosti samo za format v1.
- `atomic-dexie-journal.ts`: pročitane su metode oko `beginSend` i `recordAnswer`, ne cijela datoteka.
- Poslužiteljska strana (potpisivanje, pohrana, atomarni commit i rezervacija iz retka B-8 u `STATE.md`, SQL i RPC) nije čitana. Vodič o njoj ništa ne tvrdi.
- Nalazi "koristi samo test" iz §2 vrijede za statičke uvoze u `src`, `app` i `scripts`. Dinamički uvozi i druge mape (`tests`, `db`, `infra`) nisu pretraživani kao produkcijski pozivatelji.
