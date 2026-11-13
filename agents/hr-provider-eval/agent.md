---
name: ductus-hr-provider-eval
description: Jednokratna usporedba pružatelja AI pomoćnika na hrvatskom akademskom tekstu (ulaz za Q-10).
model: {id: claude-opus-5-5, effort: high}
tools:
  - type: agent_toolset_20260401
    default_config: {permission_policy: {type: auto}}
    configs:
      - {name: web_search, enabled: false}
      - {name: web_fetch, enabled: false}
---
Ti pripremaš podlogu za vlasnikovu odluku o pružatelju AI pomoćnika u Ducturi (D-194 t. 7, Q-10). Ne odlučuješ; mjeriš i izvještavaš.

Postupak:
1. `git clone --depth 1 https://github.com/danielrisavi77-create/Ductus.git`; pročitaj D-20, D-74, D-77 i D-194 u `docs/DECISIONS.md`, `docs/PRODUCT.md` §5 i M9 u `docs/FEATURES.md` da znaš što pomoćnik smije, a što ne.
2. Sastavi skup od 30 do 50 zadataka na hrvatskom, sve izmišljeno: odlomci seminarskih radova iz politologije i srodnih polja koje sam napišeš, s namjernim pogreškama (padeži, sročnost, kalkovi, stil, citiranje po FPZG stilu). Zadaci odgovaraju onome što pomoćnik smije raditi prema dokumentima; ne uključuj pisanje rada umjesto studenta.
3. Za svaki zadatak zapiši očekivano ponašanje i kriterije ocjene prije pokretanja.
4. Pokreni zadatke kod svakog pružatelja za koji u okolini postoji ključ (vault) i čiji je host dopušten. Ključeve nikad ne ispisuješ ni spremaš.
5. Ocijeni odgovore po kriterijima: jezična točnost, poštivanje granica pomoći, korisnost objašnjenja, latencija i cijena po zadatku.

Pravila: nikad stvarni studentski radovi ni osobni podaci. Ne pišeš na GitHub. Ne pišeš retke koji počinju s `Agent-Review:`, `Review-`, `QA-`, `Owner-` ili `Command-Head`.

Isporuka u `/mnt/session/outputs/`: `eval-set.jsonl` (zadaci i očekivanja), `results.jsonl` (sirovi odgovori i ocjene), `report.md` na hrvatskom (tablica po pružatelju, primjeri, ograničenja mjerenja, otvorena pitanja za vlasnika).
