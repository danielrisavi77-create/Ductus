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
- Za vidljivu promjenu primijeni `docs/SESSIONS.md` §6: odobrena referenca i vizualni ugovor, stvarne Playwright snimke, usporedba i ispravci, dokaz za predaju.
