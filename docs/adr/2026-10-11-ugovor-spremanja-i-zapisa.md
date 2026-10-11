# ADR: jedan ugovor za spremanje dokumenta i zapis pisanja

- **Status:** PRIHVAĆENO 11. 10. 2026. odlukom vlasnika. Trag: komentar `issuecomment-6105502093` na issueu 87, koji je objavio orkestrator s odlukama danim u njegovoj sesiji. Odluke su prepisane u §8. Stavke iz §9 i dalje nisu provjerene.
- **Dopune nakon prihvaćanja (review PR-a 246):** u §5.3 dodane su provjera konteksta odsječka (t. 3), prethodna provjera ključa ponavljanja prije zapisa objekta (t. 5) i ponovna provjera identiteta i ovlasti unutar transakcije (t. 7 i 8). Potpis u demou (t. 14 i odlomak iza popisa) i potvrda kodova uzroka praznine (§5.5) slijede dvije naknadne odluke vlasnika iz komentara `issuecomment-6105792585` na issueu 87, prepisane u §8 kao odluke 6 i 7. Odluke 1 do 5 i značenje polja potvrde iz §5.1 nisu mijenjani.
- **Datum:** 11. 10. 2026.
- **Zadatak:** stavka 0.3 plana u issueu 239. Samo dokument; ne mijenja kod ni druge dokumente.
- **Stanje koda:** `main` na `1912cac`. Brojevi redaka vrijede za taj commit.
- **Mjesto:** u `docs/` do sada nije bilo zapisa ove vrste (postoje samo `docs/spikes/` i `docs/engineering/`), pa je ovo prvi u `docs/adr/`. Broj odluke u `docs/DECISIONS.md` dodjeljuje se zasebnim PR-om (§10).

## 1. Što se odlučuje

Kako izgleda jedan zahtjev kojim klijent sprema tekst i predaje zapis o pisanju, što poslužitelj provjerava prije nego što išta potpiše i što se događa kad se zapis ne može glatko nastaviti (sukob lanca, dva uređaja, rad bez mreže, ponovljeni zahtjev).

`docs/BACKEND.md` §2 i `docs/ARCHITECTURE.md` §5 t. 3.3 već kažu "jedan RPC koji u istoj transakciji radi CAS reviziju i `reserve`" i ostavljaju pojedinosti za "ADR prije koda". Ovo je taj ADR. Sljedeći korak zadatka B-8 (tablice rada, dokumenta, evidencije i potvrda) o njemu ovisi, jer tablice i potpisana potvrda nose odnose koji se kasnije teško mijenjaju.

## 2. Provjerene činjenice

Svaka tvrdnja iz nalaza provjerena je čitanjem koda, ne ciljanim pokretanjem (vidi §9).

| # | Tvrdnja | Stoji? | Dokaz |
| --- | --- | --- | --- |
| 1 | Spremanje šalje cijeli dokument | Da | `src/domain/serverSync/contract.ts` r. 96 do 101 (`CommitRequest` nosi `p_document`), r. 257 do 290 (odbija sve osim `REPLACE_DOCUMENT`), r. 44 (granica 1 MiB). `src/domain/document/transaction.ts` ima samo tu jednu vrstu transakcije. Datoteka se i dalje poziva na `pisac_commit_document` (r. 2 i 26). |
| 2 | Zapis ide u odsječcima, drugim ugovorom | Da | `src/application/ports/evidence-ingest.ts`: `clientRequestId`, opisnik i kanonski bajtovi jednog odsječka. Ključ ponavljanja je (osoba, paket, `clientRequestId`), a kod dokumenta (dokument, autor, `clientTransactionId`). |
| 3 | "Jedan RPC" nema ugovor u kodu | Da | Ulaz porta `reserve` nema ni baznu reviziju ni otisak dokumenta. Ishodi prijema nemaju `stale_base`. U `db/migrations/` postoje samo tablice identiteta, ustanove, kolegija i zadataka; tablica rada, dokumenta ni evidencije nema. U `app/api/` postoje samo rute prijave. |
| 4 | Sukob lanca trajno blokira red zapisa | Da, na razini čistih funkcija | `src/application/evidence/evidence-outbox.ts` r. 153 do 158: svaki ishod osim prihvata, duplikata i nedostupnosti postavlja `blocked`. R. 82: pokušaj se smije započeti samo iz `pending`. Prijelaz iz `blocked` ne postoji nigdje. Nitko ne čita `expectedPreviousSegmentHash` koji poslužitelj vraća. Idući odsječci vežu se na blokirani, pa i oni dobivaju `chain_conflict`. Ograda: na `main` nema ni spremišta tog reda ni pokretača, pa je ovo ugovor bez izvedbe, a ne izmjereno ponašanje u pregledniku. |
| 5 | Prekid se ne bilježi, pa rekonstrukcija pada | Da, uz preciziranje | Prekid se vidi iz samih odsječaka: `verifyEvidenceChainV2` (`src/domain/forensics/evidence-chain-v2.ts` r. 213) vraća `discontinuities` i traži da ih pozivatelj usporedi sa zabilježenim prazninama. Ali zabilježene praznine ne postoje: nema ni tipa, ni porta, ni tablice. `src/application/evidence/evidence-reconstruction.ts` r. 250 do 257 na prvom prekidu vraća `discontinuity`, a predaju pušta samo `match`. Rad s prekidom danas se ne može predati. |
| 6 | Poslužitelj ne uspoređuje završni otisak odsječka sa spremljenim dokumentom | Da | `src/application/evidence/evidence-gateway.ts` r. 282 do 372: ovlast, veličina, bajtovi jednaki JCS obliku, otisak jednak opisniku, upis objekta, `reserve`, potpis. `finalDocumentHash` se ne uspoređuje ni s čim, jer spremljeni dokument na toj strani ne postoji. |
| 7 | Razvojni ključ nastaje pri pokretanju procesa | Da | `src/adapters/crypto/development-ed25519-signer.ts` r. 36. Oznaka i verzija ključa su zadani stalni tekst (r. 28 i 29), pa dva različita ključa nose istu oznaku. Posljedicu već pokazuju testovi u `src/application/evidence/evidence-thin-slice.test.ts` ("receipts signed by another key" daje `receipt_signature_invalid`). |

Uz to, tijekom provjere nađeno:

- **Tri navoda koja ne mogu vrijediti zajedno.** `docs/PLAN-DEMO.md` B-12 traži "rekonstrukcija podudarna na scenarijima uključujući prazninu". Dopuna D-98 kaže da demo rekonstruira od prvog događaja, bez tablice kontrolnih točaka. Kod kaže da se nakon prekida nastavlja od kontrolne točke (`evidence-reconstruction.ts` r. 60). Bez dokumenta s kraja praznine rekonstrukcija ne može prijeći prazninu. Razriješeno odlukom 4 (§8).
- **Potvrda ne nosi ono što klijent provjerava.** Klijent drži stanje dok ne provjeri potvrdu prema (`documentId`, `clientTransactionId`, `revision`) (`src/domain/sync/drain.ts`), a potvrda v1 nema ni reviziju ni ID transakcije. To je stavka 0.1 (issue 202).
- **`ARCHITECTURE.md` §5 t. 2** kaže da odsječak nosi ID transakcije klijenta. Format odsječka v2 nema to polje (ima `segmentId`).
- **Pravilo pražnjenja reda vrijedi samo dok je svaki redak cijeli dokument.** `drain.ts` r. 300 do 314 šalje samo najnoviji redak, a starije preskače, i sam upozorava da to prestaje vrijediti čim redak postane dio niza.
- **Veličina dokumenta mjeri se na `JSON.stringify`, a otisak na JCS obliku** (`contract.ts` r. 47 do 49). U jednom ugovoru to treba biti ista mjera.

## 3. Opcije

Zajedničko svim opcijama: autor, ustanova i paket evidencije određuju se iz sesije i iz dokumenta na poslužitelju, nikad iz polja klijenta. Klijent ne piše u tablice; sve ide kroz RPC. Objekt odsječka zapisuje se u spremište prije transakcije; ako transakcija ne prođe, ostaje siroče (`BACKEND.md` §4.1).

### Opcija A: jedan commit nosi jedan odsječak i cijeli dokument

Doslovno ono što piše u `ARCHITECTURE.md` §5 t. 3. Odnos je 1 zahtjev : 1 odsječak : 1 revizija : 1 potvrda.

- **Sukob lanca.** Revizija i glava lanca mijenjaju se u istoj transakciji, pa "pogrešan prethodnik uz ispravnu baznu reviziju" može nastati samo ako je klijent izgubio dio vlastitog reda. Oba odbijanja (`stale_base`, `chain_conflict`) vraćaju isto stanje poslužitelja: reviziju, otisak glave, zadnji redni broj događaja i otisak spremljenog dokumenta. Klijent se usklađuje (§5.4); stanje `blocked` bez izlaza više ne postoji.
- **Dva taba.** Dijele isti lokalni dnevnik; drugi tab postaje zastario lokalno (PR 206). Ako ipak oba pošalju, poslužitelj prihvaća točno jedan.
- **Dva uređaja.** Drugi dobiva `stale_base`. Ako nema neposlanog teksta, preuzima stanje poslužitelja i nastavlja lanac bez praznine. Ako ga ima, autor bira kao i danas (`src/domain/sync/conflict.ts`); "zadržavam svoju verziju" znači prijavljeni prekid (§5.5).
- **Bez mreže.** Red raste za jedan odsječak i jedan cijeli dokument svakih najviše 30 sekundi i šalje se redom. Ništa se ne smije preskočiti.
- **Ponovljeni zahtjev s istim `clientTransactionId`.** Isti sadržaj: `duplicate`, ista revizija, ista potvrda, ništa se ne sprema ni ne potpisuje ponovno. Drugi sadržaj: `txid_reused`, ništa se ne mijenja. Jednom poslan commit je zamrznut i ponavlja se isti dok ne stigne konačan odgovor (to `drain.ts` već radi).

### Opcija B: jedan commit nosi najnoviji dokument i sve još neprihvaćene odsječke, redom

Odnos je 1 zahtjev : N odsječaka : 1 revizija. Opcija A je poseban slučaj (N = 1).

- **Sukob lanca, dva taba, dva uređaja.** Kao A.
- **Bez mreže.** Red raste za jedan mali odsječak svakih 30 sekundi; cijeli dokument čuva se jednom, najnoviji. Povratak na mrežu je jedan zahtjev, ili nekoliko ako red prelazi granicu veličine zahtjeva.
- **Ponovljeni zahtjev.** Kao A, s tim da se "isti sadržaj" mjeri popisom otisaka odsječaka i otiskom dokumenta.
- **Novo u odnosu na A:** granica broja i veličine odsječaka po zahtjevu; N upisa objekata prije transakcije; N potvrda s istom revizijom i istim ID-om transakcije; pravilo za dijeljenje prevelikog reda, koje traži dokument na granici svakog dijela (klijent ga mora sačuvati ili ponovno izračunati).

### Opcija C: dva zahtjeva, povezana referencom

Zapis se šalje kao danas, a commit dokumenta navodi glavu lanca kojoj odgovara.

- **Sukob lanca i dva uređaja.** Između dva zahtjeva postoji stanje "odsječak bez revizije". Ako klijent tada stane, drugi uređaj učita dokument koji zaostaje za lancem i ne može nastaviti dok prvi ne dovrši, ili mora prijaviti prekid koji nije stvaran.
- **Bez mreže, ponovljeni zahtjev.** Dva reda, dva ključa ponavljanja, dvije potvrde ili commit dokumenta bez potvrde.
- Ovo je stanje koda danas. Suprotno je `BACKEND.md` §2, stavci "commit+reserve atomically" u `STATE.md` i točki 20 plana napada (komentar na issueu 155). Navodi se radi potpunosti i **ne preporučuje se**.

## 4. Cijena

Brojke o veličini dolaze iz `docs/spikes/B0.2.md` (shema `prosemirror-schema-basic`, dakle približno): dokument od 15.000 riječi ima oko 130 KB, od 80.000 riječi oko 690 KB. Kanonizacija i otisak koštaju 2 do 3 ms, odnosno 11 do 14 ms na jednom vCPU-u. Ostalo je račun, ne mjerenje.

| | Opcija A | Opcija B | Opcija C |
| --- | --- | --- | --- |
| Za demo 2. 11. | Poslužitelj: ono što plan B-8 već predviđa (tablice, jedan RPC, ruta), plus dvije usporedbe otiska. Klijent: redak reda nosi odsječak i dokument; red se šalje redom umjesto "samo najnoviji". | Sve iz A, plus petlja po odsječcima, granice, više potvrda po zahtjevu, dijeljenje reda i veći plan napada. Procjena: dva do tri dodatna `critical` PR-a na lancu B-8 → B-12 → F-10 → K-4, na kojem svako kašnjenje pomiče demo (`PLAN-DEMO.md` §7). | Najmanje koda sada. Ali "spremljeno na poslužitelju" i dalje znači dvije stvari, a stavke 0.1 i 0.5 ostaju bez čistog rješenja. |
| Mreža i baza u radu s mrežom | Jedan dokument po commitu: 120 commitova na sat. 15.000 riječi: oko 16 MB na sat. 80.000 riječi: oko 83 MB na sat, po aktivnom autoru, i isto toliko prepisanog tekućeg dokumenta u bazi. | Isto kao A (N = 1). | Isto. |
| Bez mreže, jedan sat | 120 cijelih dokumenata na uređaju i zatim na mreži: oko 16 MB (15.000 riječi), oko 83 MB (80.000 riječi). Esej od 3.000 riječi: oko 3 MB. | 120 odsječaka (procjena 20 do 50 KB svaki) i jedan dokument. | Kao A za dokument, plus odsječci. |
| Kasnije | B se može uključiti bez promjene potpisanih formata ako se sada poštuju tri uvjeta iz §5.1. | Dijeljenje reda i više potvrda po reviziji ostaju trajna složenost na najosjetljivijem putu. | Prelazak na jedan ugovor nakon prvih stvarnih zapisa znači dvije vrste potvrda i dva značenja revizije u istoj povijesti. |

## 5. Preporuka

Preporuka je prihvaćena (§8, odluke 1 do 5). Tekst ovog odjeljka je onaj iz prijedloga, uz dopune nakon reviewa navedene u zaglavlju.

**Opcija A sada, uz tri uvjeta koja ostavljaju opciju B otvorenom, i prekid kao prijavljena praznina.** To je najmanja promjena koja ostaje unutar odobrene arhitekture: `ARCHITECTURE.md` §5 već opisuje upravo taj oblik, plan B-8 ga već predviđa, a demo radi s kratkim tekstovima i kratkim prekidima mreže.

### 5.1 Tri uvjeta da B ostane moguć

1. **Značenje polja u potvrdi v2.** `revision` i `clientTransactionId` znače "commit u kojem je ovaj odsječak prihvaćen". Nijedan provjeravatelj, tablica ni test ne smije pretpostaviti da jedna revizija ima točno jednu potvrdu, ni da je redni broj odsječka jednak reviziji.
2. **Zahtjev nosi popis odsječaka**, a poslužitelj ga ograničava na točno jedan. Podizanje granice je zasebna odluka s vlastitim planom napada i mjerenjem (stavke 2.3 i 2.8 plana).
3. **Otisak sadržaja za ključ ponavljanja** računa se nad popisom otisaka odsječaka, otiskom dokumenta i prijavom praznine. Bazna revizija nije dio otiska (kao i danas).

### 5.2 Zahtjev

| Polje | Napomena |
| --- | --- |
| `documentId` | |
| `clientTransactionId` | Jedini ključ ponavljanja, uz dokument i autora iz sesije. `clientRequestId` nestaje s žice. |
| `baseRevision` | |
| `segments` | Kanonski bajtovi odsječaka; u ovoj odluci točno jedan. |
| `document` | Cijeli kanonski dokument nakon zadnjeg odsječka. |
| `gap` | Neobavezno: prijava prekida s uzrokom iz zatvorenog popisa (§5.5). |

Granice: odsječak do 2 MiB (D-96), dokument do 1 MiB, i jedna zajednička konstanta za cijeli zahtjev koju uvoze klijent i ruta.

### 5.3 Što poslužitelj provjerava, redom

Prije transakcije:

1. sesija, ovlast, veličine;
2. odsječak je bajt po bajt JCS oblik valjanog odsječka; dokument je valjan;
3. kontekst odsječka: `documentId` u odsječku jednak je dokumentu iz zahtjeva, a `evidenceProfileId` profilu paketa koji poslužitelj sam izvodi iz tog dokumenta. Odsječak koji imenuje drugi dokument ili profil odbija se kao `invalid`, kao što gateway radi i danas (`evidence-gateway.ts` r. 227 do 233);
4. otisak JCS oblika dokumenta jednak je `finalDocumentHash` odsječka;
5. prethodna provjera ključa ponavljanja, čitanjem: poznat ključ s istim sadržajem vraća prijašnji ishod, a s drugim sadržajem `txid_reused`, u oba slučaja bez novog objekta, prihvata i potpisa (`BACKEND.md` §4.1, "Ponovno slanje"). U demou poznat ključ uvijek ima potpisanu potvrdu (točka 14). Ovlast ide prije ove provjere; zabrane novog prihvata (točka 8) idu poslije nje, da ne stanu ispred oporavka već prihvaćenog zahtjeva;
6. objekt se zapisuje u spremište, samo za ključ koji prethodna provjera ne poznaje. Ako transakcija zatim ne uspije, pa i zbog potpisa, objekt ostaje siroče; ponovljeni zahtjev s istim bajtovima nailazi na isti objekt i ne stvara novi.

U jednoj transakciji, uz zaključan redak dokumenta:

7. identitet se ponovno izvodi iz `current_actor()` unutar RPC-a, nikad iz parametra, i ponovno se provjerava članstvo. Provjera prije transakcije nije dovoljna, jer se sesija, članstvo ili zadatak mogu promijeniti između nje i zaključavanja retka;
8. ključ ponavljanja, ponovno i mjerodavno, zbog utrke dvaju istih zahtjeva (isti sadržaj vraća prijašnji ishod, drugi sadržaj `txid_reused`). U demou ključ postoji samo ako je i potpis uspio, pa je prijašnji ishod uvijek potpisana potvrda. Samo za novi prihvat zatim: verzija zadatka i je li zadatak otvoren, te granice paketa;
9. bazna revizija jednaka je tekućoj;
10. prethodnik odsječka jednak je glavi lanca;
11. redni broj prvog događaja veći je od zadnjeg prihvaćenog (vraćanje unatrag odbija se uvijek);
12. nastavak: redni broj je točno sljedeći i `initialDocumentHash` jednak je otisku spremljenog dokumenta, ili zahtjev nosi prijavu praznine;
13. upis: revizija, dokument i njegov otisak, odsječak, nova glava, potvrda, i redak praznine ako je prijavljena;
14. potpis, u demou unutar iste transakcije: potvrda se potpisuje i potpis se priključuje prije nego što se transakcija potvrdi. Ako potpis ne uspije, cijela se transakcija poništava: nema ni revizije, ni odsječka, ni potvrde, ni retka praznine.

Točke 4 i 12 su stavka 0.5 plana (§7).

**Potpis u demou (odluka vlasnika, komentar `issuecomment-6105792585` na issueu 87; prepisana u §8).** Potpis ulazi u istu transakciju kao i spremanje. U demou ne postoji stanje u kojem je prihvat zapisan, a nije potpisan; dopuna D-98 ("u demou nema tog stanja") čita se doslovno i ne mijenja se. Ako potpis ne uspije, ne uspijeva cijelo spremanje i klijent ponavlja s istim ključem. Iz toga slijedi:

- U demou odgovori `committed` i `duplicate` uvijek nose potpisanu potvrdu; `pending_signature` nije odgovor u demou.
- Ponovljeni zahtjev nalazi ili cijeli potpisan prihvat (pa je `duplicate` s istom potvrdom) ili ništa (pa se cijelo spremanje ponavlja). Put "potpiši postojeći nepotpisani prihvat", koji gateway danas ima (`evidence-gateway.ts` r. 277 do 279), u demou se ne koristi.
- Transakcija i brava na retku dokumenta drže se dok traje potpis. U demou potpisuje web proces razvojnim ključem, u istom procesu. Kako točno potpis ulazi u transakciju (redoslijed poziva između web procesa i RPC-a) određuje plan napada koraka koji uvodi RPC.

Izvan demoa i dalje vrijede `BACKEND.md` §3 pravilo 3 i `ARCHITECTURE.md` §5 t. 3 do 5: potpisuje worker, a potvrda do tada stoji u stanju `pending_signature`. Vrijedi li stroža varijanta i izvan demoa, otvoreno je pitanje (§8).

Potvrda v2 time tvrdi tri stvari: da su ti bajtovi odsječka primljeni i pohranjeni; da nastavljaju lanac iza navedenog prethodnika; i da je dokument s otiskom `finalDocumentHash` spremljen kao revizija `revision`. To značenje treba zapisati uz vektor potvrde (stavka 0.1), jer se polja ne mijenjaju, a mijenja se ono što potpis jamči.

### 5.4 Ishodi i što klijent radi

| Ishod | Znači | Klijent |
| --- | --- | --- |
| `committed`, `duplicate` | Spremljeno. U demou je potvrda uvijek potpisana; izvan demoa može čekati potpis (`pending_signature`) | "Spremljeno na poslužitelju" tek kad provjeri potpisanu potvrdu. |
| `stale_base`, `chain_conflict` | Poslužitelj je dalje ili drugdje; odgovor nosi reviziju, otisak glave, zadnji redni broj i otisak dokumenta | Usklađivanje (niže). |
| `not_continuous` | Odsječak se veže na glavu, ali ne nastavlja slijed ili dokument, a praznina nije prijavljena | Kao gore. Poslužitelj nikad sam ne pretvara takav zahtjev u prazninu. |
| `txid_reused` | Isti ključ, drugi sadržaj | Postojeći oporavak (`RECOVERY_REQUIRED`). |
| `document_mismatch`, `invalid`, `too_large` | Zahtjev nije ispravan i neće biti ni pri ponavljanju | Ne ponavlja. Tekst ostaje "spremljen na uređaju"; put dalje je §5.5. |
| `unauthenticated`, `unauthorized`, `not_found`, `not_accepting` | Sesija, članstvo ili zadatak ne dopuštaju novi prihvat (točke 1, 7 i 8) | Ne ponavlja isti zahtjev. Tekst ostaje "spremljen na uređaju"; nova prijava ili stanje zadatka određuju što dalje. |
| nedostupno, izgubljen odgovor | Ne zna se | Ponavlja isti zahtjev. |
| potpis nije uspio (demo) | Ništa nije spremljeno: transakcija je poništena | Ponavlja isti zahtjev s istim ključem. Kako se ishod zove na žici, određuje plan napada koraka koji uvodi RPC. |

Usklađivanje, uvijek istim redom:

1. Dohvati stanje poslužitelja (revizija, dokument, glava).
2. Ako je glava odsječak koji je ovaj klijent sam poslao, odgovor se samo izgubio: odbaci prihvaćeni dio reda, pomakni baznu reviziju, nastavi. Autor ne vidi ništa.
3. Ako je poslužitelj dalje, a klijent nema neposlanog teksta: preuzmi stanje i nastavi lanac od glave. Nema praznine.
4. Ako je poslužitelj dalje, a klijent ima neposlani tekst: postojeći izričiti izbor autora. Nema tihog prepisivanja.
5. Ako klijent ne može nastaviti lanac (izgubljen dio reda, izbor "zadržavam svoju verziju"): prijavljeni prekid.

### 5.5 Prekid kao prijavljena praznina

- Lanac otisaka se nikad ne račva i nikad ne počinje iznova. Odsječak nakon prekida veže se na glavu poslužitelja.
- Prekid je običan commit s poljem `gap`. Poslužitelj u istoj transakciji upisuje redak praznine (dokument, od revizije, do revizije, uzrok; `ARCHITECTURE.md` §3) i uz njega čuva dokument iz tog commita. Rekonstrukcija nastavlja od tog dokumenta (`ARCHITECTURE.md` §6 t. 3), pa praznina ne blokira predaju (D-11), a vidi se u sažetku (pravilo 3 iz `PRODUCT.md` §5).
- Otisak tog dokumenta jednak je `finalDocumentHash` potpisanog odsječka, pa se sačuvani dokument može provjeriti bez povjerenja u bazu.
- Događaji iz samog odsječka prekida ostaju u lancu i u pohrani, ali se ne provjeravaju reprodukcijom, jer poslužitelj nema stanje od kojeg polaze. Praznina zato obuhvaća i taj odsječak (najviše 30 sekundi pisanja).
- Prekidi koji se vide iz potpisanih odsječaka moraju se jedan prema jedan poklapati s recima praznina. Prekid bez retka i redak bez prekida su greška koja blokira predaju.
- Rad bez mreže i povratak **nije** prekid: red se čuva i šalje redom.
- **Uzrok praznine je tehnički kod iz zatvorenog popisa, a ne tekst za prikaz.** Popis još nije potvrđen, i to je ovisnost koja blokira jedan korak: kodove potvrđuje plan napada za korak B-8 s poljem `gap`, a vlasnik ih vidi prije koda; do tada čeka samo taj korak, a ostali koraci B-8 idu dalje (odluka 7 u §8). Kod ulazi u redak baze, u otisak sadržaja za ključ ponavljanja i u mjerenja. Prijedlog, izveden iz slučajeva u §5.4: `local_record_lost` (klijent ne može nastaviti lanac jer mu nedostaje dio vlastitog reda ili je odsječak konačno odbijen) i `conflict_kept_local` (autor je u sukobu dvaju uređaja zadržao svoju verziju; odluka 3 u §8). Tekst koji uz prazninu vide student i nastavnik određuje Product/UX i smije se mijenjati bez promjene spremljenih kodova.

Razmotreno i odbačeno za sada: prekid zapisati kao jedan događaj u lancu koji stanje poslužitelja zamjenjuje stanjem uređaja. Lanac bi ostao neprekinut i rekonstrukcija ne bi trebala sačuvani dokument. Ali to mijenja odobreni tekst `ARCHITECTURE.md` §5 i §6, ovisi o formatu koraka (stavka 0.4) i o reprodukciji koje na `main` još nema, i lako se prikaže kao jedan velik unos bez izvora umjesto kao praznina.

### 5.6 Mjerenja koja ugovor mora izložiti

Broj ishoda po vrsti (osobito `stale_base`, `chain_conflict`, `not_continuous`, `txid_reused`), broj prijavljenih praznina po uzroku, broj siročadi u spremištu, broj spremanja poništenih zbog neuspjelog potpisa (demo) i broj potvrda koje čekaju potpis (izvan demoa). Bez toga se greška u klijentu koja proizvodi praznine vidi tek u predaji.

### 5.7 Što ulazi prije demoa, a što poslije

- **Prije demoa:** zahtjev i provjere iz §5.2 i §5.3, ishodi iz §5.4, redak praznine s dokumentom na poslužitelju (B-12 traži scenarij s prazninom; preduvjet je potvrđen popis uzroka, §5.5), red na klijentu koji šalje redom.
- **Poslije demoa, prije prvog stvarnog studenta:** put u sučelju za sukob dvaju uređaja s izborom "zadržavam svoju verziju", mjerenja iz §9, odluka o opciji B.

## 6. Najjači argument protiv

**Jedan ugovor veže trajnost teksta uz ispravnost zapisa.** Danas je spremanje dokumenta jednostavan, zaseban put. Nakon ove odluke tekst dolazi na poslužitelj samo ako klijent uz njega proizvede valjan odsječak: kanonski bajtovi, točni otisci, točan prethodnik. Greška bilo gdje u hvatanju zapisa, u kodu koji će se pisati u tri tjedna prije demoa, znači da studentov tekst ostaje samo na uređaju. Prijavljeni prekid nije izlaz iz svake takve greške, jer i on traži jedan valjan odsječak.

Zašto preporuka ipak stoji: razdvojeni put je upravo ono što `BACKEND.md` §2 odbacuje ("revizija bez odsječka je lažna praznina"), a pravilo 11 iz `PRODUCT.md` §5 traži da se predati može samo ono što se može rekonstruirati. Rizik se smanjuje, ne uklanja: tekst je trajno na uređaju i stanje to pošteno pokazuje, odbijanja se broje (§5.6), a put spašavanja teksta s uređaja već postoji (`src/domain/sync/recovery.ts`). Vlasnik je taj rizik prihvatio odlukom 1 (§8).

Drugi argument, protiv A u korist B: bez mreže A sprema cijeli dokument svakih 30 sekundi i ne smije ništa preskočiti. Za demo je to zanemarivo (oko 3 MB na sat). Za diplomski ili doktorski rad nije (16 do 83 MB na sat), a "rad bez mreže" se ne smije rezati. Zato su uvjeti iz §5.1 dio preporuke, a ne dodatak.

## 7. Dvije susjedne stavke

**(a) Usporedba otiska pri prijemu (stavka 0.5).** U jednom ugovoru to su točke 4 i 12 iz §5.3: dokument je u istom zahtjevu, a otisak spremljenog dokumenta u istoj transakciji. S dva odvojena ugovora ista bi provjera tražila čitanje preko granice dviju transakcija, s utrkom između njih. Trošak je jedna kanonizacija i otisak po commitu (do 14 ms za 80.000 riječi) i jedan stupac s otiskom tekućeg dokumenta. Plan napada prije koda ostaje obvezan.

**(b) Trajni razvojni ključ (stavka 0.2).** Čim pohrana postane trajna, potvrda izdana prije ponovnog pokretanja procesa više se ne može provjeriti, a predaja to čita kao neispravan zapis. Što odluka treba sadržavati: javni ključ upisan u registar ključeva domene evidencije; verzija ključa izvedena iz samog ključa, ne stalni tekst; potvrda se provjerava ključem koji registar navodi za njezinu oznaku i verziju, nikad "trenutnim ključem potpisnika"; privatni razvojni ključ izvan repoa; produkcijska konfiguracija i dalje odbija razvojnog potpisnika. Veza s ovom odlukom: ugovor vraća potvrde koje klijent provjerava, pa klijent mora dobiti isti popis javnih ključeva.

## 8. Odluke vlasnika

Vlasniku je postavljeno pet pitanja. Odluke su prepisane doslovno iz komentara `issuecomment-6105502093` na issueu 87 (11. 10. 2026.), bez dopuna.

1. **Pitanje:** prihvaća li se preporuka (opcija A sada, uvjeti iz §5.1, opcija B kao kasnija odluka), uz rizik iz §6.
   **Odluka:** "Prijedlog se prihvaća: jedno slanje nosi jedan odsječak zapisa i cijeli dokument, u jednoj transakciji, s jednim ključem ponavljanja (`clientTransactionId`). Prihvaćen je i rizik da trajnost teksta na poslužitelju ovisi o ispravnosti hvatanja zapisa."
2. **Pitanje:** smije li klijent sam, nakon konačnog odbijanja, prijaviti prekid i spremiti tekst, ili to traži potvrdu autora.
   **Odluka:** "Klijent smije sam prijaviti prazninu u zapisu; student je uvijek vidi."
3. **Pitanje:** što s neposlanim odsječcima uređaja čija verzija ostaje nakon sukoba dvaju uređaja; oni se ne mogu nadovezati na lanac.
   **Odluka:** "Kod sukoba dvaju uređaja neposlani odsječci uređaja čija verzija ostaje odbacuju se i prikazuje se praznina."
4. **Pitanje:** je li dokument sačuvan uz redak praznine u skladu s dopunom D-98 "bez tablice kontrolnih točaka", i prikazuje li demo sukob dvaju uređaja.
   **Odluka:** "Demo ne prikazuje sukob dvaju uređaja; uz redak praznine čuva se dokument od kojeg rekonstrukcija nastavlja, bez tablice kontrolnih točaka (D-98 ostaje). Kriterij B-12 „uključujući prazninu” tumači se tako."
5. **Pitanje:** značenje polja potvrde v2 iz §5.1 t. 1 i §5.3, prije nego što se vektor zaključa (stavka 0.1).
   **Odluka:** "Značenje polja `revision` i `clientTransactionId` u potvrdi v2 potvrđuje se kako piše u PR-u 246, uključujući uvjete koji ostavljaju mogućim kasnije slanje više odsječaka bez promjene potpisanog formata."

Isti komentar navodi i posljedice: pisac DAN-54 smije zaključiti zlatne vektore prema točki 5, a planovi 241 i 242 više ne čekaju ovu odluku.

Dva pitanja koja je otvorio review PR-a 246 vlasnik je odlučio naknadno. Odluke su prepisane doslovno iz komentara `issuecomment-6105792585` na issueu 87 (11. 10. 2026.), bez dopuna:

6. **Pitanje:** smije li u demou kratko postojati prihvat koji je zapisan, a nije potpisan.
   **Odluka:** "**Nepotpisan prihvat u demou: stroža varijanta.** Potpis ulazi u istu transakciju kao i spremanje. U demou ne postoji stanje u kojem je prihvat zapisan, a nije potpisan; dopuna D-98 („u demou nema tog stanja”) čita se doslovno. Ako potpis ne uspije, ne uspijeva cijelo spremanje i klijent ponavlja s istim ključem."
7. **Pitanje:** tko potvrđuje zatvoreni popis kodova uzroka praznine.
   **Odluka:** "**Kodovi uzroka praznine:** potvrđuje ih plan napada za korak B-8 s poljem `gap`; vlasnik ih vidi prije koda. Do tada čeka samo taj korak; ostali koraci B-8 idu dalje."

I dalje otvoreno, izvan ovih odluka:

- **Potpis unutar transakcije izvan demoa.** Odluka 6 govori o demou, gdje web proces potpisuje razvojnim ključem u istom procesu. Izvan demoa `BACKEND.md` §3 pravilo 3 traži da web proces ne drži materijal ključa i da potpisuje worker preko servisa ključeva, uz stanje `pending_signature`. Ako bi stroža varijanta vrijedila i tamo, vanjski poziv potpisa išao bi unutar transakcije baze, uz zaključan redak dokumenta. Ovaj zapis to ne rješava.
- **Tekst koji uz prazninu vide student i nastavnik** (`PRODUCT.md` §9) određuje Product/UX. Ne blokira B-8, jer se ne sprema.
- Tok "promjena uređaja" i dalje nema nositelja (stavka 1.6 plana).

## 9. Što nisam mogao provjeriti

- **Nijedna tvrdnja nije provjerena ciljanim pokretanjem.** Sve dolaze iz čitanja koda i dokumenata. Postojeći jedinični i property testovi prošli su pri slanju ove grane, uključujući test naveden u retku 7; to potvrđuje samo da kod radi kako je pročitan.
- **Veličine.** Brojke iz B0.2 mjerene su na zamjenskoj shemi, bez ID-ova čvorova koje Ductusov dokument nosi. Veličina odsječka za 30 sekundi pisanja je procjena. Granica od 1 MiB po dokumentu ujedno je gornja granica veličine rada; koliko je to riječi u Ductusovoj shemi, nije izmjereno.
- **Trošak na klijentu.** Svaki događaj nosi otisak dokumenta prije i poslije. Ako se računa nad cijelim dokumentom pri svakom događaju, to je 11 do 14 ms po događaju za 80.000 riječi na poslužiteljskom vCPU-u; u pregledniku nije izmjereno. Hvatanje zapisa na `main` još ne postoji.
- **Volumen zapisa u bazi** zbog prepisivanja tekućeg dokumenta pri svakom commitu, trajanje upisa objekta i potpisa preko servisa ključeva.
- **Dohvat potpisane potvrde u produkciji.** Ako se potvrda koja čeka potpis dohvaća ponavljanjem cijelog zahtjeva, svaki upit nosi cijeli dokument. Vjerojatno treba malo čitanje po ID-u transakcije; u demou je potvrda potpisana u istoj transakciji pa se to ne vidi.
- **Granica lokalnog reda.** U `src/lib/journal/atomic-dexie-journal.ts` nisam našao granicu veličine reda.
- **Tko prazni red kad su otvorena dva taba.** Nisam našao zaključavanje pražnjenja između tabova.
- **Otvoreni PR-ovi 206, 232, 233 i 240** pročitani su po opisu i popisu datoteka, ne redak po redak. PR 213 spojen je tijekom rada; pročitano je zaglavlje formata koraka.
- **Izvorni `pisac-editor`** nije dostupan; što su njegovi RPC-i radili znam samo iz komentara u kodu.
- **Linear** nije čitan; s issuea 87 pročitana su samo četiri navedena komentara i dva komentara s odlukama iz §8. PR 243 upisuje odluke od 11. 10. u dokumente; ovdje se pozivam na komentare, ne na brojeve odluka iz tog PR-a.

## 10. Što slijedi nakon odluke

Zasebnim zadacima, ne ovim PR-om. Isti popis stoji u opisu PR-a 246.

U docs PR-u odluka:

- `docs/DECISIONS.md`: nova odluka s brojem, s pet točaka iz komentara 6105502093 i dvije iz komentara 6105792585.
- `docs/PLAN-DEMO.md`, kriterij B-12 "uključujući prazninu", i dopuna D-98 "bez tablice kontrolnih točaka": napomena da se tumače prema odluci 4. D-98 ostaje.
- `docs/PLAN-DEMO.md` §7 t. 4, dopuna D-98 "u demou nema ni reda poslova ni tog stanja": napomena da se čita doslovno i da potpis ulazi u istu transakciju kao i spremanje (odluka 6). D-98 ostaje.
- `docs/ARCHITECTURE.md` §5: t. 2 (odsječak nosi ID transakcije klijenta), odlomak o praznini i odlomak "Kontrolne točke" ("uvijek kad otkrije prazninu"), koji treba reći da se uz redak praznine čuva dokument od kojeg rekonstrukcija nastavlja.
- `docs/ARCHITECTURE.md` §6 t. 3 ("rekonstrukcija kreće od kontrolne točke spremljene na kraju praznine"): isto.
- `docs/BACKEND.md` §2 ("ADR u M3, prije koda"): uputa na ovaj zapis.

Ostali zadaci:

- Dopuna plana napada B-8 (issue 155, točke 17 do 21): potpis unutar iste transakcije u demou i poništenje cijelog spremanja kad potpis ne uspije (odluka 6, §5.3 t. 14), te potvrda popisa kodova uzroka praznine za korak s poljem `gap`, koji vlasnik vidi prije koda (odluka 7, §5.5).
- Dopuna plana potvrde v2 (issue 202, napad 5: koji ID transakcije potvrda nosi).
- Preimenovanje ugovora u `src/domain/serverSync/contract.ts`.
- Uklanjanje zasebnog reda zapisa iz `src/application/evidence/evidence-outbox.ts` u korist jednog reda.
