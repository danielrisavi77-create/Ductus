# Kartice uloga

Kratka uputa za sesiju kojoj je dodijeljena uloga, osobito novu sesiju u oblaku. Kartica ne uvodi pravila i ne ponavlja produktna ni sigurnosna pravila: upućuje na kanonske dokumente (`CLAUDE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/SESSIONS.md`, `docs/ORKESTRATOR.md`). U sukobu vrijedi kanonski dokument, a kartica se ispravlja.

Redoslijed: `STATE.md`, zatim `zajednicko.md`, zatim kartica uloge, zatim samo odjeljci iz zadatka.

| Uloga | Kartica |
| --- | --- |
| pisac Backend | `pisac-backend.md` |
| pisac Frontend | `pisac-frontend.md` |
| pisac Platforma | `pisac-platforma.md` |
| neovisni reviewer | `reviewer.md` |
| QA | `qa.md` |

Pravila po putanjama u `.claude/rules/` Claude Code učitava sam kad sesija pročita ili mijenja datoteku iz tog područja. Ona su podsjetnik, ne provedba: provode ih testovi, CI i Engineering review gate.
