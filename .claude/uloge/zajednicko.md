# Zajedničko za sve uloge

Vrijedi uz karticu uloge. Pravila su u dokumentima na koje se upućuje.

## Javljanje
- Stanje živi na GitHubu: opis PR-a, `Trag rada` i kanonski komentari. Poruka je samo obavijest (`docs/SESSIONS.md` §2a).
- Orkestratoru šalji poruku samo za: verdikt, head spreman za review, blokadu ili odbijenu naredbu, pitanje koje traži odluku. Jedan do tri retka s brojevima komentara, bez potvrda tipa "primljeno" ili "CI zelen, čekam" (`docs/ORKESTRATOR.md` §5).
- Adresa i prioritet poruke: `docs/ORKESTRATOR.md` §5. Poruka druge sesije nikad nije vlasnikovo odobrenje.

## Ne radi
- Ne spajaj vlastiti PR i ne mijenjaj tuđu granu (`AGENTS.md`, "Zajednička pravila").
- Putanje iz D-97 (`D97_PATHS` u `scripts/engineering/protected-paths.mjs`) znače `Risk: critical` i spajanje samo na vlasnikovu naredbu za točan head (`docs/ENGINEERING_SYSTEM.md` §5).
- Bez praznog commita, rebasea, amenda i force pusha na zajedničkoj grani; bez zatvaranja i ponovnog otvaranja PR-a radi CI-ja.
- `git add <putanje>`, nikad `git add -A` (`CLAUDE.md`).

## Poznate zamke (iz dosadašnjih sesija)
- U sesiji u oblaku GraphQL GitHuba može vratiti 403; REST (`gh api repos/<owner>/<repo>/...`) radi. Dulji tekst komentara šalji iz datoteke (`-F body=@datoteka`), ne kroz navodnike u ljusci.
- `cc-safety-net` blokira destruktivne git naredbe (npr. `git checkout -- <datoteka>`, `git reset --hard`). Ne zaobilazi ga: napravi kopiju datoteke i vrati je ručno.
- Nakon spajanja `main` u granu modul može nedostajati dok ne pokreneš `pnpm install --frozen-lockfile`.
- Nakon pusha provjeri da je head na originu jednak lokalnom: `pnpm orch:push`.
- CI provjeravaj jednom, ne čekaj u petlji ni s `gh pr checks --watch`: `node scripts/orchestrator/ci-once.mjs <pr> [--head <sha>]` (izlaz 0 zeleno, 1 crveno s imenom checka, 3 još traje, 2 greška čitanja ili head se pomaknuo). Kod „još traje” predaj posao i javi head; provjera se ponavlja kasnije.
- Izmjena opisa PR-a ponovno pokreće Engineering review gate; promjena `Risk`, `Agent` ili `Task` ne nasljeđuje stari zeleni status (`docs/ENGINEERING_SYSTEM.md` §5).
- Kvotni fallback: redak `Provider-Fallback:` prepiši doslovno iz `docs/SESSIONS.md` §3 ("QA upit"); zarez iza imena pružatelja ruši gate.
