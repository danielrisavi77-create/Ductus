# Jednakovrijednost testova prijenosa jezgre (M0.1)

Datum: 31. 10. 2026. · Korak M0.1 iz `docs/PROGRAM-RAZRADA.md` · DAN-376 · autor `claude:pl2:platforma`

Dopuna zapisa `docs/engineering/prijenos-jezgre-M0.1.md`, skupina C. Vlasnik je 31. 10. 2026. zamijenio kriterij „isti broj testova kao u izvoru” dokumentiranom jednakovrijednošću (#87 `issuecomment-6547174354`). Za svaki izvorni slučaj koji nije prenesen na istu putanju ovdje piše koji ga Ductus test pokriva ili zašto nije pokriven.

## Kako je rađeno

- Izvor: `pisac-editor@6cd0b75`, samo čitan. Slučaj je svaki poziv `it`/`test` u datoteci, i kad je u istom retku s `describe` (zato 273, a ne 271 kao u prvom brojanju po recima).
- Za svaki slučaj pročitano je tijelo izvornog testa i otvoren Ductus test na `main` (`0cdffe5f`). Za svaki redak „pokriveno” provjereno je da navedena datoteka postoji i da sadrži navedeno ime testa.
- Ime Ductus testa je tekst iz `it(...)`/`test(...)`; za pgTAP opis tvrdnje. Kad je ime predložak (`%s`, `${...}`), naveden je predložak.

Ishodi:

- **pokriveno**: Ductus test tvrdi isto ponašanje, i kad je sučelje drukčije. Napomena kaže kad je pokriće kroz drukčiji dizajn ili posredno.
- **nedostaje test**: ponašanje postoji u kodu Ductusa, a nijedan test ga ne tvrdi ili ga tvrdi samo djelomično. Ti slučajevi vraćaju se kao testovi (issue u opisu PR-a).
- **nema koda**: Ductus to ponašanje nema, jer je dizajn drukčiji ili funkcija još nije izgrađena. Test se ne može vratiti dok kod ne postoji.

## Zbroj

| Izvorna datoteka | Slučajeva | Pokriveno | Nedostaje test | Nema koda |
| --- | --- | --- | --- | --- |
| `src/lib/journal/journal.test.ts` | 100 | 39 | 14 | 47 |
| `src/lib/journal/lock.test.ts` | 9 | 3 | 2 | 4 |
| `src/lib/journal/recovery.test.ts` | 17 | 5 | 0 | 12 |
| `src/lib/sync/drainRunner.test.ts` | 40 | 27 | 0 | 13 |
| `src/editor/process-capture.test.ts` | 17 | 13 | 0 | 4 |
| `src/editor/process-capture-nodeids.test.ts` | 6 | 0 | 0 | 6 |
| `src/editor/process-capture-checkpoint.test.ts` | 2 | 1 | 0 | 1 |
| `src/lib/process-ledger/process-ledger.test.ts` | 8 | 5 | 0 | 3 |
| `src/lib/process-ledger/process-ledger-link.test.ts` | 5 | 4 | 0 | 1 |
| `src/lib/process-ledger/process-ledger-append.test.ts` | 1 | 1 | 0 | 0 |
| `src/domain/docx/labels.test.ts` | 7 | 0 | 0 | 7 |
| `src/domain/docx/manifest.test.ts` | 13 | 0 | 0 | 13 |
| `src/domain/docx/serialize.test.ts` | 15 | 0 | 0 | 15 |
| `src/lib/docx/export.test.ts` | 12 | 0 | 0 | 12 |
| `src/domain/forensics/evidence-v2-legacy-compat.test.ts` | 1 | 0 | 0 | 1 |
| `src/domain/forensics/verified-object-activity.test.ts` | 2 | 0 | 0 | 2 |
| `src/domain/forensics/verified-object-binding.test.ts` | 6 | 0 | 0 | 6 |
| `src/domain/forensics/verified-process-history.test.ts` | 4 | 2 | 0 | 2 |
| `src/lib/document/queries.test.ts` | 8 | 8 | 0 | 0 |
| **Ukupno** | **273** | **108** | **16** | **149** |

## Karta po datotekama

### `src/lib/journal/journal.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | opens the journal when IndexedDB is available | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: writes snapshot, pending, sequence and LOCAL_DURABLE atomically | Ductus nema openJournal; journal se otvara implicitno pri prvom pozivu i test to koristi. |
| 2 | reports 'unavailable' instead of throwing when IndexedDB is missing | pokriveno | `src/lib/journal/local-document-saver.test.ts`: 6: IndexedDB unavailable at load leaves the saver inert, never writing | Test simulira MissingAPIError (ono što Dexie baca bez IndexedDB-a), ne briše globalni indexedDB. |
| 3 | maps %s to %s | nedostaje test | `src/lib/journal/local-document-saver.test.ts`: maps journal and browser errors to visible reasons | Djelomično: Quota i DatabaseClosed su testirani; InvalidState nije. DataError, NotFound, Version i Upgrade u failureOf daju unknown, ne corrupt. |
| 4 | looks inside Dexie's wrapper (`inner`) | pokriveno | `src/lib/journal/local-document-saver.test.ts`: 5: a full quota is ERROR, stays visible while typing on, and a later save recovers | AbortError s inner QuotaExceededError daje failure quota. |
| 5 | follows a `cause` chain | nema koda | – | failureOf čita samo grešku i njezin inner; lanac cause se ne prati (src/lib/journal/local-document-saver.ts). |
| 6 | does not guess 'corrupt' for an unrecognised error | pokriveno | `src/lib/journal/local-document-saver.test.ts`: maps journal and browser errors to visible reasons | Provjereni null i nepoznati JournalError; string i undefined nisu u testu, ali idu istim putem. |
| 7 | terminates on a cyclic cause chain | nema koda | – | failureOf ne prati lanac cause, pa ciklusa nema. |
| 8 | assigns localSeq 1 to the first write of a document | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: writes snapshot, pending, sequence and LOCAL_DURABLE atomically | – |
| 9 | increments the local sequence on every write | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: keeps local sequences and reads separated by document ID | – |
| 10 | keeps sequences independent per document | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: keeps local sequences and reads separated by document ID | – |
| 11 | writes snapshot, pending row and meta together | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: writes snapshot, pending, sequence and LOCAL_DURABLE atomically | Ductus test koristi toMatchObject, ne puni toEqual retka. |
| 12 | records LOCAL_DURABLE, never SYNCED — nothing reached a server | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: writes snapshot, pending, sequence and LOCAL_DURABLE atomically | – |
| 13 | stores the base revision, not an invented server revision | pokriveno | `src/lib/journal/local-document-saver.test.ts`: the next write carries the revision the loaded snapshot holds (#206 qa206j MANJE) | – |
| 14 | replaces the snapshot but appends to the queue | pokriveno | `src/lib/journal/local-document-saver.test.ts`: 2, 3: a burst of saves never races its own sequence, and the newest text wins | Snimka je zadnji tekst, a red raste; broj snimki se ne broji izravno. |
| 15 | mints a fresh client transaction id per write (idempotency key) | nedostaje test | – | Journal odbija ponovljeni ključ (atomic-dexie-journal.test.ts), ali nijedan test ne provjerava da spremač bez ubrizganog generatora daje novi ključ za svaki zapis. |
| 16 | builds a REPLACE_DOCUMENT transaction — the only F1 mutation | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: rejects invalid documents, timestamps, base revisions and transaction kinds | saveLocal odbija drugu vrstu transakcije; EVIDENCE_SEGMENT ide kroz saveSegment. |
| 17 | clears a stale lastError once a write succeeds | nedostaje test | – | saveLocal piše meta iznova bez lastError, ali nijedan test to ne provjerava. |
| 18 | maps a %s during the write to '%s' | nedostaje test | `src/lib/journal/local-document-saver.test.ts`: 5: a full quota is ERROR, stays visible while typing on, and a later save recovers | Djelomično: quota i unknown su pokriveni; InvalidState pri pisanju nije testiran; DataError u Ductusu daje unknown, ne corrupt. |
| 19 | writes nothing at all when the transaction fails | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: rolls back the snapshot when pending.put fails after the first write | – |
| 20 | caps the pending queue at the newest PENDING_LIMIT rows | nema koda | – | Ductus nikad ne briše dugovane retke; na granici staje fail-closed (local-document-saver.test.ts "7: the queue stops fail-closed at its bound..."). |
| 21 | keeps the local sequence advancing past the cap | nema koda | – | Nema obrezivanja reda, pa nema ni slijeda preko granice; red staje na granici. |
| 22 | trims only the document being written | nema koda | – | Nema obrezivanja reda ni u jednom dokumentu. |
| 23 | leaves a queue under the cap alone | pokriveno | `src/lib/journal/local-document-saver.test.ts`: 7: the queue stops fail-closed at its bound and says so before it gets there | Ispod granice svi retci ostaju (5 od 5). |
| 24 | saves a 200-paragraph document ten times well inside a coarse ceiling | nedostaje test | `src/lib/journal/local-document-saver.test.ts`: 8: one save of ${count} words stays well inside the debounce window | Djelomično: Ductus mjeri jedno veliko spremanje; deset uzastopnih spremanja (trošak po pisanju) nije mjereno. |
| 25 | leaves the previous durable state intact when a later write aborts | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: rejects a reused transaction ID without changing the durable state | Kasnije neuspjelo pisanje ostavlja prethodno stanje; prekid usred transakcije pokriva "rolls back the snapshot when pending.put fails after the first write". |
| 26 | returns empty contents for a document that was never saved | pokriveno | `src/lib/journal/local-document-saver.test.ts`: an empty journal loads as an empty document without writing | – |
| 27 | round-trips the snapshot, the queue and meta | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: survives a close/reopen while retaining the owed transaction | – |
| 28 | returns the queue ascending by local sequence | pokriveno | `src/lib/journal/local-document-saver.test.ts`: 2, 3: a burst of saves never races its own sequence, and the newest text wins | – |
| 29 | never leaks another document's rows | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: keeps local sequences and reads separated by document ID | – |
| 30 | maps a read failure to a typed reason | pokriveno | `src/lib/journal/local-document-saver.test.ts`: 6: IndexedDB unavailable at load leaves the saver inert, never writing | Mapiranje je u saveru, ne u journalu. |
| 31 | drops the acknowledged prefix only | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: with newer rows queued the prefix goes, the hold is released and SYNCED is refused | clearPending je u Ductusu dio recordAnswer. |
| 32 | is a no-op when nothing is acknowledged yet | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: pending signature keeps the hold and the row | – |
| 33 | is idempotent for a repeated ACK | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: a late answer for a settled row neither deletes, releases nor moves the base back | – |
| 34 | keeps the local sequence as a high-water mark | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: a later local save keeps the acknowledged base instead of the editor's older one | Posredno: spremanje s očekivanim localSeq 1 nakon praznog reda uspije samo ako slijed nije vraćen. |
| 35 | never touches another document's queue | nedostaje test | – | recordAnswer briše samo retke svog dokumenta, ali nijedan sync test nema drugi dokument. |
| 36 | leaves the snapshot in place | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: a verified receipt deletes the row, moves the base and allows SYNCED | – |
| 37 | maps a failure to a typed reason | nema koda | – | Ductus journal baca JournalError ili izvornu grešku; ne vraća tipizirani razlog za ovu operaciju. |
| 38 | records a state for a document with no journal rows yet | nema koda | – | Nema markState; stanje se piše samo uz spremanje ili odgovor, a dokument bez zapisa daje not_queued. |
| 39 | preserves the local sequence | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: writes the marker and SYNCING before the request leaves, and a reload replays that row | Posredno: spremanje s očekivanim localSeq 1 nakon beginSend uspije. |
| 40 | clears lastError when no reason is given | nema koda | – | Nema markState, a journal sam nikad ne upisuje lastError. |
| 41 | does not touch the snapshot or the queue | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: SYNCED is refused without a verified receipt, and nothing is deleted | Promjena stanja (SYNCING) ostavlja red i reviziju snimke. |
| 42 | maps a failure to a typed reason | nema koda | – | Nema markState; operacije stanja bacaju grešku umjesto tipiziranog razloga. |
| 43 | brings %s back after the tab is closed and re-opened | nedostaje test | `src/lib/journal/atomic-dexie-journal.test.ts`: keeps sticky CONFLICT and RECOVERY_REQUIRED until explicit recovery | Djelomično: ljepljivo stanje i ponovno otvaranje testirani su odvojeno; nijedan test ne zatvara i ponovno otvara journal u CONFLICT ili RECOVERY_REQUIRED. |
| 44 | does not downgrade a recorded conflict to LOCAL_DURABLE | pokriveno | `src/domain/sync/restore.test.ts`: keeps %s sticky whatever else the journal holds | – |
| 45 | resumes LOCAL_DURABLE after an ordinary save | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: writes snapshot, pending, sequence and LOCAL_DURABLE atomically | – |
| 46 | starts a never-saved document in EDITING | pokriveno | `src/lib/journal/local-document-saver.test.ts`: an empty journal loads as an empty document without writing | – |
| 47 | lets a successful save clear a recorded ERROR | nedostaje test | – | saveLocal upisuje LOCAL_DURABLE i preko spremljenog ERROR, ali nema testa sa zapisanim ERROR pa spremanjem. |
| 48 | moves the snapshot onto the revision the server named | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: a verified receipt deletes the row, moves the base and allows SYNCED | markSynced je u Ductusu recordAnswer s potpisanom potvrdom. |
| 49 | leaves the candidate itself untouched | nedostaje test | – | recordAnswer mijenja samo reviziju snimke, ali nijedan test ne provjerava da tekst snimke ostaje isti. |
| 50 | refuses to claim SYNCED while rows are still owed to the server | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: with newer rows queued the prefix goes, the hold is released and SYNCED is refused | – |
| 51 | keeps the local sequence as a high-water mark | pokriveno | `src/lib/journal/atomic-dexie-journal.sync.test.ts`: a later local save keeps the acknowledged base instead of the editor's older one | Posredno preko CAS-a na localSeq. |
| 52 | refuses a revision that is not a whole, safe number | nedostaje test | – | Revizija dolazi iz provjerene potvrde (ackedRevision); nema testa da journal odbija reviziju 1.5 ili -1. |
| 53 | writes meta even when nothing was ever journalled locally | nema koda | – | recordAnswer traži zapis dokumenta (not_queued); SYNCED se piše samo uz brisanje potvrđenog retka. |
| 54 | maps a failing store to a reason instead of throwing | nema koda | – | recordAnswer baca grešku; nema tipiziranog rezultata. |
| 55 | adds `conflicts` to an existing v1 journal without losing its rows | nema koda | – | Ductus nema spremište conflicts; čuvanje v1 redaka pokriva atomic-dexie-journal.logout.test.ts "upgrades a populated v1 journal without losing snapshot and pending queue". |
| 56 | opens a fresh journal straight at v2 with all four stores | nedostaje test | – | Ductus je na verziji 4 s drugim spremištima; nijedan test ne provjerava verziju i popis spremišta svježeg journala (evidence test 8 provjerava samo nadogradnju). |
| 57 | stores a conflict and reads it back unresolved | nema koda | – | Ductus ne sprema zapise sukoba u journal; ConflictRecord postoji samo u src/domain/sync/conflict.ts i nigdje se ne koristi. |
| 58 | returns null when the document has no conflict | nema koda | – | Nema spremišta sukoba ni čitanja neriješenog sukoba. |
| 59 | keeps conflicts of different documents apart | nema koda | – | Nema spremišta sukoba. |
| 60 | keeps a second conflict as a second row, overwriting nothing | nema koda | – | Nema spremišta sukoba. |
| 61 | re-recording the same detection is idempotent | nema koda | – | Nema spremišta sukoba. |
| 62 | stores a conflict whose server document could not be fetched | nema koda | – | Nema spremišta sukoba; čista funkcija je u conflict.test.ts "accepts a missing server document: a failed fetch is still a conflict". |
| 63 | maps a failing store to a reason instead of throwing | nema koda | – | Nema spremišta sukoba. |
| 64 | records the decision and KEEPS the row | nema koda | – | Nema spremišta sukoba; odluka ide kroz adoptServerEvidence, a lokalni tekst ostaje kao kopija (salvage). |
| 65 | keeps both versions on the resolved row | nema koda | – | Nema spremišta sukoba; čista funkcija je u conflict.test.ts "keeps both versions on the resolved record". |
| 66 | takes the conflict out of the unresolved set | nema koda | – | Nema spremišta sukoba. |
| 67 | resolves the newest unresolved conflict and leaves older rows alone | nema koda | – | Nema spremišta sukoba. |
| 68 | is a no-op, not a failure, when nothing is unresolved | nema koda | – | Nema spremišta sukoba. |
| 69 | maps a failing store to a reason instead of throwing | nema koda | – | Nema spremišta sukoba. |
| 70 | keeps every resolved conflict up to the limit | nema koda | – | Nema povijesti riješenih sukoba ni njezine granice. |
| 71 | trims to the newest 20 resolved rows, dropping the oldest | nema koda | – | Nema povijesti riješenih sukoba. |
| 72 | never trims an UNRESOLVED row, however many there are | nema koda | – | Nema povijesti riješenih sukoba. |
| 73 | counts per document, so one document's history cannot evict another's | nema koda | – | Nema povijesti riješenih sukoba. |
| 74 | fills in a server document that could not be fetched at detection time | nema koda | – | Nema spremišta sukoba ni naknadnog osvježavanja poslužiteljske strane. |
| 75 | leaves the row untouched when the fetch comes back empty | nema koda | – | Nema spremišta sukoba. |
| 76 | treats a throwing fetch as no answer at all | nema koda | – | Nema spremišta sukoba. |
| 77 | does not resurrect a resolved conflict | nema koda | – | Nema spremišta sukoba. |
| 78 | replaces the snapshot, empties the queue and records SYNCED | pokriveno | `src/lib/sync/evidence-recovery.test.ts`: 2: a confirmed take: the server's text, revision and head, the local text kept, nothing owed | U Ductusu samo za dokument s dokazima (adoptServerEvidence). |
| 79 | keeps the local sequence as a high-water mark | pokriveno | `src/lib/sync/evidence-recovery.test.ts`: 2: a confirmed take: the server's text, revision and head, the local text kept, nothing owed | Ductus slijed povećava za 1, ne vraća ga. |
| 80 | refuses a revision that is not a whole, non-negative number | nedostaje test | – | verifyOpening odbija necijelu i negativnu reviziju, ali test provjerava samo reviziju iza snimke. |
| 81 | leaves another document's queue alone | nedostaje test | – | adoptServerEvidence briše samo retke svog dokumenta, ali nema testa s drugim dokumentom. |
| 82 | maps a failing store to a reason instead of throwing | nema koda | – | adoptServerEvidence baca grešku; povrat stanja pri kvaru pokriva evidence-recovery.test.ts "6: a failure writing %s leaves the document in CONFLICT with its rows". |
| 83 | refuses an ordinary candidate while meta records CONFLICT | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: keeps sticky CONFLICT and RECOVERY_REQUIRED until explicit recovery | – |
| 84 | writes nothing at all when it refuses | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: keeps sticky CONFLICT and RECOVERY_REQUIRED until explicit recovery | – |
| 85 | refuses while meta records RECOVERY_REQUIRED too | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: keeps sticky CONFLICT and RECOVERY_REQUIRED until explicit recovery | – |
| 86 | allows ordinary candidates in every other state | nedostaje test | – | Djelomično: spremanje nakon SYNCING i SYNCED je testirano; nakon zapisanog ERROR nije. |
| 87 | lets rebaseLocal through: the rebase IS the decision | nema koda | – | Journal nema rebaseLocal; jedini izlaz iz ljepljivog stanja je adoptServerEvidence. |
| 88 | maps a genuinely failing store to a reason, not to 'state-locked' | pokriveno | `src/lib/journal/local-document-saver.test.ts`: maps journal and browser errors to visible reasons | Quota daje quota, sticky_state daje corrupt. |
| 89 | gives a second conflict in the same millisecond its own row | nema koda | – | Nema spremišta sukoba. |
| 90 | never replaces a row that already carries a decision | nema koda | – | Nema spremišta sukoba. |
| 91 | stays idempotent for a byte-identical re-record | nema koda | – | Nema spremišta sukoba. |
| 92 | resolves exactly the record the panel decided about | nema koda | – | Nema spremišta sukoba. |
| 93 | falls back to the newest unresolved record when none is named | nema koda | – | Nema spremišta sukoba. |
| 94 | does nothing when the named record is already resolved | nema koda | – | Nema spremišta sukoba. |
| 95 | refreshes the server side of the named record only | nema koda | – | Nema spremišta sukoba. |
| 96 | rebuilds a record from the frozen queue and a fresh server read | nema koda | – | Nema recoverConflict ni spremišta sukoba. |
| 97 | falls back to the snapshot when the queue is empty | nema koda | – | Nema recoverConflict. |
| 98 | describes nothing when the server cannot be read | nema koda | – | Nema recoverConflict. |
| 99 | describes nothing when the journal holds nothing for the document | nema koda | – | Nema recoverConflict. |
| 100 | maps a failing store to a reason instead of throwing | nema koda | – | Nema recoverConflict. |

### `src/lib/journal/lock.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | namespaces the lock per document | nedostaje test | – | Ime brave ductus-journal:{scope}:{documentId} postoji u src/components/editor/LocalDocument.tsx, ali ga nijedan test ne provjerava. |
| 2 | grants the lock to the first caller | pokriveno | `e2e/local-editor.spec.ts`: 4: a second tab is read-only and blocked, and takes over once the first closes | Prva kartica dobiva bravu i piše u journal. |
| 3 | refuses a second holder instead of queueing behind the first | pokriveno | `e2e/local-editor.spec.ts`: 4: a second tab is read-only and blocked, and takes over once the first closes | Druga kartica odmah dobiva odbijenicu (ifAvailable) i stanje blocked. Razlika: Ductus nakon toga namjerno čeka bravu. |
| 4 | hands the lock on once the holder releases it | pokriveno | `e2e/local-editor.spec.ts`: 4: a second tab is read-only and blocked, and takes over once the first closes | Kad se prva kartica zatvori, druga preuzima bravu i piše. |
| 5 | keeps different documents independent | nedostaje test | – | Brava je po dokumentu u LocalDocument.tsx, ali nema testa s dva dokumenta otvorena istodobno. |
| 6 | falls back to writing when the API is missing | nema koda | – | Ductus bez Web Locks ne piše nego prikazuje unavailable (LocalDocument.tsx, provjera navigator.locks); namjerno fail-closed. |
| 7 | falls back to writing when the manager rejects | nema koda | – | Ductus kod odbijene brave prikazuje unavailable i ne piše; suprotno ponašanje testira e2e/local-editor.spec.ts "a refused wait for the lock tells the author instead of staying blocked". |
| 8 | survives a repeated release | nema koda | – | Ductus nema zaseban omotač brave s release(); bravu drži izvorni navigator.locks callback u LocalDocument.tsx. |
| 9 | is a no-op release when the lock was refused | nema koda | – | Nema omotača s release() za odbijenu bravu; odbijeni pozivatelj u izvornom Web Locks API-ju nema što otpustiti. |

### `src/lib/journal/recovery.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | offers both versions when the journal still reads and the server answers | pokriveno | `src/domain/sync/recovery.test.ts`: always returns both options, in recommended-first order | Pokriveno samo planiranje (planRecovery). Ductus nema I/O omotač attemptJournalRecovery koji čita journal i poslužitelj. |
| 2 | offers the server's version only when the store cannot be opened at all | pokriveno | `src/domain/sync/recovery.test.ts`: offers only the server's version, and recommends it, when the journal cannot be read at all | Vraćeno u #1185. Pokriveno samo planiranje (planRecovery), kao u retku 1. |
| 3 | still salvages the queue when the snapshot table throws | nema koda | – | Ductus čita journal u jednoj transakciji (AtomicDexieJournal.read); nema djelomičnog čitanja po tablici. Pokvaren sadržaj snimke pokriva "salvages the newest pending transaction when the snapshot is corrupt". |
| 4 | still salvages the snapshot when the pending table throws | nema koda | – | Nema djelomičnog čitanja po tablici. Pokvaren red u redu čekanja pokriva "falls back to the snapshot when the queued transaction is corrupt" u src/domain/sync/recovery.test.ts. |
| 5 | reports an entirely unreadable store as unreadable, not as empty | pokriveno | `src/domain/sync/recovery.test.ts`: reports an unreadable journal as unreadable, never as empty | Preporuka null za isti ulaz je u "recommends nothing when neither version can be offered". |
| 6 | says a readable but empty journal is empty | pokriveno | `src/domain/sync/recovery.test.ts`: reports a readable but empty journal as empty | – |
| 7 | treats a throwing server read as no answer at all | nema koda | – | Ductus nema kod koji čita poslužitelj za oporavak; planRecovery prima već gotov null ("refuses to adopt when the server could not be read"). |
| 8 | writes the salvaged document back even though the journal is frozen | nema koda | – | Ductus iz CONFLICT i RECOVERY_REQUIRED izlazi samo preuzimanjem verzije poslužitelja, a lokalni tekst čuva kao kopiju (evidence-recovery.test.ts, ugovor #476); saveLocal u ljepljivom stanju odbija se (sticky_state). |
| 9 | recreates the database when there is none to write to | nema koda | – | Ductus ne briše i ne stvara bazu ponovno pri oporavku; bez IndexedDB-a prikazuje unavailable. |
| 10 | refuses a salvage the plan does not offer | nema koda | – | Ne postoji izvršitelj salvage-local ni podjela na plan i izvršenje. |
| 11 | adopts the server's document in one transaction and empties the queue | pokriveno | `src/lib/sync/evidence-recovery.test.ts`: 2: a confirmed take: the server's text, revision and head, the local text kept, nothing owed | Samo za dokumente s dokazima (adoptServerEvidence). Atomičnost pokriva "6: a failure writing %s leaves the document in CONFLICT with its rows". |
| 12 | re-reads the server and refuses rather than adopting a stale plan | nema koda | – | adoptServerEvidence prima otvaranje od pozivatelja i ne čita poslužitelj ponovno; nema plana koji bi zastario. Srodno: "2b: in CONFLICT the server's version must reach the revision the conflict named". |
| 13 | takes the revision from the fresh read, not from the plan | nema koda | – | Nema plana ni ponovnog čitanja; revizija dolazi iz otvaranja koje pozivatelj preda adoptServerEvidence. |
| 14 | refuses an adoption the plan does not offer | nema koda | – | Nema plana; adoptServerEvidence odbija iz drugih razloga ("5: refusals write nothing", npr. not_in_recovery). |
| 15 | recreates the database when there is none, then adopts | nema koda | – | Ductus ne stvara bazu ponovno pri oporavku. |
| 16 | refuses a choice that is not one of the two | nema koda | – | Nema API-ja koji prima izbor kao niz; preuzimanje poslužitelja je jedina metoda (adoptServerEvidence). |
| 17 | deletes everything the store held and opens an empty one | nema koda | – | Nema resetJournalDatabase; brisanje baze postoji samo pri odjavi (destroyForLogout), što je drugo ponašanje. |

### `src/lib/sync/drainRunner.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | sends the queued transaction, ACKs it, clears it and bumps the revision | pokriveno | `src/lib/sync/drain-runner.test.ts`: a verified receipt for the only row ends in SYNCED with an empty queue | Da se localSeq ne vraća unatrag, provjerava se posredno u atomic-dexie-journal.sync.test.ts "a later local save keeps the acknowledged base instead of the editor's older one". |
| 2 | sends only the newest pending row and clears the superseded ones | pokriveno | `src/lib/sync/drain-runner.test.ts`: older rows behind the newest one are superseded and never sent | – |
| 3 | drains rows a previous session left behind, with no local save at all | pokriveno | `src/lib/sync/drain-runner.test.ts`: after a reload mid-flight the held row goes out again before any newer one | Novi runner nad ponovno otvorenim journalom šalje zaostali red bez novog spremanja. Ductus runner nema vlastiti timer. |
| 4 | drains again after a later local save | pokriveno | `src/components/editor/evidence-session.test.ts`: SYNCING shows while the request is in flight and SYNCED follows the receipt | Sesija se učita s praznim redom, a kasnije spremanje pokreće slanje. |
| 5 | does nothing at all when the queue is empty | pokriveno | `src/domain/sync/drain.test.ts`: sends nothing when the queue is empty | Runner za prazan red vraća idle (zadnji korak u drain-runner.test.ts "a verified receipt for the only row ends in SYNCED with an empty queue"). |
| 6 | treats a duplicate as an ACK: the replay found the commit already there | pokriveno | `src/components/editor/evidence-session.test.ts`: 12: a duplicate with a valid receipt is SYNCED; one with a forged receipt is not | U Ductusu duplicate je ACK samo uz provjerenu potpisanu potvrdu. |
| 7 | replays the very same idempotency key after a transport failure | pokriveno | `src/lib/sync/drain-runner.test.ts`: a lost answer replays the same key after the backoff, never a newer row | – |
| 8 | books 1s, 2s then 4s after consecutive transport errors | pokriveno | `src/domain/sync/drain.txid-reused.test.ts`: 7: a lost answer waits, the wait grows, and a new EDIT does not reset it | Niz 1s, 2s, 4s… je u drain.test.ts "doubles: 1s, 2s, 4s, 8s, 16s". Runner poštuje raspored (drain-runner.test.ts, stanje "waiting"). |
| 9 | keeps the queue while the server is unreachable | pokriveno | `src/lib/sync/evidence-drain.test.ts`: 2: a lost answer replays row 1 with the same key and bytes; row 2 waits for its receipt | – |
| 10 | treats a commit that throws as a transport error, not a crash | pokriveno | `src/lib/sync/drain-runner.test.ts`: a lost answer replays the same key after the backoff, never a newer row | Transport baca Error("offline"); runner daje ERROR i ponavlja bez ručnog koraka. |
| 11 | resets the backoff after a success | pokriveno | `src/lib/sync/drain-runner.test.ts`: after a success the backoff starts again from 1s, not from where the last failures left it | Vraćeno u #1185. |
| 12 | a new local save preempts a long backoff instead of waiting it out | nema koda | – | Namjerno suprotno: novo spremanje ne resetira čekanje (scheduleAfterOutcome u drain.ts; test "7: a lost answer waits, the wait grows, and a new EDIT does not reset it"). |
| 13 | stops on a stale base and leaves the queue for the author to resolve | pokriveno | `src/lib/sync/evidence-drain.test.ts`: 11: %s is CONFLICT; the row stays and nothing more is sent | – |
| 14 | stays stopped after a stale base even when the author keeps saving | pokriveno | `src/components/editor/evidence-session.test.ts`: 13: a 409 stale_base is CONFLICT; nothing more is saved or sent | U Ductusu se u stanju CONFLICT ni ne sprema novi red. |
| 15 | stops on a non-retryable server answer and books no retry | pokriveno | `src/components/editor/evidence-session.test.ts`: 16: 413 and 426 are sent once in ten simulated minutes | Na razini runnera: drain-runner.test.ts "a fatal answer waits for a manual retry; a fresh runner after reload tries once by itself". |
| 16 | tries again once the author has saved something new after a fatal answer | pokriveno | `src/lib/sync/drain-runner.test.ts`: after a fatal answer a new local save goes out by itself, without a manual retry | Vraćeno u #1185. Odluku i dalje tvrdi i planDrain (drain.lost-response.test.ts "11b: ... lets a new version out"). |
| 17 | still drains content saved while a fatal attempt was in flight | pokriveno | `src/lib/sync/drain-runner.test.ts`: a local save made while a fatal attempt is in flight still goes out after the refusal | Vraćeno u #1185. |
| 18 | does not resume mid-flight saves after a stale base — the author decides | pokriveno | `src/lib/sync/drain-runner.test.ts`: stale_base and txid_reused stop the drain until the author decides | U Ductusu zastoj ovisi o stanju CONFLICT, a ne o oznaci spremanja tijekom slanja. Nema testa baš sa spremanjem tijekom slanja. |
| 19 | never drains a document the journal records as being in CONFLICT | pokriveno | `src/domain/sync/drain.test.ts`: refuses to drain while the document is in CONFLICT | – |
| 20 | coalesces a burst of local saves into one drain | pokriveno | `src/lib/sync/drain-runner.test.ts`: older rows behind the newest one are superseded and never sent | Šalje se samo najnoviji red. Ductus runner nema timer za spajanje; dokazi (segmenti) se namjerno ne spajaju. |
| 21 | never runs two ticks at once, and comes back for what arrived mid-flight | pokriveno | `src/lib/sync/drain-runner.test.ts`: two steps for one document never overlap | Povratak po novi red: "an ack with a newer row queued moves the base, withholds SYNCED and sends the next row on it". |
| 22 | fast-forwards a row queued mid-flight onto the revision our own ACK named | pokriveno | `src/lib/sync/drain-runner.test.ts`: an ack with a newer row queued moves the base, withholds SYNCED and sends the next row on it | – |
| 23 | records LOCAL_DURABLE, not SYNCED, while newer rows are still owed | pokriveno | `src/lib/sync/drain-runner.test.ts`: a local save during the flight keeps the new row owed and the state off SYNCED | Točno LOCAL_DURABLE: "a local save between the answer's read and its write is not swallowed by SYNCED". |
| 24 | stop() cancels the booked tick, so nothing is ever sent | pokriveno | `src/components/editor/evidence-session.test.ts`: close() stops recording, saving and sending | – |
| 25 | stop() mid-flight drops the answer: no event, no journal write | nema koda | – | Ductus namjerno pušta da korak u letu završi i zapiše odgovor (pause pa settled; evidence-session.test.ts "14: ..."). |
| 26 | ignores notifyLocalSave after stop() | pokriveno | `src/components/editor/evidence-session.test.ts`: close() stops recording, saving and sending | – |
| 27 | records the conflict BEFORE the state machine is told about it | nema koda | – | Journal nema tablicu sukoba i runner ne zapisuje zapis sukoba; buildConflictRecord u src/domain/sync/conflict.ts nije spojen. |
| 28 | keeps both versions, the stale base and the server's revision | nema koda | – | Nema zapisa sukoba ni dohvata dokumenta poslužitelja. Lokalni red ostaje u redu čekanja, a meta.conflictRevision čuva samo reviziju. |
| 29 | still records the conflict when the server document cannot be fetched | nema koda | – | Nema dohvata dokumenta poslužitelja pri sukobu ni zapisa sukoba. |
| 30 | treats a throwing fetch as no answer, not as a crash | nema koda | – | Nema dohvata poslužitelja pri sukobu. |
| 31 | records a conflict even with no fetcher wired at all | nema koda | – | Nema zapisa sukoba ni dohvatnika. |
| 32 | leaves the queue alone: nothing is resolved on the author's behalf | pokriveno | `src/lib/sync/evidence-drain.test.ts`: 11: %s is CONFLICT; the row stays and nothing more is sent | – |
| 33 | records a second conflict as a second row when one is raised again | nema koda | – | Nema tablice sukoba. |
| 34 | resumes only on an explicit resolution, never on a new save | pokriveno | `src/components/editor/evidence-session.test.ts`: 13: a 409 stale_base is CONFLICT; nothing more is saved or sent | Izričita odluka u Ductusu je preuzimanje poslužitelja, nakon čega slanje teče dalje: evidence-recovery.test.ts "4: after the take the chain continues the server's head, on the server's revision". |
| 35 | is a no-op when the runner is not halted on a conflict | pokriveno | `src/lib/sync/evidence-recovery.test.ts`: 5: refusals write nothing | Nema resumeAfterConflict; analogno se preuzimanje izvan oporavka odbija (not_in_recovery) i ništa ne zapisuje. |
| 36 | does not resume a runner that has been stopped | nema koda | – | Runner nema stop ni resumeAfterConflict; životni ciklus vodi EvidenceSession. |
| 37 | reports both versions' coordinates when the conflict was recorded | nema koda | – | Nema onConflict ni ConflictDetail; sučelje vidi samo stanje CONFLICT. |
| 38 | still reports the server revision when the record could not be written | nema koda | – | Nema onConflict ni zapisa sukoba. |
| 39 | reports the fetched revision when it is ahead of the refusal's | nema koda | – | Nema dohvata poslužitelja pri sukobu ni onConflict. |
| 40 | says nothing to a runner that has been stopped | nema koda | – | Nema onConflict. |

### `src/editor/process-capture.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | starts from the existing snapshot without inventing typing events | pokriveno | `src/lib/journal/atomic-dexie-journal.evidence.test.ts`: 13: startEvidence sets snapshot, revision and head; again only on an empty queue | Postojeći tekst je snimka s otvaranja; glava je prazna (localSeq 0, segmentHash null), nema izmišljenih događaja. |
| 2 | records exact committed text steps, including Croatian and emoji text | pokriveno | `src/editor/capture.test.ts`: Croatian letters and emoji are recorded as typed and replay to the same text | Snima hrvatska slova, emoji izvan BMP-a i modifikator boje kože, reproducira ih na replayeru poslužitelja i provjerava tekst snimke. Hrvatska slova pokriva i `src/editor/source.test.ts`: a trusted keydown and insertText %j is editor. |
| 3 | distinguishes observed paste from unknown-origin editor changes | pokriveno | `src/editor/source.test.ts`: a spelling replacement and a paste are taken by their first change only; a program's transaction and a toolbar click are unattributed | Ductus razlikuje paste od unattributed. |
| 4 | records a composition transaction without labelling it human authorship | pokriveno | `src/editor/source.test.ts`: IME composition and its end are keyless-input, never composition | Ductus kompoziciju svjesno bilježi kao keyless-input; zatvoren skup izvora bez procjene autorstva (evidence-segment-v2.test.ts: has a closed set of sources...). |
| 5 | replays deletions, marks, paragraph splits and actual undo/redo steps | pokriveno | `src/editor/capture.test.ts`: typing, Enter, deleting, joining, bold and a heading; `src/editor/capture.property.test.ts`: 200 seeds of 30 actions | Svojstveni test uključuje Undo i Redo i uspoređuje reproducirani dokument s uređivačem. |
| 6 | captures appended transactions rather than silently losing them | pokriveno | `src/editor/source.test.ts`: three paragraphs and a heading with bold and italic, without ids, are one paste event with the appended steps | Također capture.test.ts: a block made by Enter gets its id through an attr step of the same change. |
| 7 | ignores selection-only transactions | pokriveno | `src/editor/source.test.ts`: a selection change takes nothing, and the data is dropped with the change | recordWithSource vraća null bez docChanged; test traži samo jedan izvor nakon dviju promjena odabira. |
| 8 | serializes immediately so later transaction mutation cannot change evidence | pokriveno | `src/editor/capture.test.ts`: a transaction changed after it was recorded does not change the segment | Drukčiji dizajn: Ductus ne serijalizira odmah, nego changeOf kopira korake i dokumente u vlastite nizove; koraci ProseMirrora su nepromjenjivi. Test nakon snimanja isprazni nizove transakcija, a segment se i dalje reproducira u isti dokument. |
| 9 | rejects a missing transaction instead of re-starting history | pokriveno | `src/editor/capture.test.ts`: a change that does not start where the last one ended is a gap, and nothing more is recorded | Također evidence-session.test.ts: 3: a gap saves uncovered once; later saves never take, chain, start or send. |
| 10 | checks the actual document at stop, even if the missing change was last | pokriveno | `src/components/editor/evidence-session.test.ts`: 3b: a change the recorder never saw, made last before the save, is a gap as well | Provjera je pri spremanju (evidence-session.ts uspoređuje zadnji dokument lanca s uređivačem), a ne pri zaustavljanju. Neviđena promjena je zadnja prije spremanja. |
| 11 | fails visibly at the event budget without silently trimming | nema koda | – | Ductus nema granicu broja događaja po sesiji; dijeli na segmente (MAX_SEGMENT_EVENTS 5000, 30 s, D-96). Podjela na 5000 događaja nema test; granica veličine je u testu too_large. |
| 12 | bounds queued snapshots while hashing is delayed | nema koda | – | Ductus nema red snimaka koje čekaju sažetak; sažetak se računa tek u takeSegment (capture.ts). |
| 13 | does not let a broken UI observer abort the editor transaction | nema koda | – | EvidenceRecorder nema povratni poziv za sučelje (onChange); stanje se čita iz sesije. |
| 14 | hash failures do not become a verified session | pokriveno | `src/editor/capture.test.ts`: removing half of a surrogate pair is CaptureError unsupported_step, and stops the recorder | Drugi uzrok (sažetak se ne može izračunati), ali isto ponašanje: nema segmenta, snimač stane. Kvar samog Web Cryptoa nije zaseban test. |
| 15 | preserves sequence order while hashes are pending | nema koda | – | Nema sažetaka na čekanju; slijed se dodjeljuje pri gradnji segmenta. Neprekinut slijed provjerava capture.test.ts: a pause over 400 ms or another source closes an event; the chain holds. |
| 16 | detects a changed step, removed tail, altered snapshot and receipt | pokriveno | `src/application/evidence/evidence-thin-slice.test.ts`: fails replay when the steps do not produce the recorded document hash; fails verification for %s (the last segment removed; a receipt that belongs to another segment); reports %s as a break at the start, never a match (a caller that starts from another document) | Pokriveno na razini lanca segmenata, ne jednog paketa. |
| 17 | requires valid replay positions rather than silently clamping | pokriveno | `src/application/evidence/replay-reader.test.ts`: answers an index outside the record like a document that does not exist | Indeksi -1, iza kraja, 0.5 i NaN daju not_found, bez stezanja. |

### `src/editor/process-capture-nodeids.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | binds an insertion to the stable paragraph node id | nema koda | – | Snimač ne računa touchedNodeIds (capture.ts); identitet bloka ide kroz nodeId i attr korake. |
| 2 | binds a mapless formatting step to the stable paragraph node id | nema koda | – | Snimač ne računa touchedNodeIds (capture.ts). |
| 3 | does not attribute deletion of one whole block to its untouched neighbor | nema koda | – | Snimač ne računa touchedNodeIds (capture.ts). |
| 4 | binds a deletion spanning two blocks to both stable ids | nema koda | – | Snimač ne računa touchedNodeIds (capture.ts). |
| 5 | returns no invented id when the touched node has no stable nodeId | nema koda | – | Snimač ne računa touchedNodeIds; blok bez id-a Ductus odbija (block_identity), ne izmišlja id. |
| 6 | verification rejects forged touched-node metadata | nema koda | – | Snimač ne računa touchedNodeIds (capture.ts). Pitanje o provjeri tog polja ide orkestratoru. |

### `src/editor/process-capture-checkpoint.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | returns a verified prefix without stopping later capture | pokriveno | `src/editor/capture.test.ts`: leaves events past the 30 s span for the next segment, which continues the chain | Svaki segment je provjerljiv prefiks; snimač nastavlja. Također capture.property.test.ts prazni usred rada. |
| 2 | waits for the current hash tail before copying a checkpoint | nema koda | – | Nema repa sažetaka na čekanju; takeSegment sam računa sažetke, a pozivatelj ga serijalizira (capture.ts). |

### `src/lib/process-ledger/process-ledger.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | persists an active checkpoint across a fresh database handle | pokriveno | `src/lib/journal/atomic-dexie-journal.test.ts`: survives a close/reopen while retaining the owed transaction | Test koristi običan red u tablici pending, ne segment; segmenti stoje u istoj tablici. |
| 2 | seals without allowing a later active checkpoint to overwrite the sealed segment | pokriveno | `db/tests/041-evidence-immutability.sql`: an evidence segment cannot be updated; `src/lib/journal/atomic-dexie-journal.evidence.test.ts`: 6: saveSegment refuses a broken chain, foreign or forged bytes and limits without a write | Ductus nema stanje zapečaćeno; spremljen segment se ne može prepisati (duplicate_transaction lokalno, okidač na poslužitelju). |
| 3 | makes interruption terminal for checkpoint and seal writers | pokriveno | `src/lib/journal/atomic-dexie-journal.evidence.test.ts`: 15: after the recorder stops, text is saved without evidence, earlier rows settle, no SYNCED, logout blocked | Zaustavljanje (evidenceStopped) je trajno i odbija nove segmente i startEvidence. Ductus nema pečat ni vrijeme prekida, pa taj dio izvornog testa nema para. |
| 4 | links a continuation to the exact previous terminal segment head | pokriveno | `src/components/editor/evidence-session.test.ts`: 1: typing, Enter and two changes in one save chain from the journal; a new instance continues it | Nova sesija (drugi sessionId) nastavlja s predecessorSegmentHash zadnjeg reda. |
| 5 | rejects checkpoint time rollback | nema koda | – | D-24: redoslijed je po slijedu i sažetku, ne po vremenu. Sat koji ide unatrag snimač drži na zadnjem vremenu (capture.test.ts: a clock that goes back %s...). |
| 6 | rejects a seal timestamp before the latest durable checkpoint | nema koda | – | Nema pečata ni provjere vremena (D-24, PRODUCT §5 pravilo 4). |
| 7 | rejects an interruption timestamp before the latest durable checkpoint | nema koda | – | Nema vremena prekida; zaustavljanje se bilježi bez vremena (D-24). |
| 8 | does not silently delete structurally invalid persisted records | pokriveno | `src/lib/journal/local-document-saver.test.ts`: MANJE 2: a pending row without a transaction is corrupt and changes nothing | Neispravan red vodi u oporavak i ostaje (novo učitavanje ga opet nađe). Test je na običnom spremanju, ne na putu s dokazima. |

### `src/lib/process-ledger/process-ledger-link.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | rejects continuation while the latest parent is still active | pokriveno | `src/components/editor/evidence-session.test.ts`: 15: a write of another instance makes the next save stale and stops the session | Ductus nema stanje aktivan; dvije istodobne sesije ne mogu račvati lanac (stale_local_sequence). |
| 2 | rejects a continuation whose claimed terminal parent head does not exist | pokriveno | `src/lib/journal/atomic-dexie-journal.evidence.test.ts`: 6: saveSegment refuses a broken chain, foreign or forged bytes and limits without a write; `db/tests/045-evidence-acceptance-atomicity.sql`: a new segment must name the current predecessor | Krivi prethodnik daje chain_broken lokalno i chain_conflict na poslužitelju. |
| 3 | uses parent-head lineage rather than timestamp or session id to find the chain tail | pokriveno | `src/application/evidence/evidence-thin-slice.test.ts`: fails verification for %s (reordered segments); `src/components/editor/evidence-session.test.ts`: 1: typing, Enter and two changes in one save chain from the journal; a new instance continues it | Lanac ide po predecessorSegmentHash; zamijenjen redoslijed daje predecessor_mismatch. |
| 4 | does not allow an active session to rewrite its parent link | pokriveno | `src/lib/journal/atomic-dexie-journal.evidence.test.ts`: 6: saveSegment refuses a broken chain, foreign or forged bytes and limits without a write; `db/tests/041-evidence-immutability.sql`: an evidence segment cannot be updated | Spremljen segment se ne piše ponovno (duplicate_transaction), a na poslužitelju se ne mijenja. |
| 5 | rejects a continuation whose start overlaps the terminal parent | nema koda | – | Preklapanje se mjeri vremenom; Ductus lanac ne provjerava vrijeme (D-24). |

### `src/lib/process-ledger/process-ledger-append.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | rejects rollback, changed hashes and same-hash rewrites of a persisted prefix | pokriveno | `src/lib/journal/atomic-dexie-journal.evidence.test.ts`: 6: saveSegment refuses a broken chain, foreign or forged bytes and limits without a write; `db/tests/045-evidence-acceptance-atomicity.sql`: the same descriptor with a changed payload hash is rejected | Lokalno: stale_local_sequence, chain_broken, duplicate_transaction i zamijenjen sha256. Poslužitelj: idempotency_conflict i invalid. |

### `src/domain/docx/labels.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | claims full fidelity only when nothing was non-exact | nema koda | – | DOCX izvoz još nije izgrađen; plan je M8.4 (DAN-398) u docs/PROGRAM-RAZRADA.md §M8. |
| 2 | names how many parts are approximate or unknown | nema koda | – | DOCX izvoz još nije izgrađen; plan je M8.4 (DAN-398) u docs/PROGRAM-RAZRADA.md §M8. |
| 3 | agrees with the count in Croatian rather than bracketing a number | nema koda | – | DOCX izvoz još nije izgrađen; nema oznaka vjernosti izvoza. Plan je M8.4 (DAN-398). |
| 4 | never states a percentage or a score | nema koda | – | DOCX izvoz još nije izgrađen; nema oznaka izvoza. Plan je M8.4 (DAN-398). |
| 5 | adds the local-changes note when the file is not the server's version | nema koda | – | DOCX izvoz još nije izgrađen; plan je M8.4 (DAN-398). |
| 6 | leaves the note out when there is nothing local to warn about | nema koda | – | DOCX izvoz još nije izgrađen; plan je M8.4 (DAN-398). |
| 7 | never says the export is 'saved' or equal to the server version | nema koda | – | DOCX izvoz još nije izgrađen. Opća zabrana izraza postoji (scripts/forbidden-terms), ali ne za oznaku izvoza. |

### `src/domain/docx/manifest.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | labels the whole F1 subset as exact and lists nothing | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398) u docs/PROGRAM-RAZRADA.md §M8. |
| 2 | summarises exact nodes and marks as counts, not entries | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 3 | stamps the schema version and an injected timestamp | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 4 | counts blocks and words per block | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 5 | reports an unknown block type as UNKNOWN with its path | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 6 | reports an unknown mark as UNKNOWN at the mark's own path | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 7 | refuses to claim a heading level it has no mapping for | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 8 | reports an unknown inline node without losing the block around it | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 9 | lists every non-exact thing individually, in document order | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 10 | survives malformed nodes instead of throwing | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 11 | flags children and marks that are not arrays | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 12 | is pure: the same document twice yields the same manifest | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |
| 13 | treats an empty document (one empty paragraph) as fully exact | nema koda | – | Nema manifesta DOCX izvoza; plan je M8.4 (DAN-398). |

### `src/domain/docx/serialize.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | maps an unmarked text node to a bare run | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398) u docs/PROGRAM-RAZRADA.md §M8. |
| 2 | maps bold and italic onto w:b and w:i | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 3 | keeps the text verbatim, diacritics and all | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 4 | maps a paragraph to an unstyled w:p | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 5 | maps heading levels 1-3 onto Word's own heading styles | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 6 | gives an empty block a paragraph with no runs | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 7 | keeps several runs in order, each with its own marks | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 8 | produces one paragraph per canonical block, in order | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 9 | builds exactly one section | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 10 | sizes that section as A4 with a 25 mm frame | nema koda | – | Nema pretvorbe dokumenta u DOCX; oblik fakulteta dolazi s M8.4 nakon M4.3. |
| 11 | puts every block into the body, in document order | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 12 | does not pin a font family: substitution stays the reader's business | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 13 | scales heading sizes down from 1 to 3, all above body text | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 14 | is pure: two calls on the same document agree structurally | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |
| 15 | accepts a document of only empty paragraphs | nema koda | – | Nema pretvorbe dokumenta u DOCX; plan je M8.4 (DAN-398). |

### `src/lib/docx/export.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | transliterates Croatian diacritics rather than dropping them | nema koda | – | Nema imena datoteke iz naslova; "Izvezi tekst" koristi stalno ime ductus-rad.txt (src/components/editor/LocalDocument.tsx). |
| 2 | lowercases and joins words with single hyphens | nema koda | – | Nema imena datoteke iz naslova; izvoz teksta koristi stalno ime. DOCX izvoz je M8.4 (DAN-398). |
| 3 | strips punctuation and leading or trailing hyphens | nema koda | – | Nema imena datoteke iz naslova; izvoz teksta koristi stalno ime. DOCX izvoz je M8.4 (DAN-398). |
| 4 | keeps digits | nema koda | – | Nema imena datoteke iz naslova; izvoz teksta koristi stalno ime. DOCX izvoz je M8.4 (DAN-398). |
| 5 | decomposes other diacritics through NFD | nema koda | – | Nema imena datoteke iz naslova; izvoz teksta koristi stalno ime. DOCX izvoz je M8.4 (DAN-398). |
| 6 | falls back to a readable name when nothing survives | nema koda | – | Nema imena datoteke iz naslova; izvoz teksta koristi stalno ime. DOCX izvoz je M8.4 (DAN-398). |
| 7 | caps the length without leaving a trailing hyphen | nema koda | – | Nema imena datoteke iz naslova; izvoz teksta koristi stalno ime. DOCX izvoz je M8.4 (DAN-398). |
| 8 | slugifies the project title and adds the extension | nema koda | – | Nema imena .docx datoteke; DOCX izvoz je M8.4 (DAN-398). |
| 9 | never produces a bare extension | nema koda | – | Nema imena .docx datoteke; DOCX izvoz je M8.4 (DAN-398). |
| 10 | hands the caller a manifest and the packed file | nema koda | – | DOCX izvoz još nije izgrađen; plan je M8.4 (DAN-398). |
| 11 | packs a real zip container (a .docx is a zip: PK\x03\x04) | nema koda | – | DOCX izvoz još nije izgrađen; plan je M8.4 (DAN-398). |
| 12 | reports a partial export without refusing to produce the file | nema koda | – | DOCX izvoz još nije izgrađen; plan je M8.4 (DAN-398). |

### `src/domain/forensics/evidence-v2-legacy-compat.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | keeps a newly produced v1 bundle verifiable only through the historic v1 verifier | nema koda | – | Ductus nema format v1 (pisac-local-transactions-v1) ni LocalProcessCapture; ima samo segmente v2 i v3. Odgođeno po #9. |

### `src/domain/forensics/verified-object-activity.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | includes only events after the binding became effective and retains the binding identity | nema koda | – | Ductus nema vezu događaja na akademski objekt (registar objekata). Odgođeno po #9 "nakon Frontendova editora". |
| 2 | preserves verified history segment order instead of re-sorting by session id | nema koda | – | Ductus nema aktivnost po objektu. Odgođeno po #9. |

### `src/domain/forensics/verified-object-binding.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | derives event indexes and before/after from the captured node itself | nema koda | – | Ductus nema vezu objekta na čvor iz zapisa. Odgođeno po #9. |
| 2 | rejects a binding scoped to a different document | nema koda | – | Ductus nema vezu objekta na čvor. Odgođeno po #9. |
| 3 | returns null rather than guessing when no verified event touched the node | nema koda | – | Ductus nema vezu objekta na čvor. Odgođeno po #9. |
| 4 | represents deletion of the bound node instead of treating it as a lineage failure | nema koda | – | Ductus nema vezu objekta na čvor. Odgođeno po #9. |
| 5 | does not attribute an event whose wall-clock timestamp ties the binding boundary | nema koda | – | Ductus nema vezu objekta na čvor. Odgođeno po #9. |
| 6 | does not retroactively attribute events that happened before the registry binding | nema koda | – | Ductus nema vezu objekta na čvor. Odgođeno po #9. |

### `src/domain/forensics/verified-process-history.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | refuses verified history when a persisted bundle was tampered | pokriveno | `src/domain/projection/process-summary.test.ts`: gives no summary at all when the chain does not verify | Drugi model: lanac segmenata na poslužitelju umjesto lokalnih sesija. Izmijenjeni zapis daje odbijanje. |
| 2 | does not reinterpret an active durable segment as interrupted | nema koda | – | Ductus nema lokalne sesije sa stanjem active/sealed; segment je prihvaćen ili nije. |
| 3 | fails closed when storage reports a structurally invalid persisted row | pokriveno | `src/application/projection/process-summary-reader.test.ts`: refuses a missing or unreadable payload | Drugi model. Vidi i "refuses bytes a store returns for another hash, a head cut short and a reordered list". Nema slučaja s neispravnim JSON-om u retku. |
| 4 | returns verified segments in parent lineage order | nema koda | – | Ductus ne slaže segmente po roditelju; redoslijed daje baza, a promijenjen redoslijed odbija (process-summary-reader.test.ts). |

### `src/lib/document/queries.test.ts`

| # | Izvorni test | Ishod | Ductus test | Napomena |
| --- | --- | --- | --- | --- |
| 1 | returns the canonical document and its revision | pokriveno | `src/server/evidence/open-route.test.ts`: opens the work with its state, its snapshot as base64 and only the domain's receipt keys; `src/client/evidence-ingest.test.ts`: reads the work, its snapshot bytes and the domain of its receipt keys | Tok otvaranja rada: POST /api/evidence/open vraća document i currentRevision, a openWork ih čita. |
| 2 | refuses an empty or non-string project id without a round trip | pokriveno | `src/server/evidence/open-route.test.ts`: refuses %s as invalid before any state | Id zadatka umjesto projekta: krivi ili prazan id daje 422 invalid, a baza se ne poziva. |
| 3 | reports a transport error as a read failure | pokriveno | `src/server/evidence/open-route.test.ts`: maps %s; `src/client/evidence-ingest.test.ts`: no network is unavailable | Greška baze (slučaj "a fault") daje 503 unavailable, odvojeno od not_found; klijent bez mreže daje unavailable. |
| 4 | reports an unparseable answer rather than guessing | pokriveno | `src/server/evidence/open-route.test.ts`: maps %s; `src/client/evidence-ingest.test.ts`: refuses %s | Nepoznat ishod, kriva revizija ili snimka bez teksta daju unavailable; klijent odbija odgovor koji nije zatvorenog oblika (openedWorkFrom). |
| 5 | maps not_found to the same answer for a foreign and a missing project | pokriveno | `src/server/evidence/open-route.test.ts`: maps %s; `tests/integration/work-document-read.integration.test.ts`: answers the same none for another course, another institution and no assignment (A2), and to the teacher (A7) | Slučaj "not a student of it, or no such assignment" daje isti 404 not_found. |
| 6 | redirects to /prijava when the RPC reports no session | pokriveno | `src/server/evidence/open-route.test.ts`: maps %s; `src/client/evidence-ingest.test.ts`: HTTP %i → %s | Odgovor bez sesije prepoznat je (401 unauthenticated). Umjesto preusmjeravanja /rad prikazuje poveznicu za prijavu (app/rad/page.tsx). |
| 7 | reports a stored document the canonical model cannot read | pokriveno | `src/lib/journal/atomic-dexie-journal.evidence.test.ts`: 13: startEvidence refuses a stored document the canonical model cannot read, even under its own hash | Journal odbija takvu snimku s invalid_input i ništa ne zapisuje. Hash odgovara bajtovima, pa odbija samo kanonski model. |
| 8 | accepts revision 0, the revision of a document with no commit yet | pokriveno | `src/client/evidence-ingest.test.ts`: reads the work, its snapshot bytes and the domain of its receipt keys; `tests/integration/open-student-work.integration.test.ts`: creates one work when two tabs open it at once; the second gets the same | Odgovor otvaranja s currentRevision 0 se čita; prvo otvaranje u bazi vraća reviziju 0. |

## Poznate granice

- Dio redaka „pokriveno” pokriva isto ponašanje kroz drukčiji dizajn ili posredno (npr. lokalni slijed provjeren kroz uvjet usporedbe pri sljedećem spremanju, ili odluka koju tvrdi samo domenska funkcija). Napomena u retku to kaže. Strožim čitanjem neki od njih postaju „nedostaje test”.
- Slučajevi `queries` mapirani su na tok otvaranja rada (`POST /api/evidence/open`, `openWork`, `startEvidence`), koji zamjenjuje izvorni `ensureDocumentRow`. Izvorni kod koristi Supabase klijent; `docs/ARCHITECTURE.md` §12 ga ipak navodi pod „Prenosi se bez izmjene”. Nesklad u §12 ostaje otvoren.
- Klasifikacija grešaka IndexedDB-a razlikuje se od izvora: `DataError`, `NotFoundError`, `VersionError` i `UpgradeError` u Ductusu daju `unknown`, a ne `corrupt`. Zapisano je kao „nedostaje test”; je li to namjera, odlučuje vlasnik koda (Frontend).
- Dijeljenje segmenta na 5.000 događaja (`MAX_SEGMENT_EVENTS`) nema test; to nije zaseban izvorni slučaj, nego napomena uz redak o proračunu događaja.
