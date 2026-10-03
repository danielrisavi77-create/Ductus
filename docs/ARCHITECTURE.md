# Ductus: arhitektura pilota

Verzija 0.1 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Cilj: najjednostavnija arhitektura koja pouzdano ispunjava `PRODUCT.md` za pilot na jednom fakultetu, koju jedna osoba uz AI agente može održavati, i koja se kasnije može proširiti bez prepisivanja. Ciljna arhitektura iz `pisac-editor` PR #45 ostaje referenca; elementi koje ovdje odgađamo imaju zapisan okidač (odjeljak 11).

## 1. Stack

| Sloj | Izbor | Status |
| --- | --- | --- |
| Sučelje | Next.js (App Router), React, TypeScript | [PRIJEDLOG D-08], preneseno iz `pisac-editor` |
| Editor | Tiptap / ProseMirror | [PRIJEDLOG D-08], preneseno |
| Lokalna pohrana | Dexie (IndexedDB), journal s 8 stanja sinkronizacije | [PRIJEDLOG D-08], preneseno |
| Baza i prijava | Supabase: Postgres, RLS, Auth s vlastitim OIDC pružateljem, privatni Storage, Edge Functions, `pg_cron` | [PRIJEDLOG D-08] |
| Prijava | AAI@EduHr preko OpenID Connecta | [ODLUČENO D-09] |
| Hosting | Netlify za statiku i sučelje; sadržaj radova se obrađuje u pregledniku ili u Supabase Edge Functions (eu-central-1), nikad u Netlify funkcijama izvan EU-a | [PRIJEDLOG D-08] |
| Testovi | Vitest (unit i property), Playwright (E2E i axe), pgTAP (RLS) | Preneseno i prošireno |

Bez dodatnih servisa u pilotu: nema OpenFGA servisa, transparency loga, KMS-a, Redisa, reda poruka ni zasebnog API servera.

## 2. Moduli

Modularni monolit. Svaki modul ima vlastite tablice, RPC funkcije i testove; drugi moduli ga koriste samo kroz te funkcije.

| Modul | Odgovornost | Porijeklo |
| --- | --- | --- |
| `document` | Kanonski model dokumenta, validacija, normalizacija | Preneseno |
| `sync` | Automat stanja spremanja, drain, backoff, konflikti, oporavak | Preneseno |
| `journal` | Lokalna trajna pohrana, jedan pisač po dokumentu (Web Locks) | Preneseno; mijenja se: vezano uz korisnika, briše se pri odjavi |
| `commit` | CAS commit revizije s idempotencijom | Preneseno, ugrađeno u ingest (§5) |
| `identity` | AAI@EduHr prijava, mapiranje identiteta | Novo |
| `institution` | Ustanova, kolegij, članstvo, zadatak i verzije zadatka, potvrde obavijesti, produljenja roka | Novo |
| `evidence` | Odsječci, hash lanac, potpisi, praznine | Novo (JCS preneseno) |
| `submission` | Zamrzavanje, rekonstrukcija, potvrda predaje | Novo |
| `projection` | Sažetak procesa i usporedba verzija; jedna funkcija za studenta i nastavnika; računa se na poslužitelju | Novo |
| `review` | Komentar nastavnika vezan uz predanu reviziju | Novo |
| `export` | DOCX predane verzije, izvoz evidencije | DOCX preneseno |
| `retention` | Brisanje po klasi podataka (`pg_cron`) | Novo |
| `audit` | Revizijski trag pristupa i administrativnih radnji | Novo |

## 3. Podatkovni model

Sve tablice imaju uključen RLS. Pristup ide kroz `SECURITY DEFINER` pomoćne funkcije s praznim `search_path`. Klijent nikad ne piše izravno u tablice evidencije, predaje ni revizijskog traga. Sva vremena su `timestamptz`; prikaz je u zoni Europe/Zagreb.

### Ustanova i nastava

| Tablica | Ključni stupci | Tko čita |
| --- | --- | --- |
| `institution` | id, naziv, AAI `homeOrg`, postavke (pragovi P-01 i P-02, rokovi čuvanja) | Administrator te ustanove |
| `app_user` | id, `aai_unique_id` (jedinstven), ustanova, ime za prikaz, posljednja prijava | Sam korisnik; nastavnik vidi ime studenata u svom kolegiju |
| `institution_role` | korisnik, ustanova, uloga (`teacher`, `admin`), potvrdio, vrijeme | Administrator |
| `course` | id, ustanova, naziv, akademska godina | Članovi kolegija |
| `course_enrollment_code` | kolegij, hash koda, vrijedi do, aktivan | Nastavnik kolegija |
| `course_member` | kolegij, korisnik, uloga u kolegiju (`teacher`, `student`), od, do | Članovi kolegija |
| `assignment` | id, kolegij, trenutna verzija | Članovi kolegija |
| `assignment_version` | zadatak, broj verzije, naslov, upute, vrsta, otvaranje, rok, pravila pomoći, profil evidencije, uvoz dopušten, ponovna predaja dopuštena, vrijeme. **Nepromjenjiva**; profil nove verzije smije biti samo uži | Članovi kolegija |
| `notice_acknowledgment` | student, verzija zadatka, vrijeme | Student; nastavnik zadatka |
| `deadline_extension` | zadatak, student, novi rok, razlog, odobrio | Student; nastavnik zadatka |

### Rad i evidencija

| Tablica | Ključni stupci | Tko čita |
| --- | --- | --- |
| `project` | id, zadatak, student | Student vlasnik |
| `document` | id, projekt, trenutna revizija | Student vlasnik |
| `document_checkpoint` | dokument, broj revizije, puni kanonski sadržaj, hash | Student; poslužitelj za rekonstrukciju |
| `document_revision` | dokument, broj revizije, bazna revizija, hash sadržaja, vrijeme poslužitelja, kraj sesije (da/ne). Sadržaj se ne sprema pri svakoj reviziji; nastaje iz najbliže kontrolne točke i odsječaka | Student; nastavnik samo predane revizije i revizije na kraju sesija, prema profilu |
| `evidence_segment` | dokument, redni broj, raspon revizija, adresa sadržaja u Storageu (hash), prethodni hash, offline oznaka, vrijeme na uređaju (zaokruženo), vrijeme primitka, stanje potpisa | Student; nastavnik nikad izravno, samo kroz projekciju |
| `evidence_receipt` | odsječak, potpis, ID ključa | Kao odsječak |
| `evidence_gap` | dokument, od revizije, do revizije, uzrok | Student; nastavnik kroz projekciju |
| `import_event` | dokument, revizija, naziv datoteke, veličina, hash | Student; nastavnik kroz projekciju |
| `signing_key` | ID ključa, javni ključ, vrijedi od, vrijedi do, opozvan | Javno |

### Predaja i pregled

| Tablica | Ključni stupci | Tko čita |
| --- | --- | --- |
| `submission` | id, zadatak, verzija zadatka, projekt, revizija, vrijeme poslužitelja, nakon roka (da/ne, uz produljenje), hash artefakta, rezultat rekonstrukcije, potvrda | Student vlasnik; nastavnik zadatka |
| `assistance_declaration` | predaja, tekst izjave o AI-ju i drugoj pomoći, vrijeme | Kao predaja |
| `student_note` | predaja ili odsječak, tekst, vrijeme, zamjenjuje (prethodna napomena). Samo dodavanje | Kao predaja |
| `review_comment` | predaja, autor, tekst, vrijeme | Student vlasnik; nastavnik zadatka |
| `access_log` | tko, što, kada, razlog | Administrator ustanove |
| `data_class` | klasa, svrha, rok čuvanja, osnova | Administrator ustanove |

Sadržaj odsječaka živi u privatnom Storageu, adresiran svojim hashom, odvojeno od metapodataka. Brisanje po roku briše sadržaj, a lanac hasheva ostaje provjerljiv uz zapis da je sadržaj obrisan.

### Klase podataka (C-21)

| Klasa | Primjeri | Prijedlog roka (potvrđuje FPZG, D-14) |
| --- | --- | --- |
| Lokalni zapis na uređaju | Dexie journal | Do sinkronizacije; briše se pri odjavi |
| Radne verzije | Revizije i kontrolne točke projekta | Do kraja akademske godine zadatka |
| Evidencija | Odsječci, potpisi, praznine, uvozi | Kao predaja |
| Predaja | Predana verzija, izjava, napomene, komentari | Prema pravilniku fakulteta |
| Revizijski trag | `access_log` | Dulje od predaje, za provjeru pristupa |
| Evaluacija pilota | Ankete, razgovori | Odvojeno od evidencije, do kraja evaluacije |

## 4. Prijava

1. Gumb "Prijava AAI@EduHr računom" pokreće OIDC Authorization Code s PKCE-om prema `login.aaiedu.hr` (produkcija) ili `fed-lab.aaiedu.hr` (staging).
2. Supabase Auth (vlastiti pružatelj `custom:aaieduhr`) završava prijavu i izdaje vlastitu sesiju.
3. Pri prvoj prijavi nastaje `app_user` vezan uz `hrEduPersonUniqueID`; ustanova se određuje iz `hrEduPersonHomeOrg`. Upis u kolegij uspijeva samo ako je `homeOrg` korisnika jednak ustanovi kolegija.
4. Uloga nastavnika nikad ne nastaje automatski; potvrđuje je administrator ustanove.

**Spike M1 provjerava pet stvari na AAI@EduHr Labu prije ikakve gradnje:**

1. Čita li Supabase userinfo endpoint za vlastite pružatelje. AAI@EduHr ne vraća korisničke podatke u ID tokenu kad izdaje i access token.
2. Traži li Supabase e-mail, i radi li prijava s `email_optional`.
3. Povezuje li Supabase identitete automatski po e-mailu. Ako da, to je rizik preuzimanja računa i mora se isključiti.
4. Je li `provider_token` dostupan za jedno čitanje userinfo podataka.
5. Gdje se spremaju dodatne vrijednosti (`hrEduPersonUniqueID`, `homeOrg`, `affiliation`).

Rezervni plan ako Supabase ne zadovoljava: vlastiti OIDC klijent u Edge Functionu koji nakon provjere tokena stvara ili pronalazi korisnika i otvara Supabase sesiju preko administrativnog API-ja. Taj put traži zaseban sigurnosni pregled.

**Kraj AAI računa:** kad student izgubi AAI račun, više se ne može prijaviti. Njegov rad i evidenciju na zahtjev izvozi administrator ustanove. Promjena matične ustanove stvara novi `hrEduPersonUniqueID`; spajanje računa radi samo administrator, uz zapis u revizijski trag.

## 5. Put jedne promjene

1. Editor stvara transakcije. Journal ih trajno zapisuje na uređaju (stanje "spremljeno na uređaju").
2. Transakcije se sažimaju u odsječak od najviše 30 sekundi (D-04). Odsječak nosi sve korake, jedno zaokruženo vrijeme i ID transakcije klijenta.
3. Drain šalje odsječak **jednoj** Edge Functioni `ingest`, koja redom:
   1. provjerava sesiju, članstvo, verziju zadatka i je li zadatak otvoren;
   2. računa hash sadržaja i sprema ga u Storage na adresu tog hasha (ponovljeno slanje piše isti objekt);
   3. poziva RPC koji u jednoj Postgres transakciji provjerava redoslijed i baznu reviziju (CAS), upisuje reviziju i metapodatke odsječka i nastavlja hash lanac; ponovljeni ID transakcije vraća isti rezultat;
   4. potpisuje potvrdu Ed25519 ključem koji postoji samo kao tajna te funkcije i upisuje je.
4. Tek kad klijent dobije potpisanu potvrdu, stanje postaje "spremljeno na poslužitelju".
5. `pg_cron` svakih nekoliko minuta ponovno obrađuje odsječke koji su upisani, a nisu potpisani, i briše objekte u Storageu bez metapodataka starije od jednog dana.

Ako odsječci između dviju primljenih revizija trajno izostanu, poslužitelj bilježi prazninu za taj raspon. Praznina se nikad ne popunjava pretpostavkom.

**Kontrolne točke:** kao u F1, svaki commit nosi puni kanonski dokument, ali poslužitelj ga trajno sprema samo kao kontrolnu točku: svakih 200 koraka, na kraju svake sesije i uvijek kad otkrije prazninu (pristigla revizija ne nastavlja se na posljednji primljeni odsječak). Time su rekonstrukcija i usporedba ograničenog trajanja. Opterećenje Edge Functiona (CPU vrijeme pri rekonstrukciji s ProseMirrorom u Denu) mjeri se u M3 na najvećem očekivanom radu (15.000 riječi).

## 6. Predaja

1. Student potvrđuje predaju iz pregleda (S5). Predaja traži vezu s poslužiteljem: sve lokalne promjene moraju prvo biti potvrđene.
2. Poslužitelj rekonstruira ciljanu reviziju od najbliže kontrolne točke i odsječaka. Ako u rasponu postoji praznina, rekonstrukcija kreće od kontrolne točke spremljene na kraju praznine, pa praznina ne sprječava točnu rekonstrukciju predane verzije; samo je vidljiva u evidenciji (D-11).
3. Rekonstruirani dokument uspoređuje se s ciljanom revizijom u kanonskom obliku (JCS). Nepodudarnost blokira predaju, bilježi incident i studentu nudi alternativni postupak predaje koji određuje fakultet.
4. Ako se podudaraju: zapis `submission` s verzijom zadatka, vremenom poslužitelja i oznakom kašnjenja (uz produljenje roka), hash artefakta i potpisana potvrda. Revizija je zamrznuta.

Kašnjenje se određuje isključivo vremenom poslužitelja u trenutku predaje. Rokovi se unose i prikazuju u zoni Europe/Zagreb; promjena na zimsko računanje vremena 25. 10. 2026. pokrivena je testom.

## 7. Ovlasti

- Uloga sama ne daje pristup (C-23). Svaka RLS politika i svaki RPC provjerava odnos: vlasnik projekta, nastavnik zadatka (aktivan član kolegija), administrator ustanove.
- Nastavnik nikad ne čita odsječke ni revizije izravno. Dobiva samo rezultat funkcije `projection`, izračunat na poslužitelju za profil verzije zadatka uz koju je predaja vezana.
- Ispis studenta iz kolegija (`course_member.do`) ne briše njegove predaje; nastavnik ih i dalje vidi do isteka roka čuvanja. Uklonjeni nastavnik gubi pristup odmah.
- Kod za upis ima rok valjanosti, može se poništiti i ograničen je brojem pokušaja po korisniku.
- pgTAP matrica pristupa (studenti A i B, nastavnik vlastitog i tuđeg kolegija, ispisani student, uklonjeni nastavnik, administrator vlastite i tuđe ustanove, anoniman) je uvjet za spajanje.

## 8. Ključevi za potpis

- Jedan aktivni Ed25519 ključ; javni ključevi svih verzija su u `signing_key` s razdobljem valjanosti, pa se stare potvrde mogu provjeriti i nakon rotacije (C-46).
- Rotacija: jednom godišnje i pri svakoj sumnji na kompromitaciju.
- Kompromitacija: ključ se označava opozvanim s vremenom; potvrde potpisane nakon tog vremena smatraju se nevaljanima i ponovno se potpisuju novim ključem; događaj se bilježi i prijavljuje fakultetu.

## 9. Okruženja

| Okruženje | Baza | Prijava | Podaci |
| --- | --- | --- | --- |
| Lokalno i CI | `supabase start` (Docker) s migracijama iz repoa | Lažni OIDC pružatelj | Samo sintetički |
| Staging | Zaseban Supabase projekt | AAI@EduHr Lab | Samo sintetički |
| Produkcija | Supabase Pro, eu-central-1 | AAI@EduHr | Stvarni, tek nakon GO uvjeta |

Migracije se nikad ne primjenjuju ručno na produkciju bez prolaska kroz staging. Test u CI-ju provjerava da produkcijska konfiguracija nema lažnog OIDC pružatelja.

## 10. Sigurnosna osnova

- Privilegirani ključevi samo na poslužitelju; potpisni ključ samo u Edge Functionu `ingest`.
- Bez sadržaja radova u logovima i analitici.
- Lokalni journal se briše pri odjavi; odjava s nesinkroniziranim promjenama je blokirana uz poruku.
- Akcije u CI-ju pinane na SHA; Gitleaks lokalno i u CI-ju; Dependabot s odgodom.
- Deploy na produkciju samo iz zelenog `main`-a.

## 11. Odgođeno, s okidačem

| Element | Usvojiti kad |
| --- | --- |
| Reprodukcija pisanja | Zasebna odluka i Constitution Gate (C-14, C-19) |
| Dnevni korijen potvrda s RFC 3161 žigom, javna objava | Nakon pilota, ili ranije ako fakultet traži neovisnu provjeru vremena |
| Alat za neovisnu provjeru izvezene evidencije | Uz dnevni korijen |
| OpenFGA ili drugi servis za ovlasti | Više ustanova s različitim pravilima, ili SQL pomoćne funkcije postanu neprovjerljive |
| Transparency log (Tessera) | Netko izvana stvarno ospori zapis |
| KMS ili HSM za potpise | Prvi plaćeni ugovor ili sigurnosni pregled koji to traži |
| eIDAS kvalificirani vremenski žig | Pravni postupak koji traži pravnu presumpciju |
| C2PA na predanom artefaktu | Kad SDK podrži DOCX |
| PowerSync | Kad postoji stvarno offline stanje osim dokumenta |
| Regionalne ćelije | Prva ustanova izvan EU-a |
| Merlin (LTI 1.3) | Srce pristane registrirati alat, ili više od 3 kolegija |
| Yjs i pisanje više autora | Grupni zadaci |

## 12. Preneseno iz `pisac-editor`

Izvor: `danielrisavi77-create/pisac-editor` nakon spajanja PR #49 i #50. Prenosi se kod zajedno s testovima; broj testova prenesenih modula mora ostati isti.

- `src/domain/document`, `sync`, `serverSync`, `json`
- `src/lib/journal`, `src/lib/sync/drainRunner`, `src/lib/document/queries`
- `src/editor` (Editor, schema, interop) i DOCX izvoz
- `src/domain/forensics/jcs.ts` i property testovi kanonizacije
- F1 migracije za dokumente, revizije, checkpointe i njihove RPC funkcije (prilagođene novom modelu)
- `authz/*.fga` samo kao specifikacija za pgTAP testove
- CI, Vitest projekti, Playwright konfiguracija, `.gitattributes`

Ne prenosi se: AI Architect, stari prototip, `/demo` i moduli koji su radili samo u njemu, nekorišteni portovi, magic link prijava, dokumentacija iz PR #45 (ostaje u starom repou kao referenca).
