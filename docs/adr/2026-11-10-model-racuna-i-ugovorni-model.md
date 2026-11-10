# ADR: model računa kod AI pružatelja i ugovorni model pravnog angažmana

- **Status:** PRIJEDLOG. Čeka neovisni review i vlasnikove odgovore na otvorena pitanja iz §6 (Owner queue Q-10, rok 15. 12. 2026.; kontrolna točka 30. 11. 2026., D-270 O12). Ovaj dokument ne donosi nove odluke: za svaku sastavnicu navodi što je već odlučeno, opcije s izvorima i posljedice, a izbor ostavlja vlasniku i pravnom mišljenju.
- **Datum:** 10. 11. 2026.
- **Zadatak:** Linear DAN-400, M9.1-P01 (plan rb 129). Samo dokument; ne mijenja kod, migracije ni druge dokumente.
- **Stanje koda:** `main` na `cb4fbde1`.
- **Izvori:** D-194 t. 3, 6, 7, 8 i 9, D-199 t. 2 i 4, D-266 t. 2 i 6, D-267 O1, O5 i O10, D-270 O11 i O12, D-264 Q09 i Q13, D-20, D-74, D-77, D-15, D-23, D-29, D-35, D-38 (`docs/DECISIONS.md`); `docs/PRODUCT.md` §5 pravilo 15 i odjeljak o AI-ju (C-2); `docs/privacy/04-podizvrsitelji-i-atributi-prijave.md`; `docs/privacy/05-otvorena-pitanja.md` A t. 1 i B t. 23 do 28; `docs/PROGRAM-RAZRADA.md` (M9.0-S2, M9.1, M9.2, M9.3); `docs/contracts/ai-request-v1.md` (OA-1, OA-2); `STATE.md` Q-1, Q-3 i Q-10 (#87 c.6639423372).

## 1. Što se odlučuje

D-194 t. 6 predlaže jedan ugovorni model za AI pomoćnika: operater drži institucionalne račune kod AI pružatelja, student ne plaća ništa, a pružatelji su podizvršitelji. Vlasnik ga je prihvatio samo kao prijedlog (#87 c.6544041852: „Slažem se, zapiši kao prijedlog”), a prijedlog ostaje PRIJEDLOG dok ga ne potvrdi pravno mišljenje (D-194 t. 6). D-267 O1 traži da se ta opcija pripremi u ovom ADR-u (M9.1-P01) i ponavlja da to nije odluka. Q-10 traži odluku o t. 6 i t. 7 do 15. 12. 2026. (D-266 t. 6).

Ovaj ADR rastavlja prijedlog na šest sastavnica (§3, A do F). Za svaku navodi što je već odlučeno, opcije s izvorima i posljedice. Izbor pružatelja (D-194 t. 7) ovdje se ne obrađuje, osim kad o njemu ovisi ugovorni model (sastavnica D).

Dok vlasnik ne odluči, vrijedi D-194 t. 9: ništa se ne gradi na t. 6 i t. 7 ako bi njihova promjena bila skupa. Do potvrde t. 6 ne vrijedi ni D-20, a ni zamjena nije odlučena (D-194 t. 6).

## 2. Što je već odlučeno i ovdje se ne otvara

- **D-194 t. 1 i 2**, ODLUČENO 31. 10. 2026.: AI pomoćnik je u pilotu. Isključeni su kineski pružatelji, modeli kineskih tvrtki i obrada na kineskim serverima.
- **D-194 t. 3 uz izmjenu D-266 t. 2 (Q-1 B)**, ODLUČENO 4. 11. 2026.: vlasnik osniva pravnu osobu operatera odmah, usporedno s FPZG-om. Ugovor o obradi potpisuje se prije tehničke probe (D-264 Q13). Ovisi o osnovanoj pravnoj osobi i o odobrenju FPZG-a. Oblik pravne osobe ostaje vlasniku. Raspodjela uloga ulazi u isti pravni angažman kao pravno mišljenje i DPIA (D-194 t. 3).
- **D-194 t. 5**, ODLUČENO: jedno pravno mišljenje i jedna DPIA.
- **D-194 t. 8 i D-199 t. 5**: pravila 1 do 17 iz `docs/PRODUCT.md` §5, Ustav, D-09, D-23 i D-38 se ne mijenjaju.
  - Pravilo 15 glasi: „Student nikad ne mora platiti da bi izvršio obvezu. U pilotu zadatak ne smije zahtijevati AI. (C-2)”.
- **D-29**, ODLUČENO: FPZG je voditelj obrade, Ductus izvršitelj (čl. 28. GDPR-a), a privola nije osnova obrade. Čeka pisanu potvrdu FPZG-a (D-199 t. 4).
- **D-23 i D-35**: dopuštene pružatelje određuje fakultet; FPZG bira s popisa na kojem uz svakog pružatelja stoji zemlja obrade.
- **D-270 O11**, ODLUČENO 5. 11. 2026.:
  - Pružatelji dolaze iz verzionirane konfiguracije `config/faculties`, a popis potvrđuje FPZG (D-23).
  - Administrator ustanove mijenja samo AI pravilo i pragove (D-265 Q18).
- **D-267 O5**, ODLUČENO 5. 11. 2026.: mehanizam granica troška je po `docs/BACKEND.md` §4.5, a prazna konfiguracija znači da je AI isključen. Iznosi slijede nakon mjerenja u M9.1-P03b. Proračun je DAN-445.
- **D-267 O10**, ODLUČENO 5. 11. 2026.: transkripcija i alati pružatelja grade se iza prekidača po ustanovi, isključenog po zadanom.
- **D-199 t. 2**, ODLUČENO 1. 11. 2026. (iznos): proračun pilota je 10.000 EUR bez PDV-a i obuhvaća trošak AI pružatelja.
  - Raspodjela je PRIJEDLOG i NEPROVJERENA (AI pružatelji oko 2.000 EUR).
- **D-270 O12**, ODLUČENO 5. 11. 2026.: ako do 30. 11. 2026. nema odluke o modelu računa i pružatelju, stvarni dio M9.2 se ne počinje. M9 ostaje u valu 1.

## 3. Sastavnice prijedloga D-194 t. 6

### A. Uloge u obradi i razina ugovora o obradi

Uloge su odlučene u D-29: fakultet je voditelj obrade, Ductus izvršitelj. D-194 t. 6 dodaje razinu ugovora: ugovor o obradi „sa svakom ustanovom (ili sa sveučilištem za njegove sastavnice)”.

| Opcija | Izvor | Posljedica |
|---|---|---|
| A1. Ugovor o obradi sa svakom ustanovom | D-194 t. 6, D-29 | Za pilot je to jedan ugovor s FPZG-om. Svaka nova sastavnica traži novi ugovor i svoju potvrdu popisa podizvršitelja (D-23). |
| A2. Ugovor o obradi sa sveučilištem za njegove sastavnice | D-194 t. 6 | Manje ugovora za sastavnice istog sveučilišta. Treba odgovor tko na sveučilištu potpisuje i odobrava podizvršitelje; izvori to ne navode. |

D-29 čeka pisanu potvrdu FPZG-a (D-199 t. 4). Pitanje 2 iz `docs/privacy/05` A ostaje `[Ustanova]`.

### B. Ugovorna strana na strani operatera

D-194 t. 6 kaže da je ugovorna strana pravna osoba operatera (npr. d.o.o.), ne fizička osoba. D-266 t. 2 odlučuje da se ta pravna osoba osniva odmah, a njezin oblik ostavlja vlasniku. `docs/privacy/05` A t. 1 navodi moguće oblike: obrt, trgovačko društvo ili ustanovu kao ugovornu stranu. `STATE.md` (stavka Računovođa) bilježi da je FINA potrebna tek uz obrt ili uz FPZG kao ugovornu stranu.

| Opcija | Izvor | Posljedica |
|---|---|---|
| B1. Trgovačko društvo (npr. d.o.o.) | D-194 t. 6 | Odgovara primjeru iz prijedloga. Oblik i PDV određuje vlasnik uz računovođu (D-199 t. 2, `STATE.md`). |
| B2. Obrt | `docs/privacy/05` A t. 1, `STATE.md` | D-194 t. 6 kaže „ne fizička osoba”. Je li obrt pravno dovoljan kao ugovorna strana, pitanje je za pravno mišljenje. |

Rok za Q-1 je 13. 11. 2026. (`STATE.md`). Ovaj ADR ne bira oblik.

### C. Tko drži račune kod AI pružatelja

Ovo je jezgra pitanja modela računa (D-267 O1). U izvorima postoje tri modela.

| Opcija | Izvor | Posljedica |
|---|---|---|
| C1. Operater drži institucionalne račune i ugovore o obradi s pružateljima | D-194 t. 6, D-267 O1 (PRIJEDLOG) | Trošak je trošak operatera. Popis podizvršitelja vodi operater, a potvrđuje ga fakultet (D-23, D-270 O11). Ključ pružatelja je tajna operatera, a ne korisnika. |
| C2. Student drži vlastiti račun kod posrednika i plaća | D-20 (bio PRIJEDLOG, pod preispitivanjem D-194 t. 6) | D-77 navodi da osobni OpenRouter računi ne mogu jamčiti obradu u EU. D-194 t. 6 kaže da student ne plaća ništa. Tajne bi bile tajne korisnika, kako ih opisuje D-74 (AES-256-GCM s AAD-om koji uključuje korisnika). |
| C3. Fakultet osigurava ključ ili račun | `docs/PRODUCT.md`, odjeljak o AI-ju (C-2), za kasniji obvezni AI; D-199 t. 4 (pokriva li FPZG dio troška) | Izvori ga navode samo za kasniji obvezni AI, ne za pilot. Za pilot ga nijedna odluka ne predlaže. Izvori ne opisuju kako bi se takvi računi vodili. |

U pilotu zadatak ne smije zahtijevati AI (pravilo 15, D-38), pa pravilo 15 samo po sebi ne isključuje C2. C2 isključuje tek prijedlog t. 6 („student ne plaća ništa”) ako ga vlasnik potvrdi.

### D. Pružatelji kao podizvršitelji

D-194 t. 6 predlaže podizvršitelje s unaprijed odobrenim popisom i obvezom najave promjena. `docs/privacy/04` kaže da AI pružatelj postaje podizvršitelj i ulazi u popis tek kad ga ustanova odobri (čl. 28. st. 2. GDPR-a). Nijedan još nije izabran ni ugovoren. Redak AI pružatelja ondje ima status „PRIJEDLOG, D-194 t. 6 i 7”.

| Opcija | Izvor | Posljedica |
|---|---|---|
| D1. Operater ugovara izravno s pružateljem | D-194 t. 6 i 7 (Mistral: EU ugovorna strana) | U lancu podizvršitelja je jedna karika po pružatelju. |
| D2. Model se dohvaća preko platforme treće strane | D-194 t. 7 (Claude preko AWS Bedrocka s EU profilom) | Izvori ne kažu je li platforma, razvijač modela ili oboje podizvršitelj. To je pitanje za pisane odgovore pružatelja (D-194 t. 7) i za pravno mišljenje (`docs/privacy/05` t. 24). |
| D3. Posrednik prema više pružatelja | D-20, `docs/privacy/05` t. 24 | D-194 t. 7 kaže da OpenRouter nije izabran. `docs/privacy/05` t. 24 pita je li posrednik dodatni podizvršitelj. |

Za pilot D-194 t. 7 predlaže najviše dva pružatelja. Popis potvrđuje FPZG (D-23, D-35, D-270 O11). Isključenja iz D-194 t. 2 vrijede u svakoj opciji.

### E. Tko plaća trošak AI-ja

D-194 t. 6 predlaže da trošak AI-ja ulazi u cijenu usluge, a student ne plaća ništa (C-2). D-199 t. 2 stavlja trošak AI pružatelja za pilot u proračun od 10.000 EUR bez PDV-a. Raspodjela je PRIJEDLOG: oko 2.000 EUR za AI, NEPROVJERENO. D-199 t. 4 pita FPZG može li pokriti dio troška. Granice troška slijede D-267 O5.

| Opcija | Izvor | Posljedica |
|---|---|---|
| E1. Operater snosi trošak u pilotu iz proračuna pilota | D-199 t. 2 | Iznos je ograničen granicama troška (D-267 O5). Bez konfiguracije AI je isključen. |
| E2. Trošak je dio cijene usluge koju plaća ustanova | D-194 t. 6 | Ovisi o ugovoru o usluzi i odgovoru FPZG-a (D-199 t. 4). Izvori ne kažu plaća li FPZG uslugu u pilotu. |
| E3. Student plaća svoj račun | D-20 | Protivno prijedlogu t. 6. Vidi C2. |

### F. Pilot i okvirni ugovor za visoko obrazovanje

D-194 t. 6 predlaže izravan ugovor operatera s FPZG-om za pilot (ugovor o usluzi i ugovor o obradi). Usporedno ide okvirni ugovor ili nabava preko ministarstva ili središnjeg tijela (npr. SRCE ili CARNET), kojem ustanove pristupaju svojim ugovorom o obradi. Opseg pitanja je cijelo visoko obrazovanje u Hrvatskoj (c.6544013247 t. 2). Pilot je samo na FPZG-u (D-15).

| Opcija | Izvor | Posljedica |
|---|---|---|
| F1. Samo izravni ugovori po ustanovi | D-194 t. 6 (dio za pilot) | Za pilot je dovoljan FPZG. Širenje znači ugovor po ustanovi (A1). |
| F2. Izravni ugovor za pilot, okvirni ugovor usporedno | D-194 t. 6 | Okvirni ugovor ne utječe na pilot. Oblik nabave i nositelj nisu određeni. |

`docs/privacy/05` t. 23 pita mijenja li model računa D-15. Prijedlog t. 6 pilot drži na FPZG-u.

## 4. Što ovisi o modelu računa

- **M9.2 (DAN-401):** posrednik prema pružatelju, ograničenje troška i „tajne po modelu računa koji se odluči” (`docs/PROGRAM-RAZRADA.md`, redak M9.2; D-74). U C1 tajna je ključ operatera. U C2 to su tajne korisnika iz D-74. U C3 to su ključevi po ustanovi. M9.2 čeka M9.1 (D-194 t. 9, D-270 O12).
- **M9.0-S2:** port prema pružatelju i sintetički adapter. Stvarni adapter dolazi tek nakon M9.1-P04 (D-267 O1, `docs/PROGRAM-RAZRADA.md`).
- **`docs/contracts/ai-request-v1.md`:** ne gradi tablicu ključa pružatelja ni stvarni adapter. Model računa i iznosi ostaju otvoreni (OA-1, OA-2).
- **M9.3 (DAN-402):** popis pružatelja po fakultetu i zadatku iz `config/faculties` (D-270 O11). Ne ovisi o tome tko drži račun, ali ovisi o izboru pružatelja (D-194 t. 7).
- **`docs/privacy/04`:** redak AI pružatelja popunjava se kad pružatelj bude izabran i ugovoren (D-194 t. 9).
- **`docs/privacy/05`:** A t. 1 i B t. 23 do 28. Rok za t. 23 do 28 je 15. 1. 2027. (Q-10).
- **D-20 i D-74:** status D-20 ostaje „pod preispitivanjem” dok vlasnik ne odluči (D-194 t. 6).
- **Paket za FPZG (Q-3, D-264 Q09):** sadrži pitanja o ugovoru s pravnom osobom operatera, o D-29 i o dijelu troška (D-199 t. 4).

## 5. Neskladi u izvorima (ostaju otvoreni)

Ovaj ADR nesklade ne razrješava. Bilježi ih da ih vlasnik ili zaseban docs PR uskladi.

- **Nesklad A.** `docs/privacy/05` A t. 1 kaže da vlasnik osniva pravnu osobu „kad prvi fakultet odobri pilot”. D-266 t. 2 (Q-1 B) to je promijenio u „odmah, usporedno s FPZG-om”. `STATE.md` Q-1 slijedi D-266.
- **Nesklad B.** Redak M9.2 u `docs/PROGRAM-RAZRADA.md` i D-74 navode `provider.only`. D-74 sam navodi da je to pojam OpenRoutera. D-194 t. 7 kaže da OpenRouter nije izabran.
- **Nesklad C.** Status D-74 nije usklađen:
  - `STATE.md` vodi D-74 među odlučenima, a zapis D-74 počinje s „Potvrđeno 10. 10. 2026.”.
  - Redak M9.2 u `docs/PROGRAM-RAZRADA.md` kaže „D-74 pod preispitivanjem”.
  - Tajne korisnika iz D-74 odgovaraju modelu C2, a ne prijedlogu C1.
- **Nesklad D.** D-194 t. 6 stavlja trošak AI-ja u cijenu usluge (E2). D-199 t. 2 stavlja ga u proračun pilota operatera (E1). Izvori ne kažu vrijedi li E2 i za pilot.

## 6. Otvorena pitanja za vlasnika

Pitanja nemaju preporuku. Odgovor bira vlasnik, uz pravno mišljenje gdje ga D-194 t. 6 traži.

- **O1 (C).** Tko drži račune kod AI pružatelja u pilotu: operater (C1), student (C2) ili fakultet (C3)? Potvrđuje li vlasnik prijedlog D-194 t. 6 ili čeka pravno mišljenje?
- **O2 (D-20).** Ako se C1 potvrdi, je li D-20 zamijenjen ili ukinut, i kojom odlukom?
- **O3 (B).** Koji je oblik pravne osobe operatera (D-266 t. 2; Q-1, rok 13. 11. 2026.)?
- **O4 (A).** Potpisuje li se ugovor o obradi po ustanovi (A1) ili po sveučilištu za sastavnice (A2), i tko ga potpisuje na strani FPZG-a?
- **O5 (D).** Kad se model dohvaća preko platforme treće strane (D2), tko je podizvršitelj i tko je ugovorna strana? Pitanje ide uz pisane odgovore pružatelja (D-194 t. 7) i `docs/privacy/05` t. 24.
- **O6 (D).** Kako izgleda obveza najave promjene popisa podizvršitelja: rok najave i pravo ustanove na prigovor? D-194 t. 6 je navodi, a ne određuje.
- **O7 (E).** Plaća li FPZG uslugu ili dio troška AI-ja u pilotu (D-199 t. 4), ili trošak u pilotu snosi operater iz proračuna (D-199 t. 2)?
- **O8 (E).** Je li iznos za AI unutar proračuna od 10.000 EUR (PRIJEDLOG oko 2.000 EUR, NEPROVJERENO) dovoljan nakon mjerenja u M9.1-P03b (D-267 O5, DAN-445)?
- **O9 (F).** Pokreće li vlasnik okvirni ugovor ili nabavu preko ministarstva ili središnjeg tijela, i kada? Mijenja li to D-15 (`docs/privacy/05` t. 23)?
- **O10 (§5).** Usklađuju li se neskladi A do D jednim docs PR-om (npr. uz Q-18) ili posebno?

## 7. Posljedice ovog ADR-a

Prihvaćanje ovog ADR-a ne znači odluku o t. 6 ni t. 7. Znači samo da su sastavnice, opcije i otvorena pitanja zapisani na jednom mjestu za odluku do 15. 12. 2026. (Q-10).

Dok vlasnik ne odgovori na O1 i pružatelj ne bude izabran, nastavlja se samo rad neovisan o pružatelju (D-270 O12):
- port i sintetički adapter (M9.0-S2);
- mehanizam granica troška s praznom konfiguracijom (D-267 O5);
- prekidači isključeni po zadanom (D-267 O10).
