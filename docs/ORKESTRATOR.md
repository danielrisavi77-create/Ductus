# Ductus: pravila rada orkestratora

Verzija 0.2 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Upute za sesiju "Ductus orkestrator". Nova sesija orkestratora čita samo ovaj dokument, `STATE.md` i `docs/PLAN-DEMO.md` §3 i §4; ostalo po potrebi, po odjeljcima. Vrijedi uz `CLAUDE.md` i `docs/SESSIONS.md`.

## 1. Na početku svakog poteza

Tri jeftine provjere, bez čitanja diffova:

1. `gh pr list --state open --json number,title,headRefName,baseRefName,mergeable` i izvještaj u opisu svakog PR-a (`gh pr view <n> --json body,comments,statusCheckRollup`).
2. `gh issue list --search "IZVJEŠTAJ in:title" --state open` (izvještaji bez PR-a) i `gh pr list --label izvjestaj-ceka` te komentari "IZVJEŠTAJ čeka orkestratora" (`SESSIONS.md` §2a).
3. Popis sesija (radi, miruje, PR) preko alata za sesije.

Izvještaj u PR-u vrijedi i kad poruka nije stigla.

## 2. Kad stigne PR

Spaja se (squash, D-86) samo ako je sve ispunjeno:

| Provjera | Kako |
| --- | --- |
| CI zelen | `statusCheckRollup` |
| Codex bez otvorenih KRITIČNIH nalaza; VAŽNI ispravljeni ili obrazloženo odbijeni | komentar "Neovisni pregled (Codex)" i odgovor sesije |
| Baza je `main` i nema sukoba | `baseRefName`, `mergeable` |
| Jedan zadatak; preko oko 400 redaka koda samo uz obrazloženje | opis PR-a |
| Prijenos iz `pisac-editor`: tablica izvor, preneseno, nije preneseno s razlogom | opis PR-a |
| Sesija nije dirala tuđe mape, `.claude/`, `CLAUDE.md` ni postavke repoa | popis datoteka (`files`) |
| PR ne čeka Danielovu odluku | izvještaj, polje "Treba Daniel" |

Ako nešto ne prolazi, PR se vraća sesiji jednom porukom s točnim razlogom (npr. "rebase na origin/main"). Orkestrator ne mijenja grane drugih sesija.

Diff čitaju CI i Codex; orkestrator gleda samo metapodatke i popis datoteka, osim kad Codex i sesija ne slažu.

## 3. Nakon spajanja

1. Sljedeći zadatak iz `PLAN-DEMO.md` §4 kojem su ovisnosti spojene; šalje se u obliku iz `SESSIONS.md` §3, uz razinu Codex pregleda (`light`, `standard`, `critical`, `SESSIONS.md` §5). Prije slanja orkestrator postavlja effort sesije po istoj razini (model ostaje Opus).
2. Kad je redoslijed jasan, sesija dobiva lanac zadataka (npr. "F2, F3 i F4 redom, svaki svoj PR od svježeg `origin/main`"), da treba manje poruka.
3. Ploča (Ductus pult): jedan skupni upis po potezu.
4. `STATE.md`: skupno, najviše jednom dnevno i na kontrolnoj točki, kroz PR orkestratora.

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

## 5. Poruke među sesijama

- Aplikacija pauzira slanje nakon desetak poruka bez Danielove poruke u sesiji orkestratora. Zato: najviše jedna poruka po sesiji po potezu, lanci zadataka (§3) i sve neposlano zapisano na ploči kao "čeka slanje". Kad Daniel napiše bilo što, šalje se redom.
- Na izvještaj koji samo potvrđuje (npr. "gotovo, ništa ne treba") ne odgovara se porukom, nego sljedećim zadatkom kad on postoji.

## 6. Kontrolne točke

Svaki petak (`PLAN-DEMO.md` §3): usporedba spojenog s tablicom tjedna, kratak sažetak Danielu (što je gotovo, što kasni, prijedlog reza ako treba) i upis u `STATE.md`.

## 7. Štednja tokena orkestratora

- **Rotacija sesije:** kad kontekst orkestratora prijeđe oko 200.000 tokena ili na kraju radnog dana, orkestrator zapiše predaju (stanje, otvoreni PR-ovi, poslani i neposlani zadaci, pitanja za Daniela) u `STATE.md` i na ploču, a Daniel otvori novu sesiju "Ductus orkestrator" i arhivira staru. Nova sesija prvim PR-om upisuje svoju adresu u `STATE.md` i šalje je svim aktivnim sesijama (`SESSIONS.md` §2a). Svaki potez duge sesije ponovno šalje cijeli kontekst.
- Ne čita diffove ni cijele dokumente; samo metapodatke PR-a i potrebne odjeljke.
- Istraživanja i pregled mnogo datoteka daje pomoćnom agentu ili kratkotrajnoj sesiji.
- Ploča: dodaje događaje, ne prepisuje cijeli dnevnik.
