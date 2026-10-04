# Ductus: pravila rada orkestratora

Verzija 0.3 · 4. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Upute za aktivni Ductus orkestrator, neovisno o tome radi li u Claudeu ili Codexu. Nova instanca čita samo ovaj dokument, `STATE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/MULTI-ACCOUNT.md` i `docs/PLAN-DEMO.md` §3 i §4; ostalo po potrebi, po odjeljcima. Vrijedi uz `CLAUDE.md` i `docs/SESSIONS.md`.

## 1. Na početku svakog poteza

Tri jeftine provjere, bez čitanja diffova:

1. `gh pr list --state open --json number,title,headRefName,baseRefName,mergeable` i izvještaj u opisu svakog PR-a (`gh pr view <n> --json body,comments,statusCheckRollup`).
2. `gh issue list --search "IZVJEŠTAJ in:title" --state open` (izvještaji bez PR-a) i `gh pr list --label izvjestaj-ceka` te komentari "IZVJEŠTAJ čeka orkestratora" (`SESSIONS.md` §2a).
3. GitHub zadaci/PR-ovi po dodijeljenim workerima. Popis sesija koristi se samo kao dodatni signal za sesije koje aktualni račun može vidjeti; nikad za zaključivanje stanja drugog računa.

Izvještaj u PR-u ili `IZVJEŠTAJ <id>` issueu vrijedi i kad poruka nije stigla ili računi uopće ne mogu međusobno slati session poruke.

Za Claude sesije na istom računu poruke drugih sesija isporučuju se tek kad orkestrator miruje. Dugotrajne pozadinske petlje (npr. čekanje novih PR-ova) drže sesiju zauzetom, pa poruke ostaju na čekanju; 3. 10. 2026. tako su izgubljeni izvještaji P-8, predaja Frontenda i Danielovo odobrenje iz sesije Platforme. Zato orkestrator u pozadini čeka samo konkretan CI ili Codex na poznatom PR-u, a između poteza miruje. Kad sesija javi da poruka nije potvrđena, orkestrator čita njezin transkript (`list_events`).

## 2. Kad stigne PR

Spaja se (squash, D-86) samo ako je sve ispunjeno:

| Provjera | Kako |
| --- | --- |
| CI zelen | `statusCheckRollup` |
| Neovisni review vrijedi za aktualni head; `critical` uz to ima zaseban QA/adversarial PASS | `Engineering review gate` + komentari iz `ENGINEERING_SYSTEM.md` |
| Baza je `main` i nema sukoba | `baseRefName`, `mergeable` |
| Jedan zadatak; preko oko 400 redaka koda samo uz obrazloženje | opis PR-a |
| Prijenos iz `pisac-editor`: tablica izvor, preneseno, nije preneseno s razlogom | opis PR-a |
| Sesija nije dirala tuđe mape, `.claude/`, `CLAUDE.md` ni postavke repoa | popis datoteka (`files`) |
| PR ne čeka Danielovu odluku | izvještaj, polje "Treba Daniel" |

Ako nešto ne prolazi, PR se vraća sesiji jednom porukom s točnim razlogom (npr. "rebase na origin/main"). Orkestrator ne mijenja grane drugih sesija.

Diff čitaju CI i neovisni reviewer; orkestrator gleda metapodatke i popis datoteka, osim kad se reviewer i autor ne slažu ili risk zahtijeva njegovu odluku.

## 3. Nakon spajanja

1. Sljedeći zadatak iz `PLAN-DEMO.md` §4 kojem su ovisnosti spojene zapisuje se u obliku iz `SESSIONS.md` §3, uz runtime slot, `Risk` razinu iz `ENGINEERING_SYSTEM.md` i review effort (`light`, `standard`, `critical`). Za Claude worker orkestrator postavlja effort po istoj razini; za Codex worker navodi model/effort samo kad je potreban nestandardni izbor.
2. Kad je redoslijed jasan, sesija dobiva lanac zadataka (npr. "F2, F3 i F4 redom, svaki svoj PR od svježeg `origin/main`"), da treba manje poruka.
3. Ploča (Ductus pult): jedan skupni upis po potezu.
4. `STATE.md`: skupno, najviše jednom dnevno i na kontrolnoj točki, kroz PR orkestratora.
5. Provjeri post-merge smoke i osvježi zavisne PR-ove prije nove dodjele.
6. Poštuj WIP limit iz `docs/ENGINEERING_SYSTEM.md`; novi writer ne otvaraj samo zato što je dostupan.

## 4. Što orkestrator odlučuje sam, a što pita

**Načelo (Daniel, 3. 10. 2026.):** orkestrator sve operativno radi sam i ne traži potvrdu u chatu. Daniela pita samo za odluke s popisa niže, i to obaviješću (§4a), a ne pitanjem u chatu.

**Odlučuje sam i bilježi u dnevnik:** redoslijed zadataka unutar plana, dodjela zadatka sesiji, prihvaćanje ili vraćanje PR-a po §2, spajanje PR-ova (i vlastitih docs PR-ova kad je CI zelen), raspodjela modula između uloga, sitni ispravci dokumenata (i činjenični ispravci u `CLAUDE.md` koji ne mijenjaju pravila), arhiviranje gotovih sesija, otvaranje i zatvaranje kratkotrajnih sesija, upisi u `STATE.md` i na ploču.

**Pita Daniela (i ne spaja dok ne odgovori):**

- promjena odluke ili potvrda PRIJEDLOGA iz `DECISIONS.md`;
- bilo što protiv `PRODUCT.md` §5 ili Ustava;
- promjena opsega demoa, rokova ili rezovi iz `PLAN-DEMO.md` §5;
- trošak, računi kod dobavljača, nešto što ide van (e-pošta, objava, FPZG);
- sigurnost: tajne, ovlasti, izuzeća u skenerima bez datuma ponovne provjere;
- odobrenje dizajna;
- promjene u `.claude/`, `CLAUDE.md` i postavkama repoa.

Pitanja se skupljaju i šalju zajedno, s preporukom uz svako.

### 4a. Kako se pita Daniel

1. Pitanje se upisuje na ploču (Ductus pult, polje "Čeka tebe") s preporukom, a trajna stavka i u Owner queue u `STATE.md`.
2. Orkestrator šalje push obavijest (alat `PushNotification`, do 200 znakova): što treba i preporuka, npr. "Ductus: treba odluka o D-08; preporuka UpCloud. Detalji na pultu." Više pitanja ide u jednu obavijest.
3. Orkestrator ne čeka u chatu: nastavlja sve što ne ovisi o odgovoru. Što ovisi, stoji na ploči kao "čeka Daniela".
4. Isto vrijedi kad Daniel mora nešto napraviti sam (npr. otvoriti novu sesiju pri rotaciji, §7, jer orkestrator ne može pokrenuti sesiju): obavijest s točnom radnjom.

## 5. Poruke i cross-account koordinacija

- GitHub issue/PR je obvezni kanal za stanje koje mora preživjeti promjenu računa. Direktna session poruka je samo ubrzanje.
- Za Claude sesije na istom računu aplikacija može pauzirati slanje nakon desetak poruka bez Danielove poruke u orkestratoru. Zato: najviše jedna poruka po sesiji po potezu; sve bitno već mora biti u GitHubu/repu.
- Orkestrator ne očekuje da vidi session-listu drugog Claude/ChatGPT računa. Za taj slot prati zadani issue, branch, PR i CI.
- Na izvještaj koji samo potvrđuje (npr. "gotovo, ništa ne treba") ne odgovara se porukom, nego sljedećim zadatkom kad on postoji.

## 6. Kontrolne točke

Svaki petak (`PLAN-DEMO.md` §3): usporedba spojenog s tablicom tjedna, kratak sažetak Danielu (što je gotovo, što kasni, prijedlog reza ako treba) i upis u `STATE.md`.

## 7. Štednja tokena orkestratora

- **Rotacija orkestratora:** rotira se nakon završenog logičkog sklopa ili kad ponovljeni kontekst postane skuplji od kratke repo/GitHub predaje; 200.000 tokena je gornja sigurnosna granica, ne cilj. Kad se rotira, orkestrator zapisuje predaju u `STATE.md` i na ploču. Nova instanca može biti na drugom računu ili provideru; mora moći nastaviti samo iz repoa, GitHuba i ploče. Session adresa u `STATE.md` ažurira se samo kao pomoćni podatak za runtime koji je koristi.
- Ne čita diffove ni cijele dokumente; samo metapodatke PR-a i potrebne odjeljke.
- Istraživanja i pregled mnogo datoteka daje pomoćnom agentu ili kratkotrajnoj sesiji.
- Ploča: dodaje događaje, ne prepisuje cijeli dnevnik.
