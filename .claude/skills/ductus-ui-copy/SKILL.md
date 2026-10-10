---
name: ductus-ui-copy
description: Pre-handoff checklist for a Ductus PR that adds or changes user-facing interface text, labels or save-state wording.
---

Popis provjera prije predaje PR-a koji dodaje ili mijenja tekst sučelja. Ne uvodi pravila: svaka stavka upućuje na odjeljak koji je pravilo ili opisuje kako dokazati da je ispunjeno. Ako se popis i dokument razilaze, vrijedi dokument, a nesklad ide u IZVJEŠTAJ.

Pročitati `CLAUDE.md` (Tvrda pravila, Jezik), `docs/PRODUCT.md` §5 s "Rječnikom sučelja", D-84 i D-90 t. 3 u `docs/DECISIONS.md`, `docs/PLAN-DEMO.md` §4 (F-8, P-6) i `docs/ARCHITECTURE.md` §5 t. 1 i t. 5.

1. Tekst sučelja je na hrvatskom i u ključevima; kod i identifikatori su na engleskom (`CLAUDE.md` "Jezik"; D-84).
2. Nijedan izraz iz lijevog stupca Rječnika, ni njegov engleski ekvivalent, ne pojavljuje se u tekstu sučelja (PRODUCT §5; D-90 t. 3). Nema postotaka, ocjena ni tvrdnji o autorstvu (PRODUCT §5 pravila 1, 2 i 9).
3. Stanja spremanja koriste doslovno propisane oblike iz zadnjeg retka Rječnika i iz F-8. Druga formulacija istog stanja ne prolazi (nalaz: "Spremljeno lokalno" za stanje koje se zove "spremljeno na uređaju").
4. "Spremljeno na poslužitelju" prikazuje se samo uz potpisanu potvrdu (ARCHITECTURE §5 t. 5); vidi `ductus-sync-states`. Offline oznaka ostaje i nakon sinkronizacije (PRODUCT §5 pravilo 10).
5. Svako pravilo iz PRODUCT §5 ima test ili provjeru u PR-u: promijenjena formulacija vezana je testom uz datoteku u kojoj tekst stvarno stoji.
6. Provjera zabranjenih izraza (P-6) mora čitati tu datoteku. Provjera izvedbe: lokalno, bez commita, upisati riječ iz Rječnika u promijenjenu datoteku i potvrditi da provjera pada. Ako provjera ne postoji na grani ili ne čita tu mapu (nalaz: `src/domain/**`), to upisati u "Otvoreno ili blokira" i ne tvrditi pokrivenost.
7. Svaki dokument i odjeljak na koji se komentar ili tekst poziva postoji na `origin/main` i kaže to što se tvrdi (`CLAUDE.md` "Mjerodavni izvori": mjerodavan je repo, ne grana ni sjećanje).
8. Frontend PR prilaže snimke zaslona iz Playwrighta (`docs/SESSIONS.md` §6 t. 2).
9. `Risk` po `docs/ENGINEERING_SYSTEM.md` §5: copy bez promjene značenja može biti `low`; tekst koji dira pravilo iz PRODUCT §5 ili provjeru zabranjenih izraza je `critical`.
