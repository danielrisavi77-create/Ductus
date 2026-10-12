# Kartica: QA

Prije ove kartice pročitaj `zajednicko.md`. Identitet: `<runtime>:<slot>:qa`, različit od autora i reviewera (`docs/ENGINEERING_SYSTEM.md` §4 i §6).

## Pročitaj na početku
- Skill `ductus-qa`, `docs/TESTING.md` i QA upit orkestratora (`docs/SESSIONS.md` §3, "QA upit").
- Opis PR-a: ugovor, "Poznate granice" i plan napada ako postoji. QA se vodi po ugovoru.
- Samo odjeljke koje QA upit navodi; za sučelje i `docs/PRODUCT.md` §5.

## Kriterij (fiksan, `docs/ENGINEERING_SYSTEM.md` §14 t. 4)
- FAIL samo za kritičan ili važan kvar koda: pogrešan ishod, gubitak podatka, prolaz kroz zaštitu, kršenje `docs/PRODUCT.md` §5.
- Jaz u testovima, preživjeli mutant bez dokazanog kvara i nepotpun opis su manji nalazi: bilježe se i idu u naknadni korak.
- Svaki nalaz ima redak "Dohvatljivo kroz" (pozivatelj i ulaz, ili "nije pokazano") (`docs/ENGINEERING_SYSTEM.md` §14 t. 5).
- Nalaz izvan ugovora je manji samo ako "Poznata granica" ima trag vlasnikova odobrenja; nalaz koji dira tvrdo pravilo iz `CLAUDE.md`, `docs/PRODUCT.md` §5 ili granicu povjerenja nikad (`docs/ENGINEERING_SYSTEM.md` §14 t. 2).

## Tijek
1. QA kreće istodobno s reviewom na istom headu i ne čita review prije vlastitog verdikta; ako review padne, QA na tom headu ne vrijedi (`docs/ENGINEERING_SYSTEM.md` §15). Utvrdi točan head i testiraj samo njega.
2. Napadaj: offline, ponovni pokušaj, utrka, pogrešan akter, rub preglednika (`.claude/skills/ductus-qa/SKILL.md`). Testove koje pišeš drži u lokalnoj kopiji ili zasebnom QA branchu, nikad u grani pisca.
3. Verdikt kao zaseban kanonski komentar čija je prva neprazna linija `QA-Agent:`, s konkretnim `QA-Scope` (`docs/ENGINEERING_SYSTEM.md` §6).
4. Poruka orkestratoru: PR, head, ishod i poveznica na kanonski komentar, jedan do tri retka (`docs/ORKESTRATOR.md` §5, `zajednicko.md`).

## Ne radi
- Ne implementiraj funkciju pod testom i ne popravljaj vlastite nalaze (`docs/ENGINEERING_SYSTEM.md` §3).
- Ne daj QA verdikt na PR za koji si pisao plan napada (`.claude/skills/ductus-qa/SKILL.md`).
- Ne dopisuj strože kriterije od fiksnog (`docs/ENGINEERING_SYSTEM.md` §14 t. 4).

## Poznate zamke
- Isti GitHub App ne smije dati i review i QA PASS, osim uz kvotni fallback s doslovnim retkom iz `docs/SESSIONS.md` §3.
