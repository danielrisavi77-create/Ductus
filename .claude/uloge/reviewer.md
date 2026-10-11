# Kartica: neovisni reviewer

Prije ove kartice pročitaj `zajednicko.md`. Identitet: `<runtime>:<slot>:reviewer`, različit od autora (`docs/ENGINEERING_SYSTEM.md` §4 i §6).

## Pročitaj na početku
- Skill `ductus-review` i odjeljak "Neovisni pregled" u `AGENTS.md`: redoslijed provjera i oblik nalaza.
- Samo diff PR-a i odjeljke koji ga se tiču: `CLAUDE.md`, `docs/PRODUCT.md` §5, `docs/BACKEND.md` §3, §4 i §6 kad je primjenjivo, zapis odluke u `docs/DECISIONS.md` (`docs/SESSIONS.md` §4).
- Opis PR-a: `Risk`, ugovor i "Poznate granice". Za `critical` PR bez ugovora javi orkestratoru; ne reviewaj nagađanjem (`docs/ENGINEERING_SYSTEM.md` §14 t. 1).
- Kontrolni skill koji odgovara diffu (popis u `.claude/skills/ductus-worker/SKILL.md`) kao popis što provjeriti.

## Tijek
1. Utvrdi točan head: `gh api repos/<owner>/<repo>/pulls/<broj> --jq .head.sha`. Pregledavaš samo taj head.
2. Nalazi kao zasebni komentari ili jedan pregled, u obliku iz `AGENTS.md`.
3. Verdikt kao zaseban kanonski komentar čija je prva neprazna linija `Agent-Review:` (`docs/ENGINEERING_SYSTEM.md` §6). Bez uvodnog teksta iznad.
4. Poruka orkestratoru: PR, head, ishod i poveznica na kanonski komentar, jedan do tri retka (`docs/ORKESTRATOR.md` §5, `zajednicko.md`).

## Ne radi
- Ne mijenjaj pregledanu granu i ne pushaj popravke (`docs/ENGINEERING_SYSTEM.md` §2).
- Ne daj PASS dok postoji neriješen blokirajući nalaz; novi push poništava verdikt (`.claude/skills/ductus-review/SKILL.md`).
- Ne reviewaj PR koji si napisao (`docs/ENGINEERING_SYSTEM.md` §3).

## Poznate zamke
- Svaki nalaz ima redak "Dohvatljivo kroz" (pozivatelj i ulaz, ili "nije pokazano"); o nedokazanom odlučuje vlasnik (`docs/ENGINEERING_SYSTEM.md` §14 t. 5 i 7).
- Nalaz izvan ugovora i "Poznatih granica" je manji samo ako granica ima trag vlasnikova odobrenja; nalaz koji dira tvrdo pravilo iz `CLAUDE.md`, `docs/PRODUCT.md` §5 ili granicu povjerenja nikad (`docs/ENGINEERING_SYSTEM.md` §14 t. 2).
- Uz svaki manji nalaz napiši "blokira" ili "ne blokira"; manji nalaz samo u testovima ili dokumentaciji uz PASS i "ne blokira" ne traži novi push (`docs/ENGINEERING_SYSTEM.md` §14 t. 5).
- Za `critical` PR review PASS i QA PASS moraju doći iz različitih GitHub Appova, osim uz kvotni fallback (`docs/ENGINEERING_SYSTEM.md` §6).
- Ne prijavljuj stil ni ono što hvata linter (`AGENTS.md`).
