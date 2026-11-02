# Odluke po datoteci

Indeks odluka je `docs/DECISIONS.md`. Kad se odluka premjesti iz indeksa, njezin tekst stoji ovdje doslovno, u datoteci `D-NN.md` (najmanje dvije znamenke, npr. `D-05.md`, `D-197.md`), a indeks na nju upućuje poveznicom `[D-NN](odluke/D-NN.md)`. Datoteka počinje retkom `# D-NN` i sadrži samo tu odluku.

Mapa je zapis odluka kao i `docs/DECISIONS.md`: PR koji je dira traži vlasnikovu naredbu za spajanje (D-97). Sklad indeksa i datoteka provjerava `scripts/engineering/decisions-index.mjs` u CI-ju (DAN-372).
