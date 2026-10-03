# Ductus: rad u paralelnim sesijama

Verzija 0.2 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Kako više Claude Code sesija radi na Ductusu istodobno. Vrijedi uz `CLAUDE.md`; u sukobu vrijedi `CLAUDE.md`.

## 1. Uloge

| Uloga | Posao | Vlasnik mapa | Model i napor |
| --- | --- | --- | --- |
| **Orkestrator** | Plan, `STATE.md`, dodjela zadataka, dnevnik, Owner queue, praćenje tokena. Ne piše kod. | `STATE.md`, `docs/` (osim ARCHITECTURE kad ga drži druga sesija) | Opus, high |
| **Platforma** | Kostur projekta, CI, `docker compose`, lefthook, skeneri, migracijski alat, kasnije OpenTofu i operacije | korijenske konfiguracije (`package.json`, `tsconfig*`, `eslint*`, `vitest*`, `playwright*`), `.github/`, `compose.yaml`, `lefthook.yml`, `scripts/`, `infra/` | Sonnet, medium |
| **Backend** | Baza, uloge, RLS, pgTAP, RPC-i, evidencija, OIDC i sesije, worker, rekonstrukcija, potpisi | `src/domain/`, `src/application/`, `src/adapters/`, `src/server/`, `db/`, `app/api/`, `tests/` za te mape | Opus, high (evidencija, ovlasti, prijava); Sonnet za rutinu |
| **Frontend** | Editor (Tiptap), journal i sinkronizacija u pregledniku (Dexie), ekrani, hr/en, pristupačnost, zabranjene riječi | `app/` (osim `app/api/`), `src/components/`, `src/editor/`, `src/client/`, `src/lib/i18n/`, `e2e/` | Sonnet, medium; Opus za sinkronizaciju |
| **Kratkotrajna** | Jedan zadatak pa se arhivira: prepis dokumenta, spike, istraživanje | zadano u zadatku | prema zadatku |

Codex nije sesija nego neovisni recenzent PR-a (§5).

Pravila vlasništva:

- Sesija mijenja samo svoje mape. Ako mora dirati tuđu, staje i javlja orkestratoru; orkestrator dogovara redoslijed.
- `package.json` i lockfile mijenja samo Platforma. Backend i Frontend traže novu ovisnost kroz izvještaj ("treba paket X, zašto"), a Platforma je dodaje u zasebnom malom PR-u. Iznimka: dok Platforma ne postoji, ovisnost dodaje sesija koja prenosi kod, uz napomenu u opisu PR-a.
- `src/domain/` dijele Backend i Frontend (sinkronizacija i dokument). Vlasnik je Backend; Frontend smije mijenjati `src/domain/sync`, `src/domain/document`, `src/domain/diff` i `src/domain/serverSync` uz oznaku u opisu PR-a.
- `STATE.md` mijenja samo orkestrator.

Najviše četiri sesije koje pišu kod istodobno. Usko grlo je pregled i spajanje PR-ova, ne broj sesija.

## 2. Tijek jednog zadatka

1. Orkestrator šalje zadatak (predložak u §3) sesiji odgovarajuće uloge.
2. Sesija radi u svom worktreeu na grani `<uloga>/<kratki-opis>` (npr. `backend/m0-port-domain`), od svježeg `origin/main`.
3. Testovi i provjere lokalno zeleni (`pnpm lint`, `pnpm typecheck`, `pnpm test`); lefthook to radi pri commitu.
4. Sesija otvara PR (jedan korak iz `STATE.md`, do oko 400 redaka; veći PR obrazlaže zašto).
5. Sesija pokreće Codex pregled (§5) i ispravlja nalaze koje prihvaća; odbijene nalaze obrazlaže u PR-u.
6. Sesija šalje izvještaj orkestratoru (predložak u §3) i staje.
7. Spaja samo sesija "Ductus orkestrator" (izričita ovlast Daniela, 3. 10. 2026.), kad Codex nema otvorenih kritičnih nalaza i PR ne čeka Danielovu odluku. Radne sesije nikad ne spajaju PR, ne mijenjaju `.claude/` postavke i ne diraju postavke repoa na GitHubu.
8. Orkestrator ažurira `STATE.md` i dnevnik, šalje sljedeći zadatak ili arhivira sesiju (arhiviranje briše worktree).

Kad sesija zapne na odluci (PRIJEDLOG, nejasan zahtjev, tuđa mapa), ne nagađa: šalje izvještaj sa statusom "blokirano" i staje.

### 2a. Kad poruka ne stigne

Izvještaj u opisu PR-a je izvor istine; poruka je samo obavijest. Ništa u tijeku ne smije čekati na poruku.

1. **Sesija:** ako slanje vrati "nije dostavljeno", pokuša još jednom. Ako ni tad ne prođe, doda PR-u oznaku `izvjestaj-ceka` (oznaku jednom stvara Daniel; dok ne postoji, umjesto nje komentar na PR-u "IZVJEŠTAJ čeka orkestratora") i staje. Ne ponavlja u petlji i ne čeka odgovor.
   **Kad PR ne postoji** (status "blokirano" prije PR-a ili "gotovo bez PR-a"), sesija nakon neuspjelog ponovnog pokušaja otvara GitHub issue s naslovom `IZVJEŠTAJ <id>`, izvještajem u tijelu i istom oznakom (ili bez nje dok ne postoji), i staje.
2. **Orkestrator ne ovisi o porukama:** na početku svakog poteza pregleda otvorene PR-ove (`gh pr list --label izvjestaj-ceka` i PR-ove svih dodijeljenih zadataka) i otvorene issuee s naslovom `IZVJEŠTAJ` (`gh issue list --search "IZVJEŠTAJ in:title"`), obrađuje izvještaje i zatvara obrađene issuee.
3. **Stanje sesija:** `notify_when_idle` ne radi za sesije desktop aplikacije (provjereno 3. 10. 2026.), pa orkestrator na početku poteza uz PR-ove pogleda i popis sesija (radi, miruje, PR otvoren ili spojen), bez ispitivanja u petlji.
4. **Jedan orkestrator:** aktivna je samo jedna sesija s imenom "Ductus orkestrator"; stara se arhivira ili preimenuje. Zadatak nosi točnu adresu orkestratora (ime i ref, npr. `Ductus orkestrator [b568f5]`), a sesija odgovara na adresu iz `from` poruke zadatka.
5. **Sesija koja šuti:** ako sesija ne otvori PR u očekivanom vremenu, orkestrator pogleda njezino stanje na popisu sesija (zauzeta ili miruje) i pita je jednom. Poruke tipa "jesi li gotova?" se ne šalju.

## 3. Predlošci

### Zadatak (orkestrator → sesija)

```
ZADATAK <id> · uloga: <uloga> · korak iz STATE.md: <naziv>
Orkestrator: <ime i ref, npr. Ductus orkestrator [b568f5]>
Cilj: <jedna rečenica>
Ulaz: <dokumenti i odjeljci koje treba pročitati, ništa više>
Opseg: <što ulazi>; Izvan opsega: <što ne ulazi>
Mape: <smije dirati>
Gotovo kad: <provjerljiv kriterij, npr. naredba i očekivani ishod>
Ovisi o: <PR ili ništa>
```

### Izvještaj (sesija → orkestrator)

```
IZVJEŠTAJ <id> · status: PR otvoren | blokirano | gotovo bez PR-a
PR: <poveznica>
Napravljeno: <3 do 5 stavki>
Testovi: <naredba i rezultat>
Codex: <broj nalaza, prihvaćeno, odbijeno uz razlog>
Otvoreno ili blokira: <stavke ili "ništa">
Treba Daniel: <odluka ili "ništa">
```

Izvještaj ide porukom orkestratoru na adresu iz zadatka (ili iz `from` poruke zadatka). Isti sadržaj ide u opis PR-a, pa ništa ne ovisi samo o poruci; ako poruka ne stigne, vrijedi §2a.

## 4. Štednja tokena

- **Jedan zadatak, jedna sesija.** Nakon spajanja PR-a sesija se arhivira; novi zadatak dobiva svježu sesiju. Dugi razgovori skupi su na svakom potezu.
- **Čitaj samo ulaz iz zadatka.** `CLAUDE.md` traži `STATE.md`; ostale dokumente samo odjeljke navedene u zadatku.
- **Pretraživanje preko pomoćnog agenta** (Explore) kad treba pregledati mnogo datoteka; u glavni razgovor vraća se zaključak, ne sadržaj.
- **Testovi kroz naredbe s kratkim izlazom** (npr. `vitest run --reporter=dot`); puni izlaz samo za test koji pada.
- **Bez nepotrebnih pluginova i konektora** u ovom projektu (`.claude/settings.local.json`, §7).
- **Model po ulozi** iz tablice u §1. Opus samo gdje je pogreška skupa.
- **Predaja posla kroz `STATE.md` i opis PR-a**, ne kroz prepričavanje u razgovoru.
- **Codex pregledava samo diff PR-a**, ne cijeli repo.

## 5. Neovisni pregled (Codex)

Nakon otvaranja PR-a sesija pokreće:

```
powershell -File scripts/codex-review.ps1
```

Codex radi i desetak minuta, pa se skripta pokreće u pozadini s vremenskim ograničenjem od najmanje 20 minuta; inače se prekine prije objave komentara. Skripta pokreće `codex exec review --base origin/main` (samo diff grane), Codex sam čita upute iz `AGENTS.md`, a nalaz ide kao komentar na PR. Codex troši ChatGPT kvotu, ne Claude kvotu. Sesija ispravlja prihvaćene nalaze i u izvještaju navodi odbijene s razlogom. Kritičan nalaz koji sesija ne može riješiti znači status "blokirano".

## 6. Dizajn

1. Prije koda: dizajnerski sustav i ključni ekrani demoa kao Design artifact; Daniel ih komentira i odobrava. Frontend gradi samo po odobrenom.
2. Svaki frontend PR prilaže snimke zaslona iz Playwrighta (širok i mobilni prikaz, hr i en).
3. Na zahtjev: lokalno pokretanje i pregled u pregledniku unutar aplikacije. Javni preview tek nakon D-08.

## 7. Okruženje i održavanje

- **Lokalne postavke** (`.claude/settings.local.json`, nije u gitu, kopira se u svaki worktree preko `.worktreeinclude`): isključeni claude.ai pluginovi, skillovi i konektori koji ne trebaju Ductusu; poruke između sesija primaju se bez dodatnog odobrenja. Datoteku stvara Daniel (agent ne mijenja vlastite postavke):

  ```json
  {
    "syncClaudeAiPlugins": false,
    "syncClaudeAiSkills": false,
    "disableClaudeAiConnectors": true,
    "crossSessionInbound": "accept"
  }
  ```
- **Worktreeovi**: aplikacija ih stvara u `.claude/worktrees/`. Arhiviranje sesije briše worktree; u postavkama aplikacije uključeno je automatsko arhiviranje nakon spajanja ili zatvaranja PR-a. Skripta `scripts/cleanup-worktrees.ps1` uklanja preostale worktreeove čija je grana spojena u `main`.
- **Paketi**: pnpm (zajednička pohrana paketa, manje mjesta na disku po worktreeu). Node 24 (`.nvmrc`).
- **Praćenje**: orkestrator vodi nadzornu ploču "Ductus pult" (privatni artifact, https://claude.ai/artifact/UY9VUZPW4mePTZjhCPGLSd) s vremenskom crtom, stanjem sesija i potrošnjom tokena. Potrošnju po sesiji daje `powershell -File scripts/usage-report.ps1` (ccusage nad lokalnim zapisima; trošak je procjena po API cijenama, ne naplata pretplate).
