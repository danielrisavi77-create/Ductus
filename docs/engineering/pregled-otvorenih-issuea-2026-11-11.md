# Pregled otvorenih GitHub issuea (DAN-451)

Snimka: 11. 11. 2026. Izvor: REST popis otvorenih issuea (bez PR-ova), povezani PR-ovi (`Closes #N`, DAN oznake u naslovima PR-ova) i provjera na `main`. Ovaj dokument samo predlaže: ništa nije zatvoreno ni prelabelirano, a konačnu odluku donosi orkestrator ili vlasnik. Risk: low (samo dokument).

## Sažetak

- Otvoreno je **190 issuea, nijedan nema nositelja** (assignee); posao se vodi labelama i Linearom, pa „bez nositelja” ovdje ne znači „nitko ne radi na tome”. Aktivnu sesiju pokazuje labela `claude:in-progress` (3 issuea: #1880, #1889, #1893).
- Prijedlog po stanju (točne brojke nisu izračunate, retke u tablicama treba čitati kao prijedlog):
  - **Riješeno ili zastarjelo** (zatvoriti uz komentar nakon potvrde u Linearu): većinom jednokratni „Plan napada” issuei čiji su zadaci spojeni, neovisni planovi #1479 do #1482, #1490 i #1491, te stari planski issuei iz listopada (#73 do #78, #325 do #338 i #341, osim #334). Točni popisi su u sekcijama 2 i 6; ostali issuei iz tih raspona (npr. #1486, #1488, #1489, #339, #340, #342) ostaju.
  - **Vrijedi, ima Linear vezu** (DAN-xxx iz naslova ili tijela): UX M4 do M8 (DAN-501, 502, 509, 599, 602), planovi napada za buduće korake i aktivni zadaci platforme.
  - **Vrijedi, nema Linear vezu**: nekoliko issuea (npr. #1880, #1894, #1503, #1345, #449); za njih je predložen novi DAN tiket ili spajanje u postojeći.
  - **Trajni pokazivači, ne zatvarati**: #87, #271, #152, #835, #1836, #1873.
- Najveći klaster: **51 UX issue** za M4 do M8 (naslovi „UX M4” do „UX M8”). Svi vrijede dok se pripadni milestone ne gradi; predlažem da ostanu otvoreni pod jednim nadređenim DAN tiketom po milestoneu (509, 502, 501, 599, 602) i da se ne otvaraju pojedinačni tiketi.
- Provjera „na mainu” je ograničena: gdje nisam mogao potvrditi stanje u kodu, piše **nejasno** umjesto pogađanja. Redak „riješeno” temelji se na spojenom PR-u koji je naveden u retku; gdje taj PR nosi drugu DAN oznaku ili je veza posredna, redak je označen N.

Oznake stanja: **R** riješeno na mainu, **Z** zastarjelo (zamijenjeno novijim issueom ili odlukom), **V** vrijedi, **N** nejasno (treba pogled vlasnika zadatka).

## 1. Trajni pokazivači (ne zatvarati)

| Issue | Opis | Stanje | Prijedlog |
|---|---|---|---|
| #87 | Koordinacija, odluke vlasnika | V | Bez promjene; veza DAN-47/64/71/72 već u tijelu. |
| #271, #152, #835 | Botovi: dnevni pregled, dnevna snimka dema, Tehničar prijedlozi | V | Bez promjene; #152 veza DAN-124. |
| #1836, #1873 | Oblak: izvještaji sesija i dnevni poslovi | V | Bez promjene. |

## 2. Platforma, CI i alati

| Issue | Opis | Stanje | Prijedlog |
|---|---|---|---|
| #1951, #1930 | Kanarinac smoke testa iznad praga gitleaksa | V | DAN-701; PR #1954 je otvoren. Ostaje do spajanja. |
| #1902 | Nestabilni testovi na mainu | V | DAN-702; zadržati. |
| #1869, #1868 | PR metapodaci i Squawk na pre-pushu | V | DAN-692, DAN-691; #1869 ima `ready-for-claude`. |
| #1880, #1889, #1893 | Alati za sesije, audit čitljivosti, vodič forensics | V | U radu (`claude:in-progress`): DAN-696, DAN-698; #1880 nema DAN, predlažem novi tiket. |
| #1823, #1826 | Proces workera (DAN-517 ostatak) i plan napada | V | DAN-517; spojeni PR-ovi #1829, #1720 pokrivaju dio. Provjeriti ostatak (N). |
| #1843 | Plan napada DAN-381 M7.0-S1 | V | DAN-381; zadržati dok M7 nije gotov. |
| #1671 | Plan napada DAN-574 PR B | N | PR-ovi #1672 do #1674 spojeni; vjerojatno R, potvrditi u Linearu. |
| #1597 | Plan napada DAN-435 paket spikes/docx-provenance | R | #1600, #1606, #1610 spojeni; zatvoriti uz DAN-435. |
| #1183 | Priprema staginga i produkcije (B0.x) | V | DAN-298/299/71; #1691 spojen, ostatak čeka račune (Owner queue Q-2). |
| #1146 | Sigurnost F-024 (M0.6, DAN-162) | R | #1169 spojen; zatvoriti kad Sigurnost potvrdi status. Detalji nikad u repo. |
| #1085, #1053 | Čišćenje riječi demo, preimenovanje (DAN-434) | N | #1566, #1567 spojeni (val 2 je u #1053); #1085 nema DAN. Provjeriti `grep -ri demo` prije zatvaranja. |
| #1042 | Brži pre-push test (DAN-433) | N | DAN-361/433; #993, #994 spojeni; provjeriti trajanje pre-pusha. |
| #998 | Orkestrator: nalog za review i QA iz skripte | N | Tijelo traži posao nakon DAN-370, #993 i #994; #1003 samo dodaje OSV iznimke. Provjeriti postoji li skripta na mainu. |
| #988, #987, #985 | DAN-368 plan napada (PR 1, PR 2) i izvještaj | N | #993 i #994 nose DAN-361, ne DAN-368; izvještaj #985 kaže da implementacija nije dovršena. Provjeriti prije zatvaranja. DAN-9001/9002 u tijelu su probni, ne tiketi. |
| #946 | Login E2E: uzroci padova 25. do 27. 10. | R | DAN-348; PR-ovi #919 do #940 spojeni. |
| #930, #929, #928 | Vizualne referentne slike, podjela kataloga tekstova, preflight pisca | N | Nemaju DAN; `pnpm orch:preflight` postoji (#928 vjerojatno R). Predlažem zatvoriti #928, a #929 i #930 provjeriti. |
| #853 | Dnevna provjera sažetaka botova (DAN-339) | V | Zadržati. |
| #852, #473, #472 | Trijaža: pravilo postotka, Risk po putanji, `check:pr-metadata` | V | DAN-340/134, DAN-219, DAN-137/218. `check:pr-metadata` ne postoji u `package.json`; #472 vrijedi, a #1869 je njegov nasljednik (spojiti). |
| #474 | Dokument: Akt o UI nije visokorizičan | V | DAN-220; dokument nije na mainu. |
| #1503, #1340 | Skener oznaka skip/todo/only i RPC inventory skener | V | #1340 ima DAN-487 (#1305 spojen, nedostatak opisan u issueu ostaje). #1503 nema DAN: predložiti novi. |
| #1345 | Odgovori grešaka na isključenim statičkim putanjama bez CSP-a | N | `middleware.ts` komentar i `next.config.ts` `headers()` sada daju statičku politiku; vjerojatno R, treba test. Nema DAN. |
| #1481, #1482, #1480, #1479, #1491, #1490 | Neovisni planovi (DAN-515, 168, 232, 511) | R | #1469, #1453, #1458, #1456, #1444 spojeni; zatvoriti. |
| #1546 | Odjava ne visi dok slanje čeka (DAN-571) | V | DAN-571; #1444 je spojen samo za DAN-511. |
| #681 | Shadow Integration Lab (DAN-269) | N | #632 je DAN-268 (Contract Radar), ne ovaj posao; jedini DAN-269 PR #684 zatvoren je bez spajanja, `orch:shadow` nije u `package.json`. Vjerojatno vrijedi. |
| #624, #623, #621, #620 | Token V2 i Workflow B (DAN-275 do 278) | Z | Bez spojenog PR-a; #1880 ih ne spominje, pa je zamjena tumačenje. Predlažem zatvoriti uz Linear. |
| #626 | Izvještaj DAN-280: katalog 78 ideja | Z | Push je bio blokiran; sadržaj nije na mainu (N). Pitati vlasnika tiketa. |
| #602 | Mjerenje login E2E (DAN-262) | N | PR-ovi #606 i #628 zatvoreni bez spajanja; #946 je analiza uzroka padova, ne mjerenje. Odlučiti je li posao napušten. |
| #749 | Health/readiness (DAN-299) | N | #1691 spojen; provjeriti graceful shutdown. |
| #761 | Testovi auth/flow.ts i oidc.ts (DAN-307) | N | #1084 (DAN-307) spojen 1. 11. 2026., vjerojatno riješeno; provjeriti pokrivenost i ugovorni test. |
| #355 | Testno okruženje za Independent QA (DAN-205) | N | Čeka račune (Q-2); zadržati. |
| #301 | orch:health U2, U3 (DAN-139) | N | #198 spojen; ostatak nejasan. |
| #58, #54 | Jedan pisac po grani; Firefox/WebKit matrica | N | #58 pokriva WORK-GUARD; #54 djelomično (#1046, #1776 su WebKit). Bez DAN. |
| #1046, #1776 | WebKit E2E padovi i nestabilni login | V | #1046 DAN-114, ima `ready-for-claude`; #1776 spojiti s DAN-702 (#1902). |

## 3. Backend i baza (planovi napada i zadaci)

| Issue | Opis | Stanje | Prijedlog |
|---|---|---|---|
| #1911 | Plan napada DAN-436 M8.0-S1 | V | #1913 spojen, #1914 otvoren; zadržati do spajanja. |
| #1894 | Bug: ponovni pregled prikazuje nastavnikovu uputu kao studentovu | V | Nema DAN: predložiti novi tiket (bug, area:db/ui). |
| #1808 | Plan napada DAN-420/597 | V | Nema PR-a; zadržati. |
| #1778 | Plan napada DAN-594 idempotentno slanje | V | Nema PR-a; zadržati. |
| #1711, #1659, #1635, #1258 | Plan napada shema dokumenta v2 (DAN-453, 589, 583) | N | #1264 spojen (V11 shema); M5.0-S1 i M9.0-S1 su novi koraci. #1258 vjerojatno R. |
| #1667 | Plan napada DAN-297 ugovor brisanja | N | #1730, #1738 spojeni; potvrditi je li S1 gotov. |
| #1664, #1662 | Plan napada DAN-401 M9.0-S2/S3 | N | #1679, #1697 spojeni; potvrditi opseg. |
| #1592, #1408, #1181 | A-02 uloga nastavnika, administrator u ljusci, afilijacija | N | DAN-581/313/304; spojeni #1311, #1316, #1450, #1644, #1256. #1181 vjerojatno R. |
| #1552 | /zadatak/[id] granica učitavanja bez noncea (ostatak DAN-570) | N | #1553 spojen; ostatak provjeriti. |
| #1532 | Klase podataka DATA-CLASS (DAN-539) | N | #1238, #1253, #1828, #1830 spojeni; potvrditi je li ostalo što. |
| #1507 | Omotnica commita prihvaća duplicirani ključ (N-19) | N | Ima oznaku `question`; DAN-320, #1875 spojen. Provjeriti je li pitanje odgovoreno. |
| #1506 | Trajni automat dorade (DAN-266/314) | V | Nema PR-a; #1840 (DAN-314) zatvoren je bez spajanja. |
| #1505, #1502, #1432 | policy_version, otisak obavijesti, lanac ključa (DAN-315, 442) | R | #1509, #1510, #1619, #1627, #1447 spojeni; zatvoriti uz potvrdu. |
| #1489, #1488 | Prijedlozi izmjena (DAN-419), čitanje snimki (DAN-293) | N | #1488 vjerojatno R (#1807, #1824, #1827, #1925 spojeni); #1489 V. |
| #854 | D-173 provjerljiv izvozni paket (DAN-341) | N | #787, #791, #793 spojeni; potvrditi. |
| #449 | B9 load test | V | Bez DAN: predložiti novi tiket (M0/GO). |
| #385 | Plan napada B-12 + F-10 (DAN-87) | R | Brojni PR-ovi spojeni; zatvoriti. |
| #242, #241 | Plan napada stavke 0.5 i 0.2 | Z | Iz početka listopada, prije M0 jezgre; bez DAN. Predlažem zatvoriti. |
| #76, #74 | E4 Evidence, E2 Policy | N | Epici bez DAN; zamijeniti Linear projektima. |
| #320, #319, #318, #316 | Spike i odluka: uvjetovana valjanost pregleda | N | Odluka D-45 i nasljednici postoje; zatvoriti ili povezati s DAN-316. |

## 4. Prijava, sinkronizacija i sučelje (jedinični issuei)

| Issue | Opis | Stanje | Prijedlog |
|---|---|---|---|
| #1235, #1234, #1232 | Zaslon prijave: pomoć, poruka „Prijava je istekla”, stranica pogreške | V | DAN-450; nema spojenog PR-a. |
| #1374, #1341 | DAN-343: Ctrl+A citira, test polja „Stranica navoda” | N | #866, #896, #904 spojeni; provjeriti postoje li regresijski testovi. |
| #1347 | Označavanje odlomka za komentar tipkovnicom | V | DAN-86; zadržati uz M6. |
| #1284, #1283, #1282, #1281 | UX M2: Brz put, početna nastavnika, zadatak, popis zadataka | N | DAN-479, #1351 spojen; provjeriti koji nalazi još vrijede. |
| #1486 | M5.3 numerirani naslovi (DAN-395) | N | #1636, #1640 spojeni; vjerojatno R. |
| #1896 | Opažanja Bug Huntera 11. 11. | V | DAN-428/553; za Product/UX. |
| #923 | Archivum, svi ekrani (DAN-344) | N | Više PR-ova spojeno; praćenje. |
| #960 | Dizajn: jedan mjerodavni dokument | R | D-188 i `docs/design/DESIGN-SYSTEM.md` postoje; zatvoriti. |
| #956, #954, #953, #951 | Početna stranica i editor (DAN-347, 353, 354, 355) | N | Bez spojenog PR-a po DAN oznaci; provjeriti u Linearu. |
| #871 | Demo korak 2: citat i bibliografija bez unosa u sučelju | Z | Citiranje (DAN-343) je naknadno građeno; provjeriti. |
| #397 | AI pomoć nastavniku nakon demoa | Z | Izvan vala 1; D-194, Q-10. Pridružiti DAN za M9. |
| #417 | Čitljivost koda nakon demoa | Z | Zamijenjeno #1889 i #1893 (DAN-696, 698). Zatvoriti. |
| #79 | GOV: Ustav i odobreni mockup | Z | Ustav v1.4 i D-188 vrijede; zatvoriti. |

## 5. UX klasteri (M4 do M8)

Svi vrijede dok se pripadni milestone ne gradi; stanje svakog nije posebno provjeravano u kodu, jer pripadni ekrani još nisu na mainu (provjera `app/` i `docs/design/EKRANI.md`).

| Issue | Klaster | Stanje | Linear |
|---|---|---|---|
| #1380, #1381, #1383, #1385, #1387, #1389, #1391 | M4 S-11 Panel Upute, stanja i A-04 | V | DAN-501 |
| #1382, #1384, #1386, #1388, #1390, #1392, #1393, #1394, #1395 | M5 stanja kartica, fokus, vodič | V | DAN-502 |
| #1419 do #1430 | M6 komentari, prijedlozi, obavijesti, reproduktor | V | DAN-509 (#1429 i DAN-422) |
| #1779 do #1790 | M7 predaja i pregled | V | DAN-599 (#1784 DAN-312, #1786 DAN-384) |
| #1792 do #1802 | M8 uvoz i izvoz | V | DAN-602 (#1793 DAN-242/396, #1795 DAN-438/440, #1796/1799/1800 DAN-316/341/398/399, #1801 DAN-441) |

Napomena: #1793, #1796, #1799, #1800 imaju spojen PR (#1851, #1863, #1867, #1892) pod istom DAN oznakom, pa vjerojatno dio nalaza već vrijedi kao riješen (N). #1798, #1801 su odlučeni (D-281 do D-287, Owner queue) i čekaju samo gradnju.

## 6. Stari planski issuei (listopad)

| Issue | Opis | Stanje | Prijedlog |
|---|---|---|---|
| #73 do #78 | Epici E1 do E6 | Z | Zamijenjeni programom M0 do M11 (D-191) i Linear projektima. Zatvoriti uz komentar. |
| #325 do #338, #341 (osim #334) | UI issuei po ekranima iz 13. 10. | Z | Zamijenjeni `docs/design/EKRANI.md` i UX M-klasterima iz sekcije 5. Predlažem skupno zatvaranje uz popis. #339 (UX-EVAL) i #342 (rječnik) zadržati dok se ne ponovi evaluacija. |
| #340 | Feature flagovi vala 2/3 | N | Pitati vlasnika; nema DAN. |

## Prijedlog sljedećeg koraka

1. Orkestrator potvrdi klastere označene R i Z u Linearu, a zatim ih zatvori uz komentar (ova sesija ne zatvara).
2. Za oko 20 issuea bez DAN-a (#1880, #1894, #1503, #1345, #449, #1085 i dr.) otvoriti ili pridružiti tiket.
3. Za retke označene N vlasnik zadatka u Linearu potvrdi je li ostalo što.
4. Ponoviti pregled nakon zadnjeg spajanja iz M0 audita; ovaj dokument je datirana snimka, ne registar.
