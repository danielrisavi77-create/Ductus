# 03 Nacrt obavijesti o privatnosti za studente

> **Ovo je radni nacrt, nije pravni savjet.** Tekst ispod nije spreman za objavu. Mjesta u uglatim zagradama čeka odluka ustanove ili pravnika.

**Samo pravnik ili ustanova odlučuje:** tko je voditelj i kako se naziva; pravna osnova; rokovi; kontakt službenika za zaštitu podataka; je li korištenje obvezno i što je alternativa; jesu li navedeni podizvršitelji konačni; sadrži li obavijest sve što traže čl. 13. i 14. GDPR-a.

**Napomene za uredništvo (nisu dio teksta za studente):**
- Tekst poštuje rječnik sučelja iz PRODUCT §5 i njegove engleske ekvivalente (D-90). Alat `scripts/forbidden-terms/` nad tekstom obavijesti (od naslova "Obavijest o privatnosti") 11. 10. 2026. nije dao pogodaka; provjeru treba ponoviti pri svakoj izmjeni.
- Izgrađeni su samo prijava, sesije, upis u kolegij i potvrda obavijesti. Ostalo u odjeljku 3 (rad, događaji u radu, predaje, komentari, tko je otvorio rad), reprodukcija, izvoz i brisanje opisani su kao ciljno stanje i ne smiju se objaviti kao postojeći dok nisu izgrađeni.
- Obavijest o privatnosti ne zamjenjuje obavijest o praćenju koja je prvi ekran svakog zadatka (PRODUCT §5 pr. 6); ona je ugrađena u nju (PROGRAM, GO uvjeti). Potvrda koju student daje nije privola i ne smije se tako prikazivati (PRODUCT §6, student 3).
- Dok potvrda ne veže otisak teksta ove obavijesti, ne može se tvrditi da je student potvrdio upravo ovaj tekst `[IZVEDBA]`.
- Odlomci označeni `[VARIJANTA]` ili `[PLANIRANO]` ovise o odlukama D-142 do D-144 i ne smiju se objaviti prije izgradnje prikaza uživo i reprodukcije. Prije pilota sa stvarnim studentima trebaju pravno mišljenje (D-55) i DPIA; do tada se vrijeme po promjeni bilježi samo u demou i testovima s izmišljenim podacima, pa obavijest sa stvarnim studentima ne smije tvrditi da se bilježi dok to ne vrijedi.

---

## Obavijest o privatnosti: pisanje radova u Ductusu

Verzija: `[broj]` · Vrijedi od: `[datum]` · Otisak teksta: `[SHA-256, dodaje se pri objavi]`

### 1. Tko je odgovoran za vaše podatke

Voditelj obrade je `[naziv ustanove]`. Ductus za ustanovu radi kao izvršitelj obrade `[naziv i podaci izvršitelja, tek kad bude određen]`. Pitanja o podacima možete uputiti službeniku za zaštitu podataka ustanove: `[kontakt]`.

### 2. Čemu služi Ductus

Ductus bilježi kako rad nastaje i olakšava razgovor o radu. Zaključak o vašem radu uvijek donosi osoba, nikad Ductus. Ductus ne tvrdi tko je napisao rad i ne ocjenjuje vas. Ne pokazuje postotke, ocjene ni oznake koje bi sugerirale procjenu vas kao studenta.

### 3. Koje podatke obrađujemo

- **Prijava.** Prijavljujete se isključivo AAI@EduHr računom. Od AAI-ja dobivamo i trajno spremamo oznaku vašeg računa (`hrEduPersonUniqueID`), oznaku izdavatelja prijave i identifikator korisnika kod izdavatelja (`sub`); matična ustanova iz AAI-ja služi za određivanje vaše ustanove: uz račun spremamo ustanovu, a ne izvorni atribut prijave. `[Dodatni atributi iz popisa u 04 tek kad budu potvrđeni.]` OIB ne tražimo.
- **Rad.** Tekst koji pišete i promjene teksta, sažete u odsječke do 30 sekundi s vremenom zaokruženim na minutu. Bilježi se i je li promjena vaša, nastavnikova ili mentorova.
- **Događaji u radu.** Veliko lijepljenje (veličina i vrijeme), uvoz datoteke (naziv, vrsta, veličina), oznaka koju sami odaberete uz lijepljeni tekst, vaše napomene, izjava o pomoći alata i razgovori koje sami priložite.
- **Nastava.** Upis u kolegij, potvrda ove obavijesti i vrijeme potvrde, predaje, komentari i prijedlozi nastavnika, produljenja roka.
- **Tko je otvorio vaš rad.** Vidite tko je i kada otvorio vaš rad.
- `[PLANIRANO, D-143, tek nakon pravnog mišljenja (D-55) i DPIA-e za pilot sa stvarnim studentima: svaka promjena dokumenta (unos ili brisanje znaka, lijepljenje, uvoz, prijenos iz AI pomoćnika, izmjena nastavnika) sprema se redom i s vremenom promjene, isključivo za prikaz uživo i reprodukciju rada. Odnosi se na sve zadatke, ne samo na mentorske radove. Najavljuje se prije pisanja, nikad unatrag.]`

### 4. Što ne bilježimo

Koju ste tipku pritisnuli i koliko dugo ste je držali. Brzinu tipkanja i stanke kao mjeru. Druge aplikacije i kartice preglednika. Što je u međuspremniku izvan teksta koji zalijepite u rad. Kameru, mikrofon i zaslon. Razgovore s alatima umjetne inteligencije, osim ako ih sami priložite izjavi. U evidenciji nema IP adrese ni podataka o uređaju.

### 5. Tko što vidi i od kada

- Vi uvijek vidite točno ono što vidi nastavnik ili mentor.
- `[PLANIRANO, D-142 i D-144: Mentor i nastavnik zadatka vide vaš rad dok nastaje, od prvog dana i za sve zadatke, i prikaz im se osvježava dok pišete. Vidi se samo ono što je u editoru Ducture, ništa izvan njega. Prikaz služi praćenju nastanka rada i komentarima tijekom pisanja, nikad ocjeni ni rangiranju. Vidite isti prikaz svog rada. Mogu vidjeti i tekst koji ćete kasnije obrisati.]`
- `[PLANIRANO, D-143: Mentor može pokrenuti reprodukciju kako je rad nastajao, znak po znak, uključujući tekst koji ste obrisali, lijepljenja, uvoze i izmjene. Vidite istu reprodukciju i vidite kad ju je mentor gledao; uz trenutak reprodukcije možete dodati napomenu. Vrijeme se koristi samo kao brzina reprodukcije: ne računaju se brzina tipkanja, stanke ni ritam. Ima li reprodukciju i nastavnik kolegija ili samo mentor: otvoreno u D-143 (D-154 u PR-u #480 predlaže samo mentora, koji je nastavnik zadatka).]`
- Administrator ustanove vidi tko je kada pristupio kojem radu, ali ne vidi sadržaj rada.
- Održavatelj Ductusa ne čita sadržaj radova, osim zabilježenog pristupa podrške uz pristanak ustanove i u skladu s ugovorom o obradi `[planirano, PRODUCT §3: ugovor, zapis pristupa i ovlast operatera ne postoje; ODLUKA]`.

### 6. Zašto smijemo obrađivati podatke

`[Pravna osnova koju navede ustanova. Ne piše se "privola" ako je osnova drukčija.]` `[Je li korištenje Ductusa obvezno za vaš kolegij ili rad, i što možete učiniti ako ga ne želite koristiti: odluka ustanove.]`

### 7. Koliko dugo čuvamo podatke

| Vrsta podataka | Rok |
| --- | --- |
| Radne verzije | `[do kraja akademske godine zadatka, prijedlog]` |
| Predani rad, izjava, napomene | `[prema pravilniku ustanove]` |
| Evidencija nastanka rada | `[kao predaja]` |
| Revizijski trag pristupa | `[rok]` |
| Sesije prijave | `[rok]` |
| Sigurnosne kopije | `[rok po vrsti kopije; brisanje je potpuno kad istekne najdulji rok]` |

Neki tehnički otisci (hashevi) nastavljaju postojati nakon brisanja sadržaja da bi se mogla provjeriti cjelovitost zapisa; ne sadrže tekst rada. `[Pravnik potvrđuje je li ih potrebno opisati drukčije.]`

### 8. Kome se podaci prenose

Podatke obrađuju podizvršitelji navedeni u `[prilogu, popis iz 04, tek kad bude potvrđen]`. `[Tvrdnja da tekst rada nije namijenjen prijenosu izvan Europskog gospodarskog prostora vrijedi za Ductusove dobavljače (04); za AI pružatelje ovisi o izboru pružatelja i ugovoru, pa je pravnik prepisuje tek kad pružatelj bude izabran (D-194).]` `[Pravnik potvrđuje za svakog podizvršitelja koji djeluje izvan EU-a ili pripada grupi izvan EU-a.]` `[PLANIRANO, D-194, tek kad pomoćnik postoji: Ductus šalje AI pružatelju samo odlomak koji sami pokrenete poslati pomoćniku, nikad bez vaše radnje; navode se imena pružatelja, zemlja obrade, čuvanje i činjenica da se tekst ne koristi za treniranje. Kineski pružatelji i modeli kineskih tvrtki ne koriste se.]`

### 9. Vaša prava

Imate pravo na pristup svojim podacima, ispravak, brisanje, ograničenje obrade, prigovor i prenosivost, u mjeri koju propisuje zakon. Svoj rad i svoju evidenciju možete u svakom trenutku izvesti iz Ductusa `[planirano, PRODUCT §6: izvoz nije izgrađen; ne objavljivati dok ne postoji]`. Ako se povučete iz pilota, predani radovi ostaju po pravilima ustanove, a ostali sadržaj se briše (D-12). `[Pravnik i ustanova određuju koji tehnički artefakti ostaju nakon brisanja (hashevi lanca, potvrde, javno objavljen ukupan broj) i na kojoj osnovi; dok to ne bude odlučeno, ne obećava se brisanje "svega".]` `[Kako i kome podnosite zahtjev, rok odgovora: odluka ustanove. U izgradnji još ne postoji postupak za ispravak i brisanje.]` Pritužbu možete podnijeti nadzornom tijelu: Agenciji za zaštitu osobnih podataka.

### 10. Što student može učiniti uz svaki zapis

Uz evidenciju možete dodati napomenu; napomene se samo dodaju, a ispravak je nova napomena koja upućuje na staru. Uz lijepljeni tekst možete odabrati oznaku izvora, ali ne morate.

### 11. Izmjene obavijesti

`[PRIJEDLOG, nije odluka: kako se verzije obavijesti potvrđuju još nije određeno.]` Ako se obavijest promijeni, dobit ćete novu verziju na prvom ekranu zadatka i prije nastavka pisanja trebate potvrditi da ste je pročitali. Zadaci koje ste već potvrdili ne proširuju se unatrag (PRODUCT §5 pr. 14).
