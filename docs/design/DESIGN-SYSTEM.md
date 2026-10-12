# Ductus: Product UI & Design System

Verzija 0.2 · 13. 10. 2026.  
Izvor: vizualni koncept (13 slajdova) — Product UI & Design System.

Ovaj dokument sažima vizualni jezik, principe i ekrane koje treba usvojiti.  
Funkcionalni tokovi ostaju u `docs/PRODUCT.md`. Ovaj dokument definira **kako to izgleda i kako se osjeća**.

---

## 1. Vizualni principi (Slide 13)

| # | Princip | Objašnjenje |
|---|---------|-------------|
| 01 | Akademski, ne "AI-tech" | Self-naglasak na sadržaj i institucionalnu ozbiljnost. UI ostaje čist i suzdržan. |
| 02 | Evidence, ne sumnja | Broj / status komuniciraju stanje procesa, ne kreiraju "risk score". |
| 03 | Dark-first, ali pristupačno | Visok kontrast, jasne površine i semantičke boje; bez pretjeranog neon-a. |
| 04 | Isti jezik kroz sve uloge | Student, mentor i admin koriste isti grid, iste kartice, iste statuse. |
| 05 | Teal = povjerenje i akcija | Primarna akcijska boja. Koristi se samo kada semantika to traži. |
| 06 | Institucionalno spremno | UI treba izgledati kao proizvod kojem bi fakultet povjerio akademske procese i podatke. |

**Ključna rečenica:** Dark academic SaaS — teal/mint sustav — institucionalna ozbiljnost — neutralan evidence.

---

## 2. Paleta boja (Slide 12)

### Primarne
- **Primarna zelena** (`#14B8A6` / teal) — akcija, povjerenje, pozitivni statusi
- **Primarna tamna** (`#0D9488`)
- **Primarna svijetla** (`#5EEAD4`)

### Semantičke
- **Uspjeh** `#22C55E`
- **Informacija** `#3B82F6`
- **Upozorenje** `#F59E0B`
- **Greška** `#EF4444`

### Neutralne (dark)
- Pozadina `#0A0F0E`
- Površina 1 `#111827`
- Površina 2 `#1F2937`
- Border `#334155`
- Tekst primarni `#F8FAFC`
- Tekst sekundarni `#94A3B8`

**Pravilo:** Semantičke boje se koriste samo za status, nikad za "sumnju" ili rangiranje. Poštivati rječnik iz `PRODUCT.md` §5.

---

## 3. Design system komponente (Slide 11)

- Sidebar navigacija (ikone + label)
- Kartice rada / zadatka
- Status badgevi (U izradi, Predano, Komentari dostupni, Nije otvoreno…)
- Stepper / wizard koraci (1–4)
- Accordion sekcije
- Gumbovi (primarni teal, sekundarni outline)
- Input polja, dropdownovi, date picker
- Progress indikatori
- Empty states i onboarding kartice

Sve komponente moraju poštivati rječnik iz `PRODUCT.md` §5.

---

## 4. Detaljno mapiranje ekrana → funkcije → implementacija

### 4.1 Javni website (Landing)
**Funkcije:** Hero, CTA (Zatraži demo), kartice vrijednosti, sekcije Za studente / Za mentore, GDPR, testimonial.  
**Implementacija:** Statična Next.js stranica ili zasebni marketing site. Komponente iz design systema.  
**Prioritet:** P2.  
**Issue:** Marketing website.

### 4.2 Studentski editor
**Funkcije:** Lijeva struktura (poglavlja + progress + riječi), toolbar, Tiptap editor, desni panel (Asistent / Literatura / Upute / Komentari), status bar (spremljeno, riječi, napredak).  
**Implementacija:** Postojeći Tiptap + kanonski model. Asistent iza flaga (D-77). Status bar vezan na M3 + D-63.  
**Prioritet:** P0 (val 1, M5).  
**Issue:** Editor struktura + status + desni panel.

### 4.3 Reprodukcija / Replay
**Funkcije:** Vremenska crta sjednica, highlight promjena, detalji sjednice, diff odabranog događaja, legenda podrijetla, kontrole reprodukcije.  
**Implementacija:** Na M3 evidenciji + D-56 (samo mentorski radovi). Projekcija sjednica + diffovi.  
**Prioritet:** P2 (val 3).  
**Issue:** Replay (D-56).

### 4.4 Predaja i deklaracija
**Funkcije:** Provjera spremnosti (rekonstrukcija, lanac, konzistentnost), izjava studenta (alati + način AI-ja), detalji rada, gumb Predaj.  
**Implementacija:** M7 + D-40 + D-77. Kontrolni popis D-62.  
**Prioritet:** P0 (val 1, M7).  
**Issue:** Predaja ekran + izjava.

### 4.5 Faculty Policy Engine
**Funkcije:** Tri stupca (Dopušteno / Mora se deklarirati / Nije dopušteno), toggleovi, dodatne postavke, preview izjave, povijest verzija, primjena na fakultet/kolegij.  
**Implementacija:** D-52 + fakultetska konfiguracija. Verzionirana pravila. Veza na S3 i izjavu.  
**Prioritet:** P1 (val 2).  
**Issue:** Policy Engine.

### 4.6 Course / Teacher Dashboard
**Funkcije:** Lista predmeta, pregled zadatka (statistike), tablica studenata (status, rekonstrukcija, praznine, dovršenost), feed aktivnosti.  
**Implementacija:** M2 + M6 + M7. Projekcije bez risk scorea. "Dokazni nedostaci" = D-61 praznine.  
**Prioritet:** P0/P1.  
**Issue:** Nastavnički dashboard.

### 4.7 Institutional Admin
**Funkcije:** Metrike, graf predaja, status sustava, AAI status, pohrana, audit log, GDPR pravila.  
**Implementacija:** M2 + M10 + M11. Projekcije + revizijski trag.  
**Prioritet:** P1/P2.  
**Issue:** Institutional admin dashboard.

### 4.8 Audit & Appeals paket
**Funkcije:** Finalni dokument, procesna crta, rezultat rekonstrukcije, verzije, izjava, politika, kriptografska potvrda, verifikacija, izvoz.  
**Implementacija:** D-49 + M3 + M7. Prenosivi paket s opsegom.  
**Napomena:** Tekst "Nema indikacija neautentičnog autorstva" je zabranjen (D-01 + rječnik). Zamijeniti neutralnim.  
**Prioritet:** P1 (val 2).  
**Issue:** Audit paket (D-49).

---

## 5. Preporučeni redoslijed

| Prioritet | Ekran | Val | Ovisnosti |
|-----------|-------|-----|-----------|
| P0 | Design system tokeni + komponente | 1 | — |
| P0 | Studentski editor | 1 | M5 |
| P0 | Predaja + izjava | 1 | M7 |
| P0/P1 | Nastavnički dashboard | 1–2 | M2, M6 |
| P1 | Policy Engine | 2 | D-52 |
| P1 | Audit paket | 2 | M3, M7 |
| P2 | Replay | 3 | M3, D-56 |
| P2 | Institutional admin | 2–3 | M10, M11 |
| P2 | Javni website | — | — |

---

## 6. Veza s postojećim dokumentima

- Funkcionalni tokovi: `docs/PRODUCT.md`
- Rječnik: `PRODUCT.md` §5
- UX evaluacija: `docs/UX-EVAL.md`
- Arhitektura: `docs/ARCHITECTURE.md`

---

## 7. Sljedeći koraci

- [ ] Potvrditi paletu i principe
- [ ] Kreirati implementacijske issuee po prioritetu
- [ ] Odlučiti o komponentnoj biblioteci (shadcn/ui + Tailwind)
- [ ] Uskladiti s Tiptap editorom

**Status:** predloženo za usvajanje.
