# 03 Nacrt obavijesti o privatnosti za studente

> **Ovo je radni nacrt, nije pravni savjet.** Tekst ispod nije spreman za objavu. Mjesta u uglatim zagradama čeka odluka ustanove ili pravnika.

**Samo pravnik ili ustanova odlučuje:** tko je voditelj i kako se naziva; pravna osnova; rokovi; kontakt službenika za zaštitu podataka; je li korištenje obvezno i što je alternativa; jesu li navedeni podizvršitelji konačni; sadrži li obavijest sve što traže čl. 13. i 14. GDPR-a.

**Napomene za uredništvo (nisu dio teksta za studente):**
- Tekst poštuje rječnik sučelja iz PRODUCT §5 i njegove engleske ekvivalente (D-90). Prije objave ga treba provući kroz `scripts/forbidden-terms/`; do tada nije provjeren tim alatom.
- Obavijest o privatnosti ne zamjenjuje obavijest o praćenju koja je prvi ekran svakog zadatka (PRODUCT §5 pr. 6); ona je ugrađena u nju (PROGRAM, GO uvjeti). Potvrda koju student daje nije privola i ne smije se tako prikazivati (PRODUCT §6, student 3).
- Dok potvrda ne veže otisak teksta ove obavijesti, ne može se tvrditi da je student potvrdio upravo ovaj tekst `[IZVEDBA]`.
- Odlomci označeni `[VARIJANTA]` ovise o neriješenom odnosu D-06 i D-39.

---

## Obavijest o privatnosti: pisanje radova u Ductusu

Verzija: `[broj]` · Vrijedi od: `[datum]` · Otisak teksta: `[SHA-256, dodaje se pri objavi]`

### 1. Tko je odgovoran za vaše podatke

Voditelj obrade je `[naziv ustanove]`. Ductus za ustanovu radi kao izvršitelj obrade `[naziv i podaci izvršitelja, tek kad bude određen]`. Pitanja o podacima možete uputiti službeniku za zaštitu podataka ustanove: `[kontakt]`.

### 2. Čemu služi Ductus

Ductus bilježi kako rad nastaje i olakšava razgovor o radu. Zaključak o vašem radu uvijek donosi osoba, nikad Ductus. Ductus ne tvrdi tko je napisao rad i ne ocjenjuje vas. Ne pokazuje postotke, ocjene ni oznake koje bi sugerirale procjenu vas kao studenta.

### 3. Koje podatke obrađujemo

- **Prijava.** Prijavljujete se isključivo AAI@EduHr računom. Od AAI-ja dobivamo i trajno spremamo oznaku vašeg računa (`hrEduPersonUniqueID`), oznaku izdavatelja prijave i identifikator korisnika kod izdavatelja (`sub`); matična ustanova služi za odabir ustanove i ne sprema se uz vaš račun. Izvedeno je upravo to. `[Dodatni atributi iz popisa u 04 tek kad budu potvrđeni.]` OIB ne tražimo.
- **Rad.** Tekst koji pišete i promjene teksta, sažete u odsječke do 30 sekundi s vremenom zaokruženim na minutu. Bilježi se i je li promjena vaša, nastavnikova ili mentorova.
- **Događaji u radu.** Veliko lijepljenje (veličina i vrijeme), uvoz datoteke (naziv, vrsta, veličina), oznaka koju sami odaberete uz lijepljeni tekst, vaše napomene, izjava o pomoći alata i razgovori koje sami priložite.
- **Nastava.** Upis u kolegij, potvrda ove obavijesti i vrijeme potvrde, predaje, komentari i prijedlozi nastavnika, produljenja roka.
- **Tko je otvorio vaš rad.** Vidite tko je i kada otvorio vaš rad.
- `[VARIJANTA, samo mentorski radovi i tek nakon pravnog mišljenja i izmjene Ustava (D-56): vrijeme promjena u koracima od 100 ms, isključivo za reprodukciju rada. Najavljuje se prije pisanja, nikad unatrag.]`

### 4. Što ne bilježimo

Koju ste tipku pritisnuli i koliko dugo ste je držali. Brzinu tipkanja i stanke kao mjeru. Druge aplikacije i kartice preglednika. Što je u međuspremniku izvan teksta koji zalijepite u rad. Kameru, mikrofon i zaslon. Razgovore s alatima umjetne inteligencije, osim ako ih sami priložite izjavi. U evidenciji nema IP adrese ni podataka o uređaju.

### 5. Tko što vidi i od kada

- Vi uvijek vidite točno ono što vidi nastavnik ili mentor.
- `[VARIJANTA A (D-06): Nastavnik ili mentor vidi trenutno stanje spremljeno na poslužitelju, osvježeno najviše svakih 5 minuta, od prvog dana.]` `[VARIJANTA B (D-39): Nastavnik ili mentor vidi stanje na kraju svake sesije pisanja.]` Ne vidi tipkanje uživo. Može vidjeti i tekst koji ste kasnije obrisali, ako je bio u stanju koje je poslužitelj primio.
- `[VARIJANTA, samo uz D-56: U mentorskom radu mentor može pokrenuti reprodukciju kako je rad rastao, za cijeli rad ili jedan odlomak, uključujući tekst koji ste obrisali i prethodne verzije odlomka, uz oznake lijepljenja, uvoza, izmjena i konzultacija. Vidite istu reprodukciju i vidite kad ju je mentor gledao; uz trenutak reprodukcije možete dodati napomenu. Ritam se ne mjeri: nema brzine tipkanja ni statistike stanki. Od kojeg je trenutka reprodukcija dostupna mentoru: odluka, u izvorima nije određeno.]` tko je kada pristupio kojem radu, ali ne vidi sadržaj rada.
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

Podatke obrađuju podizvršitelji navedeni u `[prilogu, popis iz 04, tek kad bude potvrđen]`. Tekst vašeg rada nije namijenjen prijenosu izvan Europskog gospodarskog prostora. `[Pravnik potvrđuje za svakog podizvršitelja koji djeluje izvan EU-a ili pripada grupi izvan EU-a.]` Ductus u pilotu ne šalje vaš tekst nijednom pružatelju umjetne inteligencije.

### 9. Vaša prava

Imate pravo na pristup svojim podacima, ispravak, brisanje, ograničenje obrade, prigovor i prenosivost, u mjeri koju propisuje zakon. Svoj rad i svoju evidenciju možete u svakom trenutku izvesti iz Ductusa `[planirano, PRODUCT §6: izvoz nije izgrađen; ne objavljivati dok ne postoji]`. Ako se povučete iz pilota, predani radovi ostaju po pravilima ustanove, a ostali sadržaj se briše (D-12). `[Pravnik i ustanova određuju koji tehnički artefakti ostaju nakon brisanja (hashevi lanca, potvrde, javno objavljen ukupan broj) i na kojoj osnovi; dok to ne bude odlučeno, ne obećava se brisanje "svega".]` `[Kako i kome podnosite zahtjev, rok odgovora: odluka ustanove. U izgradnji još ne postoji postupak za ispravak i brisanje.]` Pritužbu možete podnijeti nadzornom tijelu: Agenciji za zaštitu osobnih podataka.

### 10. Što student može učiniti uz svaki zapis

Uz evidenciju možete dodati napomenu; napomene se samo dodaju, a ispravak je nova napomena koja upućuje na staru. Uz lijepljeni tekst možete odabrati oznaku izvora, ali ne morate.

### 11. Izmjene obavijesti

`[PRIJEDLOG, nije odluka: kako se verzije obavijesti potvrđuju još nije određeno.]` Ako se obavijest promijeni, dobit ćete novu verziju na prvom ekranu zadatka i prije nastavka pisanja trebate potvrditi da ste je pročitali. Zadaci koje ste već potvrdili ne proširuju se unatrag (PRODUCT §5 pr. 14).
