# Ductus: razrada faza M0 do M11

Verzija 0.1 · 31. 10. 2026. · Dopuna `docs/PROGRAM.md` prema D-191 (trag: #87 [c.6524612217](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6524612217); vlasnikovo odobrenje 31. 10. 2026.: „Može, kreni bez datuma”).

Dokument daje redoslijed faza i koraka, **bez datuma**. Ciljni datumi po fazi i kontrolne točke su u D-199 t. 6 (ODLUČENO 1. 11. 2026.; novi raspored iz D-191 t. 2) i u Linear milestoneovima. Sadržaj faza i izlazni kriteriji ostaju u tablici faza u `docs/PROGRAM.md`; ovdje su razloženi na korake. U sukobu vrijede `docs/PROGRAM.md`, `docs/PRODUCT.md`, `docs/BACKEND.md` i `docs/DECISIONS.md`.

## Kako čitati

- **Gotovo na mainu**: provjereno u kodu na `main` `5517896f` (31. 10. 2026.), ne prema planu. „Djelomično” znači da postoji dio, ali izlazni kriterij nije dokazan.
- **Koraci**: jedan korak je jedan zadatak, obično jedan ili nekoliko PR-ova. Uloga: **B** Backend, **F** Frontend, **P** Platforma, **V** vlasnik (nije posao agenta). Tiketi za korake stvoreni su 31. 10. 2026. i upisani u stupac Tiket; oznaka „novo” znači da korak još nema DAN tiket, a prijedlog tiketa ide orkestratoru. Linear ne mijenja ova razrada.
- **Ekrani**: oznake iz mape ekrana od 31. 10. 2026. (S student, N nastavnik i mentor, K koordinator i povjerenstvo, A administrator fakulteta, J javni posjetitelj, Z zajednički elementi). Ocjene mape o stanju u kodu treba provjeriti prije gradnje.
- **Oznake PLAN-TOKOVI**: A1 do E3 su koraci iz `docs/engineering/PLAN-TOKOVI-2026-10-25.md`.
- Sigurnosni nalazi navode se samo kao ID; pojedinosti su u privatnom registru.
- Faze idu redom po ovisnostima, ali koraci različitih uloga teku usporedno kad ne ovise jedan o drugom. Faza je gotova tek kad je uvjet završetka dokazan testom ili zapisom.
- **Uvjetni koraci (val 3, T3)**: korak označen „(uvjetno)” čeka odluku vlasnika, izmjenu Ustava ili PRODUCT §5, ili pravno mišljenje, i **ne gradi se** dok se uvjet ne riješi. Uvjetni korak nije dio uvjeta završetka svoje faze; uvjeti su u odjeljku „Uvjetni koraci” niže (odluka orkestratora T3, #87 c.6544288967, opcija C).
- **Oznake iz mape ekrana** u ugovorima i tiketima uvijek idu s punim nazivom ekrana, jer kolidiraju s oznakama u `docs/FEATURES.md` i `docs/DECISIONS.md` (npr. S-14, A-10, P-01). Mapa ekrana nije u repou.

## Redoslijed

M0 → M1 (čeka AAI@EduHr Lab) i M2 → M3 → M5 i M6 → M7 → M4 (čeka licencu Lekte) i M8 → M10 → M9 → M11. M4 i M8 dijele izvoz u obliku fakulteta, pa izvoz DOCX-a ide nakon M4. M9 ne blokira nijednu drugu fazu. Koraci vezani uz vanjske račune (B0.1) i AAI Lab ne zaustavljaju ostale korake.

## M0 Temelj

**Cilj:** repo, CI, lokalni stog i pravila gradnje na kojima stoje sve ostale faze.

**Gotovo na mainu:** CI u `.github/workflows/ci.yml` (lint, typecheck, unit, property, integration, pgTAP preko `pg_prove`, E2E i E2E prijave); sigurnosni posao (Gitleaks nad cijelom poviješću, zizmor, Semgrep, OSV); axe (`e2e/accessibility.spec.ts`); `lefthook.yml`; `compose.yaml` (Postgres 17, RustFS, Mailpit, lažni OIDC); dbmate s 52 migracije i 50 pgTAP datoteka; provjera zabranjenih izraza u CI-ju. Provjereno na `main` `34b94dab` (1. 11. 2026.): E2E na Chromiumu, Firefoxu i WebKitu dio je obveznog statusa „Local stack (compose.yaml)” na svakom PR-u (#1097, M0.3); skener zabranjenih izraza čita i tekst svojstava izvan JSX-a (#552, `247efb68`, M0.4); testovi pravila hookova prolaze na Linuxu u obveznom poslu „Lint, typecheck, test and build” (DAN-136, M0.7). **Djelomično:** kriterij „isti broj prenesenih testova kao u izvoru” vlasnik je zamijenio dokumentiranom jednakovrijednošću (#87 c.6547174354); karta je u `docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md`, a 24 nepokrivena slučaja vraćaju se kao testovi; ljuska još nije u konačnom vizualnom smjeru D-188.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M0.1 | Zapis prijenosa jezgre: broj testova u izvoru i na mainu (`docs/engineering/prijenos-jezgre-M0.1.md`) | P | | DAN-376 |
| M0.2 | Sedam zaštitnih mjera za dbmate (D-91) | P | | DAN-71 |
| M0.3 | E2E na Firefoxu i WebKitu kao obvezna provjera | P | | DAN-114, DAN-232; gotovo: #1097 (`34b94dab`) |
| M0.4 | Skener zabranjenih izraza i za tekst izvan JSX-a | P | | DAN-133; gotovo: #552 (`247efb68`) |
| M0.5 | Ljuska u konačnom vizualnom smjeru „papir i grafit”: tokeni, navigacija, dijalozi, mobilni raspored | F | D-188 (#972) | DAN-344 (#973, #974) |
| M0.6 | Nalazi kontrolne ravnine i review gatea s rokom prije prvog stvarnog studenta (samo ID): F-010, F-011, F-012, F-013, F-014, F-015, F-017, F-023, F-027, F-033, F-035, F-039, F-040, F-041, F-045, F-046 | P | | DAN-141 do DAN-144, DAN-153 do DAN-155, DAN-161, DAN-163, DAN-166, DAN-168, DAN-171 do DAN-173, DAN-177, DAN-178 |
| M0.7 | Testovi pravila hookova prolaze na Linuxu | P | | DAN-136; gotovo na `main` `34b94dab` |

**Ekrani:** Z-01 ljuska i navigacija, Z-04 greška i 404, Z-06 učitavanje, Z-08 dijalozi, Z-13 tema.

**Uvjet završetka:** CI zelen na `main` uz obvezan E2E na Chromiumu, Firefoxu i WebKitu; zapis M0.1 postoji; mjere D-91 spojene; nalazi iz M0.6 zatvoreni u privatnom registru; ljuska prošla vizualnu provjeru prema D-183.

## M1 Prijava preko AAI@EduHr

**Cilj:** studenti i nastavnici prijavljuju se isključivo preko AAI@EduHr (D-09, D-16), a račun je vezan uz izdavatelja i `hrEduPersonUniqueID`.

**Gotovo na mainu:** vlastiti OIDC klijent (`src/server/auth/`, `app/api/auth/{login,callback,logout}`) s PKCE, `state` i `nonce`; sesije u bazi; jedinstvenost (`oidc_issuer`, `hr_edu_person_unique_id`) bez spajanja po e-pošti (`db/migrations/20261003210100_identity_session.sql`, D-73), čime je D-104 pokriven na razini sheme; test da produkcijski build nema lažnog pružatelja (`tests/unit/auth/build-mode.test.ts`); pgTAP 020 do 022; ekran `/prijava`. **Nema:** prijave na stvarnom AAI@EduHr Labu.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M1.1 | Ovlast za AAI@EduHr Lab i registracija usluge | V | FPZG, Srce | DAN-196, DAN-198 |
| M1.2 | Prijava na Labu: konfiguracija klijenta, mapiranje hrEdu atributa, zapis prolaza s testnim računom | B | M1.1 | DAN-377 |
| M1.3 | Afilijacija djelatnika pri potvrdi nastavničke uloge | B | M1.2 | DAN-304 |
| M1.4 | Odjava kod pružatelja (RP-initiated logout) | B | M1.2 | DAN-212 |
| M1.5 | Izravni unit testovi `flow.ts` i `oidc.ts` | B | | DAN-307 |
| M1.6 | CSP, HSTS, Permissions-Policy i istek neaktivne sesije | B | | DAN-296 |
| M1.7 | Nalazi identiteta i sesija (samo ID): F-020, F-021, F-022, F-036, F-151 | B | | DAN-158, DAN-159, DAN-160, DAN-169, DAN-342 (#861) |
| M1.8 | Ekran „nema ovlasti” (401/403) i poruka o isteku sesije | F | | DAN-378 |

**Ekrani:** S-01 prijava, Z-03 sesija istekla, Z-05 nema ovlasti.

**Uvjet završetka:** zapisan uspješan prolaz prijave na Labu; `app_user` vezan uz `hrEduPersonUniqueID`; test da drugi izdavatelj s istim identifikatorom ne dobiva isti račun (D-104); CI test bez lažnog pružatelja u produkciji zelen; nalazi iz M1.7 zatvoreni.

## M2 Model fakulteta

**Cilj:** ustanova, kolegiji, članstva, zadaci i mentorstva s ovlastima koje dokazuje pgTAP matrica, uz administraciju ustanove u sučelju.

**Gotovo na mainu:** ustanova, uloge, kolegij s pravilom AI-ja (D-52, D-175), članstvo, upis kodom, zadatak i verzije, potvrda obavijesti, raspon riječi zadatka, mentorstvo kao tablica s RLS-om (#925); pgTAP 030 do 037; HTTP rute `app/api/institution/**`; revizijski trag upisa i članstva (#819, #840); ekrani `/zadaci`, `/upis`, `/zadatak/[id]`, `/nastavnik`, `/nastavnik/zadatak/novi`; ruta za novu verziju zadatka (#870). **Nema:** oznake prilagodbe (D-50), dodjele mentorstva i njezina sučelja, administracije ustanove, komentora i povjerenstva, jezika rada odvojenog od jezika sučelja (F-06).

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M2.1 | Rad nastaje tek na „Započni rad”, uz korak na poslužitelju | F, B | | DAN-330 (#830), DAN-331 (#831) |
| M2.2 | HTTP rute za preostale institucijske RPC-ove | B | | DAN-292 |
| M2.3 | Studentska projekcija kolegija, zadataka i radova; ekran Moji radovi (B1, B2) | B, F | | DAN-309, #941 |
| M2.4 | Zadatak u postojećem kolegiju, uređivanje s pregledom posljedica i čarobnjak zadatka (B3, B8) | F | M2.2 | DAN-310 |
| M2.5 | Popis studenata kolegija i zadatka s imenima | B, F | | #948 (DAN-344) |
| M2.6 | Mentorstva: put evidencije, čitači i RPC za dodjelu | B | vlasnik za RPC (D-182 t. 1) | DAN-349 (#947) |
| M2.7 | Nastavni tim kolegija i seminarske grupe | B | | DAN-351 |
| M2.8 | Komentor i povjerenstvo s vremenski ograničenim pristupom (model, N-08, N-09) | B | M2.6 | DAN-379 |
| M2.9 | Oznaka odobrene prilagodbe (D-50): nastavnik vidi oznaku, ne razlog | B, F | | DAN-380 |
| M2.10 | Jezik rada odvojen od jezika sučelja (F-06) | B | | DAN-386 |
| M2.11 | Administracija ustanove: pregled, korisnici i uloge, kolegiji i akademske godine (C1 do C3) | B, F | M1.3 | DAN-313 |
| M2.12 | Pravila fakulteta i njihove verzije (D-117, D-175) | B, F | M2.11 | DAN-315 |
| M2.13 | Potvrda obavijesti veže otisak teksta obavijesti | B | | DAN-306 |
| M2.14 | Mentorovi radni zapisi navedeni u obavijesti studentu (D-130) | F | | DAN-235 (#553) |
| M2.15 | Nalazi granice baze (samo ID): F-018, F-019; RLS uz `current_actor()` kao initplan | B | | DAN-156, DAN-157, DAN-51 |

**Ekrani:** S-02 studentska početna, S-03 moji kolegiji, S-04 upis kodom, S-05 obavijest (dio o zadatku), N-01 moji kolegiji, N-02 novi kolegij i zadatak, N-03 čarobnjak zadatka, N-04 popis studenata, N-16 radovi uz mentora (podaci), A-01 pregled ustanove, A-02 korisnici i uloge, A-03 kolegiji i akademske godine, A-04 pravila fakulteta.

**Uvjet završetka:** pgTAP matrica zelena za studenta, nastavnika, mentora, komentora, člana povjerenstva, administratora i osobu druge ustanove; E2E: administrator potvrdi nastavnika, nastavnik napravi kolegij i zadatak, student se upiše i potvrdi obavijest; svaki RPC koji mijenja stanje ima HTTP rutu ili zapisan razlog zašto je nema.

## M3 Evidencija

**Cilj:** svaka promjena dokumenta postaje cjelovit, potpisan i provjerljiv zapis, i kad student radi bez mreže.

**Gotovo na mainu:** JCS i hash lanac, odsječak v2 i v3, potvrda (`src/domain/forensics/`); izvori unosa uključujući lijepljenje (D-43) i vrste dokaza (D-44); rute `app/api/evidence/{commit,open,replay}`; jedan RPC za commit i `reserve`, odbijanje nepoznatih polja i granice veličine (B-8); provjera hasha uklonjenog raspona (B-12, `src/adapters/evidence/edit-steps-v1-rules.ts`); osam stanja sinkronizacije sa „spremljeno na poslužitelju” tek uz potpisanu potvrdu; journal vezan uz korisnika i odjava po D-118; format vremena po promjeni v1 i njegov verifikator (#942); pgTAP 040 do 049 i 088. **Djelomično:** potpis i rekonstrukcija u workeru izašli su iz demoa (D-98) i vraćeni su u opseg (D-191 t. 4); nema mjerenja rekonstrukcije velikog rada (B0.2) ni spikea D-54.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M3.1 | Zatvoriti preostali opseg B-8 | B | | DAN-83 (#970) |
| M3.2 | Worker potpisuje potvrdu i oporavlja `pending_signature` (B-9) | B | | DAN-84 |
| M3.3 | Kontrolne točke rekonstrukcije u B-12 i čitanje snimki dokumenta | B | M3.2 | DAN-293 |
| M3.4 | Spike B0.2: rekonstrukcija 15.000 i 80.000 riječi na stvarnom stroju | P | stroj | DAN-388 |
| M3.5 | Spike programskog unosa (D-54) | B | | DAN-390 |
| M3.6 | Ostaci evidencije i značenje odgovora na ponovljeni `ingest` | B | | DAN-301, DAN-46 |
| M3.7 | Nalazi evidencije, lokalnog zapisa i rekonstrukcije (samo ID): F-001, F-003 do F-008, F-028, F-029, F-030, F-034, F-037, F-038, F-043, F-048, F-049, F-154 | B, F | | DAN-140, DAN-145, DAN-146, DAN-147 do DAN-152, DAN-164, DAN-165, DAN-167, DAN-170, DAN-175, DAN-180, DAN-181, #913 |
| M3.8 | Produkcijski potpisnik preko KMS-a | B | B0.1 (M11.1) | DAN-295 |
| M3.9 | Specifikacija i izvedba dnevnog korijena i žiga s CLI verifikatorom (B5, D-72, D-93) | B | M3.2 | DAN-55; izvedba DAN-391 |
| M3.10 | Fuzz parsera B-8 i B-12 te proba izgubljenog odgovora nakon prihvata | P, B | | DAN-320, DAN-321 |
| M3.11 | Oznake stanja spremanja po rječniku i izlaz iz blokirane odjave | F | | DAN-99, DAN-103 |

**Ekrani:** S-10 editor (stanja spremanja), Z-02 odjava i dijalog, Z-11 rad bez mreže, druga kartica i oporavak.

**Uvjet završetka:** izlazni kriterij M3 iz `docs/PROGRAM.md` (property testovi, idempotentno ponovno slanje, oporavak prekida između Storagea, RPC-a i potpisa, izmjereno CPU vrijeme rekonstrukcije doktorskog rada u zapisu B0.2); potvrdu potpisuje worker; B5 prolazi known-answer vektor i negativne slučajeve iz `docs/BACKEND.md` §8; nalazi iz M3.7 zatvoreni.

## M4 Paket pravila Lekte

**Cilj:** pravila akademskog pisanja FPZG-a dolaze iz verzioniranog paketa Lekte, a Ductus ih samo čita i provjerava (D-117, pravilo 12).

**Gotovo na mainu:** FPZG citatni stil kopiran iz Lekte kao čista funkcija (`src/domain/citation/{style,format}.ts`, K-2). **Nema:** paketa, profila ni provjere oblika.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M4.1 | Licenca i pravo redistribucije Lekte | V | | Owner queue |
| M4.2 | U Lekti: generiran paket pravila (FPZG profili, oblik, citatni stilovi, naslovna stranica) s verzijom i testom zanošenja | P | M4.1 | DAN-392 (repo Lekta) |
| M4.3 | Ductus učitava paket s verzijom; kopija iz K-2 prelazi na paket | B | M4.2 | DAN-393 |
| M4.4 | Provjera oblika nad dokumentom i panel Upute | F | M4.3, M5.3 | DAN-394 |

**Ekrani:** S-11 panel Upute (provjera oblika).

**Uvjet završetka:** izlazni kriterij M4 iz `docs/PROGRAM.md` (profili učitani s verzijom, test zanošenja u Lekti, provjera oblika javlja odstupanja na izmišljenim testnim radovima).

## M5 Akademski editor

**Cilj:** student u Ductusu napiše cijeli akademski rad u obliku fakulteta, sa svakim novim elementom zapisanim u evidenciji.

**Gotovo na mainu:** shema s odlomkom, naslovom, stavkom popisa i blok-citatom (`src/domain/document/schema.ts`); popis naslova; opseg u traci stanja; identitet blokova; format odsječka v3 s izvorom citata (#904). **U tijeku:** citati i literatura (#866), traka alata (#976), ljuska editora (#980). **Nema:** fusnota, tablica, slika, sadržaja, naslovne stranice, citata i bibliografije kao čvorova, provjere DOI-ja, opsega po poglavlju, bilježnice izvora, traži i zamijeni, fokusa.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M5.1 | Citat u tekstu i bibliografija kao čvorovi dokumenta (D-191 t. 4) | F | | DAN-343 (#866) |
| M5.2 | Traka alata, popis naslova i napredak naspram opsega; ljuska editora | F | M0.5 | DAN-211 (#976), DAN-214 (#980) |
| M5.3 | Numerirani naslovi i sadržaj | F | | DAN-395 |
| M5.4 | Naslovna stranica i izjava | F | M4.3 | DAN-403 |
| M5.5 | Fusnote | F | | DAN-404 |
| M5.6 | Tablice, slike s opisima, popisi tablica i slika, pozivi na prikaze | F | | DAN-405 (#344) |
| M5.7 | DOI i ISBN u bibliografskom zapisu (S-08); provjera „pronađeno / nije pronađeno” za DOI i URL (D-48) | B, F | M5.1 | DAN-406 |
| M5.8 | Opseg po poglavlju (D-60) | F | M5.3 | DAN-407 |
| M5.9 | Bilježnica izvora (D-59), kasnije uvoz iz Zotera | F, B | M5.1 | DAN-408 |
| M5.10 | Hrvatski navodnici, traži i zamijeni, način fokusa | F | | DAN-409 |
| M5.11 | Pravopis prema jeziku rada bez slanja teksta van (S-07) | F | M2.10 | DAN-410 |
| M5.12 | Uvodni vodič od dvije minute (S-11 iz `docs/FEATURES.md`) | F | | DAN-418 |
| M5.13 | Nalaz identiteta blokova u editoru (samo ID): F-044 | F | | DAN-176 |
| M5.14a | Panel Nacrt (S-14), ljuska kartice i prikaz Obrnuti nacrt, samo izvedeno iz dokumenta (`docs/design/PANEL-NACRT-SPEC.md`) | F | M5.2, M5.3, M0.5, M5.13; odgovori vlasnika na pitanja 3 (naziv kartice) i 9 (podjela M5.14a/b/c) iz specifikacije | novo |
| M5.14b | Panel Nacrt: pohrana plana (pitanje rada, svrhe poglavlja, pojmovnik) kao zapis uz rad; tablica s RLS-om, RPC, pgTAP | B | M5.14a; odluke 1, 2 i 6 iz specifikacije | novo |
| M5.14c | Panel Nacrt: prikazi Nit i Pojmovnik nad pohranom | F | M5.14b, M2.10 | novo |
| M5.15 | Planer rada iz roka i opsega po poglavlju (S-06) | F | M5.8, spajanje #1030 (izuzetak u PRODUCT §5 pravilu 4: napredak po poglavlju i dani do roka) | novo |

Svaki novi čvor sheme traži pravilo u formatu koraka uređivanja i test reprodukcije prije spajanja (B-12).

Koraci M5.14a do M5.14c: odluka vlasnika 31. 10. 2026. da panel Nacrt ulazi u program (#87 c.6543799262, t. 5); smještaj i podjela su PRIJEDLOG iz `docs/design/PANEL-NACRT-SPEC.md`, a pohrana plana, vidljivost mentoru i naziv kartice čekaju odgovore na pitanja 1, 2 i 3 iz te specifikacije, a podjela na odgovor na pitanje 9. **Nijedan od koraka M5.14a do M5.14c ne počinje prije tih odgovora** (M5.14a ne prije pitanja 3 i 9, M5.14b i M5.14c ne prije pitanja 1, 2 i 3); redak M5.14 u ovoj razradi je do tada samo okvir.

**Ekrani:** S-10 editor, S-13 Literatura i bilježnica izvora, S-14 panel Nacrt (`docs/design/PANEL-NACRT-SPEC.md`), S-45 prvi ulazak i vodič.

**Uvjet završetka:** izlazni kriterij M5 iz `docs/PROGRAM.md` (izmišljeni testni rad od 15.000 riječi sa svim elementima uređuje se bez gubitka; citati i bibliografija usklađeni); rekonstrukcija tog rada podudarna.

## M6 Suradnja

**Cilj:** mentor i nastavnik zadatka prate rad uživo, komentiraju i predlažu izmjene, a svaka izmjena pripisana je autoru (pravila 7 i 8).

**Gotovo na mainu:** komentari uz odlomak (B-10, `app/api/comments/[action]`); prikaz uživo kroz zaseban kanal zadnjeg stanja (`docs/BACKEND.md` §4.12, `app/api/live/[documentId]`, `/nastavnik/rad/[id]`); „Kako vidi nastavnik” (#815); čitanje reprodukcije na poslužitelju (#927, pgTAP 089). Napomena: PROGRAM za M6 još piše „polling, D-74”; prikaz uživo od D-142 radi prema §4.12, a D-74 ostaje za obavijesti. **Nema:** prijedloga izmjena, izravnih izmjena nastavnika, sučelja reprodukcije, zahtjeva za doradu, obavijesti.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M6.1 | Prikaz uživo: predani rad prikazan kao predan; mentorski prikaz s komentarom | F, B | | DAN-332 (#911), DAN-215 |
| M6.2 | Reprodukcija znak po znak za mentora, odnosno nastavnika zadatka, i za studenta (D-143, D-154) | F | M3.1 | DAN-344 (#932) |
| M6.3 | Prijedlozi izmjena s prihvaćanjem kao zasebnom promjenom s izvorom | B, F | M5.1 | DAN-419 |
| M6.4 | Izravne izmjene nastavnika s pripisivanjem i postavkom vidljivom na radu (D-21, D-34) | B, F | M6.3 | DAN-420 |
| M6.5 | Zahtjev za doradu i odgovor studenta (D-45), uključujući „promijenjeno nakon prihvaćanja” | B, F | | DAN-314, DAN-266 |
| M6.6 | Obavijesti u aplikaciji i e-poštom, podsjetnici o roku (N-01, N-02) | B, F | | DAN-305 (#950) |
| M6.7 | Odgođeno objavljivanje komentara (D-51), banka komentara (N-03), promjene od zadnjeg pregleda (N-05) | F, B | | DAN-421 |
| M6.8 | Mentorov pregled rada i komentari na mobitelu | F | M6.1 | DAN-422 |
| M6.9 | Konzultacije vezane uz verziju rada (D-47); dio „Bilješka mentora” je uvjetan (U-2, D-135) | B, F | M2.6 | DAN-423 |
| M6.10 | Zbirni pregled kolegija bez imena (N-11) | B, F | | DAN-425 |
| M6.11 | Ključni rokovi mentorskog rada (N-07 iz `docs/FEATURES.md`) | B, F | M2.6, M6.6 | novo |
| M6.12 | (uvjetno) Sučelje komentora i povjerenstva s vremenski ograničenim pristupom (N-08, N-09, ekran P-01 povjerenstvo); model je M2.8 | F, B | M2.8, M6.1, uvjet U-1 | novo |
| M6.13 | (uvjetno) Etape mentorskog rada s odobravanjem (N-15 etape) | B, F | M6.9, uvjet U-2 | novo |
| M6.14 | (uvjetno) Rubrika i nacrt izvješća kao mentorovi radni zapisi (N-15 rubrika i izvješće, D-130, D-135) | B, F | M6.13, uvjet U-2 | novo |
| M6.15 | (uvjetno) Ocjena vidljiva studentu tek nakon objave (N-15 ocjena, D-135) | B, F | M6.14, uvjet U-2 | novo |

**Ekrani:** S-12 komentari studenta, S-17 kako vidi nastavnik, S-34 reprodukcija vlastitog rada, S-40 komentari na mobitelu, S-41 i Z-07 obavijesti, N-06 rad uživo, N-07 pregled rada, N-08 komentari, prijedlozi i dorada, N-09 reprodukcija, N-12 konzultacije, N-17 zbirni pregled.

**Uvjet završetka:** izlazni kriterij M6 iz `docs/PROGRAM.md`; uz to pgTAP i E2E dokazuju da reprodukciju vide samo mentor, odnosno nastavnik zadatka, i student, a nitko drugi (pravilo 7); obavijest nastavniku ne stiže češće od P-03. Koraci M6.12 do M6.15 (uvjetno) nisu dio uvjeta završetka.

## M7 Predaja i sažetak

**Cilj:** student predaje rad koji se točno rekonstruira iz zapisa i dobiva potpisanu potvrdu, a student i nastavnik vide isti sažetak procesa (pravila 5 i 11).

**Gotovo na mainu:** zahtjev za predaju, zapis predaje, potvrda v2 i zatvaranje paketa (pgTAP 060 do 067, 070, 071, 086, 087); predani rad samo za čitanje (#818); rekonstrukcija i odluka o predaji; sažetak procesa iz jedne funkcije (`app/api/process-summary`); obavijest S3 i njezina vrata; tri koraka predaje na `/rad/[assignmentId]/predaja`; brz put nastavnika i popis predaja zadatka (#878, #909). **Djelomično:** usporedba s ranijim nacrtom. **Nema:** produljenja roka, izjave po FPZG čl. 9 i 15, rekonstrukcije u workeru.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M7.1 | Rekonstrukcija u workeru (D-191 t. 4) | B | M3.2, M3.3 | DAN-381 |
| M7.2 | Nastavnik vidi tko je predao, reviziju i „poslije roka”; detalj zadatka i pregled predane verzije (B6) | B, F | | DAN-290, DAN-311 |
| M7.3 | Produljenje roka po studentu (B9) | B, F | | DAN-312 |
| M7.4 | Rok testiran preko promjene sata | B | M7.3 | DAN-382 |
| M7.5 | Izjava po FPZG čl. 9 i 15 (D-40), izjava o ljudskoj pomoći (R-09), ispis razgovora iz vanjskog AI-ja uz izjavu (R-10, D-77) | F, B | | DAN-383 |
| M7.6 | Usporedba verzija i vremeplov za studenta (C5, S-02 iz `docs/FEATURES.md`) | B, F | M3.3 | DAN-293 |
| M7.7 | Karta podrijetla bez zbroja (D-57), otvorena mjesta (D-61), pravila zadatka s kontrolnim popisom bez oznaka prolaza (D-62) | F | | DAN-384 |
| M7.8 | Napomena, dopuna i osporavanje opisa događaja (R-08) | B, F | | DAN-385 |
| M7.9 | Test jednakosti prikaza u sučelju, API-ju i izvozu kao uvjet builda (R-07) | P | | DAN-387 |
| M7.10 | Prenosiv zapis s QR provjerom (D-49), javna provjera potvrde i otvoreni verifikator zapisa (A-07 iz `docs/FEATURES.md`) | B, F | M3.9 | DAN-389 |
| M7.11 | (uvjetno) Priprema za razgovor: deterministički popis mjesta uz studentove izjave, „razgovor održan” bez polja za ocjenu (D-53; ekran N-14 priprema za razgovor i obranu) | F, B | M6.5, M7.5, M7.7, uvjet U-3 | novo |
| M7.12 | (uvjetno) Priprema za obranu, samo za studenta (A-04 iz `docs/FEATURES.md`) | F | M7.11, uvjet U-3 | novo |
| M7.13 | „Moj rad u brojkama” za studenta, bez ritma i usporedbe (A-10 iz `docs/FEATURES.md`; ne miješati s ekranom A-10 slučajevi i paket dokaza). Brojke samo iz verzija i samo za studenta, prema D-63 | F | M7.1, M5.8, spajanje #1030 (izuzetak u PRODUCT §5 pravilu 4) | novo |

**Ekrani:** S-05 obavijest (S3), S-15 panel Rad, S-30 pregled prije predaje, S-31 izjava, S-32 potvrda, S-33 sažetak procesa, S-43 napomene i osporavanje, N-05 brz put, N-10 sažetak i karta podrijetla, N-11 usporedba verzija, N-13 produljenje roka, J-03 provjera potvrde.

**Uvjet završetka:** izlazni kriterij M7 iz `docs/PROGRAM.md` (rekonstrukcija podudarna na svim scenarijima uključujući prazninu, nepodudarnost blokira predaju, isti sažetak, nema zabranjenih riječi, rok preko promjene sata, potpuna izjava, karta podrijetla bez zbroja); test iz M7.9 zelen u CI-ju. Koraci M7.11 i M7.12 (uvjetno) nisu dio uvjeta završetka.

## M8 Uvoz i izvoz

**Cilj:** uvezeni tekst ulazi u rad kao označen događaj s izvorom, a rad se izvozi u obliku fakulteta.

**Gotovo na mainu:** ništa od uvoza ni izvoza DOCX-a i PDF-a.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M8.1 | Lokalni sintetički spike čitanja DOCX-a (D-198 t. 5) | B | M8.8 | DAN-242 |
| M8.2 | Uvoz DOCX-a kao događaj s izvorom „uvoz” | B, F | M8.1, M3.1 | DAN-396 |
| M8.3 | Uvoz PDF-a kao događaj s izvorom | B, F | M8.2 | DAN-397 |
| M8.4 | Izvoz DOCX-a u obliku fakulteta | B | M4.3, M5.4 | DAN-398 |
| M8.5 | Izvoz PDF-a u obliku fakulteta | B | M8.4 | DAN-399 |
| M8.6 | Izvoz predanog rada, potvrde za referadu (R-06) i paket za Merlin (R-05); provjerljiv izvozni paket (D-173) | B, F | M7.1 | DAN-316, DAN-341 |
| M8.7 | PDF izvori u bilježnici s isticanjem i citatom sa stranicom (S-09) te provjera doslovnog citata u učitanom PDF-u (A-03) | F, B | M5.1, M5.9, M8.3 | DAN-441 |
| M8.8 | Paket, lockfile, OSV skeniranje i testovi za `spikes/docx-provenance` | P | | DAN-435 |
| M8.9 | Ugovor provenance i manifest uz `import_event`; `evidence-receipt-v2` se ne mijenja (D-198 t. 7) | B | M8.1, M8.2 | DAN-436 |
| M8.10 | Tragovi u PDF-u i ODT-u, bez povijesti pisanja | B | M8.3, M8.9 | DAN-437 |
| M8.11 | Čitanje spremljenih verzija iz OneDrivea, SharePointa i Google Drivea za odabranu datoteku (D-198 t. 1; granica podataka i opseg dozvola po D-198 t. 5) | B, F | M8.2, M8.9 | DAN-438 |
| M8.12 | Word i Google Docs dodaci, sljedeći val, ne pilot (D-198 t. 2; uvjet U-7) | B, F | M8.11 | DAN-439 |
| M8.13 | Ekran „Povijest dokumenta”: popis „uvezeno, tvrdnja iz datoteke”, isti za obje uloge (D-198 t. 6) | F | M8.2, M8.9 | DAN-440 |

**Ekrani:** S-19 uvoz teksta, S-20 izvoz, N-18 izvoz predanog rada i paket za Merlin.

**Uvjet završetka:** izlazni kriterij M8 iz `docs/PROGRAM.md` (uvoz označen u evidenciji; izvezeni DOCX prolazi Lektinu provjeru za FPZG profil).

## M9 AI pomoćnik

**Cilj:** student, kad zadatak to dopušta, koristi AI pomoćnika unutar Ductusa, a svako prenošenje teksta zapisano je s pružateljem, modelom i svrhom (pravilo 13). D-191 ga vraća u cilj programa, a D-194 uvodi u pilot (1. 3. 2027.) sa svim namjenama osim kineskih pružatelja i modela; ulazi u val 1 (D-199 t. 1).

**Gotovo na mainu:** pravilo AI-ja i dopuštene svrhe na kolegiju i zadatku (#943). **Nema:** posrednika prema pružatelju ni sučelja pomoćnika.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M9.1 | Izbor pružatelja, model računa i ugovorni model (D-194 t. 6 i 7, PRIJEDLOG; razlog D-77), uz pravno mišljenje i DPIA | V | | DAN-400 |
| M9.2 | Posrednik prema pružatelju: `provider.only`, ograničenje troška, tajne po modelu računa koji se odluči (D-74 pod preispitivanjem, D-194) | B | M9.1 | DAN-401 |
| M9.3 | Dopušteni pružatelji po fakultetu i zadatku | B | M2.12, M9.2 | DAN-402 |
| M9.4 | Panel Asistent i prenošenje teksta s bilježenjem pružatelja, modela i svrhe (D-42) | F, B | M9.3, M3.1 | DAN-411 |
| M9.5 | Razgovori priloženi uz izjavu; nepriloženi nisu vidljivi nastavniku (D-41) | B, F | M9.4, M7.5 | DAN-412 |
| M9.6 | Zaštita brojki i citata pri lekturi (D-46); poznato podrijetlo i podudaranje s odgovorom pomoćnika (D-58; oznaka podudaranja je uvjetna, U-4) | B, F | M9.4 | DAN-413 |
| M9.7 | Svrhe razine 2 nedostupne dok ih nastavnik ne uključi; pomoćnik koji pita (D-64) | F, B | M9.4 | DAN-414 |

**Ekrani:** S-16 panel Asistent. N-19 (AI pomoć nastavniku) je PRIJEDLOG i ne gradi se.

**Uvjet završetka:** izlazni kriterij M9 iz `docs/PROGRAM.md`, bez oznake podudaranja s odgovorom AI pomoćnika iz M9.6 (D-58, uvjet U-4): ta oznaka (stavka „prepisan AI odgovor označen” u izlaznom kriteriju) nije dio uvjeta završetka M9 dok se U-4 ne riješi.

## M10 Podaci

**Cilj:** podaci se čuvaju po klasama i rokovima, brišu se po roku tako da lanac ostaje provjerljiv, i mogu se izvesti.

**Gotovo na mainu:** revizijski trag pristupa (pgTAP 080 do 083), upisa i članstva. **Nema:** klasa podataka, brisanja po roku, pravnog zadržavanja ni izvoza za studenta.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M10.1 | Rokovi čuvanja s FPZG-om (D-30) | V | FPZG | Owner queue |
| M10.2 | Klase podataka i brisanje po roku, uključujući stanje prikaza uživo, verzije i vrijeme po promjeni | B | M10.1 | DAN-297 |
| M10.3 | Pravno zadržavanje (F-02) | B | M10.2 | DAN-415 |
| M10.4 | Student vidi tko je i kada otvorio njegov rad (pravilo 17, C4) | B, F | | DAN-294 |
| M10.5 | Izvoz za studenta i za bivšeg studenta preko administratora | B, F | M8.6 | DAN-316 (dio) |
| M10.6 | Izlaz iz usluge: izvoz svih podataka fakulteta (F-04) | B | M10.5 | DAN-416 |
| M10.7 | Administracija čuvanja, pravnog zadržavanja i revizijskog traga | F | M10.2, M2.11 | DAN-417 |
| M10.8 | Studentova vlastita povijest rada (D-131) | B, F | pravno mišljenje D-55 | DAN-424 |
| M10.9 | (uvjetno) Paket za zaštitu studenta: proširenje prenosivog zapisa (D-49, S-01 iz `docs/FEATURES.md`; ekran S-46 paket zaštite) | B, F | M7.10, M10.5, uvjet U-5 | novo |
| M10.10 | (uvjetno) Izvješće za evaluaciju smjernica (F-01, FPZG čl. 13), samo agregati | B, F | M6.10, M10.7, uvjet U-6 | novo |
| M10.11 | Portfelj nakon studija: izvoz predanog rada za portfelj (S-10) | B, F | M8.6, M10.5 | novo |

**Ekrani:** S-18 vlastita povijest rada, S-42 dnevnik pristupa, S-44 izvoz vlastitih podataka, A-05 čuvanje i pravno zadržavanje, A-06 revizijski trag pristupa, A-08 izlaz iz usluge.

**Uvjet završetka:** izlazni kriterij M10 iz `docs/PROGRAM.md` (brisanje po roku testirano; lanac provjerljiv nakon brisanja sadržaja); pravno zadržavanje zaustavlja brisanje (test). Koraci M10.9 i M10.10 (uvjetno) nisu dio uvjeta završetka.

## M11 GO uvjeti

**Cilj:** produkcija i staging u EU-u s dokazanim povratom, pravnim dokumentima, pristupačnošću i operacijama, tako da je svaki GO uvjet iz `docs/PROGRAM.md` zelen.

**Gotovo na mainu:** axe E2E; test bez lažnog pružatelja u produkcijskom buildu; mapa `docs/privacy/`. **Nema:** `docs/OPERATIONS.md`, produkcijske i staging konfiguracije, statusne stranice, engleskog kataloga sučelja.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M11.1 | Računi dobavljača i spike B0.1 (PITR, RTT, KMS) | V, P | računi | DAN-52 |
| M11.2 | Produkcijski Dockerfile, Caddy, OpenTofu, proba povrata baze i bucketa | P | M11.1 | DAN-298 |
| M11.3 | Health i readiness, provjera okoline pri pokretanju, strukturirani log, kostur `docs/OPERATIONS.md` | P, B | | DAN-299 |
| M11.4 | Staging s AAI@EduHr Labom i sintetički prolaz evidencije na istim vrstama resursa | P | M11.2, M1.2 | DAN-426 |
| M11.5 | Sučelje na engleskom (D-70) i postavke profila | F | | DAN-427 |
| M11.6 | Pristupačnost WCAG 2.1 AA, ručna provjera čitačem zaslona i izjava o pristupačnosti (F-03) | F | | DAN-428 |
| M11.7 | Statusna stranica i postupak incidenta (F-10 iz `docs/FEATURES.md`) | P | M11.2 | DAN-429 |
| M11.8 | Obavijest o privatnosti, DPIA, ugovor o obradi i popis podizvršitelja s DPA-ima | V | FPZG, pravno mišljenje | DAN-430 |
| M11.9 | Prije pilota: nadzor i uzbune, build bez source mapa, vanjski penetracijski test, ograničenja zahtjeva, SBOM | P, B | M11.2 | DAN-184 do DAN-187, DAN-322 |
| M11.10 | „Prijavi problem”, mobilni prikaz svih ekrana, stranica „Kako Ductura radi” | F | | DAN-431 |
| M11.11 | Licenca, uvjeti korištenja i odluka o vidljivosti repoa | V | | DAN-188 |
| M11.12 | Brze bilješke s mobitela u bilježnicu projekta (S-03). Bilješka koja ulazi u rad je promjena dokumenta s vrstom izvora „mobilna bilješka” (pravilo 8) | F, B | M5.9, M11.10 | novo |

**Ekrani:** A-07 integracije i status AAI@EduHr, A-09 zdravlje sustava i kopije, J-01 naslovnica, J-02 kako Ductura radi, J-05 statusna stranica i izjava o pristupačnosti, Z-09 postavke, Z-10 prijavi problem, Z-12 mobilni prikaz.

**Uvjet završetka:** svaki redak tablice „GO uvjeti za stvarne studente” u `docs/PROGRAM.md` zelen i zapisan s dokazom.

## Uvjetni koraci (val 3, T3)

Sadržaj vala 3 raspoređen je po fazama prema odluci orkestratora T3 (#87 c.6544288967, opcija C; delegirano u #87 c.6543799262, t. 3): stavke bez vanjskog preduvjeta su koraci svojih faza (M5.14 do M5.15, M6.11, M7.13, M8.7, M10.11, M11.12), a već raspoređene stavke ostaju gdje jesu (M6.9 konzultacije, M6.10 zbirni pregled, M7.6 vremeplov, M7.10 prenosiv zapis, M8.3 uvoz PDF-a, M5.7 provjera izvora, M6.2 reprodukcija s poviješću odlomka, M10.8 povijest rada). Stavke ispod imaju pravni ili ustavni uvjet, ne grade se dok se on ne riješi i nisu dio uvjeta završetka svoje faze. Odluku o svakom uvjetu donosi vlasnik.

| Uvjet | Koraci | Što treba riješiti | Granica |
| --- | --- | --- | --- |
| U-1 | M6.12 | Što komentor i povjerenstvo smiju vidjeti (tekst, sažetak, reprodukciju, prikaz uživo) i hoće li se mijenjati PRODUCT §3 i §5 pravilo 7. Model u M2.8 ostaje; sučelje čeka. | Ustav C-23, D-154, pravilo 7 |
| U-2 | M6.13 do M6.15 | Pravno mišljenje D-55 i vlasnikova zasebna odluka o gradnji (D-136). Dio „Bilješka mentora” u M6.9 (D-47) vrijedi pod istim uvjetom (D-135). | D-130, D-135, D-136 |
| U-3 | M7.11, M7.12 | Vlasnik potvrđuje tekst kriterija prihvaćanja: popis mjesta je činjenica, bez rangiranja, težine ni zbroja; „razgovor održan” bez ocjene; student vidi identičan popis. | PRODUCT §5 pravila 1, 2, 3, 5, 13 |
| U-4 | dio M9.6 | Oznaka „podudara se s odgovorom AI pomoćnika” ostaje oznaka mjesta, ne tvrdnja o autoru. | pravilo 1 (C-9, C-10); D-194 |
| U-5 | M10.9 | Tekst paketa i QR provjere ne smije tvrditi autorstvo; dokument izlazi izvan sustava. | pravilo 9, C-13 |
| U-6 | M10.10 | Agregati bez rizika, ranga i ocjena; isti prag od najmanje 5 studenata kao N-11. | pravilo 2 |
| U-7 | M8.12 | Dodaci idu u sljedeći val, ne u pilot (D-198 t. 2, ODLUČENO 1. 11. 2026.). Prije gradnje pisana potvrda FPZG-a, pravno mišljenje, DPIA i provjera ograničenja Microsofta i Googlea. Do tada vrijede D-79 i D-80. | D-79, D-80 |

Planer (M5.15) i „Moj rad u brojkama” (M7.13) više nisu uvjetni prema odluci vlasnika o D-63 („1. da 2. da”, #87), ali izričiti izuzetak u PRODUCT §5 pravilu 4 (napredak po poglavlju, dani do roka, napredak iz verzija) upisuje tek docs PR #1030: **M5.15 i M7.13 ne počinju prije spajanja #1030.** A-08 (dnevni vremenski žig kod vanjskog pružatelja) ostaje izvan rasporeda.

## Ekrani izvan faza

Ovi ekrani iz mape nemaju mjesto u tablici faza i ne grade se dok vlasnik ne odluči: K-01 koordinator (zbrojevi po kolegiju), K-02 odobrenje istrage (mapa bilježi sukob s D-143 i D-154), A-10 slučajevi i paket dokaza, J-04 stranice za fakultete i nabavu.

## Otvorena pitanja za vlasnika

1. ~~Novi raspored i datum pilota.~~ Riješeno 1. 11. 2026.: pilot 1. 3. 2027. (D-194 t. 1), raspored D-199 t. 6 (#87 c.6551869348).
2. M9: AI pomoćnik ulazi u pilot (D-194 t. 1, odlučeno), i to u val 1 (D-199 t. 1). Otvoreno ostaje: model računa, ugovorni model i izbor pružatelja (D-194 t. 6 i 7, PRIJEDLOG, uz pravno mišljenje i DPIA; `docs/privacy/05` t. 23 do 28).
3. ~~Raspored sadržaja vala 3 po fazama.~~ Riješeno 31. 10. 2026. odlukom orkestratora T3 (#87 c.6544288967): koraci u fazama M5 do M11, uvjetni koraci u odjeljku „Uvjetni koraci”. Preostaju pitanja U-1 do U-6 vlasniku, uz faze kojih se tiču.
4. Ekrani bez faze: K-01, K-02, A-10, J-04. Grade li se, i u kojoj fazi?
5. Panel Nacrt (S-14: obrnuti nacrt, nit argumenta, pojmovnik). Djelomično riješeno 31. 10. 2026.: ulazi u program (#87 c.6543799262, t. 5); koraci M5.14a do M5.14c prema `docs/design/PANEL-NACRT-SPEC.md` kao okvir. **Smještaj i naziv ostaju otvoreni:** pitanja 1, 2, 3 i 9 iz te specifikacije čekaju vlasnika i nijedan korak M5.14 ne počinje prije odgovora.
6. D-63 (napredak i „preskočena stanka”) prema D-56 i pravilu 4 (DAN-104).
7. Kriteriji popisa „tko treba pomoć” (N-12, DAN-102).
8. RPC za dodjelu mentorstva (D-182 t. 1 čeka odluku nakon demoa; M2.6).
9. ~~Izlazni kriterij M0 „isti broj testova kao u izvoru”.~~ Riješeno 31. 10. 2026. odlukom vlasnika (#87 c.6547174354): umjesto broja vrijedi zapis jednakovrijednosti za svaki neprenesen izvorni slučaj (`docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md`); nepokriveno se vraća kao test.
10. Sastav backend dodatka (otvoreno pitanje uz D-99) gubi rok 16. 11. 2026. s rasporedom po valovima; rješava li se uz novi raspored.
11. M8 Document Provenance (D-198): rok čuvanja uvezenih verzija uz FPZG DPO i pravno mišljenje (t. 3). Dodaci za Word i Google Docs odlučeni su za sljedeći val (t. 2, U-7).
