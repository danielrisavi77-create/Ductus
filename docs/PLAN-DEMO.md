# Ductus: plan demoa za FPZG

Verzija 0.1 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi · Cilj: **ponedjeljak 2. 11. 2026.** (D-82)

Razrada odjeljka "Demo za fakultet" iz `PROGRAM.md` (D-76) na zadatke za sesije iz `docs/SESSIONS.md`. Svaki zadatak orkestrator šalje u obliku predloška iz `SESSIONS.md` §3; ova tablica je izvor za te poruke. Kad se plan i `PROGRAM.md` razlikuju u opsegu, vrijedi `PROGRAM.md`, a razlika se prijavljuje orkestratoru.

## 1. Što demo mora pokazati

Prema `PROGRAM.md`, na izmišljenom zadatku, lokalno u Dockeru, s lažnom prijavom označenom "demo prijava":

1. Nastavnik stvara kolegij i zadatak s obaviješću studentu (S3).
2. Student piše u pravom editoru (naslovi, citat, bibliografija u osnovnom obliku); stanja spremanja su stvarna, uključujući rad bez mreže i povratak.
3. Nastavnik vidi spremljeno stanje rada i ostavlja komentar uz odlomak.
4. Student predaje; poslužitelj rekonstruira rad, usporedba se podudara, student dobiva potpisanu potvrdu.
5. Student i nastavnik vide isti sažetak procesa; nema zabranjenih riječi ni postotaka.
6. Brz put za nastavnika (D-80): tekst rada, četiri retka i stanje zapisa.
7. Prvi ekran zadatka citira dopuštene i zabranjene uporabe iz FPZG čl. 8 (D-80).
8. Dvije izmišljene povijesti koje Ductus ne može razlikovati, uz objašnjenje granica zapisa (D-80).

**Izlazni kriterij:** prolaz 1 do 5 snimljen, E2E test tog prolaza zelen u CI-ju, nijedan stvarni osobni podatak. Točke 6 do 8 su u demou, ali nisu u izlaznom kriteriju; ako se kasni, režu se prve (§5).

## 2. Temelji demoa

**Odlučeno:** D-07, D-10, D-11 i D-24 (potvrđeni u D-81), citatni stil kopiran iz Lekte (D-83), sučelje samo na hrvatskom s tekstovima u ključevima (D-84), izgled editora i nastavničkog sučelja po prototipu (D-85).

**Gradi se uz PRIJEDLOG, iza sučelja, jer je promjena jeftina:** OIDC klijent `openid-client` (D-73 bira biblioteku na M1), red poslova pg-boss (D-74), potpis razvojnim Ed25519 ključem umjesto KMS-a (D-71), lokalni Postgres i S3-kompatibilna pohrana umjesto dobavljača (D-08). Ništa od toga ne veže demo uz dobavljača.

**Izvan demoa:** AAI prijava, AI pomoćnik, Lekta paket osim citatnog stila, uvoz i izvoz, dnevni korijen, mentorski radovi, reprodukcija, izravne izmjene nastavnika (D-34), engleski.

## 3. Tokovi i tjedni

| Tjedan | Razdoblje | Kontrolna točka (petak) |
| --- | --- | --- |
| T1 | 3. do 11. 10. | Kostur, CI i lokalni stog spojeni; dizajn odobren |
| T2 | 12. do 18. 10. | Jezgra prenesena (isti broj testova kao izvor); prijava i model fakulteta s pgTAP matricom; editor u aplikaciji sprema lokalno |
| T3 | 19. do 25. 10. | Evidencija na poslužitelju s potpisanim potvrdama; nastavnik vidi stanje i komentira; obavijest S3 i upis kodom |
| T4 | 26. 10. do 1. 11. | Predaja s rekonstrukcijom, sažetak procesa, E2E prolaz 1 do 5 zelen u CI-ju; proba u subotu 31. 10. |

Na svakoj kontrolnoj točki orkestrator uspoređuje stanje s tablicom i, ako se kasni, primjenjuje rezove iz §5 i javlja Danielu.

## 4. Zadaci

Oznaka uloge: P Platforma, B Backend, F Frontend, K kratkotrajna sesija, D Daniel. "Gotovo kad" je uvijek uz zelene testove, otvoren PR i Codex pregled bez otvorenih kritičnih nalaza, osim gdje piše drukčije. Za svaki backend zadatak uz to vrijede tvrda pravila iz `CLAUDE.md` i kontrolna lista iz `docs/BACKEND.md` §6: svaka nova tablica ima RLS i retke u pgTAP matrici s testom odbijanja; RPC-i izvode identitet iz `current_actor()`, nikad iz parametra; svaka ruta koja mijenja stanje odbija zahtjev bez ispravnog `Origin` i `Sec-Fetch-Site`.

### Platforma

| ID | Zadatak | Ovisi o | Gotovo kad | T |
| --- | --- | --- | --- | --- |
| P-1 | M0.1 kostur: pnpm, Node 24, Next.js i React kao u `pisac-editor`, TypeScript strict, ESLint, Vitest (unit, property), Playwright konfiguracija; bez Supabasea i Netlifyja | | `pnpm install`, `lint`, `typecheck`, `test` zeleni | T1 |
| P-2 | M0.4a CI na GitHub Actions: lint, typecheck, unit, property, Gitleaks, zizmor, Semgrep, OSV; lefthook lokalno | P-1 | CI zelen na `main`; namjerno pokvaren test ruši CI | T1 |
| P-3 | M0.4b `docker compose`: Postgres 17, S3-kompatibilna pohrana (RustFS; MinIO više nema sliku), Mailpit, lažni OIDC pružatelj (`node-oidc-provider`) s jasnom oznakom "demo prijava"; jedna naredba za podizanje | P-1 | `pnpm stack:up` diže sve; zdravstvene provjere zelene; isto radi u CI-ju | T1 |
| P-4 | Migracije (dbmate) i pgTAP u CI-ju (`pg_prove` nad Postgresom iz compose) | P-3 | Prazna migracija i jedan pgTAP test prolaze lokalno i u CI-ju | T2 |
| P-5 | E2E u CI-ju: Playwright nad stogom iz compose, axe, snimke zaslona i video kao artefakti PR-a | P-2, P-3 | Primjer E2E testa zelen u CI-ju; snimke vidljive uz PR | T2 |
| P-6 | Provjera zabranjenih riječi u CI-ju (rječnik iz `PRODUCT.md` §5) nad tekstovima sučelja | P-2 | Riječ iz rječnika u ključu teksta ruši CI | T2 |
| P-7 | Demo naredbe: `pnpm demo:up` (stog, migracije, izmišljeni podaci) i kratke upute za Daniela | P-3, K-3 | Daniel s čistog stanja podiže demo jednom naredbom | T4 |

### Backend

| ID | Zadatak | Ovisi o | Gotovo kad | T |
| --- | --- | --- | --- | --- |
| B-1 | Plan prijenosa backend jezgre (samo čitanje) | | Plan poslan orkestratoru | T1 |
| B-2 | M0.2a prijenos domene i forenzike (`src/domain` bez dijelova Frontenda) | P-1, B-1 | Isti broj prenesenih testova kao u izvoru, svi zeleni | T1 do T2 |
| B-3 | M0.2b prijenos `application/ports`, `application/evidence`, in-memory adaptera i ugovornih testova | B-2 | Isti broj testova kao u izvoru | T2 |
| B-4 | M0.2c crypto adapteri: razvojni Ed25519 potpisnik u upotrebi, KMS adapter prenesen ali ne spojen | B-3 | Ugovorni testovi potpisnika zeleni | T2 |
| B-5 | Uloge baze (`ductus_migrator`, `ductus_app`, `ductus_worker`, `ductus_evidence`), sesije u bazi, `current_actor()`, `withActor` (BACKEND §3, §4.3) | P-4 | Tablica sesija s uključenim RLS-om i retkom u pgTAP matrici; pgTAP: `ductus_app` ne vidi tablicu sesija ni uz isključen `REVOKE`; test da GUC ne ostaje na vezi | T2 |
| B-6 | Prijava preko lažnog OIDC-a: `openid-client`, PKCE, `state`, `nonce`, sesija u bazi, kolačić `__Host-`, odjava; test da produkcijska konfiguracija nema lažnog pružatelja | B-5, P-3 | Prijava i odjava rade; navedeni testovi zeleni | T2 |
| B-7 | Model fakulteta za demo (dio M2): fakultet, kolegij, članstvo, upis kodom, zadatak i verzija zadatka, potvrda obavijesti; RLS i pgTAP matrica | B-5 | Matrica pristupa zelena za studenta, nastavnika i stranca (drugi kolegij) | T2 do T3 |
| B-8 | Evidencija (dio M3): ruta `ingest`, odsječci (D-24), jedan RPC za CAS reviziju i `reserve`, hash lanac, spremanje u lokalnu S3 pohranu, idempotentno ponovno slanje | B-3, B-7 | Property testovi: izmjena, brisanje ili preslagivanje odsječka ruši provjeru; ponovno slanje ne duplicira; RPC izvodi identitet iz `current_actor()` i pgTAP dokazuje da `ductus_app` ne može dodati evidenciju s tuđim principalom; RLS i pgTAP retci za sve nove tablice evidencije; `ingest` odbija zahtjev s pogrešnim ili nedostajućim `Origin` i `Sec-Fetch-Site` (test) | T3 |
| B-9 | Worker: pg-boss, potpis potvrda razvojnim ključem, `attach_signature`; stanje `pending_signature` | B-4, B-8 | Potvrda potpisana; pad workera ostavlja `pending_signature` i oporavlja se | T3 |
| B-10 | Komentari uz odlomak: tablica, RPC, RLS, pgTAP | B-7 | Student vidi komentar na svom radu; stranac ne vidi ništa | T3 |
| B-11 | Pogled nastavnika: spremljeno stanje rada s osvježavanjem po P-03 (polling, D-06); podaci za brz put (D-80): zadnja promjena, otvoreni zahtjevi, lijepljenja bez izvora, stanje izjave | B-8 | Nastavnik ne dobiva novo stanje češće od P-03; test | T3 do T4 |
| B-12 | Predaja (dio M7): `requested_at` iz sata baze, rekonstrukcija u workeru, JCS usporedba, nepodudarnost blokira predaju (D-11), praznina vidljiva, potpisana potvrda | B-9 | Rekonstrukcija podudarna na scenarijima uključujući prazninu; nepodudarnost blokira | T4 |
| B-13 | Sažetak procesa: jedna funkcija za studenta i nastavnika (pravilo 5), sesije (P-01), lijepljenja (P-02), praznine, vrsta dokaza (D-44), stanje zapisa | B-8 | Test jednakosti studentskog i nastavničkog prikaza, uključujući API (D-80 točka 6) | T4 |

### Frontend

| ID | Zadatak | Ovisi o | Gotovo kad | T |
| --- | --- | --- | --- | --- |
| F-1 | Plan prijenosa editora, journala i sinkronizacije (samo čitanje) | | Plan poslan orkestratoru | T1 |
| F-2 | M0.3a prijenos `src/domain/sync`, `document`, `diff`, `serverSync` | P-1, F-1 | Isti broj testova kao u izvoru | T1 do T2 |
| F-3 | M0.3b editor (Tiptap), journal (Dexie) i klijent sinkronizacije s testovima; adapteri prema Supabaseu zamijenjeni sučeljem | F-2 | Isti broj testova kao u izvoru | T2 |
| F-4 | Ljuska aplikacije po odobrenom dizajnu: tokeni, raspored, navigacija, tekstovi u ključevima (hr) | P-1, D-2 | Snimke zaslona odgovaraju odobrenom dizajnu; axe bez kritičnih nalaza | T2 |
| F-5 | Ekran "demo prijava" i odjava; odjava s nesinkroniziranim promjenama blokirana uz poruku; journal prethodnog korisnika obrisan pri promjeni korisnika | B-6, F-4 | E2E: prijava, odjava, blokada | T2 do T3 |
| F-6 | Nastavnik: stvaranje kolegija i zadatka s obaviješću S3 i popisom dopuštenih i zabranjenih uporaba iz FPZG čl. 8 | B-7, F-4 | E2E: nastavnik stvara zadatak | T3 |
| F-7 | Student: upis kodom, prvi ekran zadatka (obavijest i čl. 8), potvrda; prije potvrde nema slanja evidencije | B-7, F-4 | E2E; test da prije potvrde ništa ne ide na poslužitelj | T3 |
| F-8 | Editor u aplikaciji: naslovi, citat i bibliografija u FPZG stilu (osnovno), stanja spremanja "spremljeno na uređaju" i "spremljeno na poslužitelju", rad bez mreže i povratak s oznakom | F-3, B-8, K-2 | E2E: prekid mreže, nastavak, ništa izgubljeno, offline oznaka ostaje | T3 |
| F-9 | Nastavnički pogled na rad u nastajanju i komentar uz odlomak | B-10, B-11, F-4 | E2E: komentar stiže studentu | T3 do T4 |
| F-10 | Predaja, potvrda i sažetak procesa (isti prikaz za oba) | B-12, B-13 | E2E: predaja, potvrda, isti sažetak | T4 |
| F-11 | Brz put za nastavnika (D-80): tekst rada, četiri retka, stanje zapisa, sortiranje po prezimenu | B-11, F-9 | E2E; nema sortiranja po brojevima | T4 |

### Kratkotrajne sesije i Daniel

| ID | Zadatak | Ovisi o | Gotovo kad | T |
| --- | --- | --- | --- | --- |
| K-1 | B0.4 prepis `docs/ARCHITECTURE.md` (sesija Arhitektura) | | PR spojen | T1 |
| D-1 | S8 dizajnerski sustav i ekrani demoa po prototipu (sesija Dizajn) | | Design artifact objavljen | T1 |
| D-2 | Daniel komentira dizajn; Dizajn sesija ispravlja; Daniel odobrava | D-1 | Daniel napiše "odobreno" | T1 |
| K-2 | Citatni stil (D-83): FPZG stil kopiran iz Lekte (`katedra-lite/references/fakulteti/fpzg.json`, `fpzg-diplomski/references/stranice-i-izvori.md`) u konfiguracijsku datoteku Ductusa; čista funkcija za citat u tekstu i bibliografiju | P-1 | Testovi s primjerima iz Lekte zeleni | T2 |
| K-3 | Izmišljeni podaci demoa: fakultet, kolegij, zadatak, nastavnik, dva studenta, i dvije povijesti koje Ductus ne može razlikovati (samostalan uvezeni tekst i postupno pretipkan tuđi tekst) s objašnjenjem granica zapisa (D-80 točka 3) | B-7, B-8 | Skripta puni bazu; nijedan stvarni osobni podatak | T3 |
| K-4 | E2E prolaz demoa 1 do 5 kao jedan Playwright test s videom | F-10, P-5, K-3 | Zelen u CI-ju; video priložen | T4 |
| D-3 | Proba demoa u subotu 31. 10.: Daniel prolazi demo sam, zapisuje primjedbe | K-4, P-7 | Primjedbe poslane orkestratoru | T4 |
| D-4 | Snimka prolaza 1 do 5 za sastanak | D-3 | Snimka postoji | T4 |

## 5. Rezovi ako se kasni

Redoslijed je odobren (D-87). Primjenjuju se redom, tek na kontrolnoj točki, kad orkestrator utvrdi kašnjenje; Daniel dobiva obavijest uz svaki primijenjeni rez:

1. Dvije izmišljene povijesti (K-3, dio za D-80 točku 3) prikazuju se kao unaprijed pripremljen primjer umjesto u živom prolazu.
2. Brz put za nastavnika (F-11) ide nakon demoa; nastavnik vidi rad i sažetak kroz F-9 i F-10.
3. Bibliografija samo u jednom obliku izvora (knjiga), citat u tekstu ostaje.
4. Video iz CI-ja zamjenjuje Danielovu snimku (D-4).

Ne režu se: rekonstrukcija i blokada nepodudarne predaje, isti sažetak za oba, rad bez mreže, pgTAP matrica, provjera zabranjenih riječi.

## 6. Kad se planira ostatak vala 1

Detaljan plan faze nastaje tek kad je okidač ispunjen; do tada vrijedi tablica faza iz `PROGRAM.md`.

| Faza | Okidač za detaljan plan |
| --- | --- |
| M1 AAI | FPZG ovlasti Daniela za AAI@EduHr Lab (nakon demoa) |
| M2 ostatak (komentor, povjerenstvo, pravno zadržavanje, jezik rada, mentorstvo) | Demo spojen; D-16 potvrđen |
| M3 ostatak (lijepljenje s oznakom, vrsta dokaza, spike programskog unosa D-54) | Demo spojen; B0.2 izmjeren |
| M4 Lekta paket | Odluka o licenci Lekte |
| M5 do M7 ostatak | Demo spojen i Danielove primjedbe s probe; D-34 za izravne izmjene |
| M10 Podaci | D-30 (rokovi čuvanja) od FPZG-a |
| M11 GO uvjeti | D-08 potvrđen nakon B0.1 i B0.2; računi dobavljača |
