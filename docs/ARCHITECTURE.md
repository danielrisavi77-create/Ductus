# Ductus: arhitektura pilota

Verzija 0.3 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi

> **Povijesna napomena:** verzije 0.1 i 0.2 ovog dokumenta opisivale su varijantu na Supabaseu (baza, prijava, Storage, Edge Functions, Realtime, `pg_cron`, Vault) i Netlifyju (hosting sučelja). Ta varijanta je napuštena prijedlogom u `docs/BACKEND.md` v0.3 (D-08); razlozi su u BACKEND §1. Verzija 0.3 opisuje sustav preko sučelja (portova) koja ne ovise o dobavljaču, a konkretni dobavljači navedeni su samo u §9 i uvijek uvjetno.

Cilj: najjednostavnija arhitektura koja pouzdano ispunjava `PRODUCT.md` za pilot na jednom fakultetu, koju jedna osoba uz AI agente može održavati, i koja se kasnije može proširiti bez prepisivanja. Ciljna arhitektura vNext ostaje referenca (D-75); što se iz nje prihvaća i odgađa zapisano je u BACKEND §2, a odgođeni elementi imaju okidač u §11.

**Odnos prema `BACKEND.md`:** BACKEND je detaljan plan backenda i ima prednost u pojedinostima (topologija, uloge, prijava, evidencija, kopije, trošak, program B0 do B9). Ovaj dokument daje cjelinu sustava i upućuje na BACKEND gdje je on mjerodavan. Sve što ovisi o D-08 i D-71 do D-75 vrijedi kao **PRIJEDLOG** dok vlasnik te odluke ne potvrdi (B0.3), a D-08 je uvjetan i rezultatima spikeova B0.1 i B0.2.

## 1. Stack

| Sloj | Izbor | Status |
| --- | --- | --- |
| Sučelje | Next.js (App Router), React, TypeScript; sadržaj radova se ne renderira na poslužitelju | [PRIJEDLOG D-08], preneseno iz `pisac-editor` |
| Editor | Tiptap / ProseMirror | [PRIJEDLOG D-08], preneseno |
| Lokalna pohrana | Dexie (IndexedDB), journal s 8 stanja sinkronizacije | [PRIJEDLOG D-08], preneseno |
| API | Next.js API rute s verzijom protokola (ne Server Actions), u web procesu bez materijala ključeva | [PRIJEDLOG D-08], BACKEND §3 |
| Pozadinski rad | Zaseban worker proces (Node): red poslova pg-boss, potpisivanje, rekonstrukcija, čuvanje, e-pošta, dnevni korijen | [PRIJEDLOG D-74] |
| Baza | PostgreSQL s RLS-om, uloge po namjeni, upravljana usluga s povratom u točku (PITR) | [PRIJEDLOG D-08], dobavljač u §9 |
| Pohrana objekata | S3-kompatibilan privatni bucket, objekti adresirani hashom | [PRIJEDLOG D-08] |
| Prijava | AAI@EduHr preko OpenID Connecta | [ODLUČENO D-09] |
| Izvedba prijave | Vlastiti OIDC klijent, sesije u bazi | [PRIJEDLOG D-73] |
| Potpis | Dva odvojena Ed25519 ključa u KMS-u, potpisuje samo worker | [PRIJEDLOG D-71] |
| Neovisno vrijeme | Dnevni korijen s RFC 3161 žigom, val 2 | [PRIJEDLOG D-72] |
| E-pošta | Transakcijska usluga u EU-u preko SMTP-a ili API-ja | [PRIJEDLOG D-08] |
| Obavijesti | Polling svakih 30 do 60 s, obavijest o reviziji najviše jednom po P-03 prozoru | [PRIJEDLOG D-74] |
| Testovi | Vitest (unit, property i ugovorni), Playwright (E2E i axe), pgTAP (RLS, uloge, matrica pristupa) | Preneseno i prošireno |
| Pravila fakulteta | Zajednički paket s Lektom (generirani podaci pravila, citatni stilovi, predlošci naslovne stranice) | [ODLUČENO D-25] |
| AI pomoćnik | Nije u pilotu; student koristi vlastiti alat izvan Ductusa i prilaže ispis razgovora uz izjavu | [ODLUČENO D-77] |

Kod se piše iza sučelja (§2a) dok D-08 nije potvrđen. Nema OpenFGA servisa, transparency loga, Redisa, zasebnog reda poruka ni zasebnog API servera osim workera.

## 2. Moduli

Modularni monolit u dva procesa (web i worker) nad istom bazom. Svaki modul ima vlastite tablice, RPC funkcije i testove; drugi moduli ga koriste samo kroz te funkcije.

| Modul | Odgovornost | Porijeklo |
| --- | --- | --- |
| `document` | Kanonski model dokumenta, validacija, normalizacija | Preneseno |
| `sync` | Automat stanja spremanja, drain, backoff, konflikti, oporavak | Preneseno |
| `journal` | Lokalna trajna pohrana, jedan pisač po dokumentu (Web Locks) | Preneseno; mijenja se: logički vezan uz korisnika (BACKEND §4.3) |
| `commit` | CAS commit revizije s idempotencijom | Preneseno protokolom; RPC se prepisuje i spaja s `reserve` (§5) |
| `identity` | OIDC klijent prema AAI@EduHr, sesije u bazi, `current_actor()`, `withActor` | Novo (BACKEND §4.3) |
| `authz` | `can(actor, action, object)`, izvršni referentni model ovlasti Ductusa | Novo (BACKEND §4.4) |
| `institution` | Ustanova, kolegij, članstvo, zadatak i verzije zadatka, potvrde obavijesti, produljenja roka | Novo |
| `evidence` | Odsječci, hash lanac, potvrde, praznine, kontrolne točke | Domena, portovi i gateway preneseni; SQL i adapteri novi (§12) |
| `signing` | Port potpisa; KMS adapter u produkciji, razvojni potpisnik lokalno i u CI-ju | Preneseno (§12) |
| `anchoring` | Dnevni korijen, Merkle stablo, consistency dokaz, RFC 3161 žig, objava, CLI verifikator | Novo, val 2 (D-72) |
| `submission` | Zamrzavanje, rekonstrukcija u workeru, potvrda predaje | Novo |
| `projection` | Sažetak procesa i usporedba verzija; jedna funkcija za studenta i nastavnika; računa se na poslužitelju | Novo |
| `collaboration` | Komentari vezani uz odlomak, prijedlozi izmjena, izravne izmjene nastavnika i mentora (D-34), obavijesti | Novo |
| `rules` | Učitavanje Lekta paketa, profil fakulteta po zadatku, provjera oblika nad dokumentom editora | Novo |
| `citations` | Citiranje u tekstu i bibliografija prema stilu iz Lekta paketa | Novo (logika iz Lekte) |
| `declaration` | Izjava o pomoći (D-40), priloženi ispisi razgovora iz vanjskih alata kao izjavljeno (D-77), oznake lijepljenja | Novo |
| `import` | Uvoz DOCX-a i PDF-a u dokument kao označen događaj; parsiranje u pregledniku ili izoliranom poslu | Novo |
| `export` | DOCX i PDF u obliku fakulteta, izvoz evidencije | DOCX preneseno |
| `jobs` | pg-boss u workeru; tijela poslova samo ID-ovi | Novo (D-74) |
| `notification` | Obavijesti u aplikaciji i e-poštom, prozor P-03 | Novo |
| `retention` | Brisanje po klasi podataka, uključujući verzije objekata i kopije (BACKEND §4.7); posao u workeru | Novo |
| `audit` | Revizijski trag pristupa i administrativnih radnji, break-glass (BACKEND §2) | Novo |

### 2a. Sučelja prema infrastrukturi (portovi)

Sav pristup vanjskim uslugama ide kroz portove iz `src/application/ports`. Svaki port ima in-memory adapter za unit testove, lokalni adapter za `docker compose` i ugovorne testove koje prolaze svi adapteri.

| Port | Lokalno i CI | Produkcija (uvjetno, §9) |
| --- | --- | --- |
| Baza (`withActor`) | PostgreSQL u Dockeru s istim ulogama i migracijama | Upravljani PostgreSQL s PITR-om |
| Pohrana objekata (`putImmutable`, `get`, `head`) | MinIO | S3-kompatibilan bucket |
| Potpis (`sign(digest, keyId)`) | Razvojni Ed25519 potpisnik | KMS, samo nad digestom (D-71) |
| Vremenski žig | Lažni TSA u testovima | Dva neovisna RFC 3161 TSA-a (D-72) |
| E-pošta | Mailpit | Transakcijska usluga u EU-u |
| Pružatelj identiteta | Lažni OIDC pružatelj (samo lokalno i u CI-ju, D-09) | AAI@EduHr |
| Sat | Upravljiv sat u testovima | Sat baze za sva pravno relevantna vremena |

## 3. Podatkovni model

Sve tablice imaju uključen RLS i retke u pgTAP matrici pristupa. Pristup ide kroz `SECURITY DEFINER` funkcije s praznim `search_path` čiji je vlasnik uloga bez prijave; identitet funkcije izvode iz `current_actor()`, nikad iz parametra (BACKEND §4.1 i §4.3). Klijent nikad ne piše izravno u tablice evidencije, predaje ni revizijskog traga. Sva vremena su `timestamptz` iz sata baze; prikaz je u zoni Europe/Zagreb.

**Uloge u bazi** (BACKEND §3): `ductus_migrator` (jedini s DDL-om), `ductus_app` (web, podliježe RLS-u, bez `BYPASSRLS` i bez izravnog `EXECUTE` na evidencijske funkcije), `ductus_worker` (uske funkcije za potpis, rekonstrukciju i korijen), `ductus_retention` (samo brisanje pokazivača na sadržaj), `ductus_evidence` (NOLOGIN, vlasnik sheme `evidence`). Evidencija je u zasebnoj shemi `evidence`; fizički nazivi njezinih tablica određuju se u B4 prema prenesenom gatewayu, a niže su logički nazivi.

### Identitet i sesije

| Tablica | Ključni stupci | Tko čita |
| --- | --- | --- |
| `app_user` | id, izdavatelj i `hrEduPersonUniqueID` (jedinstveni par), `sub`, ustanova, ime za prikaz, posljednja prijava | Sam korisnik; nastavnik vidi ime studenata u svom kolegiju |
| `session` | hash tokena, korisnik, ustanova, nastala, istječe, zatvorena (odjava ili back-channel logout) | Nitko izravno; samo `current_actor()` |

### Ustanova i nastava

| Tablica | Ključni stupci | Tko čita |
| --- | --- | --- |
| `institution` | id, naziv, AAI `homeOrg`, postavke (pragovi P-01 do P-03, rokovi čuvanja, obveznost po vrsti rada) | Administrator te ustanove |
| `institution_role` | korisnik, ustanova, uloga (`teacher`, `admin`), potvrdio, vrijeme | Administrator |
| `course` | id, ustanova, naziv, akademska godina, pravilo AI-ja iz izvedbenog plana (D-52) | Članovi kolegija |
| `course_enrollment_code` | kolegij, hash koda, vrijedi do, aktivan | Nastavnik kolegija |
| `course_member` | kolegij, korisnik, uloga u kolegiju (`teacher`, `student`), od, do | Članovi kolegija |
| `mentorship` | mentor, student, vrsta rada, od, do, potvrdio | Mentor i student |
| `assignment` | id, kolegij, trenutna verzija | Članovi kolegija |
| `assignment_version` | zadatak, broj verzije, naslov, upute, vrsta rada, Lekta profil i verzija paketa, otvaranje, rok, pravila pomoći i dopuštene svrhe (D-80), profil evidencije, uvoz dopušten, ciklusi verzija, vrijeme. **Nepromjenjiva**; profil nove verzije smije biti samo uži | Članovi kolegija |
| `notice_acknowledgment` | student, verzija zadatka, vrijeme | Student; nastavnik zadatka |
| `deadline_extension` | zadatak, student, novi rok, razlog, odobrio | Student; nastavnik zadatka |

### Rad i evidencija

| Tablica | Ključni stupci | Tko čita |
| --- | --- | --- |
| `project` | id, zadatak ili mentorstvo, student, način izmjena nastavnika (prijedlozi ili izravno, D-21), oznaka odobrene prilagodbe (D-50) | Student vlasnik; nastavnik zadatka ili mentor |
| `document` | id, projekt, trenutna revizija | Student vlasnik |
| `document_checkpoint` | dokument, broj revizije, puni kanonski sadržaj, hash | Student; worker za rekonstrukciju |
| `document_revision` | dokument, broj revizije, bazna revizija, hash sadržaja, vrijeme baze, kraj sesije (da/ne). Sadržaj nastaje iz najbliže kontrolne točke i odsječaka | Student; nastavnik ili mentor trenutno stanje (D-06) i revizije na kraju sesija prema profilu |
| `evidence.segment` | dokument, raspon slijeda, autor (iz sesije), raspon revizija, adresa sadržaja u pohrani objekata (hash), prethodni hash, offline oznaka, vrijeme na uređaju (zaokruženo), `accepted_at` iz sata baze. Samo dodavanje (okidači, BACKEND §4.1) | Student; nastavnik nikad izravno, samo kroz projekciju |
| `evidence.receipt` | odsječak, `receipt_payload` (JCS), stanje (`pending_signature`, `signed`), potpis, ID ključa. Jedini dopušteni prijelaz je `pending_signature` u `signed` uz nepromijenjen payload | Kao odsječak |
| `evidence.gap` | dokument, od revizije, do revizije, uzrok | Student; nastavnik kroz projekciju |
| `evidence.signing_key` | ID ključa, namjena (potvrde, dnevni korijen), javni ključ, referenca na ključ u KMS-u, vrijedi od, vrijedi do, opozvan | Javno (bez reference) |
| `evidence.daily_root` | dan (UTC), broj listova, korijen, prethodni korijen, consistency dokaz, potpis, žigovi (`.tsr` i lanac certifikata po TSA-u), objavljeno. Val 2 (D-72) | Javno |
| `import_event` | dokument, revizija, naziv i vrsta datoteke, veličina, hash | Student; nastavnik kroz projekciju |
| `paste_label` | odsječak, oznaka (vlastite bilješke, citat, prijašnja verzija, vanjski AI, drugo), vrijeme. Samo dodavanje | Student; nastavnik kroz projekciju kao izjavljeno (D-43) |
| `review_request` | komentar, stanje (otvoren, proveden prema studentu, prihvaćen, ponovno otvoren), revizija prihvaćanja, hash sidrenog raspona pri prihvaćanju | Kao komentar (D-45), val 2 |
| `consultation` | mentorstvo ili projekt, datum, tema, dogovoreno, revizija rada, autor | Mentor i student (D-47), val 2 |
| `source_entry` | projekt, bibliografski zapis (CSL-JSON), bilješka, izvor uvoza (ručno, Zotero) | Student; nastavnik kroz projekciju citiranih jedinica (D-59) |
| `clipboard_origin` | projekt, otisak kopiranog teksta, podrijetlo (zapis izvora), vrijeme. Samo na uređaju i u odsječku lijepljenja | Student (D-58) |
| `source_check` | dokument, stavka bibliografije, DOI ili URL, rezultat (pronađeno, nije pronađeno, nedostupno), vrijeme | Student; nastavnik kroz projekciju (D-48) |
| `comment` | dokument, sidro u tekstu, autor, tekst, stanje (otvoren, odgovoren, riješen), vrijeme | Student vlasnik; nastavnik ili mentor rada |
| `suggestion` | dokument, bazna revizija, autor, koraci izmjene, stanje (otvoren, prihvaćen, odbijen), vrijeme | Kao komentar |
| `notification` | primatelj, vrsta, objekt, prozor P-03, poslano (aplikacija, e-pošta) | Primatelj |

Tablice za ugrađeni AI pomoćnik (`ai_transfer`, `ai_conversation`, šifrirani ključ pružatelja) nisu u pilotu (D-77, §11). Ako se vrate, ključ se šifrira aplikacijski (AES-256-GCM s AAD-om, BACKEND §4.5), ne u bazi.

### Predaja i pregled

| Tablica | Ključni stupci | Tko čita |
| --- | --- | --- |
| `submission` | id, zadatak, verzija zadatka, projekt, revizija, `requested_at` iz sata baze, nakon roka (da/ne, uz produljenje), hash artefakta, rezultat rekonstrukcije, potvrda | Student vlasnik; nastavnik zadatka |
| `assistance_declaration` | predaja ili poslana verzija, obrazac (koristio, nije koristio), stavke (alat, model, svrha, faza; uvijek izjavljeno), priloženi ispisi razgovora iz vanjskih alata (poveznica, izvoz ili zalijepljen tekst, D-77), refleksija, vrijeme (D-40) | Kao predaja |
| `student_note` | predaja ili odsječak, tekst, vrijeme, zamjenjuje (prethodna napomena). Samo dodavanje | Kao predaja |
| `access_log` | tko, što, kada, razlog (uključujući break-glass) | Administrator ustanove |
| `data_class` | klasa, svrha, rok čuvanja, osnova, rokovi kopija | Administrator ustanove |

Sadržaj odsječaka živi u privatnom bucketu, adresiran svojim hashom, odvojeno od metapodataka. Brisanje po roku briše sadržaj i njegove verzije, a lanac hasheva i čvorovi Merkle stabla ostaju provjerljivi uz zapis da je sadržaj obrisan. Brisanje je potpuno tek kad istekne i najdulji rok kopija (BACKEND §4.7).

### Klase podataka (C-21)

| Klasa | Primjeri | Prijedlog roka (potvrđuje FPZG, D-30) |
| --- | --- | --- |
| Lokalni zapis na uređaju | Dexie journal | Do sinkronizacije; briše se pri odjavi ili prijavi drugog korisnika |
| Sesije | `session` | Do isteka ili odjave, zatim kratko radi revizije |
| Radne verzije | Revizije i kontrolne točke projekta | Do kraja akademske godine zadatka |
| Evidencija | Odsječci, potvrde, praznine, uvozi | Kao predaja |
| Predaja | Predana verzija, izjava s priloženim ispisima razgovora, napomene, komentari | Prema pravilniku fakulteta |
| Revizijski trag | `access_log` | Dulje od predaje, za provjeru pristupa |
| Kopije | PITR, dnevni dump, replika bucketa | Vlastiti rok po vrsti kopije (BACKEND §4.7) |
| Evaluacija pilota | Ankete, razgovori | Odvojeno od evidencije, do kraja evaluacije |

## 4. Prijava

Mjerodavno je BACKEND §4.3 [PRIJEDLOG D-73]; ovdje je tijek.

1. Gumb "Prijava AAI@EduHr računom" pokreće OIDC Authorization Code s PKCE-om iz Next.js rute prema `login.aaiedu.hr` (produkcija) ili `fed-lab.aaiedu.hr` (staging). Klijenta u Registru resursa registrira FPZG kao svoju uslugu; Daniel to kao fizička osoba ne može sam.
2. Vlastiti OIDC klijent provjerava `state`, `nonce`, `iss`, `aud`, `azp`, `exp`, `iat`, algoritam i JWKS, čita atribute s userinfo endpointa i provjerava da je `sub` jednak onom iz ID tokena. Biblioteka (Better Auth s isključenim povezivanjem računa ili `openid-client`) bira se na M1 spikeu.
3. Pri prvoj prijavi nastaje `app_user` vezan uz izdavatelja i `hrEduPersonUniqueID`; ustanova se određuje iz `hrEduPersonHomeOrg`. **Nikad se računi ne spajaju po e-pošti**; prijava radi i kad AAI ne vrati `mail`. OIB se ne traži. Upis u kolegij uspijeva samo ako je `homeOrg` korisnika jednak ustanovi kolegija.
4. Poslužitelj izdaje nov slučajni token sesije u kolačiću `__Host-...; HttpOnly; Secure; SameSite=Lax`; u bazi je samo njegov hash. Mijenjajuće rute traže `Origin` i `Sec-Fetch-Site`.
5. Svaki pristup bazi ide kroz `withActor(token, fn)`, koji u transakciji postavlja `app.session_token`; `current_actor()` iz njega izvodi korisnika i ustanovu. Sirovi ID korisnika se nikad ne postavlja kao GUC (SQL injekcija bi glumila drugoga).
6. Odjava: RP-initiated logout prema AAI-ju i back-channel logout koji zatvara sesije u bazi. Istek sesije tijekom pisanja nije odjava; journal ostaje do ponovne prijave istog korisnika.
7. Uloga nastavnika nikad ne nastaje automatski; potvrđuje je administrator ustanove.

**Lažni OIDC pružatelj** postoji samo lokalno i u CI-ju (D-09); CI test dokazuje da ga produkcijska konfiguracija nema. Demo (D-76) koristi njega, uz jasnu oznaku "demo prijava".

**Kraj AAI računa:** kad student izgubi AAI račun, više se ne može prijaviti. Njegov rad i evidenciju na zahtjev izvozi administrator ustanove. Promjena matične ustanove stvara novi `hrEduPersonUniqueID`; spajanje računa radi samo administrator, uz zapis u revizijski trag.

## 5. Put jedne promjene

1. Editor stvara transakcije. Journal ih trajno zapisuje na uređaju (stanje "spremljeno na uređaju").
2. Transakcije se sažimaju u odsječak od najviše 30 sekundi. Odsječak nosi sve korake, jedno zaokruženo vrijeme i ID transakcije klijenta.
3. Drain šalje odsječak verzioniranoj API ruti za ingest u web procesu, koja redom:
   1. provjerava sesiju (`current_actor()`), članstvo, verziju zadatka i je li zadatak otvoren; autora određuje iz sesije, nikad iz polja klijenta;
   2. provjerava da su primljeni bajtovi jednaki ponovno izračunatom JCS nizu, računa SHA-256 i zapisuje objekt u bucket na adresu tog hasha (bez prepisivanja; postojeći objekt prihvaća se tek nakon usporedbe bajtova);
   3. poziva **jedan RPC** koji u istoj transakciji radi CAS reviziju dokumenta i `reserve` odsječka: provjerava redoslijed i baznu reviziju, upisuje reviziju i metapodatke, nastavlja hash lanac i stvara potvrdu u stanju `pending_signature`. Ponovljeni ID transakcije vraća isti rezultat. Ako RPC padne, objekt ostaje siroče (BACKEND §2, ADR u M3).
4. Worker preuzima posao (tijelo posla je samo ID), radi HEAD objekta, potpisuje digest potvrde ključem potvrda preko porta potpisa i priključuje potpis (`attach_signature` provjerava digest i da je ključ poznat i neopozvan).
5. Tek kad klijent dobije potpisanu potvrdu, stanje postaje "spremljeno na poslužitelju". Dok potpis čeka, klijent ostaje u stanju čekanja; ako worker ili KMS ne rade, potvrde ostaju `pending_signature` i backlog je alarm.

Siročad u bucketu se u pilotu samo broji i prijavljuje; brisanje tek nakon 30 dana uz ponovnu provjeru u bazi i savjetodavno zaključavanje po hashu, jer zakašnjeli offline klijent može upravo upisivati `reserve` (BACKEND §4.1).

Ako odsječci između dviju primljenih revizija trajno izostanu, poslužitelj bilježi prazninu za taj raspon. Praznina se nikad ne popunjava pretpostavkom.

**Kontrolne točke:** svaki commit nosi puni kanonski dokument, ali poslužitelj ga trajno sprema samo kao kontrolnu točku: svakih 200 koraka, na kraju svake sesije i uvijek kad otkrije prazninu. Time su rekonstrukcija i usporedba ograničenog trajanja. Vrijeme, memoriju i volumen za radove od 15.000 i 80.000 riječi mjeri B0.2.

## 5a. Suradnja nastavnika i studenta

- **Pogled na rad u nastajanju (D-06):** nastavnik ili mentor dobiva trenutno spremljeno stanje dokumenta kroz RPC koji provjerava odnos. Klijent provjerava novo stanje pollingom svakih 30 do 60 s; obavijest o novoj reviziji nastaje najviše jednom po P-03 prozoru (i samo na kraju sesije ako se potvrdi D-39). Tipkanje se ne prenosi uživo. [PRIJEDLOG D-74]
- **Komentari:** vezani uz raspon teksta preko sidra (preneseno iz `collaboration/anchor` u `pisac-editor`). Ako se tekst ispod sidra promijeni toliko da se sidro ne može pouzdano pronaći, komentar se prikazuje kao "sidro nije pouzdano", nikad na krivom mjestu.
- **Prijedlozi:** spremaju se odvojeno od dokumenta (`suggestion`), pa ne stvaraju sukob s pisanjem studenta. Kad ga student prihvati, koraci prijedloga primjenjuju se kao nova revizija s autorom "nastavnik (prihvaćeni prijedlog)".
- **Izravne izmjene (D-21, [PRIJEDLOG D-34]):** izravna izmjena je prijedlog koji studentov klijent automatski primjenjuje, pa dokument uvijek ima jednog pisača; student može vratiti način na prijedloge. **Otvoreno pitanje (BACKEND §4.1):** revizija tada nastaje na studentovu klijentu, a autor mora biti "nastavnik" bez povjerenja u polje klijenta (npr. potpisani zahtjev nastavnikove sesije koji klijent prilaže). Rješenje se određuje u M6; do tada D-34 ostaje PRIJEDLOG.
- **Zahtjev za doradu (D-45, val 2):** pri prihvaćanju se sprema hash sidrenog raspona; ako se raspon kasnije promijeni, projekcija prikazuje "promijenjeno nakon prihvaćanja". Deterministički, bez AI-ja.
- **Pripisivanje:** autor je dio svakog odsječka evidencije i određuje ga poslužitelj iz sesije.

## 5b. Pomoć AI-ja u pilotu

Ugrađeni AI pomoćnik nije u pilotu (D-77). Student koristi vlastiti alat izvan Ductusa, a uz izjavu (D-40, čl. 15 Smjernica) prilaže ispis razgovora kao poveznicu za dijeljenje, izvezenu datoteku ili zalijepljen tekst. Ductus ga sprema uz izjavu kao **izjavljeno**, ne provjerava ga i ne tvrdi ništa o njegovoj potpunosti. Lijepljenje iz vanjskog alata ostaje vidljivo kao lijepljenje, uz neobaveznu oznaku "vanjski AI" (D-43). Prvi ekran zadatka citira dopuštene i zabranjene uporabe iz FPZG čl. 8 (D-80).

Ništa u sustavu ne poziva AI pružatelja, pa nijedan AI pružatelj nije podizvršitelj obrade u pilotu.

## 5c. Lekta paket i uvoz

- **Paket pravila (D-25):** Lekta generira verzionirani paket po uzoru na postojeći `katedra-pack` (`scripts/generate-katedra-pack.mts`): profili fakulteta s pravilima oblika, rasponima opsega, obveznim dijelovima, citatnim stilom i predloškom naslovne stranice, uz verziju i hash. Ductus ga uvozi kao ovisnost s fiksnom verzijom; zadatak pamti verziju paketa s kojom je stvoren.
- **Provjera tijekom pisanja:** Lektina postojeća analiza radi nad DOCX datotekom. Za provjeru tijekom pisanja Ductus koristi pravila iz paketa nad dokumentom editora; potpuna Lektina provjera pokreće se nad izvezenim DOCX-om pri slanju verzije i predaji.
- **Citiranje:** logika citatnih stilova i bibliografije izdvaja se iz Lekte u zajednički modul bez ovisnosti o Viteu i DOM-u (druga faza paketa).
- **Licenca i podaci:** Lekta je trenutno `UNLICENSED`, a pravila potječu iz službenih dokumenata fakulteta. Prije objave paketa izvan vlastitih repozitorija treba odlučiti o licenci i pravu na redistribuciju pravila.
- **Uvoz:** DOCX se pretvara u dokument editora uz očuvanje strukture gdje je moguće; PDF se uvozi kao tekst s osnovnom strukturom i jasnom porukom da je oblik izgubljen. Oba su jedan označen događaj `import_event`. Parsiranje ide u pregledniku ili u izoliranom poslu workera s ograničenjem veličine i vremena (zip bombe, XXE), nikad u web procesu.

## 6. Predaja

1. Student potvrđuje predaju iz pregleda (S5). Predaja traži vezu s poslužiteljem: sve lokalne promjene moraju prvo biti potvrđene.
2. **Vrijeme predaje je `requested_at` iz sata baze u trenutku klika**, prije reda rekonstrukcija. Kašnjenje se određuje isključivo tim vremenom, uz produljenje roka.
3. Worker rekonstruira ciljanu reviziju od najbliže kontrolne točke i odsječaka, istim kodom kao klijent (ProseMirror u Nodeu), u kontejneru s ograničenim CPU-om da ne guši ingest. Ako u rasponu postoji praznina, rekonstrukcija kreće od kontrolne točke spremljene na kraju praznine, pa praznina ne sprječava točnu rekonstrukciju predane verzije; samo je vidljiva u evidenciji (D-11).
4. Rekonstruirani dokument uspoređuje se s ciljanom revizijom u kanonskom obliku (JCS). Nepodudarnost blokira predaju, bilježi incident i studentu nudi zamjenski postupak koji određuje fakultet (D-69, D-79), uz očuvani `requested_at`.
5. Ako se podudaraju: zapis `submission` s verzijom zadatka, `requested_at`, oznakom kašnjenja, hashom artefakta i potpisanom potvrdom. Revizija je zamrznuta.

Rokovi se unose i prikazuju u zoni Europe/Zagreb; promjena na zimsko računanje vremena 25. 10. 2026. pokrivena je testom. Load test (B9): sve predaje u 15 minuta prije roka.

## 7. Ovlasti

- `can(actor, action, object)` je jedino mjesto odluke; RLS politike i RPC-i pozivaju nju (D-07, BACKEND §4.4). Odnosi su plitki, ali postoje nasljeđivanja (kolegij, zadatak, projekt, dokument); zato nema OpenFGA servisa, ali postoji izvršni referentni model Ductusa u TypeScriptu i diferencijalni test koji `can()` uspoređuje s njim.
- Uloga sama ne daje pristup (C-23). Svaka odluka provjerava odnos: vlasnik projekta, nastavnik zadatka (aktivan član kolegija), mentor iz vlastitog `mentorship` zapisa, administrator ustanove.
- Nastavnik i mentor vide trenutno spremljeno stanje rada (D-06). Odsječke evidencije i stare revizije nikad ne čitaju izravno; dobivaju samo rezultat funkcije `projection`, izračunat na poslužitelju za profil verzije zadatka.
- Ispis studenta iz kolegija (`course_member.do`) ne briše njegove predaje; nastavnik ih i dalje vidi do isteka roka čuvanja. Uklonjeni nastavnik gubi pristup odmah: nema predmemorije odluka.
- Čitanje evidencije i izvoz evidencije su zasebne sposobnosti; administrator ustanove nije superadministrator sadržaja. Iznimni pristup ide kroz break-glass (razlog, uski opseg, istek, trag u `audit`).
- Kod za upis ima rok valjanosti, može se poništiti i ograničen je brojem pokušaja po korisniku.
- pgTAP matrica pristupa (studenti A i B, nastavnik vlastitog i tuđeg kolegija, mentor, ispisani student, uklonjeni nastavnik, administrator vlastite i tuđe ustanove, anoniman, istekla i tuđa sesija, SQL pod `ductus_app` koji pokušava glumiti drugoga) je uvjet za spajanje.
- **RLS je obrana u dubinu**, ne granica protiv kompromitirane aplikacije; tako piše i u DPIA-i.

## 8. Ključevi za potpis

[PRIJEDLOG D-71]; pojedinosti u BACKEND §1 i §4.1.

- Dva odvojena Ed25519 ključa u KMS-u: **ključ potvrda** i **ključ dnevnog korijena**. Materijal ključa ne napušta KMS; u KMS idu samo digesti. Potpisuje samo worker; web proces nema pristup ni materijalu ni pravu potpisa.
- Lokalno i u CI-ju koristi se razvojni potpisnik iza istog porta; konfiguracijska brava sprječava razvojni potpisnik u produkciji.
- Javni ključevi svih verzija su u `evidence.signing_key` s namjenom i razdobljem valjanosti, pa se stare potvrde mogu provjeriti i nakon rotacije (C-46).
- Rotacija: jednom godišnje i pri svakoj sumnji na kompromitaciju.
- Kompromitacija: ključ se označava opozvanim s vremenom; potvrde potpisane nakon tog vremena smatraju se nevaljanima i ponovno se potpisuju novim ključem. Listovi dnevnog korijena su potvrde bez potpisa, pa ponovni potpis ne mijenja već sidrene korijene. Događaj se bilježi i prijavljuje fakultetu.

## 8a. Dnevni korijen i vanjsko vrijeme

[PRIJEDLOG D-72], val 2; potpisane potvrde i hash lanac su u valu 1. Pojedinosti i granice tvrdnje u BACKEND §4.2.

- Worker jednom dnevno gradi Merkle stablo nad potvrdama dana (dan po UTC `accepted_at`; list je SHA-256 nad JCS `receipt_payload` bez potpisa), objavljuje broj listova, prethodni korijen i consistency dokaz.
- Korijen potpisuje ključ dnevnog korijena; traže se žigovi od dva neovisna RFC 3161 TSA-a. Dan bez ijednog valjanog žiga je alarm; korijen se tada objavljuje "bez žiga" i posao ponavlja.
- Objava u javni repozitorij i neovisnim primateljima (e-pošta koordinatoru FPZG-a, javna arhiva).
- Paket dokaza za predaju izdaje se kao "sidren" tek kad je pripadni korijen žigosan; do tada nosi oznaku "još nije sidren".
- **Granica tvrdnje** ide doslovno u sučelje i DPIA-u: korijen otkriva kasniju promjenu potvrda svakome tko drži objavljeni korijen; ne štiti od krivotvorenja prije sidrenja ni od dva različita korijena za isti dan bez neovisnog primatelja; ne dokazuje istinitost sadržaja ni autorstvo.

## 9. Okruženja

| Okruženje | Računalo | Baza | Objekti, e-pošta, potpis | Prijava | Podaci |
| --- | --- | --- | --- | --- | --- |
| Lokalno i CI | `docker compose` | PostgreSQL u Dockeru, iste uloge i migracije | MinIO, Mailpit, razvojni potpisnik | Lažni OIDC pružatelj | Samo sintetički |
| Staging | Kao produkcija, privremeno | Upravljana baza iste vrste kao produkcija | Iste vrste usluga kao produkcija (bucket, KMS) | AAI@EduHr Lab | Samo sintetički |
| Produkcija | VM u EU-u: Caddy, web, worker | Upravljani PostgreSQL s PITR-om, bez javne adrese | Privatni S3 bucket, transakcijska e-pošta u EU-u, KMS | AAI@EduHr | Stvarni, tek nakon GO uvjeta |

**Dobavljači [PRIJEDLOG D-08, uvjetan]:** UpCloud (VM i Managed PostgreSQL s PITR-om, ista privatna mreža), Scaleway (Object Storage i TEM), AWS (samo KMS, eu-central-1). Rezerva za bazu je Neon; alternativa B je Hetzner s PostgreSQL-om i WAL-G-om. Potvrda tek nakon B0.1 (povrat u točku, uloge, latencija, cijene) i B0.2 (rekonstrukcija); trošak premašuje D-66 i odluka je vlasnika (BACKEND §1, §5, §7). Do tada kod ne ovisi o dobavljaču (§2a), a demo (D-76) radi lokalno.

Pravila koja vrijede neovisno o dobavljaču (BACKEND §3, §4.7, §4.8):

- Migracije pokreće `ductus_migrator` s VM-a pri deployu, ne iz CI-ja; nikad ručno na produkciju bez prolaska kroz staging, nikad iz agenta. Expand/migrate/contract; provjera zanošenja sheme između staginga i produkcije.
- Staging koristi iste vrste resursa kao produkcija (upravljana baza, KMS, S3), jer sintetički prolaz na njemu je uvjet za svaku komponentu koja dira povjerenje (BACKEND §6 točka 12).
- Kopije: PITR, dnevni šifrirani `pg_dump` kod drugog dobavljača, dnevna replika bucketa na drugi račun, mjesečna proba povrata baze i bucketa. Rezervni put na drugom računu u istom kodu infrastrukture.
- Test u CI-ju provjerava da produkcijska konfiguracija nema lažnog OIDC pružatelja ni razvojnog potpisnika.

## 10. Sigurnosna osnova

- Web proces ne drži materijal ključeva; potpisuje samo worker preko KMS-a.
- Baza nema javnu adresu; veze prema bazi i bucketu su `verify-full`, ključevi bucketa uske ovlasti.
- Tajne: GitHub Environments sa zaštitom za CI, na VM-u `sops` + `age`; `age` ključ i pričuvne kopije tajni drži vlasnik izvan VM-a. Tajne nikad u repou.
- Bez sadržaja radova u logovima, predmemoriji i analitici (BACKEND §4.9): `log_statement=none`, Caddy log bez query stringova, praćenje grešaka bez tijela zahtjeva, canary test u CI-ju i na stagingu.
- Bez server-side renderiranja sadržaja: rute sa sadržajem su API rute s `dynamic = 'force-dynamic'` i `revalidate = 0`, uz ESLint pravilo i E2E test s dva korisnika.
- Lokalni journal se briše pri odjavi ili prije prijave drugog korisnika; odjava s nesinkroniziranim promjenama je blokirana uz poruku.
- Akcije u CI-ju pinane na SHA; Gitleaks, zizmor, Semgrep i OSV; Dependabot s odgodom.
- Deploy na produkciju samo iz zelenog `main`-a.
- Kontrolna lista za svaku backend komponentu (BACKEND §6) je uvjet za spajanje.

## 11. Odgođeno, s okidačem

Dopunjeno tablicom iz BACKEND §2.

| Element | Usvojiti kad |
| --- | --- |
| Ugrađeni AI pomoćnik (prijava kod pružatelja, proxy s popisom dopuštenih pružatelja, `ai_transfer`, razgovori, D-42, D-46, D-64) | Nakon pilota (D-77), kad postoji pružatelj s jamstvom obrade u EU-u ili partnerstvo koje dopušta korištenje pretplate |
| Reprodukcija s ritmom (D-56) | Izmjena Ustava C-14 i C-19 i pravno mišljenje (D-55); val 3. Izvedba: uz odsječak mentorskog rada zaseban blob s pomacima vremena po transakciji (100 ms), adresiran hashom u odsječku; brisanje bloba po roku ne ruši lanac. Reprodukciju gradi isti kod koji rekonstruira predaju; projekcija nema funkciju koja iz pomaka računa mjere (test) |
| Web verifikator dnevnog korijena | Val 2, ako ne stane u prvi rez; CLI verifikator ostaje |
| FINA kao TSA | Postoji poslovni subjekt (obrt) ili FPZG kao ugovorna strana (D-72) |
| OpenFGA ili drugi servis za ovlasti | Odnosi postanu tranzitivni, više servisa treba iste odluke ili više ustanova s različitim pravilima |
| Transparency log (Tessera) | Netko izvana ospori zapis ili ustanova traži svjedoka |
| eIDAS kvalificirani vremenski žig | Pravni postupak koji traži pravnu presumpciju |
| C2PA na predanom artefaktu | Kad SDK podrži DOCX; do tada odvojeni potpisani paket dokaza |
| Automatsko brisanje siročadi u bucketu | Nakon pilota, uz test konkurentnog čišćenja i zakašnjelog `reserve` (BACKEND §4.1) |
| Visoka dostupnost (više VM-ova, HA baza) | Ugovor sa SLA-om ili više ustanova; u pilotu jedan VM uz dokazan povrat i zamjenski postupak (D-69) |
| PowerSync | Kad postoji stvarno offline stanje osim dokumenta |
| Regionalne ćelije | Prva ustanova izvan EU-a |
| Merlin (LTI 1.3) | Srce pristane registrirati alat, ili više od 3 kolegija |
| Yjs i pisanje više autora | Grupni zadaci |

## 12. Preneseno iz `pisac-editor`

Izvor: `danielrisavi77-create/pisac-editor` nakon spajanja PR #49 i #50. Kod se prenosi zajedno s testovima; broj testova prenesenih modula mora ostati isti. Točan popis prema pregledu koda (BACKEND §2):

**Prenosi se bez izmjene:**

- `src/domain/*`, uključujući `document`, `sync`, `serverSync`, `json` i `forensics` (JCS, property testovi kanonizacije); komentari koji upućuju na migracije prijašnje platforme se brišu
- `src/application/ports/*` i `src/application/evidence/*` (gateway oko 328 redaka, s testovima)
- in-memory adapteri i ugovorni testovi
- `src/adapters/crypto/aws-kms-ed25519-signer*` i `development-ed25519-signer*`
- klijent: `src/lib/journal`, `src/lib/sync/drainRunner`, `src/lib/document/queries`, `src/editor` (Editor, schema, interop), sidra komentara (`collaboration/anchor`) i DOCX izvoz
- `authz/*.fga` samo kao izvor neprijateljskih slučajeva za pgTAP i diferencijalni test, ne kao model
- Vitest projekti, Playwright konfiguracija, `.gitattributes`; CI se slaže iznova u M0

**Prepisuje se:**

- sve SQL migracije (`evidence_r4_*` i F1): daju ovlasti ulogama koje u Ductusu ne postoje, funkcije su u shemi `public` s prefiksom `pisac_`, vlasništvo provjeravaju preko `pisac_workspaces.owner_id`, a F1 RPC-i čitaju identitet iz tokena platforme i namijenjeni su pozivu iz preglednika
- RPC-i evidencije (`pisac_evidence_reserve`, `_lookup`, `_ensure_package`, `_authorize_append`): primaju identitet kao parametar; u Ductusu ga izvode iz `current_actor()` (§3)
- `src/lib/evidence/*` i svi adapteri vezani uz klijent prijašnje platforme

**Novo:**

- `pg-evidence-*` adapteri (običan `pg`), `s3-evidence-payload-store`, `withActor`
- shema `evidence` s ulogama (§3), jedan RPC za commit i `reserve` (§5)
- izvršni referentni model ovlasti (§7), migracijski alat (BACKEND §4.8)

Realna procjena prijenosa i prepisa evidencije (B4): 5 do 8 večeri dodatno.

Ne prenosi se: AI Architect, stari prototip, `/demo` i moduli koji su radili samo u njemu, nekorišteni portovi, magic link prijava, dokumentacija iz PR #45 (ostaje u starom repou kao referenca).
