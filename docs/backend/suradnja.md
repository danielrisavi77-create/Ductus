# Backend: trenutno stanje, komentari i prikaz uživo

Dio plana backenda. Verzija, status i popis svih odjeljaka su u indeksu `docs/BACKEND.md`; brojevi odjeljaka su isti kao u indeksu, pa referenca "`BACKEND.md` §N" vodi ovamo.

### 4.10 Trenutno stanje rada (B-11)

**Odluka vlasnika 17. 10. 2026. (issue #87, komentar 6235841029):** nastavnik i mentor trenutno spremljeno stanje rada (`docs/PRODUCT.md` §5 pravilo 7, D-06, P-03) čitaju iz **kontrolnih točaka teksta vezanih hashom** (`document_checkpoint`, `ARCHITECTURE.md` §3 i §5), i to već u demou. Replay u web procesu ne koristi se za ovaj prikaz, ni kao odstupanje za demo. Ovaj odjeljak je ugovor za kod B-11 i za dijelove B-8 i F-8 koji nose snimku; gdje se `ARCHITECTURE.md` §3, §5 i §5a razlikuju u pojedinostima, vrijedi ovaj odjeljak.

1. **Što je snimka.** Snimka je kanonski dokument jedne revizije: točni UTF-8 bajtovi njegova JCS oblika, isti oni nad kojima se računa hash dokumenta v2 (§4.1). Poslužitelj snimku ne izvodi iz koraka: prima je od klijenta i čuva je samo ako je SHA-256 primljenih bajtova jednak `content_hash` te revizije u `document_revision`, a time i `finalDocumentHash` odsječka koji ju je stvorio. Tu jednakost provjerava baza pri svakom upisu (okidač nad `sha256()` primljenih bajtova), ne samo gateway, i drugog puta upisa nema. Snimka tako pripada lancu evidencije jednako čvrsto kao hash revizije. Ona ne tvrdi da je koraci odsječaka stvarno proizvode: to utvrđuje samo rekonstrukcija pri predaji (B-12, D-11). Usporedba rekonstrukcije sa snimkom nije dio demoa; uvodi se zasebnom izmjenom ovog ugovora. B-11 zato snimku nikad ne prikazuje kao provjerenu rekonstrukciju. Snimka je u bazi, ne u spremniku domene evidencije (D-102): nije odsječak ni potvrda.
2. **Ruta `ingest` i drain klijenta, od prvog dana.** Zahtjev rute `ingest` uz bajtove odsječka nosi **obavezno** polje sa snimkom dokumenta nakon zadnjeg događaja odsječka. Format odsječka v2, njegov hash i potvrda se ne mijenjaju; snimka nije dio nijednog od njih. Polje je obavezno od prve verzije rute; zahtjev bez njega je `invalid`. Gateway prije pohrane odsječka snimku dekodira strogo kao UTF-8 (nevaljan niz ili BOM je `invalid`), provjerava da je valjan dokument sheme editora (`validateDocument`), da je ponovni JCS bajt-identičan primljenom i da je SHA-256 jednak `finalDocumentHash` odsječka. Svako odstupanje odbija cijeli commit: ne pohranjuje se ni odsječak ni snimka, a klijent ponavlja. Snimka se upisuje u istoj transakciji baze kao `commit_evidence_segment` (CAS i `reserve`, §4.1), pa nastaju obje ili nijedna; ako adapter to ne može jamčiti dvama pozivima u istoj transakciji, snimka postaje parametar istog RPC-a. Ponovno slanje (`duplicate`) s bajt-identičnom snimkom je idempotentno; drukčija snimka za istu reviziju je `invalid`, a izvorna ostaje. Drain na klijentu za svaki zatvoreni odsječak čuva snimku u journalu dok odsječak ne dobije potvrdu i šalje je s njim; i nakon rada bez mreže svaki odsječak u redu nosi vlastitu snimku. Poznata cijena: uz 15.000 riječi oko 130 KB po commitu (`docs/spikes/B0.2.md`). **Granica veličine snimke (odluka vlasnika 19. 10. 2026., issue #87, komentar 6256655038):** 2 MiB (2 097 152 bajta), ista kao D-96 i prikaz uživo (§4.12), jedna konstanta na klijentu i poslužitelju zajedno (§4.13 t. 2); zamjenjuje 1 MiB iz ADR-a `2026-10-11-ugovor-spremanja-i-zapisa` §5.2.
3. **Revizija 0.** Revizija 0 je početni dokument rada: dokument koji editor stvara za novi rad, u kanonskom obliku sheme F1. Njegovi točni bajtovi i hash fiksiraju se known-answer testom u PR-u koji uvodi tablicu snimki (ovdje se vrijednost ne izmišlja). Snimka revizije 0 nastaje u istoj transakciji kao redak dokumenta. Rekonstrukcija pri predaji (B-12) u demou kreće od known-answer bajtova revizije 0, istog dokumenta koji fiksira taj test, i ne čita tablicu snimki („od prvog događaja”, D-98 dopuna (b)). Svaka promjena toga je izmjena D-98 dopune (b) i pitanje za vlasnika. Predložak zadatka i uvoz datoteke (`ARCHITECTURE.md` §5c) nisu revizija 0; uvode se zasebnom izmjenom ovog ugovora.
4. **Kraj sesije (`ARCHITECTURE.md` §3, D-39).** `ARCHITECTURE.md` §3 predviđa oznaku „kraj sesije” na reviziji. Tablica `document_revision` je samo za dodavanje, pa se oznaka upisuje pri umetanju, nikad naknadnim `UPDATE`-om: nova revizija nosi oznaku početka sesije kad je od prethodne prošlo više od P-01. Prethodna revizija je tada kraj sesije, a najnovija revizija postaje kraj sesije kad od nje prođe više od P-01. Pravilo mora biti isto kao granica sesije u sažetku procesa (B-13: P-01 nad minutama odsječka, ne nad `accepted_at`), uz test jednakosti; ako RPC te minute nema, gateway ih predaje u descriptoru. Oznaka koristi vrijednost P-01 u trenutku umetanja i kasnije se ne preračunava. Test jednakosti zato vrijedi uz nepromijenjen P-01; ako ustanova promijeni P-01, B-13 čita zamrznute oznake umjesto da granice računa iznova, ili se razlika prikazuje kao poznato ograničenje uz istu vrstu dokaza (D-44). Ako vlasnik umjesto D-06 odabere D-39 (otvoreno u Owner queueu), čitanje bira drugu reviziju (zadnji kraj sesije), a shema ostaje ista.
5. **Tablica snimki (`document_checkpoint`; fizički naziv i shema u PR-u koji je uvodi).**
   - Stupci: ključ ustanove, dokument, revizija, bajtovi snimke kao tekst (ne `jsonb`, koji mijenja bajtove), SHA-256 i vrijeme baze. Složeni strani ključ (dokument, ustanova, revizija) prema `document_revision` sprječava miješanje ustanova i snimku revizije koja ne postoji (D-103).
   - `ENABLE` i `FORCE ROW LEVEL SECURITY`, vlasnik je uloga bez prijave, a `ductus_app` nema izravan DML ni politiku čitanja: čita se samo kroz RPC iz točke 6. pgTAP matrica pokriva studenta vlasnika, drugog studenta istog kolegija, nastavnika zadatka, nastavnika drugog kolegija iste ustanove, persone druge ustanove te uloge `ductus_worker` i `ductus_retention`.
   - Redak se ne mijenja. Briše ga samo prorjeđivanje, u istoj transakciji kao upis nove snimke, i funkcija retentiona. Čuvaju se samo snimke ovih revizija: revizija 0; najnovija revizija; najnovija revizija prihvaćena prije početka trenutnog P-03 prozora; svaki kraj sesije (točka 4); revizija na kraju zabilježene praznine (`ARCHITECTURE.md` §5 i §6 t. 3). Ostale se brišu pri sljedećem upisu, pa snimke unutar sesije postoje samo prolazno i nikad se ne prikazuju (pravilo 7). Razmak od oko 2.000 koraka iz `ARCHITECTURE.md` §5 ostaje PRIJEDLOG (B0.3) i nije dio ovog ugovora.
   - Tablica nije dio jamstva sheme `evidence` (samo dodavanje), jer se prorjeđuje; njezino uvođenje ne smije oslabiti okidače koji to jamstvo provode.
   - Rok čuvanja: klasa „Radne verzije” (`ARCHITECTURE.md` §3, C-21; prijedlog roka „do kraja akademske godine zadatka”, potvrđuje FPZG, D-30). Snimke su prvi tekst radova u bazi: `pg_dump` i PITR odsad sadrže tekst radova, pa napomena iz §4.7 da `pg_dump` ne sadrži odsječke više ne znači da kopije baze nemaju sadržaja. Brisanje po roku potpuno je tek kad istekne najdulji rok kopija (§4.7). Snimka nikad ne ide u log; canary iz §4.9 pokriva i tekst snimke.
6. **Čitanje: jedan RPC, ista funkcija za sve koji smiju čitati.**
   - `SECURITY DEFINER`, prazan `search_path`, identitet i ustanova iz `current_actor()`, nikad iz parametra; jedini parametar je dokument.
   - Smiju čitati: nastavnik zadatka kojem rad pripada (aktivno članstvo s ulogom `teacher` u kolegiju zadatka); mentor rada kad postoji `mentorship` (do demoa samo ogledni retci iz lokalne provisioning skripte, D-182; za svoje mentorske radove mentor djeluje u ulozi `teacher`, D-154); student vlasnik, koji dobiva bajt-identičan odgovor (pravilo 5, D-80 t. 6). Ishod ne ovisi o tome tko pita. Svi ostali, uključujući drugu ustanovu, dobivaju isti odgovor kao za nepostojeći dokument.
   - **D-37:** za zadatak kraći od P-04 stanje se ne daje prije predaje (zaseban ishod, ne `unavailable`). **Otvoreno (vlasnik):** P-04 („rok kraći od 24 sata”) je PRIJEDLOG u Owner queueu (`STATE.md`), zajedno s načinom na koji se trajanje zadatka mjeri. Vrijednost je konfiguracija ustanove (pravilo 12), ne konstanta u kodu.
   - **P-03:** prozori su poravnati na sat baze; početak trenutnog prozora je `now()` baze zaokružen naniže na višekratnik P-03 (UTC). Trenutak prihvaćanja revizije je `document_revision.created_at`: `commit_evidence_segment` u njega i u `segment.accepted_at` iste transakcije upisuje isti `clock_timestamp()`, a revizija 0 ima `now()` transakcije koja ju je stvorila. `acceptedAt` iz potvrde je zaokružen na minutu i nije izvor ovog vremena. Odgovor je snimka revizije r, najnovije revizije prihvaćene prije početka trenutnog prozora, i nikad novije, bez obzira na broj poziva, kartica, uređaja ili predmemoriju (#177, napadi 13 i 27). Polling klijenta (D-74, 30 do 60 s) ne određuje svježinu. P-03 je postavka ustanove sa zadanom vrijednošću 5 minuta. Poznata granica: transakcija koja počne prije granice prozora, a postane vidljiva nakon nje, nosi `created_at` prije granice. Odgovor se tada za isti prozor može jednom pomaknuti na tu reviziju; i ona je prihvaćena prije početka prozora, pa se ne otkriva ništa novije od P-03. PR koji uvodi RPC to pokriva testom. Ako ustanova promijeni P-03, snimka koju zahtijeva novi prozor možda je već prorijeđena; do sljedećeg upisa ishod je `unavailable`, što je prihvaćeno.
   - **Izlaz, zatvoren oblik:** kanonski dokument revizije r (JCS tekst), njegov SHA-256 kao oznaka verzije, početak trenutnog prozora i P-03 prozor u kojem je revizija r prihvaćena (zadnja promjena iz D-80 t. 2, kvantizirana na isti prozor; #177 napad 14). Izlaz nema broj revizije, broj odsječaka ili commitova, točno vrijeme, autora pojedinih promjena ni ijedno međustanje. Prikaz teksta radi klijent (D-74, bez renderiranja sadržaja na poslužitelju).
   - **Neuspjeh:** ako snimke revizije r nema, ili se SHA-256 ponovno izračunat pri čitanju ne slaže s `content_hash`, ishod je `unavailable` („stanje nije dostupno”). Nikad djelomičan tekst, nikad starija ni novija revizija umjesto r, nikad tvrdnja o uzroku. Nepodudarnost hasha bilježi se kao incident bez sadržaja.
7. **Brojke uz tekst u nastavničkom prikazu.** Vlasnik je uz odluku tražio da nastavnik vidi i brojke koje se već broje („lijepljenje, pisanje”). Ovaj ugovor ne uvodi nijednu novu brojku.
   - Već postoje u sažetku procesa B-13 (`projectProcessSummary`, `src/domain/projection/process-summary.ts`): sesije po P-01 (broj i rasponi na minutu); lijepljenja iznad P-02 kao zasebne stavke s veličinom u znakovima i oznakom da izvor nije opažen; broj manjih lijepljenja; praznine i stanje zapisa. Svaka stavka nosi vrstu dokaza (D-44).
   - `docs/PRODUCT.md` §7 navodi i stavke koje prvi korak B-13 još nema: razdoblje rada, aktivno vrijeme uređivanja (zbroj trajanja sesija, uz stalni tekst da nije mjera truda), verzije, uvoze i izmjene nastavnika. Brz put iz D-80 t. 2 dodaje zadnju promjenu, otvorene zahtjeve za doradu i stanje izjave. To su sljedeći koraci B-13 i B-11, ne nove metrike. „Pisanje” u tom smislu znači sesije i aktivno vrijeme uređivanja.
   - Sažetak procesa nema rez P-03: vlasnik je 19. 10. 2026. odlučio da se nakon D-142 (živi prikaz) rez ukida (#87 6256655038, točka 3). Sažetak se računa nad svim prihvaćenim odsječcima jedinog paketa dokumenta, zaključno s glavom paketa, pa i nad onima prihvaćenima u tekućem prozoru; mjera iz #177 napada 14 za sažetak više ne vrijedi. Popis koji ne završava na glavi paketa ne daje sažetak. Student i nastavnik dobivaju isti izlaz iste funkcije (pravilo 5).
   - Iznimka za predan rad (DAN-289 A2, ugovor #756; vlasnik #87 6397418697): kad za dokument postoji upisana predaja, sažetak završava na predanoj reviziji, ne na glavi paketa. Glava sažetka je zadnji odsječak čija potvrda nosi predanu reviziju (brojem), kao u `app.read_submission_record`, a popis su svi odsječci paketa do njega redom lanca. Ako nijedna potvrda ne nosi predanu reviziju, ishod je `unavailable`, nikad glava paketa. Sam zahtjev za predaju i odbijena predaja (`artifact_mismatch`) ne režu sažetak.
   - Sesija koja nije otvorena (istekla, zatvorena ili nepoznata) prije svega daje `ZD401` u `app.read_process_summary_source`, a ruta `POST /api/process-summary` vraća 401 `unauthorized`, kao bez kolačića, čitanje komentara i živi prikaz (DAN-85, nalaz 1 na #458). Svako drugo odbijanje ostaje isti 404 `not_found`: tuđi rad, druga ustanova, nepostojeći dokument i ID koji ne može postojati. ID koji ne može postojati odbija se prije baze, pa i uz isteklu sesiju daje 404.
   - Reprodukcija (DAN-344, ugovor na #923, c.6429438582) čita isti zapis s istim čitateljima i istim rezom predaje: `app.read_replay_source` je `app.read_process_summary_source` s oznakom `replay` u zapisu pristupa. `app.read_replay_checkpoints(dokument, hashevi)` vraća tekst kontrolnih točaka s traženim hashevima (početni dokument i nastavak nakon prekida lanca), samo bajtove koji daju svoj hash. Nastavnikov poziv bilo koje od njih upisuje otvaranje (jedan redak po čitatelju, radu i 5-minutnom intervalu), i za stranicu koja nije prva. Ruta `POST /api/evidence/replay` (`{documentId, from}`) daje stranicu točnih, provjerenih bajtova odsječaka (najviše 8 MiB i 256 odsječaka, najmanje jedan) kao JCS tekst, isti za studenta i nastavnika; svaki neuspjeh je 503, nikad djelomična stranica.
   - Prikaz ostaje opisni (D-105): bez postotka, udjela, zbroja lijepljenja, poretka po veličini, boje i ocjene (`docs/PRODUCT.md` §5 pravila 2 i 3, §7 „Zabranjeno u sažetku”).
   - Brzina tipkanja, pauze i ritam nisu dio ovog prikaza. Bilježenje ritma postoji samo kao D-56: samo u mentorskim radovima, vrijeme promjena u koracima od 100 ms isključivo za reprodukciju, bez ikakve mjere, i tek nakon pravnog mišljenja i izmjene Ustava C-14 i C-19. To je izvan opsega B-11 i demoa.

### 4.11 Komentari uz odlomak (B-10, DAN-86)

Ugovor prije koda (issue #177; vlasnikova odluka na #87, `issuecomment-6236582503`). Komentar je **zaseban zapis sa sidrom** koji klijent prikazuje kao dekoraciju. Nikad nije oznaka u dokumentu, nikad ne mijenja dokument, reviziju, segment, potvrdu ni hash; dokument ima jednog pisača (D-34). Napadi 1 do 12 iz #177 su kriterij prihvata.

**Shema i vlasništvo.** Nova shema `collaboration` (vlasnik `ductus_migrator`); tablice i RPC-ovi su u vlasništvu `ductus_identity` (on već posjeduje `app.current_actor()` i `institution.actor_assignment_role()`). Komentar nije evidencija: `ductus_identity` ne dobiva nikakvo pravo na shemi `evidence` (provjera iz `040` ostaje). Vezu dokumenta čita jedna uska funkcija `collaboration.document_scope(p_document_id text) RETURNS (institution_id uuid, assignment_id uuid, principal_id uuid)` u vlasništvu `ductus_evidence`, `SECURITY DEFINER`, prazan `search_path`, `EXECUTE` samo za `ductus_identity`; `ductus_app` je ne izvršava. `ductus_evidence` dobiva `USAGE` i `CREATE` na shemi `collaboration` samo dok migracija stvara tu funkciju i gubi ih na kraju migracije. Nema stranog ključa prema `evidence.document`: brisanje dokumenta po pravilu čuvanja ne smije ovisiti o komentarima; postojanje se provjerava pri upisu.

**Tablica `collaboration.comment_thread`** (jedna nit, jedno sidro).

| Stupac | Tip i ograničenje |
| --- | --- |
| `id` | `uuid`, PK, generira baza |
| `institution_id`, `assignment_id`, `owner_id` | `uuid NOT NULL`, iz `document_scope` pri stvaranju, nikad iz parametra |
| `document_id` | `text NOT NULL` |
| `anchor` | `jsonb NOT NULL`, oblik `TextAnchor` iz `src/domain/collaboration/anchor.ts` (`CHECK`) |
| `state` | `text NOT NULL CHECK IN ('open','answered','resolved')` |
| `created_by` | `uuid NOT NULL`, iz `app.current_actor()` |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

**Tablica `collaboration.comment`** (komentari niti redom).

| Stupac | Tip i ograničenje |
| --- | --- |
| `id` | `uuid`, PK, generira baza |
| `thread_id`, `institution_id` | `uuid NOT NULL`, strani ključ na nit iste ustanove |
| `position` | `integer NOT NULL`, 1 do 10000, `UNIQUE (thread_id, position)`; 1 je nastavnikov komentar koji otvara nit |
| `author_id` | `uuid NOT NULL`, iz `app.current_actor()`; nema parametra autora |
| `author_role` | `text NOT NULL CHECK IN ('teacher','student')`, iz `actor_assignment_role` u trenutku upisa |
| `body` | `text NOT NULL`, granice ispod (`CHECK`) |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Tekst komentara je nepromjenjiv; u B-10 nema uređivanja ni brisanja komentara (brisanje ide uz pravila čuvanja, D-50 i kasniji korak). Odgovor zaključava redak niti, pa istodobni odgovori dobivaju različite pozicije.

**Tko što smije.** Odnos se računa pri svakom pozivu iz `document_scope` i `actor_assignment_role`, bez predmemorije, pa uklonjeni nastavnik gubi i čitanje i pisanje odmah (§4.4).

| Akter | Čita | Novi korijen sa sidrom | Odgovor | Promjena stanja |
| --- | --- | --- | --- | --- |
| Student vlasnik dokumenta (`principal_id` = akter, ista ustanova, `actor_assignment_role` = `student`) | sve niti svog dokumenta | ne | da | ne |
| Nastavnik kolegija tog zadatka (`actor_assignment_role` = `teacher`, otvoreno članstvo) | sve niti dokumenta | da | da | da |
| Svi ostali (N2 drugog kolegija, Student B istog kolegija, N1 druge ustanove, administrator, istekla ili nepostojeća sesija) | ništa | ne | ne | ne |

Sesija bez aktera: `ZD401`. Svaki drugi odbijen slučaj, uključujući nepostojeći dokument ili nit: `ZD403` s istom porukom, bez razlike u obliku odgovora (napadi 1 i 12).

**Stanja niti.** Jedini prijelazi; svaki drugi je `ZD409`:

| Iz | U | Okidač |
| --- | --- | --- |
| (nema) | `open` | nastavnik stvara korijen |
| `open` | `answered` | odgovor studenta |
| `answered` | `open` | odgovor nastavnika |
| `open`, `answered` | `resolved` | nastavnik `resolve_thread` |
| `resolved` | `open` | nastavnik `reopen_thread` |

Odgovor u niti `resolved` je `ZD409` (nit se prvo ponovno otvara). Ostali prijelazi (npr. odgovor nastavnika na `open`, odgovor studenta na `answered`) ne mijenjaju stanje.

**RPC potpisi** (`SECURITY DEFINER`, `SET search_path = ''`, `EXECUTE` samo `ductus_app`):

- `collaboration.create_comment(p_document_id text, p_body text, p_anchor jsonb) RETURNS uuid`: samo nastavnik; vraća `id` nove niti.
- `collaboration.reply_comment(p_thread_id uuid, p_body text) RETURNS uuid`
- `collaboration.resolve_thread(p_thread_id uuid) RETURNS void`, `collaboration.reopen_thread(p_thread_id uuid) RETURNS void`
- `collaboration.list_comments(p_document_id text) RETURNS TABLE (thread_id, comment_id, comment_position, author_role, is_own, body, anchor, state, created_window)`; `anchor` je popunjen samo u retku pozicije 1: **ista funkcija i isti oblik izlaza za studenta i nastavnika** (`PRODUCT.md` §5 t. 5).

`ductus_app` nema nikakvu ovlast ni na jednoj tablici sheme `collaboration`, ni `SELECT`: izravno čitanje otkrilo bi točna vremena i ID-ove osoba, pa klijent čita samo kroz `list_comments` (napad 4). Tablice imaju `FORCE ROW LEVEL SECURITY` sa samo vlasnikovom politikom, pa ni pogrešno dodijeljen grant ne pokazuje ni ne mijenja nijedan redak; retci su u pgTAP matrici.

**Što se nikad ne vraća.** `author_id` drugih osoba, `institution_id`, točno vrijeme (`created_at` se vraća samo zaokružen na prozor P-03 od 5 minuta, `created_window`; redoslijed nosi `comment_position`), sadržaj dokumenta, segmenti, hashevi i revizije. Poslužitelj **ne razrješuje sidro** prema sadržaju i ne vraća nikakav isječak dokumenta: vraća sidro kako ga je nastavnik spremio, iz teksta koji je već vidio, a klijent ga razrješuje lokalno s `resolveTextAnchor` (exact, moved, ambiguous, missing). Zato poziv ne može otkriti tekst noviji od nastavnikova pogleda (napad 8). Neprouzdano sidro (`ambiguous`, `missing`) prikazuje se kao "sidro nije pouzdano" uz komentar koji ostaje vidljiv, nikad na pogrešnom mjestu (napad 7). Student ne stvara sidro jer bi ono nosilo njegov noviji tekst.

**Granice ulaza** (strogi validator bez nove ovisnosti u `src/domain/collaboration/comment.ts`, po uzoru na `src/server/institution/create-course.ts`; ista pravila kao `CHECK` u bazi):

- `body`: nakon NFC normalizacije 1 do 2000 znakova, nije samo bjelina; odbijaju se kontrolni znakovi osim `\n` i `\t` te dvosmjerni nadjačavajući znakovi (U+202A do U+202E, U+2066 do U+2069).
- `anchor`: točno polja `nodeId` (UUID kao `isNodeId` u `src/domain/document/schema.ts`), `quote` (1 do 500 znakova), `prefix` i `suffix` (do 64), `startHint` i `endHint` (cijeli brojevi, 0 ≤ `startHint` < `endHint` ≤ 1 000 000); nepoznato ili nedostajuće polje je odbijeno; isti zabranjeni znakovi kao u `body`. Duljine se broje u kodnim točkama, kao `char_length` u bazi.
- Tijelo HTTP zahtjeva do 16 KiB; dopuštena su samo točno propisana polja, nepoznato polje se odbija. Pogreška je `ZD422` bez odjeka ulaza.
- Prikaz je uvijek tekst (React tekstni čvor), nikad HTML ni Markdown (napad 10).

**Evidencija netaknuta.** Nijedan RPC ne čita ni ne piše `evidence.document_revision`, `segment`, `package` ni `receipt`; pgTAP potvrđuje da su `current_revision`, `current_content_hash` i lanac segmenata jednaki prije i poslije komentara (napad 6). Riječi poput "rizik" ili "sumnjivo" u komentaru nastavnika se ne filtriraju (kontrola lažnog blokiranja); rječnik zabranjenih izraza vrijedi za tekst sučelja, ne za korisnikov unos.

**Logovi.** Samo ID-ovi (`document_id`, `thread_id`, kod greške), nikad `body` ni `anchor` (§4.9, napad 11).

**Napadi iz #177 na testove.**

| Napad | Dokaz |
| --- | --- |
| 1, 12 | pgTAP: N2, Student B, N1 druge ustanove, administrator i bez sesije dobivaju `ZD403`/`ZD401` na svakom RPC-u, i na `list_comments`; nepostojeći dokument ili nit daje isti `ZD403`; neovlašten poziv s neispravnim ulazom i dalje dobiva `ZD403`, ne `ZD422` |
| 2 | pgTAP: nastavnik sa zatvorenim članstvom (`member_to`) odmah dobiva `ZD403` na čitanju i pisanju |
| 3 | pgTAP i katalog: nema parametra autora; `author_id` jednak akteru |
| 4 | pgTAP: izravni `SELECT`/`INSERT`/`UPDATE`/`DELETE` pod `ductus_app` odbijeni (`42501`), uz pogrešno dodijeljen grant 0 redaka; katalog: `ductus_app` izvršava točno pet RPC-ova (`bag_eq`) |
| 5 | pgTAP: svaki redak tablice prijelaza i svaki nedopušten prijelaz (`ZD409`) |
| 6 | pgTAP: hash, revizija i segmenti jednaki prije i poslije |
| 7 | unit (`anchor.test.ts`): obrisan, premješten, izmijenjen i dupliciran odlomak daju `missing`/`moved`/`ambiguous`, nikad pogrešan raspon; pgTAP: komentar ostaje u `list_comments` |
| 8 | pgTAP i katalog: izlaz `list_comments` nema stupca sa sadržajem dokumenta |
| 9 | unit (validator) i pgTAP (`CHECK`): prazno, 1 MB, kontrolni znakovi, RTL override, nepoznato polje |
| 10 | unit/e2e u koraku sučelja: `<script>` u tekstu prikazan doslovno |
| 11 | unit: log rute sadrži samo ID-ove (canary) |

**Koraci.** (1) ovaj ugovor; (2) migracija, RLS, RPC-ovi i pgTAP matrica; (3) ugovor ulaza (validator), poslužiteljski omotač i ruta s unit testovima (`Closes #177`). Prikaz u editoru je Frontendov korak.

**Poznate granice do B-11.** Nastavnikovo pravo komentiranja još ne ovisi o vidljivosti prema D-37, P-03 i potvrdi obavijesti; B-11 (§4.10, PR #395) to veže. Sidro se ne provjerava prema reviziji koju je nastavnik vidio jer bi provjera prema trenutačnoj reviziji bila bočni kanal (napad 8); vezanje uz reviziju pogleda dolazi s B-11.

### 4.12 Prikaz uživo (B-LIVE, DAN-216)

Ugovor prije koda. **Odluka vlasnika (issue #87, komentari 6254642740 i 6254721033; u `docs/DECISIONS.md` je upisuje orkestratorov docs PR kao D-142 do D-144):** student piše u jednoj prijavi, a mentor ili nastavnik zadatka rad vidi uživo, istodobno, u drugoj prijavi. To vrijedi od prvog dana i za kratke zadatke (mijenja D-37). Student za to zna prije prve rečenice (obavijest, S3) i vidi isti prikaz svog rada. Reprodukcija znak po znak (D-143) nije dio ovog ugovora.

**Redoslijed spajanja.** U repou `docs/PRODUCT.md` §5 pravilo 7 još kaže „najviše svakih P-03, ne tipkanje uživo”, a D-37 kratke zadatke skriva do predaje. Ovaj odjeljak opisuje ponašanje po novoj odluci, ali **nijedan kodni PR prema njemu ne spaja se prije orkestratorova docs PR-a** koji usklađuje PRODUCT §5 pravilo 7, D-37 i odnos prema §4.10. Do tada je nesklad otvoren i zapisan na PR-u. Odnos prema §4.10 (snimke P-03 iz evidencije) odlučuje taj docs PR; ovaj ugovor §4.10 ne mijenja i ne čita njegove tablice.

1. **Zaseban kanal, ne evidencija.** D-24 odsječke zatvara do 30 s i vrijeme zaokružuje na minutu, pa evidencija nije dovoljno brza za prikaz uživo. Prikaz uživo zato ima vlastiti kanal: **zadnje stanje dokumenta** koje student objavljuje i koje ovlašteni čitaju.
   - Stanje nije dokaz: nema lanca hasheva, potpisa ni potvrde; ne ulazi u rekonstrukciju, predaju (B-12) ni sažetak procesa (B-13); ne čita i ne piše nijednu tablicu sheme `evidence`, osim iznimke za predan rad ispod. Kanonski oblik dokumenta i hash dokumenta v2 (§4.1, D-133 i D-134 su PRIJEDLOG) ostaju netaknuti: kanal ih samo koristi.
   - Šalje se cijeli kanonski dokument (JCS bajtovi sheme editora, isti oblik kao snimka iz §4.10 t. 1), nikad događaj, tipka, raspon izmjene, trajanje ili vrijeme klijenta. Kanal zato ne nosi tipke, vrijeme ni povijest, a Ductus iz njega ne računa brzinu, pauze ni ritam (`docs/PRODUCT.md` §5 pravilo 4; D-56 ostaje izvan opsega). Svojstvo samog prikaza uživo (D-142) jest da čitač vidi kad se stanje promijenilo, s točnošću svog pollinga (točka 7), i razliku dvaju stanja koja je vidio; ugovor to ne skriva, a obavijest (S3), DPIA i pravno mišljenje (D-55) moraju to reći točno ovako. Ne bilježi se ništa izvan editora.
   - Čuva se samo **zadnje** stanje: novi upis prepisuje prethodni. Nema povijesti, međustanja ni vremena upisa.
   - **Iznimka za predan rad** (DAN-289 A3, ugovor #756; vlasnik #87 c.6397418697 i c.6397773534, opcija (a)): nakon upisane predaje kanal ne prikazuje zadnje stanje, nego oznaku predaje i točno predanu reviziju. Kanal zato smije pročitati dvije stvari i ništa drugo: je li dokument predan (`app.document_submitted(p_document_id text) RETURNS boolean`) i tekst predane revizije iz `evidence.document_checkpoint`, provjeren prema `submission.artifact_hash` (`app.submitted_document_text(p_document_id text) RETURNS TABLE (content_hash text, body text)`). Ustanova dolazi iz sesije (`current_actor()`), nikad iz parametra. Obje su `SECURITY DEFINER` funkcije uloge `ductus_evidence` s praznim `search_path`, `EXECUTE` ima samo `ductus_identity`, a ta uloga i dalje nema pristup shemi `evidence`. Kanal nikad ne vraća reviziju, vrijeme ni ID predaje.
2. **Tablica `collaboration.live_state`** (shema i vlasništvo kao §4.11: tablica i RPC-ovi u vlasništvu `ductus_identity`, opseg dokumenta iz `collaboration.document_scope`).

| Stupac | Tip i ograničenje |
| --- | --- |
| `document_id` | `text NOT NULL` |
| `institution_id`, `assignment_id`, `owner_id` | `uuid NOT NULL`, iz `document_scope` pri prvom upisu, nikad iz parametra; strani ključevi na zadatak i korisnika iste ustanove |
| `body` | `text NOT NULL`, `octet_length` 1 do 2 097 152 (D-96) (`CHECK`); tekst, ne `jsonb`, koji mijenja bajtove |
| `content_hash` | `text NOT NULL`, SHA-256 (hex) bajtova `body`; računa ga baza pri upisu, `CHECK` jednakosti |
| `write_token` | `uuid NOT NULL`, nova slučajna vrijednost pri svakom prihvaćenom upisu |

   - PK (`document_id`, `institution_id`). Nema stranog ključa prema `evidence.document` (kao §4.11); postojanje dokumenta provjerava `document_scope` pri upisu.
   - **Nema stupca s vremenom ni brojačem.** `write_token` je neproziran: iz njega se ne čita broj upisa ni redoslijed. Vrijeme zadnjeg upisa ne postoji ni u tablici ni u odgovoru.
   - `ENABLE` i `FORCE ROW LEVEL SECURITY`, samo vlasnikova politika za `ductus_identity`. `ductus_app`, `ductus_worker` i `ductus_retention` nemaju nikakvu ovlast na tablici, ni `SELECT`; klijent piše i čita samo kroz RPC-ove iz točke 3.
   - Rok čuvanja: klasa „Radne verzije” (`ARCHITECTURE.md` §3, C-21). Kaskade nema (nema stranog ključa prema dokumentu), pa redak briše samo `collaboration.delete_live_state(p_document_id text, p_institution_id uuid)` iz točke 3, koja se poziva u istoj transakciji kao brisanje dokumenta po roku i brisanje pri povlačenju studenta (D-12). Tekst rada u bazi ulazi u `pg_dump` i PITR (§4.10 t. 5 vrijedi i ovdje). `body` nikad ne ide u log; canary iz §4.9 pokriva i ovaj kanal.
3. **RPC-ovi** (`SECURITY DEFINER`, `SET search_path = ''`, identitet i ustanova iz `current_actor()`, `EXECUTE` samo `ductus_app`):
   - `collaboration.publish_live_state(p_document_id text, p_expected_token uuid, p_body text) RETURNS TABLE (outcome text, write_token uuid)`. Smije samo student vlasnik (`collaboration.actor_role` = `student`, otvoreno članstvo) koji je potvrdio trenutnu verziju obavijesti zadatka (`institution.has_acknowledged_current`). Redak se zaključava (`FOR UPDATE`), pa je usporedba tokena i upis jedan korak. Ishodi:
     - `accepted`: `p_expected_token` jednak spremljenom (ili retka nema i parametar je `NULL`); `body` i hash se prepisuju, vraća se novi token.
     - `unchanged`: hash `p_body` jednak spremljenom; ništa se ne piše, vraća se trenutni token.
     - `conflict`: token zastario, ili je `NULL` a redak postoji; ništa se ne piše, vraća se trenutni token. Time zakašnjelo ponovno slanje ne može prepisati novije stanje.
   - `collaboration.read_live_state(p_document_id text, p_known_hash text) RETURNS TABLE (outcome text, content_hash text, body text)`. Ishodi: `state` (hash i tijelo), `unchanged` (`p_known_hash` jednak spremljenom; tijelo se ne šalje), `empty` (student još ništa nije objavio). Nikad ne vraća `write_token`, ID osoba, ustanovu ni vrijeme.
   - **Nakon predaje** (iznimka iz točke 1): `publish_live_state` ništa ne piše i daje `ZD403`, kao svaka odbijena objava, prije provjere ulaza. `read_live_state` ne čita zadnje stanje, nego studentu i nastavniku jednako vraća `submitted` s hashem i tekstom predane revizije (tijelo izostaje kad je `p_known_hash` jednak tom hashu, kao kod `unchanged`), ili `unavailable` kad snimke predane revizije nema ili se njezini bajtovi ne slažu s `artifact_hash`. Nastavnikovo čitanje i dalje se upisuje u zapis pristupa. Sam zahtjev i odbijena predaja (`artifact_mismatch`) ne mijenjaju ništa.
   - `collaboration.delete_live_state(p_document_id text, p_institution_id uuid) RETURNS void`: `SECURITY DEFINER` u vlasništvu `ductus_identity`, `SET search_path = ''`, `EXECUTE` samo `ductus_retention` (ne `ductus_app`). Briše redak ako postoji; bez retka ne radi ništa. Ne prima ni ne vraća tijelo.
   - **Redoslijed provjera u `publish_live_state`** (ishodi su tako međusobno isključivi): ovlast, valjanost ulaza, zaključavanje retka, zatim (a) hash `p_body` jednak spremljenom daje `unchanged` bez obzira na token; (b) inače token kao gore daje `accepted` ili `conflict`. Isto tijelo sa zastarjelim tokenom je dakle `unchanged` i vraća trenutni token, što objavljivaču samo osvježi token.
   - **Pogreške:** sesija bez aktera `ZD401`; svaki drugi odbijen slučaj, uključujući nepostojeći dokument, `ZD403` s istom porukom. Ovlast se provjerava **prije** valjanosti ulaza, pa neovlašten poziv s neispravnim ulazom dobiva `ZD403`, ne `ZD422`. Neispravan `p_body` vlasnika (prazan, iznad granice, neispravan oblik hasha u `p_known_hash`) je `ZD422` bez odjeka ulaza.
4. **Ovlasti samo iz odnosa (Ustav C-23, `docs/PRODUCT.md` „Pristup nastaje isključivo iz odnosa”).** Odnos se računa pri svakom pozivu iz `document_scope` i `collaboration.actor_role`, bez predmemorije, pa uklonjeni nastavnik ili student gubi pristup odmah (§4.4).

| Akter | `read_live_state` | `publish_live_state` |
| --- | --- | --- |
| Student vlasnik rada, otvoreno članstvo, potvrđena trenutna obavijest | da | da |
| Student vlasnik bez potvrde trenutne verzije obavijesti | da | `ZD403` |
| Nastavnik kolegija zadatka (aktivno članstvo `teacher`) | da | `ZD403` |
| Mentor rada | da, kad postoji `mentorship` (do demoa samo ogledni retci iz lokalne provisioning skripte, D-182; mentor za svoje mentorske radove djeluje u ulozi `teacher`, a redak u `actor_role` i matrici dodaje se s DAN-349) | `ZD403` |
| Student B istog kolegija, nastavnik drugog kolegija iste ustanove, nastavnik sa zatvorenim članstvom (`member_to`), persona druge ustanove, administrator ustanove | `ZD403` | `ZD403` |
| Bez sesije | `ZD401` | `ZD401` |

5. **Isti izračun za studenta i mentora (pravilo 5).** Postoji jedna funkcija čitanja; ishod i bajtovi ne ovise o tome tko pita. Student svoj rad u prikazu vidi kroz isti `read_live_state` i istu rutu kao mentor, ne iz lokalnog editora. Test na razini baze i na razini API-ja uspoređuje odgovore studenta i nastavnika bajt po bajt.
6. **HTTP.** Ruta `/api/live/[documentId]`:
   - `PUT`: tijelo su sirovi JCS bajtovi dokumenta; zaglavlje `If-Match: "<token>"`, ili `If-None-Match: *` za prvi upis. Vrijede zaštite mutacije (`checkMutationRequest`, Origin i `Sec-Fetch-Site`). Tijelo se čita kao tok s granicom 2 MiB (D-96) i prekida čim je prijeđe. Gateway prije RPC-a provjerava: strogi UTF-8 bez BOM-a, `validateDocument`, ponovni JCS bajt-identičan primljenom (kao §4.10 t. 2). Odgovori: 200 `{outcome, token}`, 409 `{outcome: "conflict", token}` (token je `null` kad stanja još nema), 413 iznad granice, 422 za neispravno tijelo, 404 za `ZD403`, 401.
   - `PUT` prije prvog bajta tijela pita bazu za sesiju (kao F-098, §4.13 t. 1). Bez zaglavlja uvjeta, s oba ili s pogrešnim oblikom daje 428. Neispravan ID dokumenta daje 404 prije baze. Ostale odgovore (403, 405, 415, 400, 408, 503) i točna tijela navodi tablica u opisu PR-a koraka 3 (#496), a provodi ih `src/server/collaboration/live-route.ts`.
   - `GET`: `If-None-Match: "<hash>"` daje 304 kad je stanje isto; inače 200 s bajtovima dokumenta, `ETag` jednak hashu i `Cache-Control: no-store`. 204 kad je `empty`, 404 za `ZD403`, 401. Druga vrijednost `If-None-Match` čita se kao da je nema. Ishod `submitted` daje isto (200 s bajtovima predane revizije ili 304) uz zaglavlje `Ductus-Live-State: submitted`, koje ne nosi ništa drugo; `unavailable` daje 503 `unavailable`, nikad zadnje stanje. Nastavnikovo čitanje upisuje otvaranje u zapis pristupa (pravilo 17), pa ruta traži pozitivan dokaz da zahtjev šalje stranica aplikacije (F-107): bez zaglavlja `Ductus-Protocol` jednakog `DUCTUS_PROTOCOL_VERSION` daje 403 prije baze, kao i `Sec-Fetch-Site` koji postoji, a nije `same-origin`. Isto vrijedi za `HEAD`.
   - Log rute: samo `document_id`, ishod i kod greške.
7. **Učestalost i opterećenje.** Bez nove usluge i nove ovisnosti.
   - Student: najviše jedan zahtjev u letu; promjene u međuvremenu se stapaju u zadnje stanje; novi zahtjev kreće najranije 1 s nakon početka prethodnog. Šalje se samo kad se kanonski dokument promijenio.
   - Mentor, nastavnik i student u prikazu: `GET` s `If-None-Match` svake 1 s dok je stranica vidljiva (`visibilitychange`); nakon pogreške odmak od 2 s do najviše 30 s.
   - Kašnjenje od tipke do prikaza tako je oko 2 s ili manje. Te su vrijednosti tehničke konstante klijenta, ne pragovi P iz Owner queuea, i ne prikazuju se korisniku.
   - Poznata cijena: uz 15.000 riječi oko 130 KB po objavi (`docs/spikes/B0.2.md`), najviše jedna u sekundi po studentu koji piše; čitanje bez promjene je 304 bez tijela. Slanje razlika umjesto cijelog dokumenta je kasniji korak bez promjene RPC-ova.
   - Kanal guranja (npr. `LISTEN/NOTIFY` i SSE) može kasnije zamijeniti polling bez promjene tablice i RPC-ova. **Pitanje za vlasnika (nije blokirajuće):** treba li ga uvesti prije pilota; ovisi o hostingu (D-08, dio o dobavljačima).
8. **Prekid veze.**
   - Student bez mreže: editor i journal rade dalje neovisno o kanalu. Objavljivač čuva samo zadnje neposlano stanje (nema reda). Po povratku veze šalje ga sa zadnjim tokenom; na `conflict` preuzima vraćeni token i šalje ponovno (jedan pisač, D-34).
   - Mentor vidi zadnje stanje koje je stiglo. Nema zasebnog signala prisutnosti ni „student je izvan mreže”; čitač vidi samo je li se stanje promijenilo (točka 1).
   - Mentor bez mreže: stranica zadržava zadnji tekst i označava stanje **vlastite** veze; po povratku nastavlja s `If-None-Match`.
   - Odjava: objavljivač staje prije ograde odjave; redak ostaje.
   - Uklonjeni student ili nastavnik dobiva `ZD403` već pri sljedećem pozivu.
   - Dvije kartice istog studenta: u svakom CAS krugu pobjeđuje zadnji prihvaćeni upis; druga kartica dobiva `conflict` i preuzima token (poznata granica, isti dokument ima jednog pisača po uređaju, D-34).
9. **Evidencija netaknuta.** pgTAP potvrđuje da su `current_revision`, `current_content_hash` i lanac segmenata jednaki prije i poslije objave i čitanja, i da nijedan RPC kanala nema ovlast na shemi `evidence`.

**pgTAP matrica (retci za `collaboration.live_state` i RPC-ove).**

| Redak | Očekivano |
| --- | --- |
| Student vlasnik: objava, ponovna objava istog tijela, čitanje | `accepted`, `unchanged`, `state` s istim bajtovima |
| Student vlasnik: zastarjeli token; `NULL` token kad redak postoji | `conflict` s trenutnim tokenom, tijelo nepromijenjeno |
| Student vlasnik: isto tijelo s važećim tokenom; isto tijelo sa zastarjelim tokenom | `unchanged` s trenutnim tokenom u oba slučaja, token se ne mijenja |
| `delete_live_state` pod `ductus_retention`; brisanje dokumenta po roku i povlačenje studenta (D-12) | 0 redaka u `live_state` za taj dokument; `ductus_app` nema `EXECUTE` (`42501`) |
| Student vlasnik bez potvrde trenutne verzije obavijesti (i nakon nove verzije zadatka) | objava `ZD403`, čitanje dopušteno |
| Nastavnik kolegija | čitanje bajt-identično studentovu; objava `ZD403` |
| Student B istog kolegija, nastavnik drugog kolegija iste ustanove, nastavnik sa zatvorenim članstvom, persona druge ustanove, administrator ustanove | `ZD403` na oba RPC-a, i s neispravnim ulazom |
| Nepostojeći dokument | isti `ZD403` |
| Bez sesije | `ZD401` |
| Izravni `SELECT`/`INSERT`/`UPDATE`/`DELETE` pod `ductus_app`, `ductus_worker`, `ductus_retention` | `42501`; uz pogrešno dodijeljen grant 0 redaka (FORCE RLS) |
| Katalog | `ductus_app` izvršava točno očekivani skup RPC-ova sheme `collaboration` (`bag_eq`), a `ductus_retention` samo `delete_live_state`; izlaz `read_live_state` nema stupca s tokenom, vremenom ni ID-om osobe; tablica nema stupca tipa `timestamptz` |
| `CHECK` | prazno tijelo, tijelo iznad 2 097 152 bajta, hash koji ne odgovara tijelu odbijeni |
| Evidencija | stanje dokumenta i segmenata jednako prije i poslije |

**Koraci.** (1) ovaj ugovor; (2) migracija, RLS, RPC-ovi i pgTAP matrica; (3) validator tijela, poslužiteljski omotač i ruta `GET`/`PUT` s unit i integracijskim testovima (uključujući bajt-jednakost studenta i nastavnika kroz API i canary loga); (4) klijentski modul objavljivača i čitača prema točkama 7 i 8, usklađen s FE-D10 (DAN-215). Svaki korak je zaseban PR vezan uz DAN-216.

**Poznate granice.**

- Nakon predaje objava se još ne zaključava; to dolazi s B-12.
- Potvrda obavijesti dana za verziju koja još ne spominje prikaz uživo vrijedi kao potvrda. Za pilot zadatak treba novu verziju obavijesti s tekstom S3, pa studenti potvrđuju ponovno.
- Nastavnik još nema popis radova ni imena studenata (identitet ih ne čuva), pa FE-D10 ID dokumenta ne može dobiti iz postojećeg API-ja. **Pitanje za orkestratora:** kako FE-D10 u demou dolazi do ID-a rada.
- Na `main` još nema produkcijskog puta koji stvara `evidence.document` (B-8); testovi ga postavljaju sami.
- Poslužiteljsko ograničenje broja zahtjeva još ne postoji; učestalost iz točke 7 drži klijent.
- Na `main` još nema puta brisanja dokumenta po roku ni povlačenja studenta (D-12); korak 2 uvodi `delete_live_state` i pgTAP redak, a poziva ga onaj PR koji uvodi taj put.
