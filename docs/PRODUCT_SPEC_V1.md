# Ductura: Product Spec v1

Verzija 1.0 · 5. 10. 2026.  
Status: kandidat; nije prihvaćeni kanonski product/UI spec i sam ne odobrava implementaciju. `PRODUCT.md` §5, Constitution i potvrđene odluke imaju prednost; elementi u konfliktu ostaju blokirani do izričitog usklađenja. Naziv Ductura u ovom dokumentu radni je naziv, ne konačna odluka o brendu.
Vlasnik proizvoda: Daniel Rišavi

## 0. Svrha dokumenta

Ovaj dokument spaja tri sloja koji su do sada bili odvojeni:

1. postojeći kanonski plan proizvoda i odluke u `docs/PRODUCT.md`, `docs/PROGRAM.md`, `docs/FEATURES.md` i `docs/DECISIONS.md`;
2. odobreni vizualni smjer iz prototipa i novih Ductura/Pisač mockupova;
3. konkretan ekran-po-ekran product spec za razvoj, QA, pilot i kasniju institucionalnu prodaju.

Za svaki ekran definirani su:

- korisnik;
- svrha;
- podaci koje ekran prikazuje;
- glavne akcije;
- product pravila;
- zabranjena/nelogična stanja;
- backend i infrastrukturne ovisnosti;
- ciljni milestone;
- status dizajna.

Ovaj dokument ne briše postojeće odluke. Kad novi vizualni smjer ili vlasnička odluka ulaze u sukob s postojećim Product Constitution/PRODUCT pravilom, konflikt se evidentira u §18 i mora se formalno razriješiti prije implementacije konfliktnog ponašanja.

---

## 1. Produktna teza

Ductura je institucionalna platforma za dokaziv i transparentan proces akademskog rada.

Kupac je fakultet ili sveučilište. Primarni korisnici su:

- student;
- nastavnik;
- mentor;
- administrator ustanove;
- kasnije povjerenstvo / ovlašteni pregledavatelj u audit ili žalbenom postupku.

Temeljni end-to-end tok:

**Student otvara zadatak → razumije pravila i što se bilježi → piše rad → sustav bilježi proces → student šalje nacrt/predaju → nastavnik/mentor vidi rad i proces → po potrebi komentira/reproducira/uspoređuje → institucija ima verzionirana pravila i audit paket.**

Agentic Engineering System služi kao execution engine za ovaj tok. Ne određuje smjer proizvoda; smjer proizvoda određuje vlasnik proizvoda.

---

# 2. PRODUCT MAP

## 2.1 Public / pre-login

- W1 Početna stranica
- W2 Proizvod / Kako radi
- W3 Za fakultete
- W4 Sigurnost i privatnost
- W5 Cijene / pilot / zatraži demo
- W6 Kontakt
- W7 Procurement / institucionalni resursi

## 2.2 Student

- S1 AAI@EduHr prijava
- S2 Moji radovi
- S3 Assignment Start / transparentna obavijest
- S4 Uređivač rada
- S4a Literatura / bilježnica izvora
- S4b Komentari i prijedlozi
- S4c Verzije / nacrti
- S4d Replay za podržane mentorske radove
- S5 Pregled prije predaje
- S6 Predaja i izjava
- S7 Potvrda predaje / izvoz / QR
- S8 Napomene, dopune i osporavanje događaja

## 2.3 Nastavnik / mentor

- T1 Moji predmeti / mentorirani radovi
- T2 Course Dashboard
- T3 Assignment Setup
- T4 Student list
- T5 Pregled rada
- T6 Detaljna provenijencija
- T7 Replay / timeline
- T8 Compare versions
- T9 Komentari / zahtjevi za doradu
- T10 Konzultacije
- T11 Produljenje roka
- T12 Priprema za razgovor / obranu

## 2.4 Fakultet / administracija

- A1 Institution Overview
- A2 Korisnici i uloge
- A3 Kolegiji i akademske godine
- A4 Faculty / Course Policy Engine
- A5 Retention / legal hold
- A6 Security / audit
- A7 Integrations / AAI@EduHr
- A8 Export / exit from service
- A9 System health / backup / status

## 2.5 Audit / žalbe

- C1 Popis slučajeva
- C2 Evidence Package
- C3 Access audit
- C4 Policy snapshot
- C5 Cryptographic verification
- C6 Export PDF / ZIP / zapisnik

---

# 3. W1 — Početna stranica

**Korisnik:** javnost, nastavnik, uprava fakulteta, DPO, potencijalni pilot partner.

**Svrha:** u 20–30 sekundi objasniti što je Ductura/Pisač, kome služi i zašto je institucionalno relevantna.

**Ključni sadržaj:**

- hero: “Platforma za dokaziv i transparentan proces akademskog rada.”
- kratko objašnjenje student → proces → nastavnik → institucija;
- CTA `Zatraži demo`;
- CTA `Pogledaj proizvod`;
- preview studentskog editora;
- preview mentorskog pregleda;
- privatnost i sigurnost;
- institucionalne koristi;
- footer s kontaktom i pravnim dokumentima.

**Glavne akcije:**

- zatraži demo;
- pogledaj proizvod;
- otvori sigurnost;
- otvori stranicu za fakultete;
- kontakt.

**Pravila:**

- javno pozicioniranje mora ostati institucionalno, akademsko i transparentno;
- website ne smije izgledati kao consumer AI writing app;
- demo zahtjev ide prema vlasniku / sales inboxu.

**Ovisnosti:** nijedna kritična backend ovisnost; kontakt forma / CRM može kasnije.

**Milestone:** poslije radnog institucionalnog demoa, prije širenja izvan FPZG-a.

**Dizajn:** definiran u `Ductura_UI_Mockups_i_Design_System.pptx`.

---

# 4. S1–S3 — Ulazak studenta u sustav

## 4.1 S1 — AAI@EduHr prijava

**Svrha:** institucionalni login bez alternativnog studentskog identiteta.

**Prikaz:**

- Ductura/Pisač logo;
- “Prijava putem AAI@EduHr”;
- naziv ustanove ako je poznat;
- privatnost i podrška;
- session/logout stanje.

**Backend:** B2 identitet, OIDC, session, `current_actor()`.

**Milestone:** M1 / poslije demoa za stvarni FPZG pilot; demo koristi lažni OIDC.

---

## 4.2 S2 — Moji radovi

**Svrha:** početna studentska nadzorna ploča.

**Prikazuje:**

- aktivne zadatke;
- kolegij;
- nastavnika/mentora;
- rok;
- stanje: nije započeto / u radu / poslano na pregled / predano;
- zadnju izmjenu;
- otvorene komentare / zahtjeve za doradu;
- napredak prema cilju;
- nadolazeće rokove.

**Akcije:**

- otvori rad;
- otvori zadatak;
- nastavi pisanje;
- pogledaj komentar;
- pogledaj predanu verziju.

**Nedostaje u trenutnim mockupovima:** DA.

**Milestone:** Val 1.

---

## 4.3 S3 — Transparentna obavijest prije početka

**Svrha:** prije prvog evidentiranog događaja student mora razumjeti pravila.

**Prikazuje:**

- vrstu rada;
- rok;
- opseg / cilj;
- format;
- što se bilježi;
- što se ne bilježi;
- što nastavnik vidi;
- kada nastavnik vidi spremljeno stanje;
- dopuštenu/obveznu uporabu AI alata;
- pravila uvoza;
- retention;
- eventualni Replay za mentorski rad;
- odobrene prilagodbe;
- kontakt za pomoć / zamjenski postupak.

**Akcija:** `Pročitao/la sam pravila i nastavi`.

**Kritično pravilo:** prije potvrde nema evidencije za taj rad.

**Nedostaje u trenutnim mockupovima:** DA — prioritet za dizajn.

**Milestone:** demo/Val 1.

---

# 5. S4 — Studentski editor

**Korisnik:** student.

**Svrha:** mjesto gdje student realno želi pisati cijeli rad, bez potrebe da ga piše u Wordu i samo zalijepi na kraju.

**Layout:**

1. lijevo: Struktura;
2. sredina: dokument;
3. desno: Asistent / Literatura / Upute / Komentari;
4. dno: status spremanja i napretka.

**Prikazuje:**

- poglavlja;
- cilj riječi po poglavlju;
- status spremanja;
- citate;
- fusnote;
- tablice / grafikone;
- literaturu;
- riječi / stranice;
- dane do roka;
- napredak;
- komentare;
- session status.

**Akcije:**

- pisanje;
- formatiranje;
- citiranje;
- literatura;
- komentari;
- verzije;
- slanje nacrta;
- predaja.

**Dizajn:** visok stupanj definiranosti.

**Milestone:** demo + M5.

---

# 6. S4a — Literatura i bilježnica izvora

**Prikazuje:**

- popis izvora;
- PDF izvor;
- bilješke;
- stranice;
- DOI;
- ISBN;
- bibliografske podatke;
- citate;
- status citata u radu.

**Akcije:**

- dodaj izvor;
- uvoz BibTeX / RIS / CSL-JSON;
- “Citiraj”;
- “Kopiraj navod”;
- otvori PDF;
- istakni;
- dodaj bilješku.

**Postojeći plan:** D-59, S-08, S-09, A-03.

**Dizajn:** još nije izrađen kao zaseban ekran.

**Milestone po podfunkcijama — zadržava postojeći PROGRAM/FEATURES raspored:**

| Podfunkcija | Postojeći izvor | Milestone / val |
| --- | --- | --- |
| Osnovna bilježnica izvora | D-59 / M5 osnovno | Val 1 |
| DOI i ISBN | S-08 / M5 osnovno | Val 1 |
| Zotero/BibTeX/RIS/CSL-JSON uvoz | D-59 | Val 2 |
| PDF izvori s isticanjem i citatom sa stranicom | S-09 | Val 3 |
| Provjera doslovnog citata u PDF izvoru | A-03 | Val 3, uz S-09 |

Ovaj Screen ID ne mijenja raspored iz `PROGRAM.md`; on samo okuplja funkcije koje će na kraju živjeti u istom korisničkom području.

---

# 7. S4b / T9 — Komentari, prijedlozi i dorade

**Korisnici:** student, nastavnik, mentor.

**Svrha:** puni collaboration workflow.

**Objekti:**

- komentar;
- thread;
- prijedlog;
- izravna izmjena;
- zahtjev za doradu;
- status zahtjeva;
- banka komentara;
- batch publish komentara.

**Akcije nastavnika:**

- komentiraj odlomak;
- predloži izmjenu;
- zatraži doradu;
- objavi sve komentare;
- riješi thread.

**Akcije studenta:**

- odgovori;
- prihvati;
- odbij;
- označi kao riješeno;
- pošalji novu verziju.

**Plan:** već postoji kroz D-21, D-45, D-51, N-03, N-05.

**Dizajn:** djelomičan; treba dedicated mockup.

---

# 8. S4c — Verzije i ciklusi nacrta

**Svrha:** jasno modelirati D-28.

**Stanja:**

- rad u tijeku;
- nacrt spreman;
- poslano mentoru;
- na pregledu;
- vraćeno na doradu;
- nova verzija;
- finalna predaja.

**Prikazuje:**

- verziju;
- datum;
- tko je poslao;
- komentar uz verziju;
- status;
- diff;
- snapshot.

**Akcije:** pošalji nacrt, otvori komentar, usporedi, nastavi uređivanje.

**Dizajn:** nedostaje dedicated ekran.

---

# 9. S4d / T7 — Replay / Reprodukcija rada

**Korisnici:** student i mentor/nastavnik prema konfiguraciji.

**Vizualni koncept:** vremenska crta + manuskript + selected event + playback controls.

**Prikazuje:**

- sjednice;
- velike izmjene;
- komentare;
- odabrani događaj;
- prije/poslije tekst;
- provenance legendu;
- playback bar;
- speed control;
- full-session view.

**Akcije:**

- play / pause;
- odaberi događaj;
- skok na sjednicu;
- promjena brzine;
- prikaz konteksta;
- studentova napomena uz događaj.

**OWNER ODLUKA 5. 10. 2026.:** vizualni i funkcionalni Replay koncept iz novih mockupova zadržava se. Ne mijenja se u ovom Product Specu.

**Napomena:** postojeća pravna/Constitution pravila vezana uz D-56 i dalje moraju biti formalno usklađena prije implementacije svih elemenata koji su s njima u sukobu. Dizajn se ne reducira; pravila se usklađuju odvojenim governance korakom.

---

# 10. S5–S7 — Predaja

## 10.1 S5 — Spremno za predaju?

**Prikazuje:**

- točna rekonstrukcija;
- potpuni lanac dokaza;
- konzistentnost dokumenta;
- otvorena mjesta;
- korištene alate;
- AI uporabe;
- akademsku izjavu;
- detalje rada;
- privatnost i sigurnost.

**Akcije:**

- dopuni izjavu;
- odaberi alate;
- odaberi načine korištenja;
- otvori problem;
- predaj rad.

**Dizajn:** definiran.

---

## 10.2 S6 — Student Declaration

**Podaci:**

- alati;
- provider;
- model;
- svrha;
- faza rada;
- vanjski alati;
- razgovori / izvozi prema pravilima;
- ljudska pomoć;
- prilagodba;
- slobodna napomena.

**Backend:** D-40, D-41, R-09, R-10.

---

## 10.3 S7 — Potvrda predaje

**Prikazuje:**

- submitted_at / requested_at;
- status rekonstrukcije;
- finalni hash;
- downloadable receipt;
- QR / verifier;
- DOCX/PDF hash;
- izvoz rada;
- izvoz izjave.

**Plan:** D-49, R-06, D-80.

**Dizajn:** treba dedicated mockup.

---

# 11. T1–T4 — Nastavnički prostor i Course Dashboard

## 11.1 T1 — Moji predmeti

Prikazuje kolegije, semestar, broj studenata, aktivne zadatke.

## 11.2 T2 — Course Dashboard

**Prikazuje:**

- seminarski / drugi zadatak;
- Predano;
- U radu;
- Nisu započeli;
- prosječnu dovršenost;
- tablicu studenata;
- reconstruction status;
- evidence gaps;
- zadnju aktivnost;
- recent activity;
- napomenu nastavnika.

**Akcije:** otvori studentov rad, filtriraj, izvezi, uredi zadatak.

**Dizajn:** definiran.

## 11.3 T3 — Assignment Setup Wizard

**Korak 1:** osnovno  
**Korak 2:** format i opseg  
**Korak 3:** policy / AI / uvoz  
**Korak 4:** evidencija i privatnost  
**Korak 5:** nacrti / komentari / predaja

**Dizajn:** nedostaje.

## 11.4 T4 — Student list

Može biti dio Course Dashboarda ili zaseban prikaz.

---

# 12. T5–T8 — Pregled jednog rada

## 12.1 T5 — Mentor Review Overview

**Prikazuje:**

- naslov / student / rad;
- provenance summary;
- tekst;
- policy side panel;
- genealogiju;
- event log;
- navigation tabs.

**OWNER ODLUKA 5. 10. 2026.:** novi mockup ostaje točno u smjeru u kojem je dizajniran, uključujući:

- `6.1% nepoznato podrijetlo`;
- postotne udjele provenance kategorija;
- `AI doprinos 5.1%`;
- `U SKLADU` oznake u policy panelu;
- vizualno isticanje segmenata;
- statusni sažetak u donjoj traci.

Ovaj Product Spec ne uklanja niti zamjenjuje te elemente.

## 12.2 T6 — Detaljna provenijencija

- tekst po segmentima;
- tipkanje;
- literatura;
- AI praćeni kanal;
- nepoznato podrijetlo;
- event detail;
- izvor / genealogija.

## 12.3 T7 — Replay

Vidi §9.

## 12.4 T8 — Compare versions

- left/right ili inline diff;
- odabrane verzije;
- additions/deletions;
- author attribution;
- jump to paragraph.

---

# 13. T10–T12 — Mentorski workflow

## T10 — Konzultacije

- datum;
- verzija rada;
- kratka bilješka;
- sudionici;
- follow-up;
- nije scoring.

## T11 — Produljenje roka

- novi rok;
- razlog;
- student;
- originalni rok;
- audit zapis;
- vidljivost samo relevantnim korisnicima.

## T12 — Priprema za razgovor / obranu

- konkretna mjesta u tekstu;
- relevantni događaji;
- komentari;
- verzije;
- pitanja za razgovor;
- studentova izjava;
- obrana / povjerenstvo.

---

# 14. A1–A9 — Institucionalna administracija

## A1 — Administracija ustanove

**Prikazuje:**

- aktivne kolegije;
- aktivne studente;
- predaje;
- reconstruction health;
- AAI status;
- storage;
- backup;
- retention;
- audit log.

**Dizajn:** definiran.

## A2 — Korisnici i uloge

- korisnik;
- affiliation;
- uloga;
- kolegij;
- mentorstvo;
- status;
- revoke.

## A3 — Kolegiji

- akademska godina;
- kolegij;
- nastavnik;
- broj studenata;
- policy;
- status.

## A4 — Policy Engine

**Dizajn:** definiran kroz tri kategorije:

- Dopušteno;
- Mora se deklarirati;
- Nije dopušteno.

**Dodatno:**

- naziv;
- verzija;
- datum stupanja na snagu;
- primjena;
- inheritance;
- izjavu pri predaji;
- povijest verzija;
- preview.

**OWNER ODLUKA 5. 10. 2026.:** `U SKLADU` statusna semantika iz mockupova se zadržava.

## A5 — Retention / legal hold

- klase podataka;
- rok;
- policy version;
- legal hold;
- export;
- deletion status.

## A6 — Security / audit

- tko je otvorio rad;
- administratorske promjene;
- podrška;
- export;
- security events.

## A7 — Integrations

- AAI@EduHr;
- Merlin;
- Moodle;
- e-mail;
- object storage / status samo za administratore gdje ima smisla.

## A8 — Exit from service

- izvoz svih podataka fakulteta;
- status izvoza;
- manifest.

## A9 — System health

- backup;
- restore test;
- uptime;
- incident;
- storage;
- worker queue;
- status page.

---

# 15. C1–C6 — Audit i žalbe

## C1 — Popis slučajeva

- ID;
- student;
- rad;
- datum;
- razlog otvaranja;
- status;
- ovlašteni pregledavatelji.

**Povjerenstvo / N-09:** pristup člana povjerenstva nije trajna uloga niti globalna ovlast. Veže se uz konkretan rad/slučaj, ima `valid_from` i `valid_until`, može se opozvati prije isteka, a nakon isteka više ne daje sadržajni ni evidence-package pristup. Model odnosa ulazi u M2 (D-65), a UI i obrambeni tok moraju biti spremni prije prvog roka obrana (D-68).

## C2 — Paket dokaza

**Pristup:** student, mentor/nastavnik i posebno ovlašteni pregledavatelji prema odnosu i svrsi. Za povjerenstvo vrijedi N-09: vremenski ograničen pristup samo dodijeljenom radu/slučaju, s eksplicitnim početkom, istekom i opozivom. Svako otvaranje paketa ide u C3 Access Audit.

**Sadržaj:**

- Finalni dokument;
- Procesna vremenska crta;
- Rezultat rekonstrukcije;
- Relevantne verzije;
- Izjava studenta;
- Politika važeća pri predaji;
- Kriptografska potvrda.

**OWNER ODLUKA 5. 10. 2026.:** vizualni koncept `Nema indikacija neautentičnog autorstva` iz novog mockupa se zadržava u ovom Product Specu. Ne uklanja se niti zamjenjuje drugim copyjem ovim PR-om.

**Governance napomena:** implementacija zahtijeva eksplicitno usklađivanje s postojećim pravilima koja ograničavaju tvrdnje o autorstvu. Dizajn je product-owner zahtjev; konflikt se evidentira u §18.

## C3 — Access Audit

Tko je, kada i zašto pristupio predmetu.

## C4 — Policy Snapshot

Točna verzija pravila koja je vrijedila u trenutku relevantnog događaja / predaje.

## C5 — Cryptographic verification

- SHA-256;
- receipt;
- signature;
- timestamp;
- chain state;
- verifier.

## C6 — Exports

- PDF;
- ZIP;
- zapisnik;
- manifest.

---

# 16. AI Assistant

**Vizualni koncept:** desni panel u studentskom editoru s:

- Asistent;
- Literatura;
- Upute;
- Komentari;
- svrha korištenja;
- prompt box;
- prijedlozi;
- insert/copy.

**OWNER ODLUKA 5. 10. 2026.:** ugrađeni AI Assistant ostaje dio product visiona i dizajna upravo kako je prikazan u mockupovima. Ovaj Product Spec ga ne uklanja niti zamjenjuje.

**Status rollouta:** postojeći D-77 ga i dalje može odgoditi iz prvog FPZG pilota dok se ne promijeni odluka. To je rollout odluka, ne brisanje funkcije iz proizvoda.

---

# 17. Design System

## 17.1 Vizualni smjer

- dark academic SaaS;
- charcoal / black-green pozadina;
- mint / teal primary;
- elegantni serif naglasci za hero i dokument;
- čisti sans-serif za UI;
- thin borders;
- rounded cards;
- minimal glow;
- ozbiljan institucionalni ton.

## 17.2 Boje

Predloženi design tokeni iz vizualnog boarda:

| Token | Vrijednost | Uporaba |
| --- | --- | --- |
| Primary Green | `#14B8A6` | primarne akcije |
| Primary Dark | `#0D9488` | hover / active |
| Primary Light | `#5EEAD4` | highlight |
| Cyan | `#22D3EE` | info |
| Warning | `#FBBF24` | upozorenje |
| Error | `#EF4444` | greška |
| Background | `#0A0F0E` | app background |
| Surface 1 | `#111827` | glavni paneli |
| Surface 2 | `#1F2937` | sekundarni paneli |
| Border | `#334155` | rubovi |
| Text Primary | `#F8FAFC` | primarni tekst |
| Text Secondary | `#94A3B8` | sekundarni tekst |

## 17.3 Tipografija

- UI: Inter ili ekvivalentni sans-serif;
- editorial/document headings: Playfair Display ili ekvivalentni serif;
- document body može koristiti serif optimiziran za duga čitanja;
- brojevi / logovi po potrebi mono.

## 17.4 Kanonski artefakti

Google Drive mapa `Ductura`:

- `Ductura_Product_Vision_i_UX_Blueprint.docx`
- `Ductura_UI_Mockups_i_Design_System.pptx`

---

# 18. Conflict Register — OWNER ODLUKA: mockupovi se ne reduciraju

Ovaj odjeljak postoji zato što se nova product-owner vizija u nekoliko točaka razlikuje od ranijih ograničenja.

## 18.1 Zadržani elementi

Vlasnik je 5. 10. 2026. izričito odlučio zadržati:

1. postotak `nepoznato podrijetlo`;
2. postotne provenance kategorije;
3. `AI doprinos` postotak u praćenom kanalu;
4. `U SKLADU` policy oznake;
5. copy poput `Nema indikacija neautentičnog autorstva` u audit/reconstruction prikazu;
6. ugrađeni AI Assistant kao dio ciljnog proizvoda;
7. Replay kao vizualno i funkcionalno definiran feature.

## 18.2 Postojeći konflikti

Mogući sukobi s trenutačnim:

- PRODUCT §5 pravilo 2;
- D-57;
- D-61;
- D-62;
- D-01 / C-9 / C-10 za copy o autorstvu;
- D-77 za timing AI Assistanta;
- D-56 / Constitution Gate za Replay.

## 18.3 Pravilo za razvoj

**Dizajn se ne mijenja da bi sakrio konflikt.**

Evidencija vlasničke želje u §18.1 čuva povijest i ne predstavlja izuzeće od `PRODUCT.md` §5 ili Ustava. Dok nadležna odluka ne uskladi pravila, konfliktni elementi ne smiju se graditi niti prikazivati korisnicima.

Umjesto toga:

1. otvoriti zaseban governance/product issue;
2. definirati koja prethodna odluka se zamjenjuje;
3. ako treba, ažurirati Product Constitution;
4. ako postoji pravni/GDPR utjecaj, pribaviti mišljenje prije stvarnih podataka;
5. tek tada implementirati konfliktni dio.

Nekonfliktne dijelove mockupova frontend smije graditi u okviru postojećeg dodijeljenog Linear zadatka, prihvaćenog repo opsega i kriterija te odobrenog dizajna. Ovaj kandidat-spec sam ne daje odobrenje za implementaciju i ne poništava već izričito dana vlasnička odobrenja.

---

# 19. GAP BACKLOG

## 19.0 Pravilo deduplikacije

E1–E6 nisu automatski novi paralelni implementacijski trackovi. Svaka stavka mora imati jednu od tri oznake:

- **NEW** — stvarno nova funkcionalnost/model koji postojeći M0–M11 ne pokriva;
- **UX GAP** — novi ekran/tok nad već planiranim backendom ili postojećom funkcijom;
- **REUSE** — postojeći milestone/task ostaje jedini implementacijski izvor istine; epic služi samo za product/UX koordinaciju i traceability.

Ako stavka ima REUSE ili UX GAP, ne otvara se drugi backend task s novim acceptance criteriajima; novi issue mora referencirati postojeći M/D/N/F/R zadatak.



## E1 — Public Website & Institutional Sales

- E1-01 Homepage
- E1-02 Product / Kako radi
- E1-03 Za fakultete
- E1-04 Security / Privacy
- E1-05 Pricing / Pilot
- E1-06 Request demo / contact
- E1-07 Procurement resources

## E2 — Policy Governance

- E2-01 Faculty Policy entity
- E2-02 Course inheritance
- E2-03 Assignment narrowing
- E2-04 Version history
- E2-05 Effective dates
- E2-06 Policy snapshot at submission
- E2-07 Declaration preview
- E2-08 Policy diff

## E3 — Institution Operations

| Stavka | Tip | Kanonska implementacijska veza |
| --- | --- | --- |
| E3-01 Institution Overview | UX GAP | agregira postojeće admin/ops podatke |
| E3-02 Users & roles | REUSE | M2, D-07/D-81 |
| E3-03 AAI health | UX GAP | M1 + M11 operativni status |
| E3-04 Courses | REUSE | M2 model fakulteta |
| E3-05 Storage | UX GAP | B9 / M11 ops |
| E3-06 Retention | REUSE | M10, F-02 |
| E3-07 Backup status | UX GAP | B9 / M11 restore i backup dokaz |
| E3-08 Audit log | UX GAP | postojeći access/audit model |
| E3-09 Integration health | UX GAP | AAI/Merlin/e-mail integracije prema postojećim planovima |

E3 se ne smije koristiti za dupliciranje M2/M10/B9 implementacije.

## E4 — Evidence & Appeals

- E4-01 Case model
- E4-02 EvidencePackage model
- E4-03 Policy snapshot
- E4-04 Access audit attachment
- E4-05 Signed manifest
- E4-06 PDF export
- E4-07 ZIP export
- E4-08 Committee record — **REUSE/UX GAP:** N-09 + D-65 + D-68; mora koristiti vremenski ograničen pristup iz C1/C2

## E5 — Trust & Transparency UX

- E5-01 S3 transparency screen
- E5-02 What is / is not recorded
- E5-03 Who viewed my paper
- E5-04 Student event explanation
- E5-05 Event dispute / correction
- E5-06 Adaptation label
- E5-07 Support / fallback procedure

## E6 — Collaboration Workflow

| Stavka | Tip | Kanonska implementacijska veza |
| --- | --- | --- |
| E6-01 Comment threads | REUSE + UX GAP | M6 |
| E6-02 Suggestions | REUSE + UX GAP | M6 |
| E6-03 Direct edits | REUSE + UX GAP | D-21, D-34, M6 val 2 |
| E6-04 Revision requests | REUSE + UX GAP | D-45, M6 val 2 |
| E6-05 Batch publish | REUSE + UX GAP | D-51, M6 val 2 |
| E6-06 Draft/version lifecycle | REUSE + UX GAP | D-28, M7 |
| E6-07 Consultation record | REUSE + UX GAP | D-47, mentorski val |
| E6-08 Compare versions | REUSE + UX GAP | M7 |
| E6-09 Deadline extension | REUSE + UX GAP | M7 / PRODUCT §6 |

E6 je product/UX koordinacijski epic. Ne otvara drugi backend track za funkcije koje već imaju M6/M7/D-odluke.

---

# 20. Što već postoji i ne treba duplicirati

Ovaj Product Spec ne otvara nove epike za funkcije koje su već dovoljno jasno u postojećem planu:

- editor core;
- Dexie/offline;
- evidence ingest;
- exact reconstruction;
- hash chain;
- Ed25519 receipts;
- RLS / authz;
- AAI@EduHr;
- osnovni komentari;
- student/teacher equality test;
- DOCX import/export;
- citation/bibliography core;
- retention infrastructure;
- backup/restore;
- status page;
- accessibility;
- HR/EN;
- Merlin export;
- QR verifier;
- defense support.

Te funkcije ostaju u postojećim milestoneima M0–M11 i FEATURE/DECISION stavkama.

---

# 21. Prioritet razvoja

## P0 — dokazati jezgru

1. editor;
2. journal;
3. sync;
4. evidence;
5. exact reconstruction;
6. submission;
7. teacher review;
8. equality student/teacher;
9. offline/recovery.

## P1 — učiniti proizvod stvarno upotrebljivim za pilot

1. S2 Moji radovi;
2. S3 transparentna obavijest;
3. T2 Course Dashboard;
4. T3 Assignment Setup;
5. komentari / dorade;
6. verzije;
7. student declaration;
8. policy engine minimum;
9. potvrda predaje.

## P2 — institucionalna ozbiljnost

1. admin;
2. audit package;
3. retention UI;
4. AAI admin;
5. procurement;
6. website;
7. exports.

## P3 — širenje proizvoda

1. Replay full;
2. AI Assistant full;
3. defense;
4. richer integrations;
5. portfolio;
6. post-pilot institutional analytics.

---

# 22. Definition of Product-Complete Pilot V1

Ovaj odjeljak definira **product-complete** stanje: funkcionalno je izgrađen tok koji želimo pilotirati. To **nije** dozvola za uključivanje stvarnih studenata.

Stvarni pilot / svaki val smije krenuti tek kada su **svi GO uvjeti iz `PROGRAM.md` § “GO uvjeti za stvarne studente” zeleni**. Jedan crveni GO uvjet zaustavlja puštanje bez obzira na to što je product-complete lista ispod završena. To uključuje, među ostalim, DPIA i ugovor o obradi, AAI@EduHr registraciju, potvrđene rokove čuvanja, restore dokaz, pristupačnost, podršku/incident postupak i staging/proizvodne sigurnosne provjere.

**P0–P3 u ovom dokumentu su redoslijed product razvoja, ne zamjena za M0–M12, valove ni release gateove iz `PROGRAM.md`.** D-68 i dalje određuje da podrška za obranu/povjerenstvo mora biti spremna prije prvog roka obrana.

Product-complete Pilot V1 ostvaren je kad:

1. student se može prijaviti i otvoriti stvarni zadatak;
2. jasno razumije pravila i evidenciju;
3. može napisati stvarni seminarski/završni/diplomski rad;
4. offline rad se sigurno oporavlja;
5. citiranje i literatura su dovoljno dobri da ne treba Word za osnovni tok;
6. rad se može točno rekonstruirati;
7. student može predati rad i dobiti potvrdu;
8. nastavnik bez obuke u manje od dvije minute razumije rad i proces;
9. nastavnik može komentirati i zatražiti doradu;
10. policy koja vrijedi za rad je verzionirana;
11. student i nastavnik vide isti relevantni prikaz;
12. sustav ima jasan audit i recovery put;
13. pilot može proći 50–150 studenata bez ručnog tehničkog spašavanja normalnih situacija.

---

# 23. Sljedeći korak

Nakon mergea ovog Product Speca:

1. koristiti epike E1–E6 kao traceability/product epike; prije novih implementation taskova primijeniti §19.0 i za REUSE/UX GAP stavke povezati postojeće M/D/N/F/R taskove umjesto dupliciranja;
2. mapirati postojeće M0–M11 taskove na Screen ID-eve iz ovog dokumenta;
3. otvoriti zaseban OWNER/Governance issue za konflikte iz §18;
4. dizajnirati nedostajuće ekrane redom:
   - S2 Moji radovi;
   - S3 transparentna obavijest;
   - T3 Assignment Setup;
   - collaboration workflow;
   - version lifecycle;
   - submission receipt;
   - event dispute/correction;
5. frontend ne smije izmišljati novi flow mimo Product Speca bez Product/UX issuea.
