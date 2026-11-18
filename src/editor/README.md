# editor-core (`src/editor`)

Paket uređivača: Tiptap uređivač i shema dokumenta za uređivač (DAN-927, E-0.1).

## Ulaz

Jedini ulaz je `src/editor/index.ts`, uvozi se kao `@/editor` (iz `e2e/` i `spikes/` relativnom putanjom do mape, npr. `../../src/editor`). Kod izvan `src/editor/` ne uvozi pojedine module (`@/editor/schema`, `../../editor/capture` i slično). Javni popis imena ulaza drži test `src/editor/index.test.ts`; automatski čuvar granice dolazi u DAN-927 (dio 927-b2).

Unutar `src/editor/` moduli i testovi uvoze jedni druge izravno.

## Što ulaz izvozi

- javne module paketa (`export *`);
- iz `block-marker` i `text-block` samo `blockMarkerRule`, `textBlockEnter` i `textBlockBackspace`, jer oba modula definiraju `markerRemoval` i `markerToBlock`; ta dva pomoćnika ostaju unutarnja;
- ne izvozi testove ni `capture.fixture.ts` (pomoćnik za testove koji uvozi `@/adapters/evidence` i `node:crypto`).

## Granice

Kanonski model dokumenta (`src/domain/document`) nije dio paketa; paket ovisi o njemu. Objava paketa i vlastiti `package.json` su DAN-888.

## Veličina paketa u pregledniku

Moduli u `src/editor` pri učitavanju ne izvode ništa osim deklaracija. Zato ih `next.config.ts` označava kao `sideEffects: false`, pa stranica koja kroz `@/editor` uvozi jedan modul ne dobiva cijeli paket. Novi modul s nuspojavom pri učitavanju (CSS, registracija, `window`) traži promjenu tog pravila.
