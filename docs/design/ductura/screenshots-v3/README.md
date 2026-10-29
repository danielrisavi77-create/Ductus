# Povijesne snimke Archivum V3

Ove snimke čuvaju tadašnji izgled PR-a #867. Bordo/bakar je povijest, a konačni smjer je „papir i grafit” (D-188; potvrda vlasnika 29. 10. 2026.), prema [zajedničkoj specifikaciji](../../DESIGN-SYSTEM.md). Nisu aktualna referenca palete ni dokaz današnje implementacije. Za novi vizualni dokaz primijenite `docs/SESSIONS.md` §6.

Snimke za PR #867 (`docs/SESSIONS.md` §6). Snimljene Playwright Chromiumom na produkcijskoj gradnji (`pnpm build`, `next start`) glave `a3606d2`, s lokalnim demo dnevnikom. Sav tekst je izmišljen.

| Datoteka | Ekran | Širina | Tema |
| --- | --- | --- | --- |
| `rad-siroki-dark.png`, `rad-siroki-light.png` | `/rad` (uređivač i ljuska) | 1440 px | tamna, svijetla |
| `rad-mobilni-dark.png`, `rad-mobilni-light.png` | `/rad` | 390 px | tamna, svijetla |
| `naslovnica-siroki-dark.png`, `naslovnica-siroki-light.png` | `/` (javna naslovnica) | 1440 px | tamna, svijetla |
| `naslovnica-mobilni-dark.png`, `naslovnica-mobilni-light.png` | `/` | 390 px | tamna, svijetla |

Svijetla tema je snimljena postavljanjem `data-theme="light"` na `<html>`.

Engleski: sučelje trenutno postoji samo na hrvatskom (`src/lib/i18n/messages.hr.ts`, `<html lang="hr">`), pa engleskih snimaka nema (D-70).

Nije snimljeno: studentski i nastavnički ekrani (traže stog s prijavom). Za njih su promijenjeni samo radijusi preko tokena.
