---
name: ductus-editor-document
description: "Ductus document code: Tiptap editor and schema (src/editor), canonical document model and edit steps, diff, FPZG citations and collaboration anchors. Use when changing or reviewing src/editor or src/domain/document, diff, citation or collaboration."
paths:
  - "src/editor/**"
  - "src/domain/document/**"
  - "src/domain/diff/**"
  - "src/domain/citation/**"
  - "src/domain/collaboration/**"
  - "e2e/block-identity.spec.ts"
  - "e2e/editor-shell.spec.ts"
  - "e2e/local-editor.spec.ts"
---

# Ductus: router za editor i model dokumenta

Ova lokalna kopija služi samo kao router; Ductus repozitorij i kanonski dokumenti izvor su istine. Njezini raniji detalji o modulima, testovima ili implementaciji mogu biti zastarjeli.

U checkoutu pročitaj `docs/PRODUCT.md` §10–§11 za funkcije i opseg editora te `docs/ARCHITECTURE.md` §2, §5 i §5c za granice modula, put promjene i Lekta paket/uvoz. Za projektna pravila rada i testove pogledaj `docs/ENGINEERING_SYSTEM.md`, `docs/TESTING.md` i dodijeljeni issue. Ova vještina je router na te kanonske izvore; ne dodaje pravila o editoru.

Pregledaj aktualne `src/editor/`, `src/domain/document/` i povezane testove prije zaključka o modelu ili ponašanju. Ako se pojavi pravilo koje treba trajno vrijediti, predloži ga u kanonskim docs umjesto širenja ovog routera.
