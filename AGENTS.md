# Ductus: upute za AI coding agente

Ovaj je dokument ulazna točka za Codex i druge agente koji automatski čitaju `AGENTS.md`. Ductus podržava tri eksplicitna načina rada: **worker**, **review** i **orchestrator**. Provider ili račun ne određuju ulogu.

Prije rada pročitaj `CLAUDE.md`, `STATE.md` i `docs/MULTI-ACCOUNT.md`. Za detalje o paralelnom radu čitaj `docs/SESSIONS.md`; orkestrator dodatno čita `docs/ORKESTRATOR.md`.

## Odabir načina rada

- **review**: `codex exec review`, zadatak koji izričito traži pregled/audit PR-a ili aktivirani skill `ductus-review`. Ne mijenjaj kod.
- **worker**: zadatak `ZADATAK <id>`, eksplicitna implementacija/popravak ili aktivirani skill `ductus-worker`. Smiješ mijenjati samo dodijeljene mape.
- **orchestrator**: samo kad zadatak izričito kaže da si Ductus orkestrator ili aktivira `ductus-orchestrator`. Ne piši proizvodni kod.

Ako način nije jasan, ne pretpostavljaj ovlast za pisanje. Pregled ili analiza bez eksplicitnog implementacijskog zadatka je read-only.

## Zajednička pravila

- Tvrda pravila su u `CLAUDE.md` i vrijede za svaki runtime.
- GitHub i repo su zajednički control plane. Chat memorija, session-ID, privatni skill ili account-level postavka nikad nisu jedini izvor projektnog konteksta.
- Svaki writer radi u zasebnom branchu/worktreeu od svježeg `origin/main`.
- Vlasništvo mapa, tijek zadatka i izvještaj definirani su u `docs/SESSIONS.md` i `docs/MULTI-ACCOUNT.md`.
- Ne mijenjaj granu drugog workera. Ne spajaj vlastiti PR.
- Tajne, tokeni, auth datoteke i osobni podaci ne ulaze u repo, issue ni PR.

## Worker

1. Pročitaj samo izvore navedene u zadatku, uz obvezne dokumente gore.
2. Provjeri da su branch i worktree namijenjeni samo tom zadatku.
3. Mijenjaj samo mape dodijeljene ulozi.
4. Pokreni tražene testove i provjere.
5. Otvori PR i u tijelo stavi `IZVJEŠTAJ` iz `docs/MULTI-ACCOUNT.md`.
6. Sve što drugi račun mora znati zapiši u PR/issue/repo. Session URL može biti samo dodatak.
7. Stani nakon predaje ili blokade.

## Neovisni pregled

U review načinu čitaj samo odjeljke koji se tiču diffa: `CLAUDE.md`, `STATE.md`, `docs/PRODUCT.md` §5, `docs/BACKEND.md` §3/§4/§6 kad je primjenjivo i `docs/DECISIONS.md`.

Traži, po važnosti:

1. **Kršenje tvrdih pravila iz `CLAUDE.md`**: druga prijava osim AAI@EduHr (osim lažnog pružatelja samo lokalno i u CI-ju), klijent koji piše izravno u tablice evidencije, predaje ili revizijskog traga, nova tablica bez RLS-a ili bez retka u pgTAP matrici, stvarni osobni podaci u testovima, tajne u repou, obrisan, preskočen ili oslabljen test bez zamjene.
2. **Ispravnost i sigurnost**: identitet iz parametra umjesto iz `current_actor()`, `SECURITY DEFINER` bez praznog `search_path`, `SET` bez `LOCAL`, SQL injekcija, nedostajuća provjera `Origin`, curenje sadržaja rada u logove, utrke i neidempotentni ponovni pokušaji, krivo rukovanje hashom, JCS-om ili potpisom.
3. **Pravila proizvoda**: zabranjene riječi ili postoci u tekstu sučelja, tvrdnje o autorstvu, sučelje koje izgleda kao presuda o studentu.
4. **Testovi**: promjena ponašanja bez testa, test koji ne može pasti, mock koji skriva stvarnu granicu.
5. **Opseg**: PR koji radi više od jednog koraka iz `STATE.md` ili prelazi oko 400 promijenjenih redaka koda bez obrazloženja.

Ne prijavljuj stil, imenovanje ni sitnice koje hvata linter.

Za svaki nalaz piši na hrvatskom:

```
[KRITIČNO | VAŽNO | MANJE] putanja:redak
Što: jedna rečenica.
Scenarij: konkretan ulaz ili stanje → pogrešan ishod.
Prijedlog: jedna rečenica.
```

Na kraju napiši `Ukupno: N kritično, N važno, N manje.` Ako nema nalaza, samo `Bez nalaza.` Ne izmišljaj nalaze.

## Orkestrator

U orchestrator načinu slijedi `docs/ORKESTRATOR.md`. GitHub stanje ima prednost pred session-listom pojedinog računa. Direktne cross-session poruke su optimizacija, ne protokol.
