# Sinkronizacija i journal: detaljna karta

Ako se ovaj vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod; nesklad prijavi u IZVJEŠTAJU.

Stanje provjereno na `main` (c3ede8a, 11. 10. 2026.). Vodič ne uvodi pravila: pravila su u dokumentima navedenim uz svaku invarijantu.

## 1. Kada koristiti

Kad se dira `src/domain/sync/`, `src/domain/serverSync/`, `src/lib/journal/`, njihovi testovi ili `tests/unit/server-sync-messages.test.ts`, ili kad zadatak spominje SYNCED, potvrdu (ACK), drain, oporavak, rebase, salvage, offline oznaku ili brisanje lokalne pohrane pri odjavi.

Uz njega vrijede kratki skillovi iz `.claude/skills/`: `ductus-sync-states` (provjere za stanja, ACK, drain), `ductus-offline-recovery` (kanonski postupak dokazivanja oporavka), `ductus-local-storage-logout` (odjava, brisanje, zastarjeli tabovi), `ductus-ui-copy` (tekst stanja), `ductus-synthetic-data` (fixtureovi), `ductus-attack-plan` (kritični zadatak). Za širu orijentaciju `docs/vodici/karta-aplikacije.md` i `docs/vodici/testovi.md`. Podsjetnik za područje je `.claude/rules/sinkronizacija.md` (pisac u ovom području radi na Opusu, `docs/ORKESTRATOR.md` §7).

## 2. Što je stvarno izvedeno, a što nije

`docs/ARCHITECTURE.md` §0.1: dokument opisuje ciljnu arhitekturu, implementirano dokazuje kod. Na `main` postoji samo ovo:

- čisti domenski sloj (`src/domain/sync`, `src/domain/serverSync`): automat stanja, planeri, parseri;
- `AtomicDexieJournal` (`read`, `saveLocal`, `hasPendingLogout`, `destroyForLogout`) i `LocalDocumentSaver` (samo lokalno spremanje);
- `local-scope.ts` (fiksni demo opseg journala).

Ne postoji, pa ne opisuj kao da postoji: `src/lib/sync/drainRunner` (ARCHITECTURE §12 ga navodi kao prenosiv); `src/lib/journal/recovery.ts`; journal operacije `clearPending`, `rebaseLocal`, `adoptServerDocument`, `recordConflict`, `markConflictResolved`, `refreshConflictServerSide`; trajni zapis oznake `AwaitingReceipt`; Web Lock pisac po dokumentu (postoji samo poruka `MULTI_TAB_BLOCKED_MESSAGE`); poslužiteljski `pisac_commit_document`, `pisac_ensure_document`, `pisac_create_checkpoint` (ugovor je u `contract.ts` i `checkpoints.ts`, SQL se prepisuje, ARCHITECTURE §12); ingest ruta i potpisivanje u workeru (ARCHITECTURE §5 t. 3 i 4); editor na `/rad` (`app/rad/page.tsx` je prazna ljuska do F-8); poziv journala iz odjave (`app/api/auth/logout/route.ts` ne dira journal; F-5). Komentari u `states.ts`, `conflict.ts`, `restore.ts` na te operacije upućuju kao na dogovor, ne kao na postojeći kod.

Posljedica: kad nešto "mora" zapisati journal (rebase, discard, adopt, hold oznaka), to je danas samo ugovor u komentaru domene. Novi kod koji ga izvodi mora ga ostvariti i testirati.

## 3. Karta

### `src/domain/sync/` (čista domena: bez Reacta, Dexieja, IO-a i sata)

- `states.ts`: `SYNC_STATES` (8), `SyncEvent` (11 vrsta, `SYNC_EVENT_TYPES`), `SYNC_TRANSITIONS` (tablica kao podaci), `syncReducer`, `isLegalTransition`, `transitionVariant`, `INITIAL_SYNC_STATE` (EDITING), `LOCAL_SAVE_FAILURE_REASONS`, `CONFLICT_RESOLUTIONS` (`rebase`, `discard`), `RECOVERY_CHOICES` (`salvage-local`, `adopt-server`). Reducer je total i čita samo vlastita svojstva (`Object.hasOwn`).
- `journal-types.ts`: `JournalSnapshot`, `PendingTransaction`, `SyncMeta`, `JournalContents`.
- `restore.ts`: `restoreSyncState(contents)`, `TRANSIENT_SYNC_STATES`.
- `drain.ts` (najveći): `planDrain`, `outcomeToEvents`, `nextAwaitingReceipt`, `awaitingReceiptFor`, `isDiverged`, `ackedRevision`, `newerRowsQueued`, `isRetryable`, `fastForwardBase`, `serverSyncErrorToOutcome`, backoff (`backoffBaseMs`, `nextAttemptDelayMs`, `BASE_BACKOFF_MS` 1000, `MAX_BACKOFF_MS` 30000, `BACKOFF_JITTER` 0,2), raspored (`scheduleAfterOutcome`, `mayAttempt`), `adoptDiscardsNewerRows`, `adoptServerEvents`.
- `conflict.ts`: `ConflictRecord`, `buildConflictRecord`, `resolveConflict`, `withLatestLocalDocument`, `conflictSummary`, `isResolvedConflict`.
- `recovery.ts`: `planRecovery` (uvijek vraća obje opcije), `RecoveryPlan`, `RecoveryCandidate`, `RecoveryUnavailableReason`.
- `labels.ts`: `SYNC_STATE_LABELS` (`Record<SyncState, ...>`), `chipContent(state, blocked)`, `MULTI_TAB_BLOCKED_MESSAGE`.
- `index.ts`: barrel (states, journal-types, restore, conflict, recovery, drain, labels).

### `src/domain/serverSync/` (čista domena, ugovor s poslužiteljem)

- `contract.ts`: `COMMIT_STATUSES`, `parseCommitOutcome`, `parseEnsureOutcome`, `commitRequestFromTransaction`, `MAX_DOCUMENT_BYTES` (1 048 576), `exceedsDocumentSizeLimit`, `ServerSyncErrorCode`, `parseServerSyncErrorCode`.
- `bootstrap.ts`: `resolveInitialDocument(journalSnapshot, serverDocument)`.
- `checkpoints.ts`: `validateCheckpointName` (najviše 120 točaka koda), `parseCheckpointOutcome`, `parseCheckpointRow`, `parseCheckpointList`, `formatCheckpointDate`.
- `messages.ts`: sav tekst sučelja ovog sloja (`SERVER_SYNC_ERROR_MESSAGES`, `CHECKPOINT_ERROR_MESSAGES`, `UNSYNCED_CHANGES_NOTE`, `checkpointCreatedMessage`, `LOAD_FAILURE_MESSAGE`). Skener zabranjenih izraza čita svaki string u toj datoteci.

### `src/lib/journal/` (jedini sloj s IndexedDB-om)

- `atomic-dexie-journal.ts`: `AtomicDexieJournal`, `JournalError` i kodovi (`invalid_input`, `incomplete_store`, `sticky_state`, `duplicate_transaction`, `sequence_exhausted`, `stale_local_sequence`, `unsynced_work`, `logout_in_progress`, `logout_blocked`).
- `local-document-saver.ts`: `LocalDocumentSaver` (`load`, `edit`, `propose`, `resume`, `settled`, `snapshot`, `subscribe`), `failureOf`, `reasonOf`, `DEFAULT_SAVER_LIMITS`.
- `local-scope.ts`: `resolveLocalScope`, `localScopeConfigFromEnv`, `LOCAL_DEMO_SCOPE_HASH`, `LOCAL_DEMO_DOCUMENT_ID`, `LocalScopeConfigError`.

### Smjer ovisnosti

`sync` uvozi `document` i iz `serverSync/contract` samo `commitRequestFromTransaction` i tipove. `serverSync` uvozi `document`, `json` i `@/lib/i18n/hr` (checkpoints). `lib/journal` uvozi `sync`, `serverSync/contract`, `document` i `editor/storable-text`. Domena ne smije uvoziti Dexie, React ni `@/editor/interop` (`conflict.ts` i `recovery.ts` zato sami broje čvorove i riječi). ARCHITECTURE §0.1: smjer ovisnosti je prema unutra.

## 4. Lokalni journal: što se sprema i gdje

Izvor: `atomic-dexie-journal.ts`, `journal-types.ts`.

- Baza se zove `ductus-journal-v1-<scopeHash>`; `scopeHash` je 64 mala heksadekadska znaka (SHA-256 načela, nikad e-pošta ni token; konstruktor drugo odbija s `invalid_input`). Bez prijave (F-5) opseg je `LOCAL_DEMO_SCOPE_HASH`, samo uz poslužiteljsku zastavu `DUCTUS_LOCAL_DEMO_JOURNAL=1` i `DUCTUS_DEPLOYMENT` točno `local`, `ci` ili `demo`; inače `resolveLocalScope` vraća `null` (editor ostaje samo za čitanje) ili baca `LocalScopeConfigError`.
- Verzija 1: `snapshots` (ključ `documentId`, jedan redak, najnoviji kandidat; `revision` je BAZNA revizija, ne poslužiteljska revizija tog sadržaja), `pending` (ključ `[documentId+localSeq]`, redovi koji još duguju poslužitelju), `meta` (ključ `documentId`: `state`, `localSeq` kao najviši dodijeljen, `lastError`). Verzija 2 dodaje `control` (redak `logout`/`closing` je ograda odjave). Nadogradnja je nedestruktivna.
- Format reda: `tx` je `DocumentTransaction` (`kind: "REPLACE_DOCUMENT"`, `clientTransactionId`, `baseRevision`, `document`, `createdAt`). `canonicalTx` sprema samo poznata polja, dokument prolazi `validateDocument`, `createdAt` mora biti kanonski UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, `documentId` je neprazan do 128 znakova.
- `saveLocal(documentId, input, savedAt, expectedLocalSeq)` piše snapshot, pending red i meta u JEDNOJ readwrite transakciji (`journal-types.ts`, dossier §7). Meta je uvijek `LOCAL_DURABLE`; prijelazna stanja žive samo u memoriji (zaglavlje `local-document-saver.ts`).
- Baza je po originu; "vezan uz korisnika" znači opseg imena (BACKEND §4.3).

## 5. Tok podataka

1. Editor zove `saver.edit()` (EDIT, `gen += 1`) i debounced `saver.propose(doc)`. Najnoviji kandidat pobjeđuje, spremanja idu jedno po jedno (`queue`, `drain`, `writeQueued`).
2. `save()` šalje LOCAL_SAVE_STARTED, gradi `tx` (novi `crypto.randomUUID()` kao `clientTransactionId`, `baseRevision` iz snapshota), provjerava granice reda (5 000 redaka, 64 MiB znakova, `near` od 80 %) i zove `journal.saveLocal(..., this.seq)`. LOCAL_SAVE_OK ide samo ako je tekst još onaj koji je spremljen (`current()`); inače ostaje EDITING.
3. `load()` čita `journal.read`, provjerava dosljednost redaka (`consistent`) i vraća `ready`, `recovery` (`corrupt`, `sticky`, `unsaved`, `stale`) ili `unavailable`. Početno stanje daje `restoreSyncState`.
4. Slanje (za budući drainRunner; danas postoje samo čiste funkcije): `planDrain(pending, meta, awaitingReceipt)` bira JEDAN red (najnoviji; redovi su puni dokumenti pa su stariji nadomješteni) i `supersededUpTo`. Prije slanja runner mora trajno zapisati `awaitingReceiptFor(sent)`. `commitRequestFromTransaction` gradi argumente RPC-a; `fastForwardBase(tx, acked)` podiže bazu samo na reviziju vlastitog potvrđenog commita.
5. Odgovor: `parseCommitOutcome(raw)`, za pogreške prijevoza `serverSyncErrorToOutcome`, zatim `outcomeToEvents(outcome, verification, flight)` daje događaje reducera. `nextAwaitingReceipt` daje novi hold, `ackedRevision` reviziju za pomak baze, `scheduleAfterOutcome` sljedeći pokušaj.
6. Provjerena potvrda i prazan red: SYNC_ACK, SYNCED. Sukob: `buildConflictRecord`, `resolveConflict`. Oštećenje: `planRecovery`, pa `RECOVERED` s izborom.

## 6. Automat stanja

Osam stanja, bez devetog i bez općenitog "Spremljeno" (`states.ts`, `labels.ts`): EDITING, SAVING_LOCAL, LOCAL_DURABLE, SYNCING, SYNCED, CONFLICT, ERROR, RECOVERY_REQUIRED. Što nije u `SYNC_TRANSITIONS`, nedopušteno je i ostavlja stanje nepromijenjenim (bez bacanja).

- EDITING: EDIT -> EDITING; LOCAL_SAVE_STARTED -> SAVING_LOCAL.
- SAVING_LOCAL: EDIT -> EDITING; LOCAL_SAVE_OK -> LOCAL_DURABLE; LOCAL_SAVE_FAILED -> ERROR za `quota`, `unknown`, `unavailable`, a RECOVERY_REQUIRED samo za `corrupt`.
- LOCAL_DURABLE: EDIT -> EDITING; SYNC_STARTED -> SYNCING; SYNC_KEY_DIVERGED -> RECOVERY_REQUIRED.
- SYNCING: EDIT -> EDITING; SYNC_ACK -> SYNCED; SYNC_STALE_BASE -> CONFLICT; SYNC_FAILED (oba `retryable`) -> ERROR; SYNC_KEY_DIVERGED -> RECOVERY_REQUIRED.
- SYNCED: samo EDIT -> EDITING.
- CONFLICT (ljepljivo): samo CONFLICT_RESOLVED; `rebase` -> SAVING_LOCAL, `discard` -> SYNCED. EDIT se guta.
- ERROR: EDIT -> EDITING; LOCAL_SAVE_STARTED -> SAVING_LOCAL; SYNC_STARTED -> SYNCING; SYNC_KEY_DIVERGED -> RECOVERY_REQUIRED.
- RECOVERY_REQUIRED (ljepljivo): samo RECOVERED; `salvage-local` -> SAVING_LOCAL, `adopt-server` -> SYNCED. EDIT se guta.

Obveze koje tablica ne drži, nego ih ispunjava pozivatelj PRIJE slanja događaja (komentari u `states.ts`): rebase i salvage se prvo zapišu u journal; discard i adopt u jednoj journal transakciji isprazne red i spreme poslužiteljski dokument. Bez toga bi SYNCED bio lažan.

## 7. SYNCED, potvrda i drain

Jedini putovi do SYNCED:
1. `outcomeToEvents` vrati SYNC_ACK: odgovor je `committed` ili `duplicate` s `receipt.status === "signed"`; verifier (`SignedCommitReceiptVerifier`) vrati točno `true` za `expected` (`documentId`, `clientTransactionId`, `revision`); `expected.revision` jednak `outcome.revision`; i red koji odgovor zatiče nema novijeg reda (`newerRowsQueued`). Svaka nejasnoća je FATAL (`SYNC_FAILED(false)`), uključujući verifier koji baci ili vrati nešto osim `true`.
2. Izričiti `RECOVERED: adopt-server` ili `CONFLICT_RESOLVED: discard`, nakon što je journal već ispražnjen.
3. Reload: `restoreSyncState` nastavlja zapisani SYNCED samo ako journal ima snapshot i prazan red (`hasItsRecord`); inače LOCAL_DURABLE.

Ostali odgovori: `pending_signature` ne daje događaj (ostaje SYNCING, ponovi se isti red, `isRetryable`). `stale_base` -> CONFLICT, nikad ponovni pokušaj. `txid_reused` -> SYNC_KEY_DIVERGED -> RECOVERY_REQUIRED. `transport_error` -> SYNC_FAILED(true) uz backoff. `too_large`, `not_found`, `unauthenticated`, `invalid_*`, `invalid` i nepoznat status -> SYNC_FAILED(false).

Hold (`AwaitingReceipt`): kad je CAS sletio ili je mogao sletjeti, a potvrda nije provjerena, šalje se samo isti red (isti ključ, poslužitelj odgovara `duplicate`); novi red na staroj bazi dobio bi `stale_base` protiv vlastitog commita. Hold završava provjerenom potvrdom tog reda ili odgovorom iz `KEY_REFUSED` (`stale_base`, `too_large`, `not_found`, `invalid_document`, `invalid_client_transaction_id`); `unauthenticated` ga ne mijenja; izgubljen, prekinut ili nečitljiv odgovor ga zadržava. Hold s `diverged: "txid_reused"` ne šalje ništa, a briše ga samo autorova odluka. Zakašnjeli odgovor za red kojeg više nema u redu ne mijenja ništa (`isSettled`, `NOT_OWED`, #181).

`planDrain` ne šalje ništa kad je meta CONFLICT ili RECOVERY_REQUIRED, kad je redoslijed neodrediv, kad dva retka dijele `localSeq`, kad red miješa dokumente ili je hold neispravan. Nesendable red (`isSendable` preko `commitRequestFromTransaction`) postaje granica: ni slanje ni brisanje prefiksa ne prelaze je.

Backoff: 1 s, 2 s, 4 s, 8 s, 16 s, pa 30 s, jitter plus-minus 20 %, raspored po dokumentu; novi EDIT ga ne resetira.

## 8. Sukob, oporavak, rebase, salvage i redoslijed

- Sukob (`conflict.ts`): zapis sadrži obje verzije i nikad se ne mijenja na mjestu; `resolveConflict` vraća novi zapis s `resolvedVia` i `resolvedAt`. `rebase` = moj dokument na poslužiteljskoj reviziji (`journalAction: "save-local"`), dostupan i bez poslužiteljskog dokumenta; `discard` = poslužiteljski dokument (`"clear-pending"`), samo ako je dohvaćen (`server-unknown` inače); drugi put je `already-resolved`. `withLatestLocalDocument` stavlja najnoviji lokalni tekst u zapis za ploču (tekst tipkan nakon odbijenog commita ne smije se tiho izgubiti).
- Oporavak (`recovery.ts`): `planRecovery` validira svakog kandidata `validateDocument`. `salvage-local` bira novijeg od `pendingNewest` i `snapshot` (izjednačenje ide pending retku; vrijeme se rangira samo u kanonskom UTC obliku). `nextBaseRevision` je poslužiteljska revizija samo ako je validirana i nije manja od najviše poznate lokalne, inače `null` (CAS se ne šalje). Preporuka je `salvage-local` kad je dostupan (ne uništava ništa), inače `adopt-server`, inače `null`. Preporuka nije odluka; treće automatske opcije nema.
- `adoptServerEvents(queue, documentId, held, confirmed)` ne vraća događaj ako bi usvajanje odbacilo novije lokalne redove, a `confirmed !== true` (odluka vlasnika, #87 komentar 6100954183, zapisano u `drain.ts`).
- Redoslijed (STATE.md F-3/F-8): plan oporavka i izbor autora, zatim journal zapis izabrane opcije u jednoj transakciji (salvage: novi red s novim ključem na validiranoj poslužiteljskoj reviziji; adopt: prazan red i poslužiteljski dokument; rebase: lokalni dokument na poslužiteljsku reviziju), tek onda `RECOVERED` ili `CONFLICT_RESOLVED`, pa SAVING_LOCAL (rebase, salvage) ili SYNCED (discard, adopt), a drain tek iz LOCAL_DURABLE. Salvage ostavlja držani red i sve iza njega u redu, zamijenjene, do provjerene potvrde novog reda. Taj redoslijed danas drže samo testovi čiste domene (`states.test.ts` "whole pipeline", `recovery.rebase.test.ts`), jer journal operacije ne postoje.

## 9. Offline i idempotentnost

- Pravilo: PRODUCT §5 pravilo 10 "Offline zapis ostaje označen kao offline i nakon sinkronizacije" (C-15); PLAN-DEMO F-8: rad bez mreže i povratak s oznakom, E2E "offline oznaka ostaje". Oznaka nije izvedena ni u `src/domain/sync`, ni u `src/lib/journal`, ni na `PendingTransaction`. Potvrda v2 oznaku izvanmrežnog rada namjerno ne nosi (BACKEND §4.1, odluka vlasnika 11. 10. 2026.). Gdje će živjeti, nije u pročitanim izvorima; ne gradi je bez odluke.
- Ponašanje koje kod danas daje offline: `transport_error` -> ERROR s backoffom, red ostaje dužan, tekst ostaje u journalu, hold čuva ključ.
- Idempotentnost: ključ je `(document_id, actor_id, client_transaction_id)`; aktera RPC određuje iz sesije i nije u `CommitRequest` (`contract.ts`). `clientTransactionId` je neprazan, najviše 128 znakova. Isti ključ s istim sadržajem daje `duplicate` s istom revizijom; isti ključ s drugim sadržajem `txid_reused`. Lokalno `saveLocal` odbija ponovljeni ključ u redu (`duplicate_transaction`). Ponovljeni red zadržava ključ (`fastForwardBase` ga ne dira). TESTING §3 t. 10 i 11; ARCHITECTURE §5 t. 3.

## 10. Odjava i lokalna pohrana

Izvor: `atomic-dexie-journal.ts`; ARCHITECTURE §10; BACKEND §4.3; PRODUCT §13 t. 13 (kroz `ductus-local-storage-logout`).

- `destroyForLogout()` u JEDNOJ readwrite transakciji provjeri da nema pending redaka i da je svaki snapshot i meta SYNCED (inače `unsynced_work`) te upiše ogradu `control.logout`; tek onda `db.delete()`. Ograda ostaje ako brisanje ne uspije, a poziv se smije ponoviti na istoj ili novoj instanci. Istodobni pozivi dijele jedan tijek.
- Potrošena instanca: nakon odjave ili brisanja pod njom svaki poziv baca `logout_in_progress`. `versionchange` s `newVersion` null (brisanje) zatvara vezu i gasi auto-open; `populate` baca ako je instanca već otvarala bazu, pa zastarjeli tab ne stvara bazu ponovno. Instanca koja bazu nikad nije otvorila to ne može znati (granica zapisana u zaglavlju; F-5 mora koordinirati tabove).
- Blokirano brisanje: nakon `logoutBlockedTimeoutMs` (zadano 3 000) `logout_blocked`; ograda i zahtjev ostaju.
- Prijava: `hasPendingLogout()` istinit znači prekinutu odjavu; dovrši `destroyForLogout()`, pa napravi novu instancu. `saveLocal` pod ogradom baca `logout_in_progress`.
- Istek sesije nije odjava: journal se ne briše (BACKEND §4.3; ARCHITECTURE §4 t. 6).
- Nije izvedeno: poziv iz odjave, koordinacija tabova, poruka korisniku, uvjet "tek nakon provjerene potpisane potvrde" (zaglavlje to ostavlja za F-5).

## 11. Invarijante (dokument, test)

1. SYNCED tek uz potpisanu i provjerenu potvrdu ili izričitu odluku (adopt, discard). Izvor: ARCHITECTURE §5 t. 5; BACKEND §3 pravilo 3; STATE.md "Ne smije se izgubiti" F-3/F-8. Testovi: `drain.test.ts`, `drain.held-ack.test.ts`, `drain.late-answer.test.ts`, `serverSync/receipt-bridge.test.ts`, `states.test.ts`.
2. Osam stanja, bez općenitog "Spremljeno"; LOCAL_DURABLE nikad ne stoji umjesto SYNCED. Izvor: PRODUCT §5 "Rječnik sučelja"; zaglavlje `states.ts`. Testovi: `states.test.ts`, `labels.test.ts`.
3. CONFLICT i RECOVERY_REQUIRED ljepljivi, izlaz samo izričitom odlukom; reload ih ne briše; drain stoji. Izvor: zaglavlja `states.ts`, `restore.ts`, `drain.ts` (ustavno pravilo "bez tihog last-write-wins"; PRODUCT §5 ga ne navodi pod tim imenom, nema dokumentnog broja pravila). Testovi: `states.test.ts`, `restore.test.ts`, `drain.test.ts`, `atomic-dexie-journal.test.ts` (`sticky_state`).
4. Novi EDIT poništava tvrdnju o trajnosti; zakašnjeli ACK ne dokazuje novi tekst. Izvor: STATE.md F-3/F-8. Testovi: `drain.pending-receipt.test.ts`, `drain.late-answer.test.ts`, `local-document-saver.test.ts` ("ordering").
5. Snapshot, pending, localSeq i stanje u jednoj transakciji. Izvor: `journal-types.ts` (dossier §7); ARCHITECTURE §5 t. 1. Test: `atomic-dexie-journal.test.ts`.
6. Red se prepoznaje po dokumentu, localSeq i clientTransactionId, nikad po referenci. Izvor: `drain.ts` (DAN-110, DAN-135, #181); `ductus-sync-states` t. 5. Testovi: `drain.txid-reused.test.ts`, `drain.hardening.test.ts`.
7. Zadane vrijednosti zatvorene: `adoptServerEvents` bez `confirmed` ne daje događaj; `outcomeToEvents` bez ispravnog verifiera je FATAL; `verification` i `flight` su obvezni. Izvor: `drain.ts`. Testovi: `drain.test.ts`, `drain.hardening.test.ts`.
8. Klijent ne smišlja reviziju: `nextBaseRevision` je uvijek poslužiteljska. Izvor: zaglavlja `conflict.ts`, `recovery.ts`. Testovi: `conflict.test.ts`, `recovery.rebase.test.ts`.
9. Granica veličine dokumenta 1 MiB (UTF-8 bajtovi) provjerava se i na klijentu. Izvor: STATE.md B-8 "client/server size limit"; `contract.ts`. Test: `contract.test.ts` ("document size limit").
10. Nepoznat status ili oblik odgovora je `invalid`, nikad pogađanje; nepoznati ključevi se ignoriraju. Izvor: `contract.ts` (kod, bez dokumentne oznake). Test: `contract.test.ts` (malformed, prototype pollution).
11. Offline oznaka ostaje nakon sinkronizacije. Izvor: PRODUCT §5 pravilo 10. Test: nema, nije izvedeno.
12. Odjava s nesinkroniziranim radom blokirana; provjera i brisanje atomarni; zastarjeli tab ne stvara bazu. Izvor: ARCHITECTURE §10; PRODUCT §13 t. 13; BACKEND §4.3. Testovi: `atomic-dexie-journal.logout.test.ts`, `.logout-contract.test.ts`, `.logout-lifecycle.test.ts`.
13. Journal ne piše preko nepouzdanog ili tuđeg stanja: `corrupt` i `sticky` se ne prepisuju; `saveLocal` je CAS po `expectedLocalSeq` (`stale_local_sequence`). Izvor: zaglavlja savera i journala (#206), kod bez dokumentne oznake. Testovi: `local-document-saver.test.ts`, `local-document-saver.property.test.ts`, `local-document-saver.order.property.test.ts`.
14. Tekst sučelja samo u `labels.ts` i `serverSync/messages.ts`, hrvatski, bez zabranjenih izraza. Izvor: PRODUCT §5; CLAUDE.md. Testovi: `labels.test.ts`, `tests/unit/server-sync-messages.test.ts`, skener zabranjenih izraza.
15. Demo opseg journala samo uz zastavu i dopuštenu okolinu. Izvor: zaglavlje `local-scope.ts` (po uzoru na lažni OIDC, BACKEND §4.3). Test: `local-scope.test.ts`.

## 12. Kako napraviti promjenu

Opće: pročitaj `STATE.md`; jedan korak po PR-u (~400 redaka); svaki uvjet ima test koji pada kad se uvjet ukloni (TESTING §5); sintetički podaci (`ductus-synthetic-data`); `git add <putanje>`.

A. Novo stanje ili prijelaz: `SYNC_STATES`, `SyncEvent`, `SYNC_TRANSITIONS`; `SYNC_STATE_LABELS` se neće prevesti bez novog stanja, `SYNC_EVENT_TYPES` i `states.test.ts` (nabraja tablicu iscrpno) treba dopuniti; ažuriraj `restore.ts` ako je stanje prijelazno. Osam stanja je ustavna granica, pa novo stanje traži odluku vlasnika.
B. Nova vrsta odgovora poslužitelja: `COMMIT_STATUSES` i `parseCommitOutcome`, `outcomeToEvents`, `KEY_REFUSED` ili posebna grana u `nextAwaitingReceipt`, `isRetryable`. Testovi od sirovog JSON-a do stanja (obrazac `receipt-bridge.test.ts`) i modelski (`drain.*.model.test.ts`). Odgovori na pitanja: oslobađa li hold, smije li dati ACK.
C. Nova vrsta transakcije (delta): pravilo "najnoviji red nadomješta starije" u `planDrain` prestaje vrijediti; mijenjaju se `isSendable`, supersession i `consistent` u saveru. Prvo `ductus-attack-plan`.
D. Nova journal operacija (clearPending, rebaseLocal, adopt, hold oznaka): metoda u `AtomicDexieJournal` u jednoj transakciji, uz provjeru ograde `control.logout` i `incomplete_store`; nova shema je nova nedestruktivna `version(n)`; testovi u stilu `atomic-dexie-journal.test.ts`; stvarni preglednici po TESTING §2. `consistent` u saveru pretpostavlja da se pending ne briše u koraku 1 (zaglavlje); prilagodi ga.
E. Odjava ili brisanje: `ductus-local-storage-logout`; svaka promjena `fenceAndDelete`, `whileUsable` ili `versionchange`/`populate` kuke traži test u `logout*.test.ts`; granice tabova dokaži u pregledniku, ne samo u `fake-indexeddb`.
F. Tekst stanja ili poruke: samo `labels.ts` ili `messages.ts`, `ductus-ui-copy`, `labels.test.ts` ili `server-sync-messages.test.ts`.
G. Promjena ugovora s RPC-om: `contract.ts` ostaje oblik koji prepisani RPC mora zadržati; SQL strana ide kroz `docs/vodici/baza.md` i backend zadatak.

Risk (ENGINEERING_SYSTEM §5): putanje `src/domain/sync`, `src/domain/serverSync`, `src/lib/journal` nisu među segmentima koji sami dižu razinu na `critical`, pa putanja daje najmanje `standard` (runtime kod). Promjena uvjeta za SYNCED, provjere potvrde ili brisanja journala dira trust granicu i treba se deklarirati kao `critical` (QA PASS na headu). Svaka datoteka u `tests/` je najmanje `critical` po automatskom risk flooru; D-97 putanje (`.claude/`, `STATE.md`, `docs/DECISIONS.md`...) spajaju se tek na Danielovu naredbu.

## 13. Provjera

Iz `package.json`:
- `pnpm test:unit` (vitest projekt unit: `src/**/*.test.ts`, `tests/unit/**`; sve testove ovog područja osim property).
- `pnpm test:property` (`src/**/*.property.test.ts`; ovdje oba `local-document-saver.*property.test.ts`).
- Sužen poziv: `pnpm exec vitest run --project unit src/domain/sync` (ili `src/domain/serverSync`, `src/lib/journal`).
- `pnpm lint`, `pnpm typecheck`, `pnpm build`.
- Preglednici za journal i sync: Firefox i WebKit (TESTING §2); `pnpm test:e2e` danas ne pokriva journal (nema editora na `/rad`). Demo spec K-4 obvezan je do 1. 11. samo na Chromiumu (D-98 dopuna).

CI: posao `build` ("Lint, typecheck, test and build", `.github/workflows/ci.yml`) vrti lint, typecheck, `test:unit`, `test:property` i build. Posao `stack` (pgTAP, E2E) ne dira ovo područje. Adversarial scenariji TESTING §3 za područje: 1, 3, 4, 5, 6, 7, 8, 10, 11 (9 uz verzionirane rute); u IZVJEŠTAJU navedi koji su provjereni, a koji otvoreni. `fake-indexeddb` nije preglednik (`ductus-offline-recovery`, korak 7).

## 14. Zamke

- Dugi komentari u domeni opisuju ugovor s kodom koji ne postoji (journal operacije, drainRunner). Ne čitaj ih kao opis implementacije.
- `restore.ts` kaže da hold "nije trajan" (DAN-110, #183 napad 12), a `drain.ts` traži da ga journal zapiše prije slanja. Danas ne postoji ni jedno ni drugo; usklađuje se pri izgradnji runnera.
- `restoreSyncState` nikad ne vraća SYNCED bez snapshota i praznog reda; ne dodaj put do SYNCED mimo pravila iz odjeljka 7.
- Prijelazna stanja (SAVING_LOCAL, SYNCING) se ne obnavljaju; zapisanom stanju ne vjeruj više nego što journal stvarno drži.
- SYNC_ACK nema identitet: samo `outcomeToEvents` ga smije uskratiti za tuđi odgovor. Ne prosljeđuj zastavicu zapamćenu pri slanju (#181); red se čita u trenutku odgovora.
- Pozivi s izostavljenim argumentom (`verification`, `flight`, `confirmed`) moraju zatvoriti, ne otvoriti.
- `planDrain` ne pretpostavlja sortiranje, a `meta` može biti `null`.
- Svojstva `Object.prototype` ("toString", "constructor") ne smiju proći kao prijelaz ili status: `Object.hasOwn` i `ownProperty`.
- `unavailable` je običan ERROR (privatni prozor ne smije biti zamka); RECOVERY_REQUIRED je samo za `corrupt` i `txid_reused`. SYNC_FAILED uvijek ide u ERROR; `retryable` služi samo pravilu ponavljanja.
- Rebase i salvage proizvode NOV sadržaj: prvo journal, tek onda slanje.
- `saveLocal` ne smije izaći iz jedne transakcije; svaki novi `put` ide unutar nje.
- Tekst koji `storableDocument` odbija ne smije u journal (`src/editor/storable-text.ts`; JCS i jsonb granice).
- Dexieov zadani `versionchange` ostavlja auto-open; ne vraćaj ga.
- `chipContent`: `blocked` (druga kartica) pobjeđuje svako stanje.
- Sat, jitter i `nowFn` ubrizgavaj; testovi ne smiju ovisiti o stvarnom vremenu.

## 15. Otvoreno

- Gdje se čuva offline oznaka (PRODUCT §5 pravilo 10, F-8): nije u kodu, a potvrda v2 je ne nosi. Ne gradi bez odluke.
- Granulacija koraka u commitu i razmak kontrolnih točaka "oko 2.000 koraka" su [PRIJEDLOG] uz B0.3 (ARCHITECTURE §5).
- Dexie je u ARCHITECTURE §1 označen [PRIJEDLOG D-08]; D-08 je 11. 10. razdvojen (aplikacija ODLUČENA, dobavljači i trošak PRIJEDLOG do B0.1, STATE.md Owner queue). Provjeri `docs/DECISIONS.md` D-08 prije oslanjanja.
- ARCHITECTURE §5 (odsječci do 30 s, ingest ruta, jedan RPC za CAS i `reserve`) i kod (`REPLACE_DOCUMENT` s cijelim dokumentom, ugovor `pisac_commit_document`) opisuju dva različita oblika slanja; usklađivanje je zadaća M3/F-8, ne gradi na jednom bez provjere. BACKEND §3 pravilo 7 (API rute s verzijom protokola, `upgrade_required`) nije izvedeno.
- Otvoreni PR-ovi prema STATE.md: #206 i #214 (F-3 spremanje i Tiptap editor, #214 draft). Provjeri `gh pr list` i Linear prije rada.
- Journal zapisuje samo LOCAL_DURABLE; ostala stanja se u meta još ne pišu, a `restoreSyncState` ih ipak čita.
