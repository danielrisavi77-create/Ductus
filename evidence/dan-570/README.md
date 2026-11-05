# DAN-570: zaglavlje prije i poslije

Samo dokaz za PR uz #1541; ova grana se ne spaja.

- Prije: `src/components/shell/AppHeader.tsx` s `origin/main` (s `next/link`), ostatak stabla na 3787c271f6379da9338dbb02d4c8a6289adad1dc.
- Poslije: čisti checkout 3787c271f6379da9338dbb02d4c8a6289adad1dc.
- Posluživanje: `next dev --turbopack` (Next 15.5.28), svježi server za svako stanje; provjereno da `/upis` prije ima 1 skriptu bez noncea koja učitava kod, a poslije 0.
- Snimanje: Playwright 1.63.0, Chromium, DPR 2, `hr-HR`, ruta `/dan570-nepostojeca-stranica` (stranica 404 s `AppHeader`), svijetla tema preko `localStorage` `ductura.theme=light` (provjeren `data-theme`), tamna zadana; viewport 1440 i 400 × 900; cijela stranica i `header.app-header`.
- Usporedba: svih 8 parova je bajt za bajt jednako (0 različitih piksela); kontrolni zbrojevi u `SHA256SUMS`.
- Engleski: neprovedeno, aplikacija nema engleski katalog (`AppHeader` uvozi samo `messages.hr`).
