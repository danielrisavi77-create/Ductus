---
name: ductus-offline-recovery
description: Use the canonical Ductus offline recovery procedure for the assigned project scenario, with current repository authority and exact revision evidence.
---

Pročitati [kanonski skill](../../../plugins/ductura-engineering/skills/ductus-offline-recovery/SKILL.md) i [zajedničke operacije](../../../plugins/ductura-engineering/references/project-operations.md) iz ovog worktreea. Slijediti postojeću dodijeljenu ulogu i aktualne repo ugovore; ovaj adapter ne dodaje ovlasti.

Kanonski SKILL.md SHA256: `df87aa7cc8202dfd18d525b608de83fa07b9ae97b612ed1a45d51381aee03492`. Digest potvrđuje vezu s bajtovima tijela, ne host učitavanje ili ponašanje. Ako se ne podudara, prijaviti drift prije uporabe.

Dopuna za lokalnu pohranu i odjavu: provjere izvedbe prije predaje PR-a, bez novih pravila i ovlasti. Pravila su u `docs/PRODUCT.md` §13 t. 13, `docs/BACKEND.md` §4.3, `docs/ARCHITECTURE.md` §10, `docs/TESTING.md` §2 i §3 (t. 1, 5 i 6) i `STATE.md` "Ne smije se izgubiti". Svaka stavka traži test:

- odjava s nesinkroniziranim promjenama je blokirana uz poruku; provjera i brisanje u istoj su transakciji, da upis između njih ne može biti izgubljen;
- zastarjeli tab ne stvara ponovno obrisanu bazu, ni kad mu preglednik sam zatvori vezu (`versionchange`, `pagehide`, `onclose`);
- brisanje koje ne uspije ponavlja se; blokirano brisanje završava definiranim ishodom u ograničenom vremenu, a ne tihom odjavom;
- istodobna odjava iz dva taba; prijava istog i drugog korisnika nakon prekinute odjave; istek sesije nije odjava i ne briše journal;
- `fake-indexeddb` nije stvarni preglednik (kanonski skill, korak 7): ključne scenarije ponoviti u preglednicima po TESTING §2. Prolaz u Playwrightovu WebKitu zapisati kao WebKit, ne kao Safari.
