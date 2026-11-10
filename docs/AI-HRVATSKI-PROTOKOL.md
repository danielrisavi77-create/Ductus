# Protokol provjere hrvatskog jezika za AI pomoćnika

Stanje: 10. 11. 2026., M9.1-P03 (DAN-400). Nastavak matrice pružatelja `docs/AI-PRUZATELJI-MATRICA.md` (M9.1-P02).

## 1. Svrha i granice

Ovaj protokol opisuje kako se izlaz jezičnog modela ocjenjuje na hrvatskom za deset svrha iz kataloga svrha, verzija 2 (D-268 O2; `src/domain/assistant/purpose-catalog.ts`). Uz njega ide sintetički korpus `docs/ai-hrvatski/korpus.json`.

Protokol ne bira pružatelja. Izbor najviše dvaju pružatelja nakon testa hrvatskog je D-194 t. 7, a odluka je vlasnikova (Owner queue Q-10). Ovaj dokument daje samo postupak i ulaze za taj test.

Izvan ovog koraka:

- Test se ovdje ne pokreće. Korpus se nikome ne šalje dok pružatelj nema otvoren račun i potpisan ugovor o obradi (Q-2, `docs/privacy/05`).
- Mjerenje troška po zahtjevu je M9.1-P03b (D-267 O5), ne ovaj korak.
- Ocjenjuje se samo izlaz modela. Nijedno mjerilo ne ocjenjuje studenta, njegov rad ni način pisanja (PRODUCT.md §5, pravila 1, 2 i 13).

## 2. Korpus

Korpus ima po dva izmišljena zadatka za svaku od deset svrha, ukupno 20. Svaki zadatak ima:

| Polje | Značenje |
| --- | --- |
| `id` | Oznaka zadatka, npr. `proofreading-1`. |
| `purpose` | Ključ svrhe iz kataloga verzije 2. |
| `level` | Razina svrhe iz kataloga: 1 je uključena po zadanome, 2 uključuje nastavnik. |
| `instruction` | Uputa kakvu bi osoba upisala u pomoćnika. |
| `input` | Izmišljen tekst ili bilješke nad kojima pomoćnik radi. |
| `criteria` | Oznake mjerila iz popisa `criteria` koja vrijede za taj zadatak. |

Svi tekstovi su izmišljeni. Nema stvarnih studentskih radova, osobnih imena, adresa, brojeva telefona, OIB-a, JMBAG-a ni stvarnih poveznica; države i županije u zadacima su izmišljene, a osobe su samo uloge sa slovom („Student A”, „Autorica B”), pa i navodi poput „(Autorica A, 2019)” ne upućuju na stvarna djela ni ljude. Test `src/domain/assistant/croatian-eval-corpus.test.ts` to čuva: odbija svrhu izvan kataloga, krivu razinu, svrhu s manje od dva zadatka, nepoznato mjerilo ili polje, mjerilo kojemu predmet nije izlaz modela, izraz iz rječnika zabranjenih izraza te oblike e-adrese, OIB-a ili JMBAG-a, telefona, stvarne poveznice i imena u obliku „Ime Prezime”, „Prezime, godina” ili „Prezime, Ime”. Dopuštene su samo rezervirane adrese (`example.org`, `.invalid`).

## 3. Mjerila

Svako mjerilo ima `subject: "model_output"`: ocjenjuje se što je model vratio, nikad osoba koja je zadatak postavila.

| Oznaka | Mjerilo | Izvor |
| --- | --- | --- |
| `uputa` | Radi ono što uputa traži i ne izlazi iz svrhe. | Katalog svrha |
| `jezik` | Standardni hrvatski: dijakritici, padeži, sročnost, red riječi. | D-194 t. 7 |
| `brojke` | Brojke, godine, nazivi, navodi i oznake izvora ostaju nepromijenjeni. | D-46 |
| `izmjene` | Svaka izmjena je vidljiva i može se prihvatiti ili odbiti. | D-46 |
| `smisao` | Tvrdnje, zaključci i stav ulaza ostaju isti. | D-46 |
| `izvori` | Nema izmišljenih izvora; nesigurni se tako i označe. | D-48 |
| `pitanja` | Postavlja pitanja, ne piše rečenice rada. | D-64 |
| `redoslijed` | Vraća redoslijed s obrazloženjem, ne novi tekst. | D-64 |
| `nazivlje` | Ustaljeno hrvatsko stručno nazivlje. | D-194 t. 7 |
| `shema` | Samo zadana shema kodiranja, s dijelom ulaza za svaku odluku. | Katalog svrha |
| `potpunost` | Obuhvaća cijeli ulaz, ništa ne ispušta. | D-46 |
| `primjer` | Primjer je označen kao izmišljen. | D-64 |

Po svrhama:

| Svrha | Razina | Mjerila u korpusu |
| --- | --- | --- |
| `formatting` | 1 | uputa, brojke, potpunost |
| `proofreading` | 1 | jezik, izmjene, brojke, smisao |
| `literature_search` | 1 | izvori, uputa, nazivlje |
| `transcription` | 1 | potpunost, smisao, jezik, brojke |
| `translation` | 1 | brojke, nazivlje, smisao, potpunost |
| `explanation` | 2 | uputa, nazivlje, jezik, primjer |
| `brainstorming` | 2 | pitanja, uputa, jezik |
| `restructuring` | 2 | redoslijed, uputa, brojke, potpunost |
| `example_generation` | 2 | primjer, uputa, jezik, brojke |
| `data_coding` | 2 | shema, potpunost, uputa |

## 4. Postupak

1. **Priprema.** Za svakog pružatelja s otvorenim računom i ugovorom o obradi isti sistemski upit i iste postavke (temperatura, najveća duljina izlaza) zapisuju se prije prvog poziva. Upit i postavke se tijekom kruga ne mijenjaju.
2. **Pokretanje.** Svaki od 20 zadataka šalje se svakom pružatelju jednom, uputa i ulaz doslovno iz korpusa. Zapisuju se model, verzija modela i vrijeme poziva.
3. **Anonimizacija.** Izlazi se miješaju i dobivaju slučajne oznake (npr. `X1` do `X40` za dva pružatelja). Ključ oznaka čuva osoba koja ne ocjenjuje.
4. **Ocjenjivanje.** Dvoje ocjenjivača neovisno ocjenjuje svaki izlaz po mjerilima tog zadatka, ljestvicom:
   - **2**: mjerilo je ispunjeno;
   - **1**: djelomično ispunjeno, uz kratku bilješku što nedostaje;
   - **0**: nije ispunjeno, uz bilješku i navod dijela izlaza.
5. **Usklađivanje.** Gdje se ocjene razlikuju za 2 boda, ocjenjivači razgovaraju i zapisuju konačnu ocjenu i razlog. Razlika od 1 boda ostaje kao prosjek.
6. **Otkrivanje.** Tek nakon zaključenih ocjena otkriva se ključ oznaka.
7. **Zbir.** Po pružatelju i svrsi zbraja se postignuto naspram najvećeg mogućeg broja bodova. Uz zbir idu sve ocjene 0 s bilješkama.

Tvrda granica: izlaz koji izmisli izvor (`izvori` = 0) ili promijeni brojku ili navod (`brojke` = 0) zapisuje se zasebno, bez obzira na zbir, jer D-46 i D-48 traže da se to ne događa.

## 5. Zapisnik

Jedan redak po paru izlaz–mjerilo:

| Zadatak | Oznaka izlaza | Mjerilo | Ocjenjivač A | Ocjenjivač B | Konačno | Bilješka |
| --- | --- | --- | --- | --- | --- | --- |
| `proofreading-1` | `X7` | `brojke` | 2 | 2 | 2 | |

Zapisnik ne sadrži ništa o osobama osim oznake ocjenjivača (A, B). Ide u repo tek kad je cijeli krug gotov, zajedno s modelom, verzijom i postavkama iz koraka 1.

## 6. Što se ne mjeri

- Ništa o studentu: ni kvaliteta rada, ni način pisanja, ni udio teksta po podrijetlu (PRODUCT.md §5, pravila 1 i 2).
- Nikakva analiza procesa pisanja pomoću AI-ja (pravilo 13).
- Brzina i trošak (M9.1-P03b, D-267 O5).
- Ocjene nisu odluka o pružatelju: rezultat ide vlasniku kao ulaz za D-194 t. 7.

## 7. Izmjene korpusa

Novi zadatak ili mjerilo dodaje se u `docs/ai-hrvatski/korpus.json` i prolazi test iz §2. Nova verzija kataloga svrha traži i novu verziju korpusa (`catalogVersion`), a raniji rezultati ostaju vezani uz verziju na kojoj su dobiveni.
