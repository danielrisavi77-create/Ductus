# Ductus Engineering System v1

Verzija 1.2 · 29. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Ovaj dokument definira kako AI tim razvija Ductus. Ne mijenja proizvodni Ustav, `PRODUCT.md` ni tehničku arhitekturu. Cilj je povećati brzinu bez gubitka neovisnog pregleda, testabilnosti i jasnog vlasništva.

## 5. Risk razine

### low

Dokumentacija, copy bez promjene značenja, preimenovanja, jednostavna konfiguracija, mali dependency update bez runtime promjene.

Gate:
- CI;
- Dependency review kad je primjenjivo;
- neovisni review **nije obavezan**.

### standard

Frontend ponašanje, editor, adapteri, API bez novih ovlasti, migracije bez security granice, CI promjene, portovi, refaktori.

Gate:
- CI;
- Dependency review;
- neovisni review **nije obavezan** (isto kao low), osim ako risk floor digne na critical ili dira D-97.
- dodatni QA po procjeni Orkestratora.

### critical

Identity, authz, RLS, evidence, submission, kripto, workflowi, gate skripte, D-97 putanje.

Gate: CI + dependency review + neovisni review + QA (s izuzećima za pure test-only / docs-only).

### Auto-merge

Kad je PR `Risk: low` ili `standard` (ili test-only), nema D-97 putanja, nije draft i CI + gate su zeleni, gate objavljuje **Auto-merge eligible**. Mergify automatski queuea.

### Automatski risk floor

- `tests/` više nije blanket-critical. Čisti test PR-ovi mogu ostati standard ili low.
- D-97 putanje, workflowi, `scripts/engineering/`, auth/evidence i ostale trust granice ostaju critical.

(Ostatak dokumenta ostaje kao na mainu; ova verzija dokumentira samo promjene 1+2+3.)
