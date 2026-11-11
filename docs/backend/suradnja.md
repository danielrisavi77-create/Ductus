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
   - Reprodukcija (DAN-344, ugovor na #923, c.6429438582) čita isti zapis s istim čitateljima i istim rezom predaje: `app.read_replay_source` je `app.read_process_summary_source` s oznakom `replay` u zapisu pristupa. `app.read_replay_checkpoints(dokument, hashevi)` vraća tekst kontrolnih točaka s traženim hashevima (početni dokument i nastavak nakon prekida lanca), samo bajtove koji daju svoj hash. Nastavnikov poziv bilo koje od njih upisuje otvaranje (jedan redak po čitatelju, radu i 5-minutnom intervalu), i za stranicu koja nije prva. Ruta `POST /api/evidence/replay` (`{documentId, from: 0}` za prvu stranicu, `{documentId, from, head}` za svaku sljedeću, s `head` koji je dala prva) daje stranicu točnih, provjerenih bajtova odsječaka (najviše 8 MiB i 256 odsječaka, najmanje jedan) kao JCS tekst, isti za studenta i nastavnika; svaki neuspjeh je 503, nikad djelomična stranica. Sljedeća stranica čita se samo iz zapisa koji završava na tom `head` (DAN-537): zapis koji je od tada narastao čita se do njega, a zapis koji ga više ne drži (rez predaje) daje 409 `record_changed`, pa preglednik kreće ispočetka i nikad ne spaja stranice dvaju zapisa. Isto vrijedi kad kontrolna točka nedostaje jer je predaja zabilježena između čitanja popisa i čitanja kontrolnih točaka, i to na svakoj stranici, pa i na prvoj (`from: 0`, bez `head`): tada se zapis provjerava prema glavi koju je ta stranica upravo pročitala, a odgovor na 409 je uvijek isti, ponovno čitanje od prve stranice. Pristup se odlučuje prije `head`, pa čitatelj bez pristupa dobiva 404, nikad 409.
   - Vlastiti zapis pristupa (DAN-294, ugovor na #1091, c.6710676431; pravilo 17, D-150): `app.read_my_access_log(dokument, granica, prije_u, prije_id)` daje studentu vlasniku, u njegovoj ustanovi, tko je otvorio njegov rad i kada: jedan redak po upisanom otvaranju (čitatelj, rad, površina i 5-minutni interval, kako ga je upisalo čitanje), s ulogom i imenom čitatelja, najnovije prvo. Granica stranice je 1 do 100, a stranica završava na cijelom 5-minutnom intervalu: uključuje sve retke intervala svojeg `granica`-tog retka, pa može biti dulja od granice za ostatak tog intervala. Kursor je par `(opened_at, entry_id)` zadnjeg retka prethodne stranice, a nastavak daje samo retke iz starijih intervala (`opened_at < prije_u`); otvaranje upisano nakon stranice vidi se samo na novoj prvoj stranici, ne u nastavku (QA #1702 c.6711590695). Nema zbroja posjeta, trajanja ni ikakvog broja. Bez sesije je `ZD401` prije svega; granica izvan 1..100 ili pola kursora je `ZD422` prije nego što se dokument pogleda; svaki drugi pozivatelj (nastavnik, drugi student, druga ustanova) i neispravan ili nepoznat dokument dobivaju isti `ZD403`. Čitanje vlastitog zapisa ništa ne upisuje.
   - Uloga čitatelja i površina u zapisu pristupa (DAN-294, M10.4-P02, ugovor na #1836, c.6788079686; D-274 MQ10): `audit.record_work_opening` uzima ulogu iz `audit.reader_role(ustanova, zadatak, vlasnik)`, u istoj transakciji kao provjera pristupa, a ne više stalnu vrijednost `teacher`. Mentor rada kojem zadatak ima mentorstvo upisuje se kao `mentor`, nastavnik kolegija kao `teacher` (i kad je ujedno nastavnik seminarske grupe), a nastavnik koji rad doseže samo preko grupe kao `seminar_teacher`. Student vlasnik, druga ustanova i čitatelj bez pristupa nemaju ulogu: upis tada daje `ZD403` i ne upisuje ništa, pa ni mentor nakon završenog mentorstva ni nastavnik s opozvanom ulogom. Površine su `live_view`, `submitted_text`, `process_summary`, `fast_path` i `replay`: `collaboration.read_live_state` za predani rad upisuje `submitted_text`, prije predaje `live_view`. Popisi bez sadržaja (predaje, radovi, studenti, kolegiji, mentorstva) ne upisuju ništa; citat do 500 znakova u sidru komentara i zahtjeva za doradu također se ne bilježi (#497, odgovor 2). Retci upisani prije ove migracije ostaju kakvi jesu, pa je čitanje predanog teksta prije nje zabilježeno kao `live_view`. Pristup podrške (D-288) nema ni ulogu ni površinu dok ne dođe DAN-312.
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
| `position` | `integer NOT NULL`, 1 do 10000, `UNIQUE (thread_id, position)`; 1 je komentar koji otvara nit (nastavnikov ili, od DAN-215, studentov) |
| `author_id` | `uuid NOT NULL`, iz `app.current_actor()`; nema parametra autora |
| `author_role` | `text NOT NULL CHECK IN ('teacher','student')`, iz `actor_assignment_role` u trenutku upisa |
| `body` | `text`, granice ispod (`CHECK`); `NULL` samo kad je komentar obrisan (DAN-215) |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `deleted_at` | `timestamptz`, `NULL` dok komentar stoji; `CHECK`: obrisan komentar nema teksta i `deleted_at >= created_at` (DAN-215) |

Tekst komentara je nepromjenjiv; uređivanja nema. U B-10 nije bilo ni brisanja; od DAN-215 student briše samo svoje komentare (pododjeljak „Nit studenta i brisanje” niže). Brisanje po pravilima čuvanja (D-50) je zaseban korak. Odgovor zaključava redak niti, pa istodobni odgovori dobivaju različite pozicije.

**Tko što smije.** Odnos se računa pri svakom pozivu iz `document_scope` i `actor_assignment_role`, bez predmemorije, pa uklonjeni nastavnik gubi i čitanje i pisanje odmah (§4.4).

| Akter | Čita | Novi korijen sa sidrom | Odgovor | Promjena stanja |
| --- | --- | --- | --- | --- |
| Student vlasnik dokumenta (`principal_id` = akter, ista ustanova, `actor_assignment_role` = `student`) | sve niti svog dokumenta | da, od DAN-215 | da | ne |
| Nastavnik kolegija tog zadatka (`actor_assignment_role` = `teacher`, otvoreno članstvo) | sve niti dokumenta | da | da | da |
| Svi ostali (N2 drugog kolegija, Student B istog kolegija, N1 druge ustanove, administrator, istekla ili nepostojeća sesija) | ništa | ne | ne | ne |

Sesija bez aktera: `ZD401`. Svaki drugi odbijen slučaj, uključujući nepostojeći dokument ili nit: `ZD403` s istom porukom, bez razlike u obliku odgovora (napadi 1 i 12).

**Stanja niti.** Jedini prijelazi; svaki drugi je `ZD409`:

| Iz | U | Okidač |
| --- | --- | --- |
| (nema) | `open` | nastavnik stvara korijen |
| (nema) | `answered` | student stvara korijen (DAN-215): nit čeka nastavnika |
| `open` | `answered` | odgovor studenta |
| `answered` | `open` | odgovor nastavnika |
| `open`, `answered` | `resolved` | nastavnik `resolve_thread` |
| `resolved` | `open` | nastavnik `reopen_thread` |

Odgovor u niti `resolved` je `ZD409` (nit se prvo ponovno otvara). Ostali prijelazi (npr. odgovor nastavnika na `open`, odgovor studenta na `answered`) ne mijenjaju stanje.

**RPC potpisi** (`SECURITY DEFINER`, `SET search_path = ''`, `EXECUTE` samo `ductus_app`):

- `collaboration.create_comment(p_document_id text, p_body text, p_anchor jsonb) RETURNS uuid`: nastavnik ili, od DAN-215, student vlasnik rada; vraća `id` nove niti.
- `collaboration.reply_comment(p_thread_id uuid, p_body text) RETURNS uuid`
- `collaboration.resolve_thread(p_thread_id uuid) RETURNS void`, `collaboration.reopen_thread(p_thread_id uuid) RETURNS void`
- `collaboration.delete_comment(p_comment_id uuid) RETURNS void` (DAN-215): samo student vlasnik rada, samo svoj komentar.
- `collaboration.list_comments(p_document_id text) RETURNS TABLE (thread_id, comment_id, comment_position, author_role, is_own, body, anchor, state, created_window, deleted_window)` (`deleted_window` od DAN-215); `anchor` je popunjen samo u retku pozicije 1: **ista funkcija i isti oblik izlaza za studenta i nastavnika** (`PRODUCT.md` §5 t. 5).

`ductus_app` nema nikakvu ovlast ni na jednoj tablici sheme `collaboration`, ni `SELECT`: izravno čitanje otkrilo bi točna vremena i ID-ove osoba, pa klijent čita samo kroz `list_comments` (napad 4). Tablice imaju `FORCE ROW LEVEL SECURITY` sa samo vlasnikovom politikom, pa ni pogrešno dodijeljen grant ne pokazuje ni ne mijenja nijedan redak; retci su u pgTAP matrici.

**Što se nikad ne vraća.** `author_id` drugih osoba, `institution_id`, točno vrijeme (`created_at` se vraća samo zaokružen na prozor P-03 od 5 minuta, `created_window`; redoslijed nosi `comment_position`), sadržaj dokumenta, segmenti, hashevi i revizije. Poslužitelj **ne razrješuje sidro** prema sadržaju i ne vraća nikakav isječak dokumenta: vraća sidro kako ga je nastavnik spremio, iz teksta koji je već vidio, a klijent ga razrješuje lokalno s `resolveTextAnchor` (exact, moved, ambiguous, missing). Zato poziv ne može otkriti tekst noviji od nastavnikova pogleda (napad 8). Neprouzdano sidro (`ambiguous`, `missing`) prikazuje se kao "sidro nije pouzdano" uz komentar koji ostaje vidljiv, nikad na pogrešnom mjestu (napad 7). U B-10 student nije stvarao sidro jer bi ono nosilo njegov noviji tekst. Od DAN-215 (D-201 t. 3(c)) student otvara nit na svom radu: citat u sidru je iz njegova vlastitog teksta i nastavniku ga daje sam, svojim komentarom, pa to nije bočni kanal kakav opisuje napad 8.

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

#### Nit studenta i brisanje (DAN-215, M6.1-P03)

Odluka D-201 t. 3(c) (uz D-133 i D-134, odlučene kroz D-266 t. 1): student koji je vlasnik rada otvara nit i briše samo svoje komentare, a brisanje ostaje u povijesti niti. Plan napada #1886; ugovor na #1836. Migracija `20261111120000_comment_student_thread_delete.sql`; nova tablica se ne uvodi, `collaboration.comment` zadržava `FORCE ROW LEVEL SECURITY` i `ductus_app` je i dalje doseže samo kroz RPC-ove.

- **Otvaranje niti.** `create_comment` prima nastavnika i studenta vlasnika rada (`collaboration.actor_role` daje `teacher` ili `student`); svi ostali, uključujući studenta na tuđem radu, dobivaju isti `ZD403` kao za nepostojeći dokument. Granice tijela i sidra jednake su nastavnikovima (`ZD422`). Studentova nit počinje u stanju `answered` jer čeka nastavnika; daljnji prijelazi su kao u tablici gore. Razrješava i ponovno otvara i dalje samo nastavnik (`ZD403`).
- **Brisanje.** `delete_comment(p_comment_id)` smije samo student vlasnik rada, samo za komentar kojemu je sam autor (`author_role = 'student'`, `author_id` = akter), u bilo kojem stanju niti. Komentar nastavnika ili mentora, komentar druge osobe, komentar iz druge ustanove i nepostojeći id daju isti `ZD403`; drugo brisanje istog komentara je `ZD409`. Neispravan id (nije UUID) ruta odbija kao `ZD422` prije baze. Nastavnik i mentor ne brišu komentare: D-201 t. 3(c) govori samo o studentu.
- **Što ostaje.** Obrisani komentar zadržava redak, poziciju, ulogu autora i (za poziciju 1) sidro niti; nestaje samo tekst (`body = NULL`), a `deleted_at` bilježi kada. Brisanje ne mijenja stanje niti i ne oslobađa poziciju, pa granica od 10 000 pozicija vrijedi kao i prije. Teksta nema ni u jednom odgovoru, ni u drugom RPC-u, ni u izravnom čitanju tablice.
- **Prikaz.** `list_comments` vraća obrisani komentar na njegovu mjestu u niti, studentu i nastavniku isti redak: `body` je `null`, a `deleted_window` je vrijeme brisanja zaokruženo na prozor od 5 minuta (kao `created_window`). Za komentar koji stoji `deleted_window` je `null`. HTTP ruta vraća polje `deletedWindow`; klijent prihvaća samo komentar koji stoji (tekst, bez `deletedWindow`) ili obrisan komentar (bez teksta, s `deletedWindow`), a svaki drugi oblik smatra neispravnim odgovorom.
- **Istodobnost.** `delete_comment` prvo zaključava redak niti (kao odgovor), zatim komentar. Dva brisanja istog komentara i brisanje u utrci s odgovorom zato se izvode jedno za drugim; drugi poziv vidi potvrđen rezultat prvoga.
- **HTTP.** `POST /api/comments/delete` s tijelom `{commentId}`; uspjeh je 204 bez tijela. Vrijede zaštite mutacije kao za ostale radnje; zapisnik nosi samo radnju i kod greške, nikad tekst komentara.
- **Silazna migracija.** Tekst obrisanog komentara ne može se vratiti, a stara tablica ne dopušta komentar bez teksta, pa silazna migracija odbija rad dok postoji ijedan obrisan komentar. Bez obrisanih komentara vraća stare funkcije; niti koje je otvorio student ostaju i stare ih funkcije čitaju kao svaku drugu nit.

**Napadi iz #1886 na testove.**

| Napad | Dokaz |
| --- | --- |
| N1, N2, N3, N4, N5, N6, N18 | pgTAP `121`: komentar nastavnika, mentora i druge osobe, druga ustanova, nepostojeći id i nastavnikovo brisanje daju `ZD403`, bez sesije `ZD401`; komentar je nakon toga nepromijenjen. Unit (`comments.test.ts`): neispravan id je 422 bez poziva baze |
| N7, N12 | pgTAP `121`: drugo brisanje je `ZD409`, a vrijeme brisanja ostaje od prvoga; brisanje u stanju `open`, `answered` i `resolved` ne mijenja stanje |
| N8, N9 | integracija (`tests/integration/comment-delete-race.integration.test.ts`): drugi poziv stvarno čeka na zaključanu nit (`pg_stat_activity`), zatim `ZD409`; utrka s odgovorom nastavnika daje neprekinute pozicije i ispravno stanje u oba redoslijeda |
| N10, N11, N13 | pgTAP `121`: isti redak za studenta i nastavnika, bez teksta, sa sidrom niti; izravno čitanje pod `ductus_app` odbijeno |
| N14, N15, N16, N17 | pgTAP `121`: otvaranje na tuđem, drugom ili nepostojećem radu `ZD403`; neispravno tijelo ili sidro `ZD422`; razrješavanje `ZD403`; nastavnik vidi nit i odgovara |
| N19 | pgTAP `121` i katalog: evidencija netaknuta, `ductus_app` izvršava točno navedene RPC-ove |
| N20 | pgTAP `121`: obrisani komentari ne oslobađaju pozicije |
| N21 | unit (`comments.test.ts`): odgovor rute i zapisnik bez teksta komentara i id-ja osobe; zaštite mutacije |
| N22 | opis PR-a i ovaj pododjeljak (silazna migracija) |
| N23 | ovaj pododjeljak i polje `deletedWindow`: obrisan komentar opisuje se kao obrisan |

**Poznate granice (DAN-215).** Sučelje za otvaranje niti i brisanje te prikaz obrisanog komentara su Frontendov korak; do tada postojeće sučelje obrisani komentar prikazuje kao prazan odlomak. `institution.can('comment', …)` se ne mijenja u ovom koraku i za studenta i dalje vraća `false`; usklađivanje s `actor_role` ide uz korak sučelja.

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
   - **Nakon predaje** (iznimka iz točke 1): `publish_live_state` ništa ne piše i daje `ZD403`, kao svaka odbijena objava, prije provjere ulaza. `read_live_state` ne čita zadnje stanje, nego studentu i nastavniku jednako vraća `submitted` s hashem i tekstom predane revizije (tijelo izostaje kad je `p_known_hash` jednak tom hashu, kao kod `unchanged`), ili `unavailable` kad snimke predane revizije nema ili se njezini bajtovi ne slažu s `artifact_hash`. Nastavnikovo čitanje i dalje se upisuje u zapis pristupa, s površinom `submitted_text` (DAN-294). Sam zahtjev i odbijena predaja (`artifact_mismatch`) ne mijenjaju ništa.
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

### 4.14 Zahtjev za doradu (D-45, DAN-314)

Ugovor prije koda za M6.5-P01 (plan napada #1506; odgovori orkestratora po delegaciji vlasnika, #1506 komentar 6626381901; potvrda ugovora s četiri odluke, #1091 komentar 6626606552; uzorak §4.11 i #177). Zahtjev za doradu je **zaseban zapis sa sidrom** u shemi `collaboration`, kao komentar iz §4.11, ali nije vrsta niti komentara i ne gradi se na D-133 (PRIJEDLOG). Nikad ne mijenja dokument, reviziju, segment, potvrdu ni hash. Komentari se ne broje kao zahtjevi (D-170 O2). Ništa se ne prihvaća, ne zatvara i ne otvara automatski: svaki prijelaz je izričita radnja jedne osobe (D-243). Napadi A do H iz #1506 su kriterij prihvata. I je korak sučelja, a F pripada DAN-266.

**Shema i vlasništvo.** Kao §4.11: tablice i RPC-ovi su u vlasništvu `ductus_identity`, opseg dokumenta daje `collaboration.document_scope`, a ulogu `collaboration.actor_role`. Nema stranog ključa prema `evidence.document` i nema nikakve ovlasti na shemi `evidence`. Tablice imaju `ENABLE` i `FORCE ROW LEVEL SECURITY` sa samo vlasnikovom politikom. `ductus_app`, `ductus_worker` i `ductus_retention` nemaju nikakvu ovlast ni na jednoj od njih, ni `SELECT`. Retci su u pgTAP matrici.

**Tablica `collaboration.revision_request`** (jedan zahtjev, jedno sidro, trenutačno stanje).

| Stupac | Tip i ograničenje |
| --- | --- |
| `id` | `uuid`, PK, generira baza |
| `institution_id`, `assignment_id`, `owner_id` | `uuid NOT NULL`, iz `document_scope` pri stvaranju, nikad iz parametra |
| `document_id` | `text NOT NULL` |
| `anchor` | `jsonb NOT NULL`, `CHECK (collaboration.is_text_anchor(anchor))`; nepromjenjiv, a drugi raspon je novi zahtjev |
| `state` | `text NOT NULL CHECK IN ('open','responded','accepted','reopened','withdrawn')` |
| `version` | `integer NOT NULL`, 1 do 1000; trenutačna verzija zahtjeva (D-243) |
| `row_seq` | `bigint NOT NULL UNIQUE`, 1 do 2^53 − 1; brojač upisa, uvijek `nextval('collaboration.revision_request_seq')` pri stvaranju i pri svakom uspješnom prijelazu ili odgovoru |
| `created_by` | `uuid NOT NULL`, iz `app.current_actor()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Tablica `collaboration.revision_request_version`** (jedan redak po verziji; povijest se ne prepisuje).

| Stupac | Tip i ograničenje |
| --- | --- |
| `request_id`, `institution_id` | `uuid NOT NULL`, strani ključ na zahtjev iste ustanove, `ON DELETE CASCADE` |
| `version` | `integer NOT NULL`, 1 do 1000; PK (`request_id`, `version`) |
| `instruction` | `text NOT NULL`, `CHECK (collaboration.is_revision_text(instruction))` |
| `requested_revision` | `bigint NOT NULL`, 0 do 2^53 − 1; revizija dokumenta koju je nastavnik vidio kad je otvorio verziju, a kod verzije otvorene ponovnim pregledom trenutačna revizija dokumenta koju je baza pročitala pri pozivu |
| `opened_by`, `opened_at` | `uuid NOT NULL` iz `app.current_actor()`; `timestamptz NOT NULL DEFAULT now()` |
| `opened_as` | `text NOT NULL DEFAULT 'instruction' CHECK IN ('instruction','rereview')`; `rereview` upisuje samo `rereview_revision_request` |
| `observed_range_hash` | `text NULL`, `^[0-9a-f]{64}$`; hash raspona koji je baza izračunala pri ponovnom pregledu, `NULL` kad se raspon više ne razrješuje; smije biti popunjen samo uz `opened_as = 'rereview'` (`CHECK`). Uz pravilo usporedivosti (niže) ponovni pregled danas uvijek upisuje `NULL` |
| `closed_as` | `text NULL CHECK IN ('accepted','reopened','withdrawn')`; postavlja se jednom i nikad ne mijenja |
| `closed_by`, `closed_at` | `NULL` dok je `closed_as` `NULL`, inače obavezni (`CHECK`) |
| `accepted_revision` | `bigint NULL`, 0 do 2^53 − 1; obavezan točno kad je `closed_as = 'accepted'` |
| `accepted_range_hash` | `text NULL`, `^[0-9a-f]{64}$`; smije biti `NULL` samo uz `accepted` (sidro nije razriješeno), inače je `NULL` |
| `accepted_anchor` | `jsonb NULL`, `CHECK (collaboration.is_text_anchor(accepted_anchor))`; sidro raspona koji je nastavnik prihvatio u reviziji `accepted_revision` (#1831 B, #87 komentar 6763239855). `NULL` točno kad je `accepted_range_hash` `NULL` (`CHECK`). Prihvaćanja upisana prije ovog stupca dobivaju sidro zahtjeva |

**Tablica `collaboration.revision_response`** (odgovor studenta; najviše jedan po verziji).

| Stupac | Tip i ograničenje |
| --- | --- |
| `id` | `uuid`, PK, generira baza |
| `request_id`, `institution_id`, `version` | strani ključ na (`request_id`, `version`) verzije, `ON DELETE CASCADE`; `UNIQUE (request_id, version)` |
| `kind` | `text NOT NULL CHECK IN ('done','declined')`: proveden ili obrazloženo ne pristaje (D-45) |
| `explanation` | `text NOT NULL`, `CHECK (collaboration.is_revision_text(explanation))`; obavezno za obje vrste |
| `response_revision` | `bigint NOT NULL`, 0 do 2^53 − 1 i nije manji od `requested_revision` te verzije (provjerava RPC) |
| `author_id` | `uuid NOT NULL`, iz `app.current_actor()`; nema parametra autora |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Ugovor nema stanja `SHARED_FOR_REVIEW`, `NEEDS_CLARIFICATION`, `REREVIEW_REQUIRED` ni `RESOLVED` iz `docs/FUNCTIONAL_ARCHITECTURE_V1.md` §13.4. „Traži pojašnjenje” i „ponovni pregled” su `reopened` s novom verzijom. FA stanje `REREVIEW_REQUIRED` je `reopened` na verziji s `opened_as = 'rereview'`, a njegov izlaz `REREVIEW_REQUIRED -> STUDENT_RESPONDED` (#87 komentar 6691142048) je postojeći `respond_revision_request` iz `reopened`. FA polje `resolved_in_version_id` je verzija koja nosi `closed_as = 'accepted'`. Kasnije proširenje skupa je jeftina migracija `CHECK`-a.

**Stanja i prijelazi.** `v` je trenutačna verzija. Ovo su jedini prijelazi; svaki drugi par (stanje, radnja) je `ZD409`, a stanje i povijest ostaju nepromijenjeni.

| Iz | Radnja | Tko | U | Verzija | Upis |
| --- | --- | --- | --- | --- | --- |
| (nema) | `create_revision_request` | nastavnik | `open` | 1 | zahtjev i verzija 1 |
| `open`, `reopened` | `respond_revision_request` (`done` ili `declined`) | student vlasnik | `responded` | `v` | odgovor na verziju `v` |
| `responded` | `accept_revision_request` | nastavnik | `accepted` | `v` | verzija `v`: `closed_as = 'accepted'`, `accepted_revision`, `accepted_range_hash`, `accepted_anchor` |
| `open`, `reopened`, `responded`, `accepted` | `reopen_revision_request` (nova uputa) | nastavnik | `reopened` | `v + 1` | verzija `v` dobiva `closed_as = 'reopened'` ako još nije zatvorena (prihvaćena ostaje `accepted`), nastaje verzija `v + 1` |
| `accepted`, uz prihvaćen raspon (`accepted_anchor`) za koji baza utvrdi da se promijenio | `rereview_revision_request` | student vlasnik ili nastavnik | `reopened` | `v + 1` | verzija `v` ostaje `accepted`; nastaje verzija `v + 1` s prepisanom uputom verzije `v`, `opened_as = 'rereview'` i `observed_range_hash` (danas `NULL`) |
| `open`, `reopened`, `responded` | `withdraw_revision_request` | nastavnik | `withdrawn` | `v` | verzija `v`: `closed_as = 'withdrawn'` |

- `withdrawn` je završno stanje: zahtjev se ne briše, objema stranama ostaje vidljiv kao povučen i ne može se ponovno otvoriti. Povlačenje iz `accepted` nije dopušteno.
- Ponovno otvaranje i ponovni pregled iz `version = 1000` su `ZD409`.
- Prihvatiti se smije i odgovor `declined`: nastavnik time prihvaća obrazloženje. Vrsta odgovora ostaje u povijesti.
- Na mjestu nema uređivanja upute ni odgovora. Izmijenjena uputa je nova verzija (D-243). Student koji je odbio, a zatim ipak proveo doradu, čeka novu verziju (napad E4).
- **Nijedan drugi put ne mijenja stanje.** Promjena teksta ili raspona, nova revizija, objava uživo (§4.12), predaja, oznaka „promijenjeno nakon prihvaćanja” (DAN-266) i S-UV1 (`conditional-validity.ts`, zastavica) same ne stvaraju verziju ni prijelaz. Poslužitelj S-UV1 ne poziva. Promijenjen prihvaćen raspon vraća zahtjev na pregled samo pozivom `rereview_revision_request` („Promijenjeno nakon prihvaćanja” niže): bez okidača i bez pozadinskog posla.
- **Verzija nije brojač upisa.** Verziju mijenjaju samo `reopen`, kao nastavnikova radnja (D-243), i ponovni pregled. Za usporedbu i upis služi zaseban `row_seq`, pa ishod ne ovisi o tome ponavlja li se stanje.

**Očekivani brojač upisa i ishodi** (odluka orkestratora 1, #1091 komentar 6626606552). Svaki RPC pisanja osim stvaranja prima `p_expected_seq bigint`, to jest `row_seq` koji je klijent zadnje pročitao. Brojač se odnosi na zahtjev, nikad na reviziju dokumenta. Revizija je zasebno polje, pa tipkanje studenta između učitavanja i slanja ne poništava valjan odgovor (napad C5). Redak zahtjeva zaključava se s `FOR UPDATE`, pa su usporedba i upis jedan korak. Ishodi `RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)`:

- `applied`: brojač je jednak spremljenom i prijelaz je dopušten. Upisuje se, `row_seq` dobiva sljedeću vrijednost sekvence i vraća se novo stanje.
- `conflict`: brojač se razlikuje od spremljenog. Ne piše se ništa i vraćaju se trenutačni `row_seq`, `version` i `state`. Ponovljen identičan poziv (dvostruki klik, ponavljanje mreže) nosi stari brojač i uvijek dobiva `conflict`, a iz vraćenog stanja klijent vidi da je radnja već provedena. Ponavljanje nije idempotentan uspjeh, pa nikad ne nastanu dva odgovora ni dva prijelaza.
- `ZD409`: brojač je jednak, ali radnja iz tog stanja nije dopuštena. Ne piše se ništa i `row_seq` ne raste. Klijent tako razlikuje „ponovno učitaj” (`conflict`) od „nije dopušteno” (`ZD409`).
- `p_expected_seq` koji nedostaje, je `NULL` ili nije cijeli broj 1 do 2^53 − 1 daje `ZD422`. Nedostajući brojač nikad ne znači „preskoči provjeru”.
- **Brojač je vezan uz zahtjev (napad C4).** Sve vrijednosti `row_seq` dolaze iz jedne sekvence `collaboration.revision_request_seq` (vlasnik `ductus_identity`, `NO CYCLE`, `MAXVALUE` 2^53 − 1, bez ovlasti za druge uloge). Zato se nijedna vrijednost ne dodjeljuje dvaput, ni istom ni drugom zahtjevu, a `UNIQUE` to čini provjerljivim. Brojač pročitan s drugog zahtjeva nikad nije jednak spremljenom i uvijek daje `conflict`. Brojač raste, ali ne nužno za 1, pa klijent ne smije računati sljedeću vrijednost.

**RPC potpisi** (`SECURITY DEFINER`, `SET search_path = ''`, identitet i ustanova iz `current_actor()`, `EXECUTE` samo `ductus_app`):

- `collaboration.create_revision_request(p_document_id text, p_anchor jsonb, p_instruction text, p_requested_revision bigint) RETURNS TABLE (request_id uuid, row_seq bigint, version integer, state text)`; novi zahtjev dobiva `row_seq` iz sekvence
- `collaboration.respond_revision_request(p_request_id uuid, p_expected_seq bigint, p_kind text, p_explanation text, p_response_revision bigint)`
- `collaboration.accept_revision_request(p_request_id uuid, p_expected_seq bigint, p_accepted_revision bigint, p_range_hash text, p_accepted_anchor jsonb DEFAULT NULL)`
- `collaboration.reopen_revision_request(p_request_id uuid, p_expected_seq bigint, p_instruction text, p_requested_revision bigint)`
- `collaboration.rereview_revision_request(p_request_id uuid, p_expected_seq bigint)`
- `collaboration.withdraw_revision_request(p_request_id uuid, p_expected_seq bigint)`
- `collaboration.list_revision_requests(p_document_id text)`: čitanje, opisano niže.
- `collaboration.delete_revision_requests(p_document_id text, p_institution_id uuid) RETURNS void`: u vlasništvu `ductus_identity`, `EXECUTE` samo `ductus_retention` (ne `ductus_app`). Briše sve zahtjeve dokumenta, a verzije i odgovori odlaze kaskadom. Bez redaka ne radi ništa. Ne prima ni ne vraća tekst.

Pet RPC-ova prijelaza vraća `(outcome, row_seq, version, state)` kao gore. Opseg zahtjeva uvijek dolazi iz spremljenog retka, nikad iz parametra, pa se ID zahtjeva ne može spojiti s drugim dokumentom ili radom (napad A12).

**Revizije.** Sve su sigurni cijeli brojevi 0 do 2^53 − 1. Kod revizija koje šalje pozivatelj provjerava se samo oblik i poredak, ne postojanje u evidenciji:

- `response_revision ≥ requested_revision` te verzije (pravilo iz `revision-request.ts` i FA §13.4);
- `accepted_revision ≥ response_revision` odgovora te verzije;
- `requested_revision` nove verzije nije manji ni od jedne revizije već zapisane na zahtjevu.

Kršenje je `ZD422` bez odjeka. Ponovni pregled ne prima reviziju: baza čita snimku spremljene `accepted_revision` i snimku trenutačne revizije dokumenta. Zasebne usporedbe revizija nema, jer ista revizija znači istu snimku i isti hash, pa je ishod `ZD409` („Promijenjeno nakon prihvaćanja” niže).

**Prihvaćanje: revizija i hash raspona** (`ARCHITECTURE.md` §5a). Pri prihvaćanju se sprema `accepted_revision`, odnosno revizija dokumenta koju je nastavnik pregledao, i `accepted_range_hash`. Poslužitelj ne razrješuje sidro (§4.11, napad 8), pa hash računa **nastavnikov klijent**. Uzima tekst revizije `accepted_revision` koji je već vidio, razriješi sidro raspona koji prihvaća s `resolveTextAnchor` i računa SHA-256 (hex, mala slova) UTF-8 bajtova teksta razriješenog raspona, bez dodatne normalizacije. To je sidro zahtjeva ili, kad je student citirani tekst zamijenio, sidro zamjenskog raspona (niže). To radi jedna domenska funkcija u `src/domain/collaboration/` koju koristi i projekcija DAN-266. Uz `exact` i `moved` hash je obavezan. `NULL` znači „nastavnik nije prihvatio nijedan raspon” (niže, „Kada klijent šalje `NULL`”). Kako projekcija čita `NULL`, odlučuje DAN-266. Poslužitelj provjerava samo oblik hasha.

**Prihvaćanje veže prihvaćen raspon** (#1831 B, odluka vlasnika #87 komentar 6763239855). Uz hash klijent šalje i `acceptedAnchor`, sidro raspona koji je nastavnik doista prihvatio u reviziji `accepted_revision` i pod kojim je hash izračunao. Ono nije uvijek sidro zahtjeva: kad student u odgovoru `done` zamijeni citirani tekst Q s Q′, nastavnik prihvaća raspon Q′. Baza ga sprema u `accepted_anchor`, a ponovni pregled uspoređuje upravo njega.

- HTTP: `rangeHash` i `acceptedAnchor` su oba obavezna ključa i dolaze zajedno: oba `null` (ništa nije razriješeno) ili ispravan hash uz ispravno sidro (§4.11, `is_text_anchor`). Hash bez sidra, sidro bez hasha i neispravno sidro ruta odbija s `ZD422` prije baze.
- SQL: `p_accepted_anchor` ima `DEFAULT NULL` radi postojećih poziva s četiri parametra. Hash bez sidra veže sidro zahtjeva; sidro bez hasha ili sidro koje nije tekstno sidro daje `ZD422`. Asimetrija je namjerna: ruta je jedini klijent i uvijek šalje par.
- Baza ne provjerava pri prihvaćanju da sidro u toj reviziji daje poslani hash; to provjerava ponovni pregled („Usporedivo prihvaćanje” niže).
- Kada klijent šalje `NULL` (ugovor #1836 komentar 6763438585, ispravak orkestratora 6763602946): samo kad nastavnik ne prihvaća nijedan raspon, jer ni sidro zahtjeva ni zamjenski raspon u reviziji `accepted_revision` nisu razriješeni (`ambiguous` ili `missing`). Zamijenjen citat nije takav slučaj: nastavnik prihvaća raspon Q′ i šalje njegovo sidro i hash. Uz `NULL` ponovni pregled to prihvaćanje nikad ne otvara (`ZD409`); ostaje samo nastavnikovo ponovno otvaranje (`reopen`).
- Klijentskog pozivatelja prihvaćanja u `src/` i `app/` još nema; jedini je ruta `POST /api/revision-requests/accept`. Sučelje koje ga uvede šalje par kako piše gore.

**Promijenjeno nakon prihvaćanja: ponovni pregled** (M6.5-P02; ugovor #1091 komentar 6752687836, sužen odlukom orkestratora #1091 komentar 6754441692; O7, #87 komentar 6581656612). Prihvaćanje nije konačna predaja. Kad se prihvaćen raspon u kasnijoj reviziji dokumenta promijeni, zahtjev se vraća na pregled kao nova verzija. Prijelaz je jedan RPC, `rereview_revision_request`, migracija `20261109210000`:

- **Tko poziva i što šalje.** Student vlasnik ili nastavnik zadatka, svatko za sebe i sa svojom sesijom. Pozivatelj šalje samo zahtjev i očekivani brojač. Hash, reviziju i tekst ne šalje: je li se raspon promijenio utvrđuje baza, nikad vrijednost iz klijenta (nalaz reviewa #1831 komentar 6754364680).
- **Čitanje raspona u bazi.** Ovo je jedino mjesto na kojem poslužiteljska strana razrješuje sidro (iznimka od §4.11, napad 8, po odluci 6754441692). Radi to funkcija `collaboration.range_hash_at(p_document_id text, p_institution_id uuid, p_anchor jsonb, p_revision bigint) RETURNS TABLE (revision bigint, range_hash text)`. Vlasnik joj je `ductus_evidence`, `SECURITY DEFINER` je, a `EXECUTE` ima samo `ductus_identity` (kao `lock_document_for_write`), pa shema `collaboration` i dalje nema ovlast na `evidence`. Čita `evidence.document` i jednu snimku (`evidence.document_checkpoint`): uz `p_revision` snimku te revizije, a uz `NULL` snimku trenutačne revizije, koja tada mora imati i `content_hash` jednak trenutačnom hashu dokumenta. Ponovni pregled je zove dvaput, za prihvaćenu i za trenutačnu reviziju. Vraća samo reviziju i hash: tekst ne izlazi iz funkcije, ni web procesu ni u log.
- **Razrješenje.** Isto pravilo kao `resolveTextAnchor` (`src/domain/collaboration/anchor.ts`): prvi blok s `nodeId` sidra, tekstovi njegovih izravnih potomaka spojeni redom, sve pojave citata (i preklopljene), po jedan bod za prefiks neposredno ispred i sufiks neposredno iza. Raspon je razriješen kad točno jedna pojava ima najviši zbroj; više od 1000 pojava nikad nije razriješeno. Tekst bloka jednak je onome koji editor daje kao `textContent`: potomak bez teksta (citat izvora) ne dodaje ništa. Usporedba ide po UTF-8 bajtovima, što u ispravno oblikovanom tekstu nalazi iste pojave kao usporedba po kodnim jedinicama. Razriješen raspon je sam citat, pa mu je hash SHA-256 bajtova citata, isti koji `snapshotHash` daje pri prihvaćanju. Jednakost s `resolveTextAnchor` dokazuje tablica u integracijskom testu, a od dva bloka s istim `nodeId` čita se prvi (pgTAP 119).
- **Usporedivo prihvaćanje.** Ponovno se pregledava samo prihvaćanje čiji je `accepted_range_hash` jednak hashu koji baza sama izračuna razrješenjem `accepted_anchor` (ne sidra zahtjeva) u snimci revizije `accepted_revision`. Prihvaćanje bez hasha ili bez prihvaćenog sidra odbija se s `ZD409` prije ikakvog čitanja rada; `CHECK` jamči da su oba `NULL` ili oba popunjena. Prihvaćanje s hashem koji baza u prihvaćenoj reviziji ne dobije također je `ZD409`, bez obzira na to što dokument sada sadrži: tako je kad je hash izmišljen, ali i kad je hash doista hash citata, a raspon se u prihvaćenoj reviziji nije razrješavao (blok ne postoji, citata nema ili je višeznačan). Tada ostaje nastavnikov `reopen`. Zato spremljeni hash sam po sebi nikad ne znači promjenu.
- **Pravilo promjene.** Uz usporedivo prihvaćanje prijelaz je dopušten samo kad se `accepted_anchor` u snimci trenutačne revizije više ne razrješuje jednoznačno (blok ne postoji, citata nema ili je višeznačan), to jest kad hash koji baza ondje dobije nije jednak prihvaćenom. Sve ostalo je `ZD409`: raspon i dalje stoji, a to vrijedi i kad dokument nema reviziju nakon `accepted_revision`, jer se tada dvaput čita ista snimka. Izmjena teksta oko citata koji i dalje stoji jednoznačno nije promjena raspona, kao ni izmjena drugog odlomka.
- **Nečitljiv rad nije promjena.** Ako dokumenta ili snimke prihvaćene ili trenutačne revizije nema, ako snimka trenutačne revizije nema hash dokumenta, ili ako snimka nije dokument s nizom `nodes` (odnosno pogođeni blok nema niz `children`), funkcija diže `ZD503` („rad nije dostupan”), a ruta odgovara 503. Ništa se ne upisuje.
- **Upis.** Verzija `v` ostaje `closed_as = 'accepted'` sa svojim odgovorom. Nastaje verzija `v + 1` s uputom prepisanom iz verzije `v`, `requested_revision` jednakim pročitanoj trenutačnoj reviziji dokumenta, `opened_as = 'rereview'` i `observed_range_hash`, koji je uz pravilo usporedivosti uvijek `NULL` (raspon se više ne razrješuje). Stanje je `reopened`, pa student odgovara na verziju `v + 1` postojećim `respond_revision_request`, a nastavnik zatim prihvaća, ponovno otvara ili povlači kao i inače.
- **Bez presude.** Nova verzija bilježi samo da je otvorena ponovnim pregledom i na kojoj reviziji. Ne nastaje ocjena, odluka ni zaključak o autoru ili načinu nastanka promjene (`PRODUCT.md` §5 pravilo 7). Zapis o pisanju (segmenti, paketi, potvrde, događaji) se ne čita; čitaju se samo snimke prihvaćene i trenutačne revizije, i ništa se u evidenciji ne mijenja.
- **Granica ponavljanja.** Ponovni pregled polazi samo iz `accepted`, pa je po jednom nastavnikovu prihvaćanju moguć najviše jedan. Nova verzija nema prihvaćanje dok je nastavnik ponovno ne prihvati.
- **Istodobnost.** Poziv zaključava redak zahtjeva prije usporedbe brojača, a redak dokumenta (`FOR SHARE`) prije čitanja raspona, pa commit segmenta ne može promijeniti reviziju između čitanja i upisa. Prihvaćanje upisuje `accepted_anchor` u istoj naredbi kao `closed_as`, `accepted_revision` i `accepted_range_hash`, pod istim `FOR UPDATE` i uz isti novi `row_seq`, pa ponovni pregled nikad ne vidi prihvaćanje bez njegova sidra. Od dva istodobna ponovna pregleda s istim brojačem jedan je `applied`, a drugi `conflict` bez nove verzije. Ponovni pregled s brojačem učitanim prije prihvaćanja koje upravo traje također je `conflict`; tekst odgovora i uputa ostaju netaknuti. Dokaz: pgTAP 119 i integracijski test s dvije stvarne veze (`revision-request-submission-race`).
- **Trošak čitanja.** Mjereno na lokalnom PostgreSQL-u 16: jedan odlomak od 2 MB s 1001 pojavom citata oko 180 ms, citat kojeg u odlomku od 2 MB nema oko 30 ms, mali odlomak u dokumentu od 2 MB oko 12 ms. Petlja staje na 1001. pojavi. Poziv čita najviše dvije snimke, pa je gornja granica dvostruka.

**Tko što smije.** Odnos se računa pri svakom pozivu iz spremljenog opsega (`document_scope` pri stvaranju i čitanju) i `collaboration.actor_role`, bez predmemorije. Uklonjeni nastavnik gubi i čitanje i pisanje odmah (§4.4).

| Akter | Čita | Stvara, prihvaća, ponovno otvara, povlači | Odgovara |
| --- | --- | --- | --- |
| Student vlasnik dokumenta (`actor_role` = `student`) | da | `ZD403` | da |
| Svaki nastavnik zadatka s otvorenim članstvom (`actor_role` = `teacher`), i za zahtjev koji je otvorio drugi nastavnik (D-154) | da | da | `ZD403` |
| Mentor rada | kao nastavnik zadatka: djeluje u ulozi `teacher`, a redak `mentorship` u `actor_role` i matrici dodaje se s DAN-349 (kao §4.12 t. 4) | | |
| Student B istog kolegija, nastavnik drugog kolegija, nastavnik sa zatvorenim članstvom, persona druge ustanove, administrator ustanove | `ZD403` | `ZD403` | `ZD403` |
| Bez sesije | `ZD401` | `ZD401` | `ZD401` |

Nastavnik ne odgovara u ime studenta, a student ne stvara, ne prihvaća i ne povlači zahtjev (napadi A6 i A7). Jedina radnja koju smiju obje strane je `rereview_revision_request`: student vlasnik i nastavnik zadatka dobivaju isti ishod, koji ovisi samo o onome što baza pročita, a svi ostali `ZD403` kao u tablici.

**Redoslijed provjera i kodovi.** Ovlast se uvijek provjerava prije ulaza, pa neovlašten poziv s neispravnim ulazom dobiva `ZD403`, ne `ZD422`. Svaki odbijen slučaj, uključujući nepostojeći dokument ili zahtjev, daje `ZD403` s istom porukom i istim oblikom odgovora.

1. Sesija bez aktera: `ZD401`.
2. Stvaranje i čitanje: opseg iz `document_scope` i uloga. RPC-ovi stanja: zaključavanje retka zahtjeva (`FOR UPDATE`, kao `thread_for_actor`) i uloga iz spremljenog opsega. Nepostojeće, tuđe ili pogrešna uloga za radnju: `ZD403`.
3. Pisanje: zaključavanje retka dokumenta (`FOR SHARE`, „Zaključavanje s predajom” niže), zatim predan rad (`app.document_submitted`): `ZD403`. Čitanje ne zaključava i dopušteno je i nakon predaje.
4. Ulaz: oblik teksta, sidra, revizija, hasha, vrste i očekivanog brojača: `ZD422`.
5. Očekivani brojač: `conflict`.
6. Prijelaz iz tablice i gornja granica verzije: `ZD409`. Za ponovni pregled zatim: prihvaćanje bez hasha ili bez prihvaćenog sidra (`ZD409`), čitanje raspona u prihvaćenoj reviziji (nečitljiv rad: `ZD503`; hash različit od spremljenog: `ZD409`), čitanje raspona u trenutačnoj reviziji (nečitljiv rad: `ZD503`) i pravilo promjene (`ZD409`).
7. Poredak revizija prema spremljenim: `ZD422`. Ponovni pregled nema ovaj korak, jer ne prima reviziju.
8. Upis i ishod `applied`.

**Granice ulaza.** Strogi validator bez nove ovisnosti u `src/domain/collaboration/`, s istim pravilima kao `CHECK` u bazi:

- `instruction` i `explanation`: nova funkcija `collaboration.is_revision_text` po uzoru na `is_comment_body`. Nakon NFC normalizacije 1 do 2000 kodnih točaka; odbijaju se kontrolni znakovi osim `\n` i `\t` te dvosmjerni znakovi U+202A do U+202E i U+2066 do U+2069. Strože od §4.11: mora sadržavati barem jedan znak koji nije Unicode bjelina (`White_Space`, uključujući NBSP) ni znak nulte širine (U+200B do U+200D, U+2060, U+FEFF). Klijentski validator odbija nesparen surogat (`isWellFormed`), a baza ga ionako ne može spremiti. §4.11 se ovime ne mijenja.
- `anchor`: točno kao §4.11 (`is_text_anchor`).
- `kind`: točno `done` ili `declined`.
- Revizije: siguran cijeli broj. String, decimalni broj, negativan broj, `2^53`, `NaN`, `Infinity` i `null` su `ZD422`.
- Hash: 64 znaka `[0-9a-f]`, ili `NULL` samo uz prihvaćanje, i tada uz `acceptedAnchor` `null`. Ponovni pregled ne prima hash: tijelo s poljem `rangeHash` ili `currentRevision` odbija se kao nepoznato polje.
- Tijelo HTTP zahtjeva do 16 KiB. Dopuštena su samo propisana polja, a nepoznato polje (npr. `state`, `accepted_by`, `__proto__`), dvostruki ključ i krivi JSON tip su odbijeni, ne ignorirani. Neispravan ID dokumenta ili zahtjeva ruta odbija prije baze istim odgovorom kao `ZD403` (kao §4.12 t. 6), jer bi neispravan `uuid` u bazi dao `22P02` umjesto propisanog koda.
- Prikaz je uvijek tekst, nikad HTML ni Markdown.

**Žica** (korak rute). `conflict` i `ZD409` moraju ostati razlučivi. Ruta vraća `409 {outcome: "conflict", row_seq, version, state}` za `conflict` i zasebno tijelo za `ZD409` (npr. `{error: "not_allowed"}`). Oblik `{error: "conflict"}` koji ruta komentara koristi za `ZD409` ovdje se ne smije ponoviti. Točne statuse navodi PR koraka 3.

**Nakon predaje i pri brisanju.** Nakon upisane predaje zahtjevi su zamrznuti. Obje strane ih čitaju, a svaki RPC pisanja daje `ZD403` prije provjere ulaza (točka 3 redoslijeda). Predaja ne mijenja stanje i nema tihog prijelaza (napad B8). Zahtjevi, verzije i odgovori brišu se zajedno s radom: `delete_revision_requests` se poziva u istoj transakciji kao brisanje dokumenta po roku i brisanje pri povlačenju studenta (D-12), kao `delete_live_state` (§4.12 t. 2 i 3). Tako ne ostaju siroti retci (napad B9). Do predaje vrijedi rok kao za komentare, a nakon predaje rok klase „Predaja” (`ARCHITECTURE.md` §3). Sami rokovi su PRIJEDLOG (D-30) i ne upisuju se u kod.

**Zaključavanje s predajom** (odluka orkestratora 4, #1091 komentar 6626606552). Predaja usred upisa nije poznata granica nego zahtjev koraka 2 (korak 1 plana #1506):

- Svaki RPC pisanja, uključujući stvaranje, u istoj transakciji uzima `FOR SHARE` na retku `evidence.document` tog dokumenta i tek zatim, u sljedećoj naredbi, poziva `app.document_submitted`. Pod `READ COMMITTED` ta naredba ima novu snimku, pa vidi predaju koja je potvrđena dok je upis čekao.
- Zaključavanje ide kroz novu funkciju `collaboration.lock_document_for_write(p_document_id text)`. Funkcija je u vlasništvu `ductus_evidence`, `SECURITY DEFINER` je, a `EXECUTE` ima samo `ductus_identity` (kao `document_scope`). Shema `collaboration` tako i dalje nema ovlast na `evidence`. Funkcija ne vraća sadržaj, a dokument izvan opsega daje isti `ZD403`.
- `app.request_submission` već drži taj redak `FOR UPDATE`. `app.record_submission` upisuje redak koji čita `document_submitted`, a danas taj redak ne zaključava. Korak 2 mu nakon `lock_student_assignment`, a prije `INSERT`-a u `evidence.submission`, dodaje dva zaključavanja: prvo sve retke `evidence.package` tog dokumenta `FOR UPDATE` (`ORDER BY id`), zatim redak dokumenta `FOR UPDATE`.
- Paket ide prije dokumenta jer `commit_evidence_segment` zaključava paket, pa zadatak i članstvo, pa dokument (`20261028000000_evidence_segment_v3.sql`). Da `record_submission` uzme samo dokument, okidač `close_submitted_packages` bi tek pri `INSERT`-u čekao paket koji drži commit, a commit bi čekao dokument: deadlock. S paketima unaprijed okidač ne čeka ništa novo, jer su njegovi retci već zaključani. Zaključavanje prije `INSERT`-a znači i da je `recorded_at` uvijek nakon upisa koji je prvi držao dokument.
- Ishod je uvijek jedan od dva: upis koji prvi drži zaključavanje završava prije predaje, ili predaja prva, pa upis dobiva `ZD403`. Upis nakon predaje ne nastaje.
- Redoslijed upisa je redak zahtjeva, pa dokument. Upis ne zaključava paket. Putevi predaje i `commit_evidence_segment` ne zaključavaju retke zahtjeva, a oba uzimaju paket prije dokumenta, pa ciklusa nema. Upis kratko čeka segment koji drži `FOR UPDATE` na dokumentu, što je prihvatljivo.

**Čitanje: isti izlaz za obje strane.** `collaboration.list_revision_requests(p_document_id text) RETURNS TABLE (request_id, request_state, request_version, request_row_seq, anchor, version, instruction, requested_revision, opened_is_own, opened_window, response_kind, response_explanation, response_revision, response_is_own, response_window, closed_as, closed_is_own, closed_window, accepted_revision, accepted_range_hash)`.

- Vraća jedan redak po verziji, za sve verzije, uključujući povučene zahtjeve. `anchor` je popunjen samo u retku verzije 1.
- Ista funkcija i isti oblik vrijede za studenta i nastavnika (`PRODUCT.md` §5 pravilo 5). Nema stupca vidljivog samo jednoj strani.
- Ne vraća se `author_id`, `created_by`, `opened_by` ni `closed_by` ni jedne osobe, `institution_id` ni točno vrijeme. Vremena se vraćaju zaokružena na prozor P-03 od 5 minuta, kao `created_window` u §4.11. Redoslijed nose `version` i redoslijed zahtjeva.
- Ne vraća se sadržaj dokumenta ni isječak. Sidro se vraća kako ga je nastavnik spremio, a klijent ga razrješuje lokalno (§4.11, napad 8).

**Evidencija netaknuta.** Nijedan RPC ne čita ni ne piše `evidence.document_revision`, `segment`, `package` ni `receipt`. Jedino `rereview_revision_request` čita snimke prihvaćene i trenutačne revizije, kroz `range_hash_at` u vlasništvu `ductus_evidence`, i ništa ne piše. pgTAP potvrđuje da su `current_revision`, `current_content_hash` i lanac segmenata jednaki prije i poslije svakog RPC-a (napad H1). Komentari iz §4.11 i njihovi testovi ostaju nepromijenjeni (napad H6).

**Logovi.** Samo ID-ovi i ishodi: `document_id`, `request_id`, `version`, `outcome` i kod greške. Nikad `instruction`, `explanation`, `anchor` ni hash (§4.9, canary).

**Istodobnost.**

- Dvije kartice ili obje strane šalju radnju s istim očekivanim brojačem. Zbog `FOR UPDATE` točno jedna dobiva `applied`, ostale `conflict` (npr. prihvaćanje i povlačenje iz `responded`, ili odgovor studenta i nova verzija iz `open`).
- Zatvaranje članstva usred poziva daje jedan čist ishod prema snimci transakcije, bez djelomičnog upisa.
- Predaja istodobno s upisom: vidi „Zaključavanje s predajom”.
- Dva usporedna ponovna pregleda istog prihvaćanja nose isti brojač: jedan dobiva `applied`, drugi `conflict` s novim stanjem, i nastaje točno jedna verzija. Ponovni pregled s brojačem pročitanim prije prihvaćanja dobiva `conflict`, a s brojačem prihvaćanja baza provjerava upravo spremljeno prihvaćanje i raspon koji sama pročita. Nijedan ishod ne briše uputu, odgovor ni prihvaćanje.
- Test u koraku 2 koristi dvije stvarne veze na bazu, ne samo sekvencijalne pozive.

**Napadi iz #1506 na testove** (korak u kojem nastaje dokaz).

| Napadi | Dokaz |
| --- | --- |
| A1, A3–A5, A8, A12 | pgTAP (2): bez sesije `ZD401`; N2, Student B, druga ustanova i administrator dobivaju `ZD403` na šest RPC-ova koje izvršava `ductus_app`, i s neispravnim ulazom; nepostojeći dokument ili zahtjev daje isti `ZD403`; `delete_revision_requests` pod `ductus_app` daje `42501` uz bilo koju sesiju, a pod `ductus_retention` se izvršava |
| A2, A6, A7 | pgTAP (2): nastavnik stvara; student na stvaranju, prihvaćanju, ponovnom otvaranju i povlačenju dobiva `ZD403`; nastavnik na odgovoru `ZD403`; drugi nastavnik istog zadatka prihvaća tuđi zahtjev |
| A9 | pgTAP (2): nastavnik sa zatvorenim članstvom odmah `ZD403` na čitanju i pisanju |
| A10, A11 | pgTAP (2): izravni `SELECT`/`INSERT`/`UPDATE`/`DELETE` pod `ductus_app`, `ductus_worker` i `ductus_retention` daju `42501`, a uz pogrešno dodijeljen grant 0 redaka; katalog (`bag_eq`): `ductus_app` izvršava točno sedam RPC-ova (šest iz koraka 2 i `rereview_revision_request`), `ductus_retention` samo `delete_revision_requests`, a `lock_document_for_write` i `range_hash_at` samo `ductus_identity`; svaka nova tablica ima RLS i retke u matrici |
| B1, B2, B7 | pgTAP (2), tablično: svaki redak tablice prijelaza daje `applied` i točno propisano stanje; svaki par (stanje, radnja) izvan nje daje `ZD409` uz nepromijenjeno stanje i povijest; potpuno, ne uzorak |
| B3, B4 | pgTAP (2): `response_revision` manja od tražene i `accepted_revision` manja od odgovora daju `ZD422`; prihvaćanje bez odgovora je `ZD409` |
| B5, D4, D6 | pgTAP (2): nakon `commit_evidence_segment`, `publish_live_state` i predaje stanje i verzija su nepromijenjeni; katalog: nema okidača na tablicama; unit (3): poslužiteljski modul ne uvozi `conditional-validity.ts` |
| B6, D1, D2, D5 | pgTAP (2): `reopen` iz svakog dopuštenog stanja stvara `v + 1`; stari odgovor i `closed_as = 'accepted'` ostaju u `list_revision_requests`; novi odgovor vezan je uz `v + 1` |
| B8, B9 | pgTAP (2): na predan rad svaki RPC pisanja daje `ZD403` (i s neispravnim ulazom), čitanje radi; `delete_revision_requests` ostavlja 0 redaka u sve tri tablice |
| B8 i istodobna predaja | integracijski test (2) s dvije veze, negativan: `record_submission` i svaki RPC pisanja istodobno, u oba redoslijeda dobivanja zaključavanja; ishod je ili upis prije predaje ili `ZD403`, nikad redak zahtjeva, verzije ili odgovora s vremenom nakon predaje; pgTAP: `record_submission` drži `FOR UPDATE` na retku dokumenta i na retcima paketa (druga veza s `NOWAIT` dobiva `55P03`) |
| Predaja i commit segmenta | integracijski test (2) s dvije veze: `record_submission` i `commit_evidence_segment` istog dokumenta istodobno, u oba redoslijeda; nijedna veza ne dobiva `40P01`; ishod je ili prihvaćen segment prije predaje ili `not_accepting` |
| C1–C4, C6, D3 | pgTAP (2): zastarjeli brojač, brojač iz budućnosti i trenutačni brojač drugog zahtjeva istog dokumenta (Q1 i Q2 stvoreni jedan za drugim, oba bez prijelaza) daju `conflict` s trenutačnim `row_seq`, verzijom i stanjem i bez upisa; katalog: `row_seq` je `UNIQUE`, a `revision_request_seq` je `NO CYCLE` i bez `USAGE` za `ductus_app`, `ductus_worker` i `ductus_retention`; ponovljen identičan poziv daje `conflict`; `NULL` i nedostajući brojač daju `ZD422`; odgovor na staru verziju nakon `reopen` daje `conflict`; `ZD409` ne povećava `row_seq` |
| C2 i istodobnost | integracijski test (2) s dvije veze: točno jedan `applied` |
| C5 | pgTAP (2): odgovor s revizijom većom od tražene uz isti brojač prolazi |
| E1, E2, E4 | pgTAP (2): `declined` s obrazloženjem daje `responded`; drugi odgovor u istoj verziji daje `conflict`; unit (3) i `CHECK` (2): obrazloženje prazno, samo bjelina, samo NBSP ili nulta širina daje `ZD422` |
| E3 | korak sučelja (I3): skener zabranjenih izraza |
| G1–G9 | unit (3), tablično i fast-check: klijentski validator i `CHECK` daju isti ishod za klase ulaza 8 do 10 iz #1506; G7: neispravan ID na ruti daje isti odgovor kao `ZD403` |
| H2, H5 | pgTAP (2): svaki prijelaz ostavlja tko (`*_by`) i kada u tablici; izlaz ima samo prozore od 5 minuta |
| H3 | unit (3): canary u uputi i odgovoru ne pojavljuje se u logu ni u poruci greške |
| H4 | pgTAP (2) i unit (3): izlaz `list_revision_requests` za studenta i nastavnika jednak je osim `*_is_own`; katalog: nema stupca s ID-om osobe ni sa sadržajem dokumenta |
| H1, H6 | pgTAP (2): evidencija jednaka prije i poslije; testovi komentara bez promjene |
| F1–F5 | DAN-266; ovdje samo spremljeni `accepted_revision` i `accepted_range_hash` |
| Ponovni pregled (#1091 komentari 6752687836 i 6754441692) | pgTAP `119-collaboration-revision-rereview.sql`, tablično po klasama ulaza: pravilo promjene nad stvarnim snimkama prihvaćene i trenutačne revizije (nepromijenjen raspon uz promijenjen drugi odlomak, promijenjen raspon, raspon koji se ni pri prihvaćanju nije razrješavao jer bloka nema ili je citat višeznačan, nema novije revizije, prihvaćanje bez hasha, prihvaćanje s izmišljenim hashem uz nepromijenjen i uz izmijenjen raspon), čitač po revizijama i po klasama razrješenja (uključujući dva bloka s istim `nodeId`), nečitljiv rad na prihvaćenoj i na trenutačnoj reviziji (`ZD503`), svako stanje, granica verzije, oblik brojača, `conflict`, redoslijed provjera, uloge i sesije, spremljeni sadržaj, novi ciklus odgovora, ponovljen poziv, predan rad i katalog (stari potpis s četiri parametra ne postoji; `range_hash_at` izvršava samo `ductus_identity`); integracijski, negativno: nepromijenjen raspon ne otvara ni student ni nastavnik, a poziv starog potpisa s `NULL` ili izmišljenim hashem daje `42883`; prihvaćanje čiji hash baza ne dobije u prihvaćenoj reviziji (izmišljen hash uz nepromijenjen i uz izmijenjen raspon, hash citata kojeg u prihvaćenoj reviziji nema, hash citata u bloku kojeg nema) ne otvara se nikad; promijenjen raspon daje `applied` jednom; tablica jednakosti `range_hash_at` i `resolveTextAnchor`; unit: radnja `rereview` rute prima samo `requestId` i `expectedSeq` |
| Prihvaćen raspon (#1831 B) | pgTAP 119 (potpis u 112): `accepted_anchor` se sprema uz hash, hash bez sidra veže sidro zahtjeva, sidro bez hasha i neispravno sidro daju `ZD422`, `CHECK` para; Q→Q′→Q″ nad snimkama: prihvaćen Q′ se ne otvara dok Q′ stoji, otvara se kad ga Q″ zamijeni, a prihvaćanje pod sidrom koje u prihvaćenoj reviziji ne daje hash i prihvaćanje bez hasha ostaju `ZD409` i ništa ne pišu; integracijski, negativno: Q→Q′→Q″ (prihvaćen Q′ u reviziji 2 ne otvara se dok Q′ stoji, otvara se jednom kad Q″ zamijeni Q′; prihvaćanje s hashem Q′ bez sidra veže Q, koji se u reviziji 2 ne razrješuje, i ostaje `ZD409`; prihvaćanje s `NULL` hashem ostaje `ZD409` ni za studenta ni za nastavnika); ruta, glavni tok nalaza c.6757238840: zamjena citata, `accept` kroz rutu sa sidrom i hashem Q′, nova izmjena, `rereview` daje `applied` i verziju v+1; unit: ruta odbija hash bez sidra, sidro bez hasha i neispravno sidro s `ZD422` prije baze |

**Koraci.** (1) ovaj ugovor; (2) migracija, RLS, RPC-ovi i pgTAP matrica (korak 1 plana #1506); (3) validator, poslužiteljski omotač i ruta s unit i integracijskim testovima, uz usklađivanje `revision-request.ts` s ovim skupom stanja (korak 2 plana); (4) projekcija „promijenjeno nakon prihvaćanja” (DAN-266); (5) sučelje nakon odobrene referentne slike N-08 (D-245). Svaki korak je zaseban PR vezan uz DAN-314, osim koraka 4. Ponovni pregled (M6.5-P02) je preostali korak DAN-314 u dva PR-a: (A) migracija, pgTAP 119, radnja `rereview` rute i integracijski testovi s dvije veze; (B) polja `opened_as` i `observed_range_hash` u čitanju i usklađivanje `revision-request.ts`.

**Poznate granice.**

- **Revizije i hash su tvrdnje strana.** Poslužitelj ne provjerava da revizija postoji ni da hash odgovara tekstu, jer bi za to morao čitati evidenciju. Krivi hash nastavnika može dati samo krivu oznaku „promijenjeno” na njegovu vlastitom prihvaćanju i ne dira evidenciju. Vezanje uz reviziju pogleda dolazi s B-11 i DAN-266.
- **Ponovni pregled polazi od tvrdnje iz prihvaćanja, ali je provjerava.** `accepted_revision`, `accepted_range_hash` i `accepted_anchor` su ono što je nastavnikov klijent poslao pri prihvaćanju (gornja granica), no baza ih uzima kao osnovu samo kad pod `accepted_anchor` u snimci te revizije sama dobije isti hash. Baza ne provjerava je li to sidro „pravi” raspon dorade, nego samo da se u prihvaćenoj reviziji razrješuje u poslani hash. Prihvaćanje s hashem koji baza ondje ne dobije ne može se ponovno pregledati ovim putem; nastavnik isto može otvoriti s `reopen`. Vezanje prihvaćanja uz reviziju pogleda dolazi s B-11 i DAN-266.
- **Prihvaćanje bez raspona ostaje izvan ponovnog pregleda** (#1831 B). Kad nastavnikov klijent u prihvaćenoj reviziji ne razriješi nijedan raspon (`ambiguous` ili `missing`), šalje `NULL` hash i `NULL` sidro, a takvo prihvaćanje je za ponovni pregled uvijek `ZD409`; ostaje nastavnikov `reopen`. Glavni slučaj iz nalaza #1831 (komentar 6755766598), dorada `done` koja zamijeni citirani tekst Q s Q′, pokriven je kad klijent pri prihvaćanju pošalje sidro raspona Q′: kasnija izmjena Q′ tada otvara ponovni pregled.
- **Postojeća prihvaćanja.** Migracija prihvaćanjima s hashem upisanima prije stupca `accepted_anchor` upisuje sidro zahtjeva, jer je takvo prihvaćanje hash računalo upravo pod tim sidrom. Prihvaćanja bez hasha ostaju bez sidra.
- **Što poziv otkriva.** Ishod ponovnog pregleda (`applied` ili `ZD409`) kaže pozivatelju je li se usporedivo prihvaćen raspon u trenutačnoj reviziji promijenio. To je jedan podatak, bez teksta, dostupan samo studentu vlasniku i nastavniku zadatka, i ne bilježi se kao otvaranje rada.
- **`observed_range_hash`.** Ponovno se pregledava samo prihvaćanje čiji se `accepted_anchor` u prihvaćenoj reviziji razriješio, a razriješen raspon je uvijek sam citat. Promjena zato znači da se raspon više ne razrješuje, pa je stupac za ponovni pregled uvijek `NULL`. Stupac i njegov `CHECK` ostaju u shemi; ovaj ih krug namjerno ne uklanja jer je sužen na nalaz.
- **Čitanje.** Do PR-a B `list_revision_requests` ne vraća `opened_as` ni `observed_range_hash`, pa se verzija otvorena ponovnim pregledom u čitanju vidi samo kao nova verzija s istom uputom.
- **Dvostruko stvaranje.** Stvaranje nema očekivani brojač, pa dvostruki klik može stvoriti dva jednaka zahtjeva, kao kod komentara u §4.11. Suvišni se povlači.
- **Vidljivost prema D-37 i P-03** veže B-11, kao u §4.11.
- Mentorski redak čeka DAN-349. Put brisanja po roku i povlačenja studenta (D-12) još ne postoji na `main`: korak 2 uvodi `delete_revision_requests` i pgTAP redak, a poziva ga PR koji uvodi taj put.

### 4.15 Prijedlozi i izravne izmjene nastavnika (D-34, D-244, DAN-597)

Ugovor prije koda (M6.0-S1, DAN-597) za prijedloge (M6.3, DAN-419, plan napada #1489) i izravne izmjene nastavnika s postavkom načina (M6.4, DAN-420, plan napada #1808). Gradi samo na odlučenom: D-34, D-21, D-244 i D-203 (B1 i t. 6), uz `docs/PRODUCT.md` §5 pravilo 8, §6 (student t. 7, nastavnik t. 7), §7 i §9. Napadi iz oba plana su kriterij prihvata. Ono što ovisi o otvorenom pitanju vlasnika ovdje se ne bira. Svaki takav dio je u tablici „Otvoreno” na kraju, uz korake koje blokira.

Prijedlog je **zaseban zapis sa sidrom** u shemi `collaboration`, kao zahtjev za doradu u §4.14 i kao komentar prema D-133 (ODLUČENO u D-266 t. 1: izvedeni prikaz zasebnog zapisa sa sidrom, `docs/ARCHITECTURE.md` §5a, ne oznaka u shemi Tiptapa). Nije vrsta niti komentara. Navod kao čvor-atom (D-134, D-266 t. 1) ovaj sloj ne mijenja: sadržaj prijedloga prolazi istu shemu editora kao dokument.

**Odlučene invarijante.** Svaki korak ih čuva i svaka ima test u tablici napada.

1. **Jedan pisač** (D-34). Dokument, reviziju, odsječak i paket piše samo student vlasnik, kroz svoj klijent i postojeći `commit_evidence_segment`. Nijedan RPC ovog sloja ne čita ni ne piše shemu `evidence`. Nastavnik ni uz izravne izmjene ne dobiva pravo commita (#1808 B1, B2).
2. **Prijedlog sprema poslužitelj pod nastavnikovom sesijom** (D-34). Autor dolazi iz `app.current_actor()` i nikad nije parametar. Spremljeni sadržaj prijedloga se nikad ne prepisuje, jer na njemu počiva pripisivanje (t. 4). Smije li se prijedlog povući ili izmijeniti određuje Pitanje #1489-3. Izmjena, ako bude dopuštena, je novi zapis.
3. **Izvor u zapisu.** Odsječak primjene nosi izvor `applied-suggestion` i polje `suggestionId`, koji su već rezervirani u formatu (t. 9). Naziv u sučelju („primijenjeni” ili „prihvaćeni prijedlog”) određuje Pitanje #1489-2.
4. **Pripisivanje računa poslužitelj iz pohranjenog prijedloga, nikad iz tvrdnje klijenta** (D-34, pravilo 8). Nastavniku se pripisuje samo ono što se podudara sa spremljenim prijedlogom, a razlika je studentova promjena. Odsječak koji se poziva na prijedlog koji ne postoji, pripada drugom dokumentu ili ustanovi, već je primijenjen ili se ne podudara nikad se ne pripisuje nastavniku (#1489 B2 do B4, #1808 D2 do D4). Odbija li se takav odsječak ili se pripisuje studentu određuje PR koraka 4, uz tablični test. Oba su ishoda unutar invarijante. Usporedba ne smije tražiti stanje dokumenta na poslužitelju pri prihvatu odsječka (`docs/backend/evidencija.md`, odluka o `removedSha256`).
5. **Izravna izmjena je prijedlog koji studentov klijent automatski primjenjuje** (D-34). Nema drugog puta upisa: isti zapis prijedloga, isto spremanje, isti izvor odsječka i isto pripisivanje. Razlikuje se samo tko pokreće primjenu. Automatska primjena nema nuspojava koje ručno prihvaćen prijedlog nema (#1808 B8).
6. **Postavka načina** (D-244, D-21). Zadano su prijedlozi. Izravne izmjene uključuje samo student vlasnik. Opoziv vrijedi odmah i bez potvrde druge strane. Smije li nastavnik vratiti način na prijedloge određuje Pitanje #1808-3, a dok odgovor ne stigne, uključivanje i opoziv su samo studentova radnja.
7. **Način prijedloga određuje se pri spremanju, pod bravom, iz spremljene postavke**, nikad iz nastavnikova klijenta ili parametra. Spremljeni način se poslije ne mijenja. Ponovno uključivanje ne djeluje unatrag, a prijedlog spremljen nakon opoziva je običan prijedlog (#1808 C2, C4, C5).
8. **Vidljivost i pripisivanje** (D-21, D-244, pravilo 5). Postavka je vidljiva na radu objema stranama, istim izlazom iste funkcije. Svaki prijedlog i svaka promjena postavke imaju autora i vrijeme baze. Povijest postavke se ne prepisuje i ne sažima (#1808 A6).
9. **Format** (D-34, D-203 t. 6). `applied-suggestion`, `suggestionId`, `own-variant`, `variantId` i `ductus-evidence-variant-v1` su rezervirani i odbijeni u v2, v3 i v4 (`src/domain/forensics/evidence-segment-v2.ts`, `docs/contracts/evidence-segment-v4.md` redak „Rezervacije”). Rezervacija se podiže samo novom verzijom formata nakon v4, s vlastitim zlatnim vektorima, uz nepromijenjene bajtove svih starijih vektora. Broj verzije se ovdje ne dodjeljuje. Prije podizanja treba odgovor na Pitanje #1808-4 (razlikuje li zapis automatsku i ručnu primjenu, i je li promjena postavke dio evidencije). Svaki dodatni ključ kasnije bi bio nova verzija, a mjesto se rezervira prije prve stvarne evidencije (D-34).
10. **Ništa se ne mijenja automatski.** Prijedlog, njegova primjena i promjena postavke ne mijenjaju stanje zahtjeva za doradu (§4.14), komentara (§4.11) ni prikaza uživo (§4.12). Pokreće li izmjena prihvaćenog odlomka ponovni pregled određuje Pitanje #1489-4.
11. **Prikaz.** Stavka sažetka „Izmjene nastavnika” je popis s vremenom i veličinom (`docs/PRODUCT.md` §7), bez postotka, udjela, zbroja, poretka i ocjene. Student izravne izmjene vidi označene (§6 student t. 7).

**Shema i vlasništvo.** Kao §4.11 i §4.14:

- Tablice i RPC-ovi su u vlasništvu `ductus_identity`.
- Opseg dokumenta daje `collaboration.document_scope`, a ulogu `collaboration.actor_role`, pri svakom pozivu i bez predmemorije.
- Nema stranog ključa prema `evidence.document` i nema ovlasti na shemi `evidence`.
- Tablice imaju `ENABLE` i `FORCE ROW LEVEL SECURITY` sa samo vlasnikovom politikom.
- `ductus_app`, `ductus_worker` i `ductus_retention` nemaju nikakvu ovlast na tablicama, ni `SELECT`.
- Svaka nova tablica i svaki RPC imaju retke u pgTAP matrici.

Imena i stupci određuju se u koracima 2 i 3, a radna imena su `collaboration.suggestion` i `collaboration.edit_mode`. Već je određeno sljedeće:

- **Prijedlog:**
  - opseg (`institution_id`, `assignment_id`, `owner_id`) iz `document_scope` pri spremanju;
  - `anchor` uz `CHECK (collaboration.is_text_anchor(anchor))`, nepromjenjiv;
  - autor iz `current_actor()`;
  - nepromjenjiv sadržaj;
  - način spremljen pri nastanku (`suggestion` ili `direct`, t. 7);
  - stanje;
  - `row_seq` iz jedne sekvence bez ciklusa, kao §4.14.
- **Stanja koja su odlučena:** čeka, prihvaćen i odbijen (§6 student t. 7, §9). Dodatna stanja i prijelaze za povlačenje, izmjenu, gubitak članstva, opoziv i neuspjelu automatsku primjenu određuju pitanja #1489-3, #1808-2 i #1808-5.
- **Svaki par (stanje, radnja)** izvan tablice prijelaza koju propiše korak 2 daje `ZD409`, a tablični test je potpun, ne uzorak (kao §4.14 B1, B2).
- **Postavka:**
  - trenutačna vrijednost iz zatvorenog skupa `suggestions`, `direct`, zadano `suggestions`;
  - povijest promjena s autorom i vremenom, koja se samo dodaje.
  - Je li postavka po radu ili po paru rad–nastavnik određuje Pitanje #1808-1. O tome ovisi ključ tablice, pa korak 3 ne kreće bez odgovora.
- **Kako prijedlog dobiva stanje „prihvaćen”** određuje korak 2. Granice su ove:
  - jedini dokaz primjene je odsječak s potpisanom potvrdom (F-3, F-8);
  - put commita evidencije ne uzima nijednu bravu sheme `collaboration`;
  - tvrdnja klijenta bez potvrđenog odsječka ne mijenja pripisivanje.

**Tko što smije.**

| Akter | Čita prijedloge i postavku | Sprema prijedlog | Uključuje ili opoziva postavku | Prihvaća ili odbija |
| --- | --- | --- | --- | --- |
| Student vlasnik dokumenta | da | `ZD403` (#1489 A4) | da | da |
| Nastavnik zadatka s otvorenim članstvom | da; prijedlozi drugog nastavnika: Pitanje #1489-9 | da | `ZD403`; vraćanje na prijedloge: Pitanje #1808-3 | `ZD403` |
| Mentor rada | kao nastavnik zadatka u ulozi `teacher`; redak `mentorship` dolazi s DAN-349 (kao §4.14) | | | |
| Student B, nastavnik drugog kolegija, zatvoreno članstvo, druga ustanova, administrator | `ZD403` | `ZD403` | `ZD403` | `ZD403` |
| Bez sesije | `ZD401` | `ZD401` | `ZD401` | `ZD401` |

**Redoslijed provjera i kodovi.** Isto kao §4.14. Ovlast se provjerava prije ulaza, a svaki odbijen slučaj, uključujući nepostojeći dokument ili prijedlog, daje isti `ZD403`. Redoslijed:

1. sesija;
2. opseg i uloga;
3. zaključavanje i predan rad;
4. ulaz (`ZD422`);
5. očekivani brojač (`conflict`);
6. prijelaz (`ZD409`);
7. upis.

Nakon upisane predaje svako pisanje daje `ZD403`, kao §4.14. Smije li nastavnik predlagati nakon predaje određuje Pitanje #1489-5. Kasnije dopuštanje je jeftina promjena provjere 3. Ništa se ne primjenjuje na predan rad (`not_accepting`, #1808 F4).

**Klase ulaza.** Svaki korak koji uvodi validator ima tablični test i fast-check: klijentski validator, `CHECK` u bazi i provjera pri prihvatu daju isti ishod za svaku klasu.

| Ulaz | Klase |
| --- | --- |
| ID prijedloga | ispravan UUID; nije UUID; prazan; predug; ispravan, ali drugog dokumenta, rada ili ustanove; već primijenjen |
| `anchor` | sve klase iz §4.11 (`is_text_anchor`) |
| Sadržaj prijedloga | unutar sheme editora; nepoznat čvor; `<script>`; veza `javascript:`; nul znak; nesparen surogat; tekst od 10 MB; primjena koja dokument diže iznad 2 MiB (#1489 C6, C7, #1808 B6) |
| Postavka | `suggestions`; `direct`; druga veličina slova; razmak; `null`; broj; nepoznata vrijednost |
| `p_expected_seq` | klase iz §4.14 (nedostaje, `NULL`, decimalni, negativan, `2^53`, string, zastario, iz budućnosti, drugog zapisa) |
| Odsječak primjene (korak 4) | izvor bez `suggestionId` i obrnuto; nepoznato polje uz izvor; `suggestionId` koji nije UUID; rezervirani ključ u starijoj verziji (#1808 E1, E3) |

Tijelo HTTP zahtjeva ima granicu, a nepoznato polje, dvostruki ključ i krivi JSON tip se odbijaju, ne ignoriraju (§4.14 „Granice ulaza”). Prikaz je uvijek tekst ili sadržaj provjeren shemom editora, nikad sirovi HTML.

**Istodobnost.**

- **Opoziv i spremanje.** Spremanje prijedloga i promjena postavke istog dokumenta serijaliziraju se na retku postavke (`FOR UPDATE`), pa spremanje čita postavku pod bravom (t. 7). U oba redoslijeda ishod je određen i bez deadlocka (#1808 C2).
- **Brojač.** Promjena postavke i svaki prijelaz prijedloga primaju `p_expected_seq` s ishodima `applied`, `conflict`, `ZD409` i `ZD422`, točno kao §4.14. Dvostruki klik i ponovljen zahtjev nikad ne daju dva prijelaza (#1489 D1, D4, D6).
- **Predaja.** Svako pisanje uzima `collaboration.lock_document_for_write` (`FOR SHARE`) i tek zatim provjerava predaju, kao §4.14 „Zaključavanje s predajom”.
- **Redoslijed brava:** postavka, prijedlog, dokument. Put commita i predaje ne uzima brave sheme `collaboration`, pa ciklusa nema.
- **Jedna primjena.** Dvije kartice istog studenta daju točno jedan odsječak primjene s tim `suggestionId`. Drugi odsječak s istim `suggestionId` nikad ne dobiva drugo pripisivanje nastavniku (#1489 D2, D3, #1808 B4).
- **Članstvo.** Zatvaranje članstva usred poziva daje jedan čist ishod prema snimci transakcije.
- **Testovi.** Integracijski testovi s dvije stvarne veze, negativni, u oba redoslijeda dobivanja brava:
  - opoziv protiv spremanja;
  - predaja protiv spremanja i promjene postavke;
  - dva prijelaza istog prijedloga.

  Nijedna veza ne dobiva `40P01`.

**Čitanje: isti izlaz za obje strane** (pravilo 5, #1489 A8, #1808 A8). Jedna funkcija za prijedloge i jedna za postavku s poviješću. Vraćaju `*_is_own` umjesto ID-a osobe, vremena zaokružena na prozor P-03 od 5 minuta i nemaju stupac vidljiv samo jednoj strani. Jesu li odbijeni prijedlozi u izlazu, sažetku i reprodukciji određuje Pitanje #1489-6.

**Logovi.** Samo ID-ovi i ishodi. Nikad sadržaj prijedloga, sidro ni tekst dokumenta (§4.9, canary; #1489 B7, #1808 F5).

**Brisanje.** Prijedlozi i postavka brišu se s radom, funkcijom koju izvršava samo `ductus_retention`, u istoj transakciji kao brisanje dokumenta (kao `delete_revision_requests`, §4.14). Rokovi čuvanja su PRIJEDLOG (D-30) i ne upisuju se u kod.

**Napadi na testove** (u zagradi je korak u kojem nastaje dokaz).

| Napadi | Dokaz |
| --- | --- |
| #1489 A1–A7; #1808 A1–A3, A7, A9 | pgTAP (2, 3): tablica ovlasti; izravan DML pod tri uloge daje `42501`; katalog (`bag_eq`) RPC-ova po ulozi; RLS i retci matrice za svaku tablicu |
| #1808 A4–A6, C2, C4, C5 | pgTAP (3): samo student mijenja postavku; povijest se samo dodaje; način prijedloga jednak je postavci pod bravom; integracijski test s dvije veze za opoziv i spremanje |
| #1489 B1–B5, G1–G4; #1808 D1–D4, E1–E3, E5 | unit, property i zlatni vektori (4): nova verzija formata; bajtovi v2 do v4 nepromijenjeni; pripisivanje iz pohranjenog prijedloga; B-12 replay s `removedSha256` |
| #1489 C1–C7; #1808 B5, B6 | unit i property (5, 6): razrješenje sidra (`resolveTextAnchor`) ne pogađa drugo pojavljivanje; granica 2 MiB i shema editora |
| #1489 D1–D6, E1–E5, H1, H2; #1808 B3, B4, B7, C1, C3 | unit i integracijski (5, 6): journal, drain i ACK; nema izgubljenog znaka; jedna primjena po prijedlogu |
| #1489 H3; #1808 F4 | pgTAP (2, 3): predan rad daje `ZD403` na pisanju; integracijski test s dvije veze za predaju |
| #1489 B6, B7, H4; #1808 F1, F5 | unit (2 do 4): isti izlaz za obje strane; canary nije u logu; sažetak bez postotka |
| #1489 F1–F4, H5; #1808 F2, F3, F6 | sučelje (7): odobrena referentna slika N-08 i S-12 (D-245); skener zabranjenih izraza |

**Koraci.** Svaki je zaseban PR vezan uz DAN-419 ili DAN-420.

1. Ovaj ugovor.
2. Prijedlozi: migracija, RLS, RPC-ovi spremanja, čitanja i prijelaza, pgTAP.
3. Postavka načina: tablica s poviješću, RPC uključivanja i opoziva, pgTAP.
4. Format: nova verzija nakon v4 s vektorima i pripisivanje iz pohranjenog prijedloga.
5. Klijent: prihvaćanje i odbijanje kroz journal.
6. Automatska primjena.
7. Sučelje.

Korak 4 mora biti spojen prije prve stvarne evidencije (D-34).

**Otvoreno** (Owner queue, `docs/ORKESTRATOR.md` §4a; ugovor ništa od ovoga ne bira).

| Pitanje | Blokira korak |
| --- | --- |
| #1489-2 naziv izvora u sučelju | 7 |
| #1489-3 povlačenje i izmjena prijedloga, gubitak članstva | 2 (stanja), 5 |
| #1489-4 ponovni pregled prihvaćenog odlomka | 5, 7 |
| #1489-5 prijedlog nakon predaje | ne blokira; do odgovora `ZD403` |
| #1489-6 vidljivost i čuvanje odbijenih | 2 (izlaz čitanja), 7 |
| #1489-7 kanonski zapis B-12 | 4 |
| #1489-9 dva nastavnika | 2 (čitanje), 3 |
| #1808-1 postavka po radu ili po nastavniku | 3 |
| #1808-2 izmjene koje čekaju pri opozivu | 2 (stanja), 6 |
| #1808-3 smije li nastavnik vratiti način | 3 |
| #1808-4 razlika automatske i ručne primjene u zapisu, postavka u evidenciji | 3, 4 |
| #1808-5 neuspjela automatska primjena | 2 (stanja), 6 |
| #1808-6 što nastavnik vidi dok izmjena čeka | 6, 7 |

Pitanje #1489-1 (nedostaje ugovor) zatvara ovaj odjeljak kad prođe gate. Pitanje #1489-8 (rezervacija u formatu) na `main` je provedeno rezervacijom iz t. 9. Ostaje samo dio koji pokriva #1808-4.

**Poznate granice.**

- Mentorski redak čeka DAN-349.
- Put brisanja po roku i pri povlačenju studenta (D-12) još ne postoji na `main`. Funkciju brisanja uvode koraci 2 i 3, a poziva je PR koji uvodi taj put.
- Vidljivost prema D-37 i P-03 veže B-11, kao u §4.11.
