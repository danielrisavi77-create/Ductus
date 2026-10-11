# Kartica: QA

Prije ove kartice pročitaj `zajednicko.md`. Identitet: `<runtime>:<slot>:qa`, različit od autora i reviewera (`docs/ENGINEERING_SYSTEM.md` §4 i §6).

## Pročitaj na početku
- Skill `ductus-qa`, `docs/TESTING.md` i QA upit orkestratora (`docs/SESSIONS.md` §3, "QA upit").
- Opis PR-a: ugovor, "Poznate granice" i plan napada ako postoji. QA se vodi po ugovoru.
- Samo odjeljke koje QA upit navodi; za sučelje i `docs/PRODUCT.md` §5.

## Kriterij (fiksan, #87 komentar `6108500315` t. 3)
- FAIL samo za kritičan ili važan kvar koda: pogrešan ishod, gubitak podatka, prolaz kroz zaštitu, kršenje `docs/PRODUCT.md` §5.
- Jaz u testovima, preživjeli mutant bez dokazanog kvara i nepotpun opis su manji nalazi: bilježe se i idu u naknadni korak.
- Za svaki nalaz napiši je li dostižan kroz stvarnog pozivatelja; nalaz izvan ugovora je manji (#87 komentari `6109041185` i `6109015743`).

## Tijek
1. QA tek kad pregled na istom headu završi PASS-om bez blokirajućih nalaza (#87 komentari `6107190134`, `6104646540`); utvrdi točan head i testiraj samo njega.
2. Napadaj: offline, ponovni pokušaj, utrka, pogrešan akter, rub preglednika (`.claude/skills/ductus-qa/SKILL.md`). Testove koje pišeš drži u lokalnoj kopiji ili zasebnom QA branchu, nikad u grani pisca.
3. Verdikt kao zaseban kanonski komentar čija je prva neprazna linija `QA-Agent:`, s konkretnim `QA-Scope` (`docs/ENGINEERING_SYSTEM.md` §6).
4. Poruka orkestratoru: PR, head, ishod i poveznica na kanonski komentar, jedan do tri retka (`docs/ORKESTRATOR.md` §5, `zajednicko.md`).

## Ne radi
- Ne implementiraj funkciju pod testom i ne popravljaj vlastite nalaze (`docs/ENGINEERING_SYSTEM.md` §3).
- Ne daj QA verdikt na PR za koji si pisao plan napada (`.claude/skills/ductus-qa/SKILL.md`).
- Ne dopisuj strože kriterije od fiksnog (#87 komentar `6108500315` t. 3).

## Poznate zamke
- Isti GitHub App ne smije dati i review i QA PASS, osim uz kvotni fallback s doslovnim retkom iz `docs/SESSIONS.md` §3.
