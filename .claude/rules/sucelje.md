---
paths:
  - "app/**/*.tsx"
  - "app/**/*.css"
  - "src/components/**"
  - "src/lib/i18n/**"
  - "**/labels.ts"
  - "**/messages.ts"
  - "src/editor/schema.ts"
---

# Područje: tekst i izgled sučelja

Podsjetnik, ne pravilo. Pravila su u `docs/PRODUCT.md` §5 ("Rječnik sučelja") i `CLAUDE.md` ("Jezik").

- Prije predaje prođi skill `ductus-ui-copy`; za oznake spremanja i `ductus-sync-states`.
- Tekst sučelja na hrvatskom; nijedan izraz iz lijevog stupca rječnika, ni engleski ekvivalent.
- Dokaži da `scripts/forbidden-terms/scan.ts` čita datoteku s novim tekstom prije nego tvrdiš pokrivenost.
- Promjena koja dira pravilo iz `docs/PRODUCT.md` §5 je `Risk: critical`.
- Konačni smjer je „papir i grafit” (D-188), prema `docs/design/DESIGN-SYSTEM.md`; stare palete ne prenosi iz prototipa.
- Frontend PR prilaže snimke zaslona iz Playwrighta (`docs/SESSIONS.md` §6): za provjeru izgleda (D-183) prije „Spreman za review” cijela stranica, svijetla i tamna tema, 1440 i 400 px, uz referencu iz `docs/design/ductura`.
