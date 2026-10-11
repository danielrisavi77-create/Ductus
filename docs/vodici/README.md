# Vodiči po područjima aplikacije

Detaljne karte područja za sesiju koja počinje raditi u nekom dijelu koda: gdje je što, kako podaci teku, koje invarijante vrijede (s izvorom u dokumentu i testom koji ih drži), kako se radi tipična promjena i kako se dokazuje.

Vodič ne uvodi pravila. Pravila su u `CLAUDE.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/BACKEND.md`, `docs/DECISIONS.md`, `docs/TESTING.md` i `docs/ENGINEERING_SYSTEM.md`. Ako se vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod, a nesklad ide u IZVJEŠTAJ. Stanje koda u vodičima je ono na `main` `c3ede8a` (11. 10. 2026.); vodič se ažurira u PR-u koji mijenja područje.

| Vodič | Područje |
| --- | --- |
| [karta-aplikacije.md](karta-aplikacije.md) | cijela aplikacija: stack, slojevi, smjer ovisnosti, okruženja, odakle krenuti |
| [testovi.md](testovi.md) | slojevi testova, konfiguracija, naredbe, koji CI posao pokreće što |
| [evidencija.md](evidencija.md) | JCS i hash, odsječci, potvrde i potpis, pohrana, rekonstrukcija |
| [sinkronizacija.md](sinkronizacija.md) | lokalni journal, stanja spremanja, potvrda, sukob, oporavak, odjava |
| [editor-i-dokument.md](editor-i-dokument.md) | model dokumenta, editor i identitet blokova, diff, citiranje, suradnja |
| [sucelje.md](sucelje.md) | rute, ljuska, tekst sučelja, skener zabranjenih izraza, pristupačnost |
| [prijava.md](prijava.md) | prijava AAI@EduHr, sesije, identitet i ustanova, lažni pružatelj lokalno i u CI-ju |
| [baza.md](baza.md) | sheme, uloge, tablice, RLS, pgTAP matrica, RPC, migracije, lokalni stog |
