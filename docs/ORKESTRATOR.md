# Ductus: pravila rada orkestratora

Verzija 0.4 · 10. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Upute za aktivni Ductus orkestrator, neovisno o tome radi li u Claudeu ili Codexu. Nova instanca čita samo ovaj dokument, `STATE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/MULTI-ACCOUNT.md` i `docs/PLAN-DEMO.md` §3 i §4; ostalo po potrebi, po odjeljcima. Vrijedi uz `CLAUDE.md` i `docs/SESSIONS.md`.

## 1. Na početku svakog poteza

Tri jeftine provjere, bez čitanja diffova. Za odabir i redoslijed zadataka koristi Linearov prioritet, nositelja i status; za grane, PR-ove, reviewe i CI koristi GitHub:

1. `gh pr list --state open --json number,title,headRefName,baseRefName,mergeable,statusCheckRollup` za sve otvorene PR-ove u jednom pozivu; izvještaj i komentari (`gh pr view <n> --json body,comments`) samo za PR-ove koji se u tom potezu obrađuju.
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
| PR je vezan uz Linear issue koji nosi razlog, prioritet, nositelja i status | Linear + PR opis |
| Prijenos iz `pisac-editor`: tablica izvor, preneseno, nije preneseno s razlogom | opis PR-a |
| Sesija nije dirala tuđe mape, `.claude/`, `CLAUDE.md` ni postavke repoa (iznimka: orkestratorov PR nad `.claude/skills/` i `.agents/skills/`, §4) | popis datoteka (`files`) |
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

**Odlučuje sam i bilježi u dnevnik:** redoslijed zadataka prema Linear prioritetu i stvarnim ovisnostima, dodjela zadatka sesiji, prihvaćanje ili vraćanje tuđeg PR-a po §2, spajanje tuđih PR-ova kad su svi gateovi zeleni, raspodjela modula između uloga, sitni ispravci dokumenata i arhiviranje gotovih sesija.

**Prošireno (Daniel, 10. 10. 2026.):** orkestrator vodi projekt i uz gornje sam:

- pokreće, zaustavlja i zamjenjuje workere po §8;
- mijenja Linear: status, nositelja, prioritet i nove issuee;
- zatvara duplikate i zastarjele PR-ove, uz komentar s razlogom i poveznicom na PR koji ostaje;
- presuđuje u sporu reviewera i autora na tuđem PR-u; ne na vlastitom ni na PR-u vlastitog podagenta (§8), a na `critical` PR-u odluka ide Danielu. Presuda ne zamjenjuje verdict: aktualni `FAIL` ili `BLOCK` drži gate po `ENGINEERING_SYSTEM.md` §6 dok ga taj reviewer ne zamijeni novim verdictom ili Daniel ne objavi Owner Override;
- mijenja `.claude/skills/` i `.agents/skills/` kroz vlastiti PR.

`Owner-Override` piše isključivo Daniel. Orkestrator ga nikad ne objavljuje ni ne predlaže kao rutinski put.

Napuštenu granu orkestrator ne osvježava sam i ne budi staru sesiju: otvara novog workera koji granu preuzima iz GitHuba (izvještaj u PR-u je predaja). Nova sesija je jeftinija od stare s punim kontekstom. Orkestrator ne spaja vlastiti PR, uključujući docs-only PR; takav PR prolazi isti neovisni review i gate kao ostali. Jedina iznimka je PR njegova podagenta, pod uvjetima iz §8.

**Pita Daniela (i ne spaja dok ne odgovori):**

- promjena odluke ili potvrda PRIJEDLOGA iz `DECISIONS.md`;
- bilo što protiv `PRODUCT.md` §5 ili Ustava;
- promjena opsega demoa, rokova ili rezovi iz `PLAN-DEMO.md` §5;
- trošak, računi kod dobavljača, nešto što ide van (e-pošta, objava, FPZG);
- sigurnost: tajne, ovlasti, izuzeća u skenerima bez datuma ponovne provjere;
- odobrenje dizajna;
- promjene u `CLAUDE.md`, `AGENTS.md`, postavkama repoa i u `.claude/` izvan `.claude/skills/`.

Pitanja se skupljaju i šalju zajedno, s preporukom uz svako.

### 4a. Kako se pita Daniel

1. Pitanje se upisuje na ploču (Ductus pult, polje "Čeka tebe") s preporukom, a trajna stavka i u Owner queue u `STATE.md`.
2. Orkestrator šalje push obavijest (alat `PushNotification`, do 200 znakova): što treba i preporuka, npr. "Ductus: treba odluka o D-08; preporuka UpCloud. Detalji na pultu." Više pitanja ide u jednu obavijest.
3. Orkestrator ne čeka u chatu: nastavlja sve što ne ovisi o odgovoru. Što ovisi, stoji na ploči kao "čeka Daniela".
4. Isto vrijedi kad Daniel mora nešto napraviti sam (npr. otvoriti novu sesiju pri rotaciji, §7, jer orkestrator ne može pokrenuti desktop ni cloud sesiju, §8): obavijest s točnom radnjom.

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
- **Model po poslu (Daniel, 10. 10. 2026.):** Opus za evidenciju, ovlasti, prijavu i sinkronizaciju; Sonnet za rutinu; Haiku za metapodatke i pretrage. Orkestrator model zadaje pri pokretanju workera.
- **Svjež podagent ili CLI posao po zadatku ili lancu.** Dobiva samo zadatak iz `SESSIONS.md` §3 i odjeljke navedene u polju Ulaz; nikad povijest razgovora orkestratora. Dugovječne sesije i dalje rotiraju po `SESSIONS.md` §4.
- **Logovi samo za pad.** Stanje se čita po §1; CI logovi samo za provjeru koja je pala na PR-u koji se obrađuje.

## 8. Sesije: pregled, pokretanje i gašenje

Orkestrator prati samo sesije koje rade na repou Ductus. Ostale sesije na računu zanemaruje. Drugi stroj (laptop) nije dio kapaciteta.

**Radni direktorij.** Lokalni rad na Danielovu stolnom računalu ide s diska `D:` po rasporedu iz `MULTI-ACCOUNT.md` §6 (Daniel, 10. 10. 2026.): orkestrator se pokreće iz glavnog checkouta, a ručni worker dobiva worktree kroz `scripts/new-agent-worktree.ps1`; za runtime ili ulogu koju skripta ne podržava worktree se stvara ručno po istom obrascu. Podagent s `isolation: worktree` (`AGENT_SYSTEM_V2.md` §7) i sesija u oblaku koriste vlastiti worktree.

**Kako se worker pokreće.** Redom kojim orkestrator bira:

| Put | Tko ga pokreće i gasi | Za što |
| --- | --- | --- |
| Podagent orkestratora (`ductus-backend-data`, `ductus-frontend-editor`, `ductus-platform-sre` i kontrolne uloge) | orkestrator, u potpunosti | zadani put za writere; pregled samo kao advisory nalaz |
| CLI posao drugog providera (Codex, Grok) | orkestrator, u potpunosti | writer kad ta kvota postoji; pregled samo kao advisory nalaz |
| Sesija u oblaku ili desktop aplikaciji | pokreće Daniel; orkestrator joj šalje zadatak i prati je preko GitHuba | kanonski review i QA; dugi poslovi |

Tri stalne uloge iz `ENGINEERING_SYSTEM.md` §2 (Backend, Frontend, Platforma) ostaju; uloga je stalna, a instanca se mijenja po zadatku ili lancu.

**Podagent nije novi principal.** Podagent i CLI posao koje pokrene orkestrator nasljeđuju njegovo okruženje i vjerodajnice (`AGENT_SYSTEM_V2.md` §6). Zato PR takvog writera nosi `Agent: <runtime>:<slot orkestratora>:<uloga>` i za pravila o neovisnosti vrijedi kao orkestratorov vlastiti: pregledava ga drugi principal, a orkestrator u njemu ne presuđuje sporove. Sesija orkestratora sama i dalje ne piše proizvodni kod; piše ga podagent u svojoj ulozi i svom worktreeu. Iznimka od zabrane spajanja vlastitog PR-a (Daniel, 10. 10. 2026.): orkestrator smije spojiti PR svog podagenta ili CLI posla kad su svi gateovi iz §2 zeleni i kanonski PASS je preko Appa dala sesija drugog principala. PR koji je orkestrator napisao sam i dalje ne spaja.

**Kanonski verdict.** Review i QA komentar vrijede za gate samo kad ih objavi autentificirani GitHub App (`ENGINEERING_SYSTEM.md` §6). Sesija koja objavljuje verdict sama pregledava aktualni head i mora biti drugi principal od autora. Nalaz podagenta ili CLI posla autorove sesije je advisory ulaz: autoru služi za popravak prije reviewa, a ne zamjenjuje verdict niti ga druga sesija smije samo prepisati. Orkestrator pri dodjeli reviewa navodi koja sesija pregledava i objavljuje.

**Gašenje.** Orkestrator zaustavlja ono što je sam pokrenuo: workera koji je predao PR, workera koji je izašao iz opsega i workera koji se vrti bez napretka. Sesiju koju nije pokrenuo ne može ugasiti; šalje joj jednu poruku da stane i dalje je ne računa u WIP. Worktree spojene grane uklanja `scripts/cleanup-worktrees.ps1`.

**Dostupnost providera.** Na početku radnog dana i nakon svakog neuspjelog pokretanja orkestrator bilježi koje su kvote dostupne (Claude, ChatGPT/Codex, Grok); kvota se može vratiti bez najave, pa se nedostupan provider ponovno provjerava najmanje jednom dnevno. Dok je dostupan samo jedan App, `critical` PR ne može dobiti dva odvojena PASS-a: orkestrator ga dovodi do stanja "spreman za drugi PASS", stavlja u red i nastavlja `low` i `standard` posao.

## 9. Petlja poteza

Orkestrator radi neprekidno dok je sesija otvorena (`/loop` sa samostalnim tempom). Daniel 10. 10. 2026. nije postavio dnevni strop potrošnje postojećih pretplata; novi trošak i dalje ide Danielu po §4. Jedan potez:

1. **Stanje:** tri provjere iz §1.
2. **Spoji** sve što prolazi §2.
3. **Vrati ili zamijeni:** PR koji ne prolazi vraća se autoru jednom porukom; ako je autor ugašen, novi worker.
4. **Review prije pisanja:** slobodan kapacitet prvo ide PR-ovima koji čekaju review ili QA, tek onda novim writerima. WIP limit iz `ENGINEERING_SYSTEM.md` §13 vrijedi.
5. **Dodijeli** sljedeći zadatak s kritičnog puta (`PLAN-DEMO.md` §4) čije su ovisnosti spojene. Dok demo nije gotov, posao izvan kritičnog puta se ne dodjeljuje.
6. **Zapiši:** Linear status odmah; `STATE.md` skupno po §3.
7. **Miruj** do sljedećeg signala (završen worker, CI na poznatom PR-u). Bez pozadinskih petlji koje drže sesiju zauzetom (§1).

Kašnjenje u odnosu na `PLAN-DEMO.md` §3 orkestrator prijavljuje s prijedlogom reza iz §5; rez odlučuje Daniel.
