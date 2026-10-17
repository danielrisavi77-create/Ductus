# Ductura — provjere rada i profili pravila

Tehnička specifikacija uz PRODUCT.md. Opisuje kako editor zna što u poglavlju fali, što je krivo i na što treba pripaziti (kartica pod mišem u Strukturi, detalji poglavlja, Upute u desnom panelu), i kako to radi za tisuće radova istodobno.

## 1. Načela

1. **Pravila su podaci.** Ustanova, vrsta rada i verzija uputa opisuju se profilom. Kod ne zna ništa o FPZG-u.
2. **Provjere se računaju kod studenta.** Preglednik računa nalaze iz modela dokumenta. Poslužitelj sprema rad i kratak sažetak nalaza.
3. **Jedan paket provjera.** Iste čiste funkcije rade u pregledniku, u pozadinskoj niti i na poslužitelju (predaja, nastavnički pregled).
4. **Rad je vezan za verziju profila.** Promjena uputa ne mijenja pravila radu koji je već u tijeku, osim ako ga student ili mentor prebace na novu verziju.
5. **Studentski prikaz** poštuje PRODUCT.md §5: bez postotaka, bez mjera ritma i truda, rječnik iz §5.

## 2. Profil pravila

Jedna JSON datoteka po kombinaciji ustanova + vrsta rada + verzija. Preglednik je učita jednom i zapamti je.

```json
{
  "id": "fpzg/zavrsni",
  "version": "2026-1",
  "institution": "Fakultet političkih znanosti, Zagreb",
  "kind": "zavrsni",
  "source": { "title": "Upute za pisanje završnog rada", "url": "…", "checkedBy": "…", "checkedAt": "2026-…" },
  "length": { "min": 6000, "max": 9000, "unit": "words" },
  "sources": { "min": 15 },
  "front": [
    { "k": "naslovnica", "label": "Naslovnica", "manual": true },
    { "k": "izjava", "label": "Izjava o autorstvu", "manual": true },
    { "k": "sadrzaj", "label": "Sadržaj", "auto": true },
    { "k": "ilustracije", "label": "Popis ilustracija", "auto": true, "when": "hasFigures" }
  ],
  "skeleton": [
    { "match": ["uvod"], "title": "Uvod", "required": true, "share": [0.05, 0.10],
      "why": "Uvod uvodi čitatelja u temu i završava teznom rečenicom.",
      "checklist": ["Kontekst i dosadašnja istraživanja", "Praznina i istraživačko pitanje", "Važnost i doprinos", "Metodologija", "Nacrt strukture rada", "Tezna rečenica"] },
    { "match": ["zaključak"], "title": "Zaključak", "required": true, "share": [0.05, 0.10],
      "checklist": ["Sinteza novim riječima", "Teza u drugoj formulaciji", "Rezultati prema ciljevima", "Otvorena pitanja"] },
    { "match": ["sažetak"], "title": "Sažetak i ključne riječi", "required": true, "position": "end" }
  ],
  "paragraph": { "lines": [5, 15] },
  "figures": { "mustBeMentioned": true, "numbering": "perKind" },
  "citation": { "style": "harvard-fpzg" },
  "messages": {
    "paragraph.length": "{n} odlomka izvan {min}–{max} redaka",
    "figure.unmentioned": "Tablica {n} nije spomenuta u tekstu. Upute traže da se objasni zašto je uvrštena.",
    "chapter.noCitations.uvod": "Tvrdnje o dosadašnjim istraživanjima trebaju izvor."
  }
}
```

- `match` povezuje naslov u radu s dijelom kostura (normalizirani tekst, više sinonima).
- `share` je udio u opsegu rada. Student ga nikad ne vidi kao postotak; prikazuje se kao "predug uvod" ili broj riječi.
- `messages` drže sve tekstove koje student čita. Mijenjaju se bez izdavanja novog koda.
- Profil se potvrđuje na temelju službenih pravila fakulteta (pravilnik, upute za pisanje). `source` navodi dokument i članak iz kojeg pravilo dolazi. Pravilo koje se ne može pozvati na službeni dokument ne ulazi u profil.
- Što ustanova ne propisuje, to se ne provjerava. Ako profil nema npr. `paragraph`, provjera `paragraph.length` se ne pokreće i ništa se o tome ne prikazuje.

## 3. Model dokumenta

Provjere ne čitaju HTML. Editor drži strukturirani model, a provjere dobivaju samo ono što im treba:

```ts
type Doc = {
  profile: { id: string; version: string };
  front: Record<string, boolean>;          // ručne kvačice prethodnog dijela
  chapters: Chapter[];
  bibliography: Source[];
};
type Chapter = {
  hid: string; level: 2 | 3; title: string; rev: number;   // rev raste pri svakoj promjeni
  paragraphs: { id: string; words: number; lines: number }[];
  citations: { sourceId: string; at: string }[];
  figures: { n: number; kind: "tablica" | "slika"; mentioned: boolean }[];
  footnotes: number;
  plan: { target?: number; due?: string; status?: "skica" | "u radu" | "gotovo"; checked: Record<number, boolean>; purpose?: string };
  deadlines: { official?: string; own?: string; shareOwn: boolean };
};
type Overrides = {                         // prilagodbe mentora za jedan rad
  by: string; at: string; note: string;    // tko, kada i zašto
  rules: Record<string, unknown | null>;   // npr. { "length.max": 12000 } ili { "paragraph": null } za isključivanje
};
```

`lines` računa editor prema predajnom obliku (font, prored, širina stranice) iz profila, ne prema širini zaslona. Ako ustanova ne propisuje oblik stranice, `lines` se ne računa, a pravila koja ga trebaju se ne pokreću.

## 4. Provjere

Svaka provjera je čista funkcija `(chapter, doc, profile) → Finding[]`, bez stanja i bez mreže.

```ts
type Finding = {
  rule: string;                 // npr. "paragraph.length"
  group: "popravi" | "nedostaje" | "pripazi";
  hid: string;                  // poglavlje
  at?: string;                  // id odlomka / navoda / tablice za skok u tekst
  params: Record<string, string | number>;   // za messages[rule]
};
```

| Pravilo | Skupina | Izvor u profilu |
|---|---|---|
| `comment.open` | popravi | (komentari, ne profil) |
| `paragraph.length` | popravi | `paragraph.lines` |
| `chapter.share` | popravi | `skeleton[].share` |
| `figure.unmentioned` | popravi | `figures.mustBeMentioned` |
| `citation.unmatched` | popravi | `citation`, bibliografija |
| `skeleton.missing` | nedostaje | `skeleton[].required` |
| `checklist.open` | nedostaje | `skeleton[].checklist` + `plan.checked` |
| `chapter.noCitations` | pripazi | `messages` |
| `chapter.belowTarget` | pripazi | `plan.target` |
| `chapter.due` | pripazi | `deadlines` (vidi §6a) |

Skupine odgovaraju kartici pod mišem: POPRAVI, JOŠ NEDOSTAJE PREMA UPUTAMA, PRIPAZI.

## 5. Kada se računa

- **Po poglavlju.** Rezultat se pamti pod ključem `(hid, rev, profile.version)`. Kad se poglavlje ne mijenja, ne računa se ponovno.
- **Nakon tipkanja.** Odgoda oko 400 ms; računa se samo promijenjeno poglavlje.
- **Teže provjere** (usklađenost navoda i literature, cijeli rad) idu u Web Worker, pa ne koče pisanje.
- **Kartica pod mišem** samo čita već izračunate nalaze, ništa ne računa.

## 6. Poslužitelj

Sprema po radu:

- dokument (model iz §3) i verzije za "Promjene od nacrta",
- plan (ciljevi, rokovi, kvačice, teza),
- komentare nastavnika kao zasebne zapise vezane uz mjesto u tekstu,
- **sažetak nalaza**: broj nalaza po poglavlju i skupini, s `profile.version` i `rev`. To je nekoliko kilobajta.

Sažetak se šalje uz spremanje. Iz njega nastavnički i ustanovni pogled grade preglede bez ponovnog računanja.

Pri predaji poslužitelj pokreće isti paket provjera nad spremljenim dokumentom. Rezultat je mjerodavan: ne oslanja se na ono što je javio preglednik.

## 6a. Rokovi i vidljivost

| Rok | Tko ga postavlja | Student vidi | Nastavnik vidi |
|---|---|---|---|
| Službeni | nastavnik ili ustanova | da | da |
| Vlastiti | student | da | samo ako student uključi dijeljenje |

- Vlastiti rokovi su po zadanom privatni (`shareOwn: false`). Student ih može podijeliti za cijeli rad jednim prekidačem i u bilo kojem trenutku isključiti dijeljenje.
- U nastavničkom pogledu podijeljeni rok je označen kao studentov, odvojeno od službenog.
- Kartica pod mišem prikazuje službeni rok, a ispod njega studentov vlastiti, ako postoji.

## 6b. Prilagodbe mentora

Mentor za pojedini rad može promijeniti ili isključiti pravilo iz profila: npr. drugačiji opseg, ublažena granica odlomka ili dodatni obavezni dio.

- Prilagodba se sprema uz rad (`Overrides`), s mentorom, datumom i obrazloženjem. Profil ustanove se ne mijenja.
- Provjere čitaju profil, pa prilagodbe preko njega: `profil ⊕ overrides`.
- Student u Uputama vidi da je pravilo prilagodio mentor, uz obrazloženje.
- Provjera pri predaji koristi iste prilagodbe, a zapisnik predaje ih navodi.
- Ustanova može u profilu odrediti koja se pravila ne smiju prilagođavati (`locked: true`).

## 6c. Ostali zapisi uz rad

Sve što prototip sada drži samo u pregledniku sprema se na poslužitelj uz rad. Ništa od toga ne ulazi u broj riječi ni u provjere opsega.

| Zapis | Sadržaj | Tko vidi |
|---|---|---|
| Inačice odlomka | `{ paragraphId, variants: Html[], current }`; u dokumentu i broju riječi je samo `current` | student; mentor samo kad ga student pita koja je bolja |
| Slike | datoteka u spremištu (`works/{id}/figures/{fid}`), u dokumentu `{ fid, caption, source }` | kao rad |
| Unakrsne reference | u dokumentu `{ kind: "h" \| "t" \| "f", targetId }`; broj se računa pri prikazu i izvozu, ne sprema se | kao rad |
| Bilješke iz čitanja | `{ sourceId, page, text, createdAt }` po izvoru | student; mentor kad je bilješka citirana u tekstu |
| PDF izvora | datoteka u spremištu, vezana uz `sourceId`; za kartu Izvor | samo student |
| Glasovni komentari | audio datoteka uz zapis komentara (§6) | student i mentor |
| Odloženo | `{ text, fromHid, createdAt }` | samo student |
| Pojmovnik | `{ term, variants[] }` | kao rad |
| Poruka sebi | `{ text, paragraphId }`, jedna po radu, prepisuje se | samo student |
| Izvori dodani iz DOI-ja, ISBN-a ili poveznice | zapis izvora kao i ručni, uz `origin: "doi" \| "isbn" \| "url"` i izvorni upit; podatke dohvaća poslužitelj (Crossref, Open Library), ne preglednik | kao rad |
| Uvezeni izvori (BibTeX, RIS) | zapis izvora uz `origin: "bibtex" \| "ris"` i izvorni zapis; duplikat = isti naslov i godina | kao rad |
| Brisanje citiranog izvora | navodi postaju rupe [izvor]; brisanje ide u povijest verzija | kao rad |
| Tok dorade | zahtjev za doradu (tekst, rok, popis komentara), runde i dnevnik: tko, što, kada, poruka; prijedlog izmjene = komentar s `sugg {old, neu}` i ishodom prihvaćeno/odbijeno; odgovori u niti uz komentar | kao rad; mentor i student |
| Odluke uz prijelaze | "u redu je" uz par odlomaka, ključ = id drugog odlomka | samo student |
| Odluke uz oznake | potvrđeni zalijepljeni tekst s obrazloženjem, "preoblikovat ću" uz rečenicu blisku bilješci | obrazloženje vidi mentor; "preoblikovat ću" samo student |

- Inačice, odloženo i poruka sebi spremaju se istim ciklusom kao dokument (stanja spremanja vrijede i za njih).
- Datoteke (slike, PDF, audio) šalju se zasebno; dokument čuva samo identifikator. Bez mreže ostaju u lokalnom redu i šalju se kad se veza vrati.
- Ne bilježi se kada je student diktirao, čitao naglas ni koliko je inačica napisao (PRODUCT.md §5).
- Izvoz u .docx i PDF radi se iz spremljenog dokumenta: uzima samo prikazanu inačicu, slike iz spremišta i ponovno izračunate brojeve referenci.

## 6d. Zajednički zapis mentora i studenta

Editor i Pregled radova čitaju isti rad na poslužitelju. Nijedan ekran ne drži vlastitu kopiju podataka. U prototipu su podaci samo usklađeni ručno.

| Zapis | Piše | Student vidi | Mentor vidi |
|---|---|---|---|
| Dokument (odlomci, `rev`) | student | da | da, zaključan |
| Runde predaje (snimka dokumenta po predaji) | student, pri slanju na pregled | da | da, uz usporedbu rundi |
| Komentari i prijedlozi izmjene (`n`, sidro, pravilo, stanje) | oboje | da | da |
| Zahtjev za doradu (tekst, rok, otvoreni komentari) | mentor | da | da |
| Etape (`stage`, stanje, datum, napomena) | student predaje, mentor odobrava ili vraća | da | da |
| Konzultacije (bilješke, dogovoreni zadaci) | mentor | samo zadaci | da |
| Stanje zadatka s konzultacija | student | da | da |
| Zadnji pregled (`reviewedRev`, vrijeme) | mentor | ne | da |
| Privatne bilješke, predlošci komentara | mentor | ne | da |
| Rubrika (kriteriji, ocjene), nacrt izvješća | mentor | ne | da |
| Ocjena i obrazloženje | mentor | tek nakon objave | da |
| Sažetak, Summary, ključne riječi, izjava o AI-ju | student | da | da |
| Uvezeni odlomci (`origin: import`, vrijeme, izjava) | student | oznaka „uvezeno” | da |
| Događaji unosa (umetanje, lijepljenje, AI, uvoz) | editor, automatski | ne | samo uz prekidač Mjere (demo) |
| Predaja i autorska putovnica (kod, broj riječi, sesije, razdoblje) | poslužitelj pri predaji | da, bez postotaka | da |

- **Jedan izvor za stanje rada.** „Čeka doradu”, „Stiglo na pregled” i „Prihvaćeno” računaju se iz zahtjeva i rundi, ne spremaju se posebno.
- **Runda** je jedna predaja na pregled. Oba ekrana broje isto.
- **„Novo od zadnjeg pregleda”** je razlika između `reviewedRev` i trenutne runde.
- **„Izmijenjeno nakon odobrenja”** je razlika između snimke pri odobrenju etape i trenutnog dokumenta.
- **Mjere (demo)** računaju se iz događaja unosa na poslužitelju. Studentu se nikad ne šalju (PRODUCT.md §5). Prekidač se uklanja nakon dema bez promjene zapisa.
- **Kod putovnice** je sažetak (hash) predanog dokumenta i zapisnika. Provjerava se bez prijave.
- Obavijesti (dorada, predana etapa, konzultacije) nastaju iz istih zapisa, nisu poseban zapis.

## 7. Skaliranje

| Opterećenje | Gdje | Raste s |
|---|---|---|
| Provjere dok student piše | preglednik studenta | duljinom promijenjenog poglavlja |
| Spremanje | poslužitelj | brojem spremanja (kao svaki editor) |
| Profil pravila | CDN / predmemorija | brojem ustanova, ne radova |
| Nastavnički pregled | poslužitelj, čita sažetke | brojem radova u grupi |
| Provjera pri predaji | poslužitelj, jednom po predaji | brojem predaja |

Tisuću istodobnih radova znači tisuću preglednika koji računaju za sebe. Poslužitelj radi spremanje, čitanje i jednu provjeru po predaji.

## 8. Testovi i verzije

- Paket provjera ima testove nad primjerima radova po profilu: za zadani dokument očekuje se točan popis nalaza.
- Isti testovi rade u pregledniku i na poslužitelju, kako se rezultati ne bi razlikovali.
- Promjena profila je nova verzija (`2026-1` → `2026-2`). Postojeći radovi ostaju na staroj verziji dok ih netko ne prebaci, a prebacivanje pokazuje koje se provjere mijenjaju.

## 9. Odluke

1. Profil se potvrđuje na temelju službenih pravila fakulteta.
2. Mentor smije prilagoditi pravila za pojedini rad (§6b).
3. Što ustanova ne propisuje, to se ne računa i ne prikazuje.
4. Nastavnik vidi službene rokove, student svoje. Student može uključiti da nastavnik vidi i njegove rokove (§6a).


## §6e Zapis unosa i istraga

> **PRIJEDLOG dizajna, ne gradi.** Sukobljava se s D-24 (vrijeme ne finije od minute), D-56 i D-125; čeka vlasnikovu D-odluku i pravno mišljenje (GDPR čl. 35). Tekst obavijesti S3 u demou slijedi važeće D-24 i D-56, ne opis iz prototipa.

- Od potvrde obavijesti bilježi se svaki unos i brisanje: `{t, op: i|d, pos, s|n}`. Svaki zapis nosi `h_i = SHA-256(h_{i-1} ‖ JSON(zapis))`; `h_0` je hash zadatka i studenta. Poslužitelj prima zapise u skupinama i provjerava lanac pri primitku.
- PRODUCT.md §5 ostaje na snazi: u redovnim prikazima nema mjera ritma, trajanja ni vremena pisanja.
- Zapis unosa i vrijeme pisanja otvaraju se samo u istrazi: zahtjev mentora (obrazloženje obavezno) → odobrenje koordinatora ili etičkog povjerenstva → obavijest studentu odmah.
- Istraga obuhvaća cijeli rad. Mentor i student vide isti prikaz: vremensku crtu sesija i reprodukciju nastanka teksta.
- Student ima 15 dana za pisano očitovanje u Ducturi.
- Ishodi: zatvoreno bez nalaza · razgovor sa studentom · upućeno stegovnom postupku · ocjena se ne mijenja. Ishod i obrazloženje vidi student.
- Svaki pristup prikazu istrage upisuje se u dnevnik pristupa (tko, kada).
- Zapis se čuva do isteka roka koji propisuje fakultet, kao rad.
- Prekid lanca (izmijenjen ili nedostajući zapis) prikazuje se u istrazi s rednim brojem prvog neispravnog zapisa.
