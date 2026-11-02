# Izvor nastavnog tima v0 — sintetički ugovor mapiranja

DAN-351, korak M2.7-P05. Izvedba: `src/domain/course-team/source-mapping.ts`, testovi uz nju.
Format `ductus-teaching-team-source-v0` je izmišljen i nije format nijednog stvarnog izvornog sustava. Adapter za ISVU je zaseban tiket s rokom „prije stvarne uporabe” (D-205 t. 2).

## Što funkcija radi

`mapTeachingTeamSource(ulaz, kontekst)` iz izvornih redaka o nastavnom timu daje **kandidate** i **nalaze**. Ništa ne zapisuje i ništa ne spaja. Svaki kandidat nosi `confirmation: "required"`: postaje nositelj kolegija ili nastavnik grupe tek kad ga administrator potvrdi kroz postojeće RPC-ove (#1302), kao kod kandidata za nastavnika (#1317).

Ulaz ima točno polja `format`, `institutionKey` i `rows`. Redak ima `courseKey`, `role` (`holder` ili `group_teacher`), `issuer`, `uniqueId` i, samo za `group_teacher`, `groupName`. Format nema polje imena osobe.

Kontekst daje poslužitelj: ključ ustanove, jedini prihvaćeni izdavatelj, preslikavanje izvornog ključa kolegija u kolegij ustanove i točnog `uniqueId` u račun.

## Pravila

| Pravilo | Ishod |
| --- | --- |
| R1 | Nepoznato ili nedostajuće polje, getter, krivi tip, drugi `format` ili više od 2000 redaka: cijeli ulaz se odbija (`ok: false`), bez djelomičnog rezultata. Druga ustanova: `wrong_institution`. `rows` mora biti obično polje bez rupa, pristupnika i vlastitog iteratora; elementi se čitaju po indeksu iz podatkovnih svojstava, a granica broja redaka računa se iz `length`. |
| R2 | Osoba se uparuje s računom samo točnim parom (izdavatelj, `uniqueId`). Nema usporedbe imena, promjene velikih i malih slova ni rezanja razmaka. |
| R3 | Isti `uniqueId` pod drugim izdavateljem ne daje kandidata, nego nalaz `foreign_issuer` (D-104). |
| R4 | Nepoznat kolegij ili račun daje nalaz `unknown_course` ili `unknown_account`; nikad novi račun ni kolegij. |
| R5 | Dva različita nositelja istog kolegija: nijedan kandidat za nositelja, nalaz `holder_conflict` na svakom takvom retku. Administrator bira sam. Nositelji se razlikuju po izvornom identitetu (izdavatelj, `uniqueId`), prije odbacivanja nepoznatih računa i stranih izdavatelja. |
| R6 | Ponovljeni redak daje jednog kandidata i nalaz `duplicate`. |
| R7 | `group_teacher` traži naziv grupe, a `holder` ga ne smije imati. Naziv je u NFC obliku, bez vanjskih razmaka i kontrolnih znakova, od 1 do 120 znakova; inače `invalid_group_name`. |
| R8 | Kandidati i vrste nalaza ne ovise o redoslijedu redaka; ulaz se ne mijenja. |

## Poznate granice

- Je li nositelj otvoreni nastavnik kolegija i je li nastavnik grupe potvrđeni nastavnik iste ustanove provjerava RPC pri potvrdi, ne ova funkcija.
- Stvarni pozivatelj zasad je samo test. Adapter izvora, ruta i ekran administratora su zasebni koraci.
- Naziv grupe konačno provjerava `institution.is_plain_label` u `create_seminar_group`; R7 je uži predfiltar.
- Svi podaci u testovima su izmišljeni.
