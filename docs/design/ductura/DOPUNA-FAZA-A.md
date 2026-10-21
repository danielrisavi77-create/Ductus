# Ductura: dopuna dizajna, faza A

Datoteka: `dopuna-faza-a.html`. Samostalna je i otvara se izravno u pregledniku, bez `support.js`. Snimke (1440 i 390 px) nisu u repou. Ekran i stanje biraju se u traci na vrhu datoteke (samo za prototip).

To je dizajnerska referenca, ne produkcijski kod. Pravila su ista kao za `docs/design/ductura/`: tokeni iz README §8 / D-123 i izmišljeni podaci.

## Zašto ovi ekrani
Prototipovi u `docs/design/ductura` već pokrivaju editor, prijavu, demo tok i ekrane faze B i C. Ovdje su ekrani iz plana #476 i kasnijih odluka koji **nemaju prototip** ili za koje je **prototip zastario** zbog vlasnikovih odluka:

| # | Ekran | Ruta | Osnova | Zašto nije dovoljan postojeći prototip |
|---|---|---|---|---|
| 1 | Moji kolegiji | `/nastavnik` | Z3 (A), #476 c.6289158306 | prototipa nema |
| 2 | Radovi zadatka (brz put) | `/nastavnik/zadatak/[id]` | Z3 (B), D-80 | demo-tok k.5 nema „Otvori rad”, stanja po studentu ni prazna stanja |
| 3 | Rad uživo + komentar + kartica sažetka | `/nastavnik/rad/[id]` | #501, #504, F-10 PR4 | pregled-radova-v2 je faza B |
| 4 | Kako vidi nastavnik (samo čitanje) | `/rad/kako-vidi-nastavnik` | ekran 12, DAN-215 | editor-v11 ima samo prekidač |
| 5 | Upis kodom → zadaci | `/upis` | FE-D4, ishodi RPC-a `enroll_with_code` | nema stanja „odbijeno” ni „previše pokušaja” |
| 6 | Predaja | `/rad/[id]/predaja` | F-10, vlasnikovi odgovori 19. 10. (c.6267167615) | prototip ima korak „Izjava” i PDF; oboje je izbačeno |
| 7 | Odjava | dijalog | FE-D7 ugovor (c.6273153537), D-118 | prototip obećava „šalje se pri sljedećoj prijavi”, a to još ne vrijedi |

Svaki ekran ima prekidač stanja u traci prototipa: prazno stanje, učitavanje, greška i blokada.

## Pravila koja dizajn poštuje
- Popis studenata je samo po prezimenu i nema kontrole za drugi poredak (D-80).
- Sažetak procesa je jedan blok s jednim natpisom („Isti sažetak vide student i nastavnik.”). Tekstovi su doslovno iz `messages.hr.ts` (`summary.*`), bez postotaka.
- Predaja nema koraka Izjava ni PDF-a. Kod blokade se vide razlog i kontakt koordinatora kao stalni demo tekst (D-145, D-146). „Predano” se prikazuje samo uz provjeren potpis.
- Rad uživo i Kako vidi nastavnik: tekstovi su iz F-108 (`liveView.*`), a pogled studenta je samo za čitanje.
- Tekst sam provjerio skenerom zabranjenih izraza iz repoa (`scripts/forbidden-terms/terms.ts`) i nema nalaza.

## Nalaz za ugovor FE-D7
Rečenicu iz ugovora „Imaš N izmjena **spremljenih samo na ovom uređaju**” skener odbija kao „spremljeno (bez pojašnjenja)”, jer između riječi „spremljeno” i „na uređaju” stoji „samo”. U dizajnu zato piše: „Imaš 7 izmjena spremljenih na uređaju koje još nisu na poslužitelju.”

## Otvoreno (odluka vlasnika ili orkestratora)
1. **Imena studenata** na ekranu 2: AAI atribut imena nije odobren (Z3, pitanje 1). Dizajn prikazuje izmišljena imena.
2. **Kod za upis** na ekranu kolegija čeka #542 (ruta DAN-36).
3. **Raspon riječi** na ekranu 5 čeka nastavak DAN-225 (DAN-229 je spojen).
4. Dopuna je u repou kao dizajnerska referenca; gradi se tek po ugovorima na #476 (D-111).

## Usklađeno sa zipom „Frontend za Ductus aplikaciju” (repo ductura-dizajn)
- `design_handoff_ductura/*.dc.html` su bajt po bajt isti kao `docs/design/ductura` u repou, pa nema što uvoziti.
- Uz `support.js` prototipi su pokrenuti i uspoređeni s ovom dopunom (editor-v11, pregled-radova-v2, demo-tok-v2, prijava-v5).
- Prema `CLAUDE.md` iz paketa („bez dekorativnih rubova, bez lijeve naglasne crte”) uklonjene su lijeve crte s napomena, grešaka i lijepljenja. Stanje rada na popisu je obojeni tekst, kao u pregled-radova-v2, a komentari su obične stavke bez kutije.
- `ref/demo-ekrani` su u starom stilu D-115 (tamnoplavo), koji je D-123 zamijenio. Ne koriste se kao uzor.
- `Ductura_showcase_v2` je izvor javne početne (FE-H1), koja je već izgrađena.
