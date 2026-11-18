# Pravila rada pisca Ducture u oblaku

Ovaj dokument čita svaki pisac Ducture u oblaku na početku sesije. Zadatak (slot, repo, DAN, redak plana) je u kratkom nalogu orkestratora; ovdje su stalna pravila. U tekstu je `<slot>` slot pisca, `<repo>` radni repo (`ductura/<ime>`), `<DAN>` Linear oznaka zadatka i `<dan>` ista oznaka malim slovima.

## Početak

- Koordinacija: danielrisavi77-create/Ductus#2028. Dodjela: orkestrator `claude:b:orchestrator` (D-111).
- Pravila rada su ista kao u Ductusu: CLAUDE.md, docs/ENGINEERING_SYSTEM-SAZETAK.md i kartica .claude/uloge/ u repou Ductus (čitaj ih preko `gh api repos/danielrisavi77-create/Ductus/contents/<put>`). Pravila ciljnog repoa (CLAUDE.md, AGENTS.md, docs/) imaju prednost za taj repo.
- Prva naredba: `node -v && pnpm -v && gh api repos/<repo> --jq .full_name`. Ako padne, objavi BLOK „okruženje” na Ductus#2028 i završi. Ako prođe, odmah na Ductus#2028 objavi `OBLAK <slot> · POČETAK <grana>` (pisca bez ijednog izvještaja 10 min nakon pokretanja orkestrator smatra mrtvim startom). GraphQL je u oblaku blokiran (403): samo REST.

## Zadatak i opseg

- Zadatak iz vala. Opseg i prihvat za <DAN> su na Ductus#2028 u komentaru orkestratora „OPSEG IZ LINEARA” (Linear u oblaku nije dostupan); pročitaj ga prije ugovora, a ako ga nema, objavi BLOK „opseg” i završi. Redak vala plana (https://claude.ai/artifact/KzzVc3xY2L96gQPHZxYU8v) daje samo okvir vala.
- Zadatak iz retka plana: opseg i prihvat su u tom retku plana migracije (https://claude.ai/artifact/KzzVc3xY2L96gQPHZxYU8v) i u Linearu <DAN>; pročitaj ih prije ugovora.
- Risk odredi prema ENGINEERING_SYSTEM §5 (CLAUDE.md, AGENTS.md, .claude/ i .github/ su uvijek `critical`) i navedi ga u ugovoru. Ne diraj grane otvorenih PR-ova u istom repou i izbjegavaj njihove datoteke.
- Ako radni repo nije ductura/server: ductura/server je u ovoj sesiji samo za čitanje: u njemu ne otvaraj PR, ne radi granu i ne komentiraj. `@ductura/contracts` je u ductura/server pod `server/contracts/` i nije na npm-u: ako ti treba, kopiraj ga (vendor) s navedenim izvornim putem i SHA-om commita i dodaj test koji provjerava da kopija odgovara izvoru.
- Prije nove grane provjeri u <repo> (REST: `gh api repos/<repo>/branches --paginate` i otvoreni PR-ovi) postoji li grana ili PR s <dan> u imenu ili `Task: <DAN>`: nedovršen rad prethodnog pisca nastavljaš na njegovoj grani, a spojene dijelove ne radiš ponovno.
- Ako je u nalogu naveden prethodni pisac koji je stao na <DAN>: pročitaj njegove izvještaje na Ductus#2028, nastavi njegovu granu i otvoreni PR (ne počinji iznova i ne otvaraj drugi PR za isti dio).

## Koraci

1. Prije koda objavi na Ductus#2028 kratki UGOVOR: opseg, Risk, kriteriji prihvata i za svaki test koji ga dokazuje, negativni slučajevi koji idu prvi, što ne ulazi. Prije objave pokreni podagenta (Agent) koji napada nacrt ugovora: je li svaki kriterij ostvariv i provjerljiv testom (npr. rok ne može prekinuti sinkroni rad; vrijeme u testu ide lažnim satom), proturječi li planu ili postojećem kodu. Neostvariv kriterij preformuliraj u ugovoru i navedi zašto. Ne čekaj potvrdu.
2. Grana od `main` s <dan> u imenu. Testovi prije koda. `pnpm install`, `pnpm lint` (ako postoji), `pnpm typecheck` i `pnpm test` moraju biti zeleni. Oko 200 promijenjenih redaka najviše (testovi uključeni) i jedan kriterij prihvata po PR-u; čisti prijenos postojećeg koda (verbatim port bez nove logike) smije do oko 400 redaka, i to navedi u ugovoru; veći opseg podijeli na dijelove (npr. 837-1, 837-2) i u ugovoru navedi koji dio radiš sada.
3. PR na <repo> otvori kao spreman, ne kao nacrt (nacrt se u oblaku ne može ukloniti: GraphQL). Opis na hrvatskom, `Risk: <razina iz ugovora>`, `Task: <DAN>`, poveznica na ugovor. Zatim na samom PR-u objavi `Spreman za review: <puni sha>` (nadzor ga čita samo s PR-a). Review i QA radi Codex CLI koji pokreće orkestrator: ne traži Claude reviewera i ne piši `@codex review`. Na komentare botova i Codex aplikacije odgovori u istoj niti i riješi niti.

Samoprovjera prije `Spreman za review` (najčešći razlozi FAIL-a): (a) validator, parser, guard ili provjera budžeta: popravi cijelu klasu ulaza, ne samo prijavljeni slučaj; testovi pokrivaju CRLF, tab, NBSP (U+00A0), DEL (U+007F), naslijeđene ključeve (`toString`, `__proto__`), Windows putanje i `additionalProperties`, gdje je primjenjivo. (b) docs/plan: svaki promijenjeni pojam grepaj kroz sve datoteke plana (docs/PLAN.md, docs/plan/*, README.md) i navedi provjere u opisu PR-a. (c) kod: pravila CODE_STYLE repoa (nova mapa ima `index.ts` i hrvatski `README.md`, svaki ključ greške ima tekst). (d) Risk critical (Daniel 17. 11. 2026., „Može sve”): nakon zelenog CI-ja, a prije `Spreman za review`, pokreni podagenta (Agent) sa svježim kontekstom kao QA napadača. Daj mu samo `git diff origin/main...HEAD`, svoj ugovor i FAIL nalaze reviewa i QA-a iz zadnjih zatvorenih ili spojenih PR-ova tog repoa (komentari s `Review-Verdict: FAIL` ili `QA-Verdict: FAIL`, `gh api repos/ductura/<repo>/issues/<n>/comments`). Neka za svaku klasu iz tih nalaza i za svaki kriterij ugovora pokuša slomiti PR i vrati nalaze s datotekom, retkom i scenarijem. Svaki nalaz popravi ili u opisu PR-a obrazloži; najviše 2 kruga. Rezultat nije verdikt: ne piši retke Agent-Review, Review-* ni QA-*, nego u opisu PR-a pod „Samoprovjera” navedi broj nalaza i što je s njima. Ne spajaj `main` u granu osim kad PR ima konflikt.

4. Na Ductus#2028 objavi `OBLAK <slot> · GOTOVO <repo>#<n> <sha>`, zatim sljedeći zadatak iz lanca ili završi.

## Lanac i pravila

Lanac zadataka: komentar „OPSEG IZ LINEARA” na Ductus#2028 može navesti 2-3 zadatka redom. Kad za prvi objaviš GOTOVO, u istoj sesiji nastavi sa sljedećim: nova grana od svježeg `main`, novi ugovor, ista pravila, oko 200 redaka i jedan kriterij prihvata po PR-u. GOTOVO objavi za svaki zadatak posebno. Stani nakon zadnjeg zadatka ili na bilo kojem BLOK-u.

Pravila: ne spajaš, ne pišeš na #87 ni #2012, ne pišeš retke Agent-Review/Review-*/QA-*, ne mijenjaš tuđe PR-ove ni postavke repoa. Nema tajni ni stvarnih osobnih podataka. Odbijen `sleep` nije prepreka: ne ponavljaj ga, nastavi. Ako hook ili klasifikator uskrati radnju, stani i zapiši to na Ductus#2028 bez zaobilaženja.
