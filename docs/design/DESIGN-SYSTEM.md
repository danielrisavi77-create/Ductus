# Ductus: Product UI & Design System

Verzija 0.3 · 13. 10. 2026.  
Izvor: vizualni koncept (13 slajdova, issue #323) — Product UI & Design System. Usvojeno odlukom **D-115** (zamjenjuje dizajn v6, D-89); komponente prema **D-116**.

Ovaj dokument sažima vizualni jezik, principe i ekrane koje treba usvojiti.  
Funkcionalni tokovi ostaju u `docs/PRODUCT.md`. Ovaj dokument definira **kako to izgleda i kako se osjeća**.

---

## 1. Vizualni principi (Slide 13)

| # | Princip | Objašnjenje |
|---|---------|-------------|
| 01 | Akademski, ne "AI-tech" | Naglasak na sadržaj i institucionalnu ozbiljnost. UI ostaje čist i suzdržan. |
| 02 | Evidence, ne sumnja | Broj / status komuniciraju stanje procesa, nikad ne stvaraju ocjenu studenta. |
| 03 | Dark-first, ali pristupačno | Visok kontrast, jasne površine i semantičke boje; bez pretjeranog neon-a. List u editoru može biti svijetao (izbor korisnika, `data-theme`). |
| 04 | Isti jezik kroz sve uloge | Student, mentor i admin koriste isti grid, iste kartice, iste statuse. |
| 05 | Teal = povjerenje i akcija | Primarna akcijska boja. Koristi se samo kada semantika to traži. |
| 06 | Institucionalno spremno | UI treba izgledati kao proizvod kojem bi fakultet povjerio akademske procese i podatke. |

**Ključna rečenica:** Dark academic SaaS — teal/mint sustav — institucionalna ozbiljnost — neutralan evidence.

---

## 2. Paleta boja (Slide 12)

Sve kombinacije ispod provjerene su prema WCAG 2.1 AA (D-115, F-03): tekst barem 4,5:1, granice kontrola i ikone barem 3:1. Omjeri su izračunati formulom relativne svjetline iz WCAG-a.

### Primarne
- **Primarna** `#14B8A6` (teal): akcija, povjerenje. **Tekst na primarnoj boji je tamni `#0A0F0E` (7,76:1), nikad bijeli** (bijeli daje 2,49:1 i ne prolazi).
- **Primarna tamna** `#0D9488`: hover i pritisnuto stanje ispune.
- **Primarna svijetla** `#5EEAD4`: tekst poveznica i aktivni elementi na tamnoj podlozi (≥ 9,9:1 na svim površinama).

### Semantičke
| Uloga | Ispuna (badge, traka) | Tekst na ispuni | Tekst na tamnoj površini |
|---|---|---|---|
| Uspjeh | `#22C55E` | `#0A0F0E` (8,47:1) | `#22C55E` (≥ 6,4:1) |
| Informacija | `#3B82F6` | `#0A0F0E` (5,25:1) | `#60A5FA` (≥ 5,7:1) |
| Upozorenje sustava | `#F59E0B` | `#0A0F0E` (8,99:1) | `#F59E0B` (≥ 6,8:1) |
| Greška sustava | `#EF4444` | `#0A0F0E` (5,13:1) | `#F87171` (≥ 5,3:1) |

Bijeli tekst na semantičkim ispunama ne prolazi AA (2,15 do 3,76:1) i ne koristi se.

### Neutralne (dark)
- Pozadina `#0A0F0E`
- Površina 1 `#111827`
- Površina 2 `#1F2937`
- Granica kontrole (polja, odabir, fokus bez boje) `#64748B` (≥ 3,08:1 na svim površinama)
- Razdjelnik (samo ukrasna linija, ne granica kontrole) `#334155`
- Tekst primarni `#F8FAFC`
- Tekst sekundarni `#94A3B8` (≥ 5,72:1)

### Boje podrijetla (preuzete iz v6)
Pokazuju odakle je tekst (karta podrijetla D-57, replay), nikad ocjenu: unutar Ductusa `#8FB0E0`, izvor nije opažen `#9E9A90`, iz AI pomoćnika `#D3AC63`, komentar `#D9AE5B`. Sve ≥ 5,2:1 na tamnim površinama.

**Pravila:**
- Semantičke boje se koriste samo za status sustava (spremanje, greška veze, potvrda), nikad za studenta, "sumnju" ili rangiranje. Nema boje za "prekršaj" (D-62). Poštivati Rječnik iz `PRODUCT.md` §5.
- Boja nikad nije jedini nositelj značenja; uz nju uvijek stoji tekst ili ikona.

---

## 3. Design system komponente (Slide 11)

Izvedba: Tailwind CSS v4 (tokeni iz §2 kao CSS varijable u `@theme`) i shadcn/ui na Radix primitivima, kopirani u repo (D-116). Tekst komponenti dolazi iz i18n kataloga (HR/EN, D-70).

- Sidebar navigacija (ikone + label)
- Kartice rada / zadatka
- Status badgevi (stanja rada iz `PRODUCT.md` §6: nije započeto, u tijeku, poslano na pregled, predano)
- Stepper / wizard koraci (1–4)
- Accordion sekcije
- Gumbovi (primarni teal s tamnim tekstom, sekundarni outline)
- Input polja, dropdownovi, date picker
- Dialog / modal (fokus se vraća na okidač, Escape zatvara)
- Progress indikatori (postotak napretka je dopušten, D-63)
- Empty states i onboarding kartice

Sve komponente moraju poštivati Rječnik iz `PRODUCT.md` §5.

---

## 4. Detaljno mapiranje ekrana → funkcije → implementacija

### 4.1 Javni website (Landing)
**Funkcije:** Hero, CTA (Zatraži demo), kartice vrijednosti, sekcije Za studente / Za mentore, GDPR, testimonial.  
**Implementacija:** Statična Next.js stranica ili zasebni marketing site. Komponente iz design systema.  
**Prioritet:** P2.  
**Issue:** Marketing website.

### 4.2 Studentski editor
**Funkcije:** Lijeva struktura (poglavlja + progress + riječi), toolbar, Tiptap editor, desni panel (Asistent / Literatura / Upute / Komentari), status bar (spremljeno na uređaju / na poslužitelju, riječi, napredak).  
**Implementacija:** Postojeći Tiptap + kanonski model. Asistent iza flaga (D-77). Status bar vezan na M3 + D-63. Fusnote i tablice su val 2.  
**Prioritet:** P0 (val 1, M5).  
**Issue:** #325.

### 4.3 Reprodukcija / Replay
**Funkcije:** Vremenska crta sjednica, highlight promjena, detalji sjednice, diff odabranog događaja, legenda podrijetla, kontrole reprodukcije.  
**Implementacija:** Na M3 evidenciji + D-56 (samo mentorski radovi). Preduvjet: pravno mišljenje (D-55) i izmjena Ustava C-14 i C-19 prije prvog bilježenja.  
**Prioritet:** P2 (val 3).  
**Issue:** #330.

### 4.4 Predaja i deklaracija
**Funkcije:** Provjera spremnosti (rekonstrukcija; status rekonstrukcije odvojen od potpunosti povijesti, D-80), izjava studenta (alati + način AI-ja), detalji rada, gumb Predaj.  
**Implementacija:** M7 + D-40 + D-77. Predaju blokira samo nepodudarna rekonstrukcija (C-42). Kontrolni popis D-62 i otvorena mjesta D-61 su val 2.  
**Prioritet:** P0 (val 1, M7).  
**Issue:** #326.

### 4.5 Pravila fakulteta (Faculty Policy Engine)
**Funkcije:** Tri stupca (Dopušteno / Mora se deklarirati / Nije dopušteno), toggleovi, dodatne postavke, preview izjave, povijest verzija, primjena na fakultet/kolegij.  
**Implementacija:** D-52 + D-117: administrator uređuje pravilo AI-ja, pružatelje, pragove i rokove čuvanja u sučelju, verzionirano; pravila akademskog pisanja dolaze iz paketa Lekte i samo se prikazuju. Veza na S3 i izjavu.  
**Prioritet:** P1 (val 2); osnovno pravilo kolegija (D-52) je val 1.  
**Issue:** #328.

### 4.6 Course / Teacher Dashboard
**Funkcije:** Lista predmeta, pregled zadatka (agregati), tablica studenata (stanje rada, zadnja izmjena), bez stupaca po kojima se može rangirati.  
**Implementacija:** M2 + M6 + M7. Sortiranje samo po prezimenu (D-80 t.2). Praznine u zapisu (C-8) i otvorena mjesta (D-61) su različiti pojmovi i ne spajaju se u jedan stupac.  
**Prioritet:** P0/P1.  
**Issue:** #327.

### 4.7 Institutional Admin
**Funkcije:** Metrike, graf predaja, AAI status, revizijski trag pristupa, pravila zadržavanja i GDPR, dopušteni AI pružatelji (D-23).  
**Implementacija:** M2 + M10 + M11. Projekcije + revizijski trag; bez pristupa sadržaju radova.  
**Prioritet:** P1/P2.  
**Issue:** #331, #333.

### 4.8 Prenosivi zapis (Audit & Appeals paket)
**Funkcije:** Finalni dokument, procesna crta, rezultat rekonstrukcije, verzije, izjava, politika, kriptografska potvrda, provjera cjelovitosti zapisa u pregledniku bez računa (QR), izvoz.  
**Implementacija:** D-49 + M3 + M7. Prenosivi paket s opsegom.  
**Napomena:** Tekst "Nema indikacija neautentičnog autorstva" je zabranjen (D-01 + Rječnik). Zamjena: "zapis je cjelovit i neizmijenjen od primitka".  
**Prioritet:** P1 (val 2).  
**Issue:** #329.

---

## 5. Preporučeni redoslijed

| Prioritet | Ekran | Val | Ovisnosti |
|-----------|-------|-----|-----------|
| P0 | Design system tokeni + komponente | 1 | D-116 (#334) |
| P0 | Studentski editor | 1 | M5 (#325) |
| P0 | Prije početka rada (S3) | 1 | M2, M7 (#336) |
| P0 | Moji radovi (S2) | 1 | M2 (#335) |
| P0/P1 | Čarobnjak za zadatak (T3) | 1–2 | M2 (#337) |
| P0 | Mentorski pregled (osnovni) | 1 | M6 (#338) |
| P0 | Predaja + izjava | 1 | M7 (#326) |
| P0/P1 | Nastavnički dashboard | 1–2 | M2, M6 (#327) |
| P1 | Pravila fakulteta | 2 | D-52, D-117 (#328) |
| P1 | Prenosivi zapis | 2 | M3, M7 (#329) |
| P2 | Replay | 3 | M3, D-56, D-55 (#330) |
| P1/P2 | Institutional admin | 2–3 | M10, M11 (#331) |
| P2 | Javni website | — | — |

---

## 6. Veza s postojećim dokumentima

- Funkcionalni tokovi: `docs/PRODUCT.md`
- Rječnik: `PRODUCT.md` §5
- Odluke: `docs/DECISIONS.md` (D-115, D-116, D-117)
- UX evaluacija: `docs/UX-EVAL.md`
- Arhitektura: `docs/ARCHITECTURE.md`

---

## 7. Sljedeći koraci

- [x] Potvrditi paletu i principe (D-115; paleta usklađena s AA u v0.3)
- [x] Kreirati implementacijske issuee po prioritetu (#325–#342)
- [x] Odlučiti o komponentnoj biblioteci (D-116: Tailwind v4 + shadcn/ui)
- [ ] Uskladiti s Tiptap editorom
- [ ] Priložiti 13 slajdova (#323)

**Status:** usvojeno (D-115).
