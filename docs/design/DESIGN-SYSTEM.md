# Ductus: Product UI & Design System

Verzija 0.1 · 13. 10. 2026.  
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
- **Primarna zelena** (`#0D9488` / teal) — akcija, povjerenje, pozitivni statusi
- **Primarna tamna** — pozadine, kartice
- **Primarna svijetla** — hover, sekundarni naglasci

### Semantičke
- **Uspjeh** — zelena / teal
- **Informacija** — plava
- **Upozorenje** — žuta / amber
- **Greška** — crvena

### Neutralne (dark)
- Pozadine: vrlo tamne (gotovo crne s blagim zelenim nijansom)
- Površine: tamno sive / navy
- Border: suptilni
- Tekst: bijeli / svijetlo sivi
- Tekst sekundarni: muted

**Pravilo:** Semantičke boje se koriste samo za status, nikad za "sumnju" ili rangiranje.

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

Sve komponente moraju poštivati rječnik iz `PRODUCT.md` §5 (nema zabranjenih riječi).

---

## 4. Ekrani (Slides 2–10)

| Slide | Ekran | Uloga | Ključni elementi |
|-------|-------|-------|-------------------|
| 2 | Javni website | Javno | Hero, vrijednosna ponuda, CTA |
| 3 | Studentski editor | Student | Editor + sidebar strukture + AI panel (ako dopušten) |
| 4 | Mentorski pregled | Mentor | Pregled rada + evidence panel + komentari |
| 5 | Replay / reprodukcija | Mentor | Vremenska crta + reprodukcija rasta dokumenta |
| 6 | Predaja i deklaracija | Student | "Spremno za predaju?" + izjava + kontrolni popis |
| 7 | Faculty Policy Engine | Admin / Nastavnik | Pravila fakulteta i kolegija |
| 8 | Course dashboard | Nastavnik | Pregled kolegija, statusi studenata |
| 9 | Institutional admin | Admin | Administracija ustanove, metrike |
| 10 | Audit & appeals paket | Admin / Nastavnik | Paket dokaza, verifikacija |

### Prioritet za pilot (val 1–2)
1. Studentski editor (Slide 3)
2. Ekran prije početka rada / S3 (iz prethodnog mockupa)
3. Moji radovi / S2
4. Čarobnjak za stvaranje zadatka / T3
5. Mentorski pregled (Slide 4)
6. Predaja (Slide 6)

Ostali ekrani (policy engine, admin, replay) idu u kasnije valove.

---

## 5. Veza s postojećim dokumentima

- Funkcionalni tokovi i pravila: `docs/PRODUCT.md`
- Rječnik sučelja: `PRODUCT.md` §5
- UX evaluacija povjerenja: `docs/UX-EVAL.md`
- Arhitektura: `docs/ARCHITECTURE.md`

---

## 6. Sljedeći koraci

- [ ] Potvrditi paletu i principe
- [ ] Razbiti ekrane u implementacijske issuee
- [ ] Odlučiti o komponentnoj biblioteci (npr. shadcn/ui + Tailwind prilagođen paleti)
- [ ] Uskladiti s postojećim Tiptap editorom

**Status:** predloženo za usvajanje.
