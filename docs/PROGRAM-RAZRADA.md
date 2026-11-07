# Ductus: razrada faza M0 do M11

Verzija 0.2 · 1. 11. 2026. · Dopuna `docs/PROGRAM.md` prema D-191 (trag: #87 [c.6524612217](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6524612217); vlasnikovo odobrenje 31. 10. 2026.: „Može, kreni bez datuma”).

Dokument daje redoslijed faza i koraka, **bez datuma**. Ciljni datumi po fazi i kontrolne točke su u D-199 t. 6 (ODLUČENO 1. 11. 2026.; novi raspored iz D-191 t. 2), kako ga mijenja D-203 (datum pilota E3, kontrolna točka 20. 12. 2026., osnovica M3 C2), i u Linear milestoneovima. Sadržaj faza i izlazni kriteriji ostaju u tablici faza u `docs/PROGRAM.md`; ovdje su razloženi na korake. U sukobu vrijede `docs/PROGRAM.md`, `docs/PRODUCT.md`, `docs/BACKEND.md` i `docs/DECISIONS.md`.

## Kako čitati

- **Gotovo na mainu**: provjereno u kodu na `main` `5517896f` (31. 10. 2026.), ne prema planu. „Djelomično” znači da postoji dio, ali izlazni kriterij nije dokazan.
- **Koraci**: jedan korak je jedan zadatak, obično jedan ili nekoliko PR-ova. Uloga: **B** Backend, **F** Frontend, **P** Platforma, **V** vlasnik (nije posao agenta). Tiketi za korake stvoreni su 31. 10. 2026. i upisani u stupac Tiket; oznaka „novo” znači da korak još nema DAN tiket, a prijedlog tiketa ide orkestratoru. Linear ne mijenja ova razrada.
- **Ekrani**: oznake iz mape ekrana od 31. 10. 2026. (S student, N nastavnik i mentor, K koordinator i povjerenstvo, A administrator fakulteta, J javni posjetitelj, Z zajednički elementi). Ocjene mape o stanju u kodu treba provjeriti prije gradnje.
- **Oznake PLAN-TOKOVI**: A1 do E3 su koraci iz `docs/engineering/PLAN-TOKOVI-2026-10-25.md`.
- Sigurnosni nalazi navode se samo kao ID; pojedinosti su u privatnom registru.
- Faze idu redom po ovisnostima, ali koraci različitih uloga teku usporedno kad ne ovise jedan o drugom. Faza je gotova tek kad je uvjet završetka dokazan testom ili zapisom.
- **Uvjetni koraci (val 3, T3)**: korak označen „(uvjetno)” čeka odluku vlasnika, izmjenu Ustava ili PRODUCT §5, ili pravno mišljenje, i **ne gradi se** dok se uvjet ne riješi. Uvjetni korak nije dio uvjeta završetka svoje faze; uvjeti su u odjeljku „Uvjetni koraci” niže (odluka orkestratora T3, #87 c.6544288967, opcija C).
- **Oznake iz mape ekrana** u ugovorima i tiketima uvijek idu s punim nazivom ekrana, jer kolidiraju s oznakama u `docs/FEATURES.md` i `docs/DECISIONS.md` (npr. S-14, A-10, P-01). Mapa ekrana je u `docs/design/EKRANI.md`.

## Redoslijed

M0 → M1 (čeka AAI@EduHr Lab) i M2 → M3 → M5 i M6 → M7 → M4 (čeka licencu Lekte) i M8 → M10 → M9 → M11. Izvoz DOCX-a, PDF-a i PDF/A (M8.4, M8.5, M8.14) ulazi u val 1 i ne čeka M4: radi bez paketa pravila Lekte, a provjera oblika FPZG-a uključuje se kad stigne licenca (D-203 A3, t. 2). Tehnički M1 ne čeka Lab; prijava na Labu uvjet je prije stvarne uporabe (D-203 t. 4). Shema v2 (DAN-453) ide prije funkcija V11 (D-201 t. 2), a funkcije V11 raspoređene su po fazama M5 do M9 (D-203 t. 6). M9 ne blokira nijednu drugu fazu. Koraci vezani uz vanjske račune (B0.1) i AAI Lab ne zaustavljaju ostale korake.

## M0 Temelj

**Cilj:** repo, CI, lokalni stog i pravila gradnje na kojima stoje sve ostale faze.

**Gotovo na mainu:** CI u `.github/workflows/ci.yml` (lint, typecheck, unit, property, integration, pgTAP preko `pg_prove`, E2E i E2E prijave); sigurnosni posao (Gitleaks nad cijelom poviješću, zizmor, Semgrep, OSV); axe (`e2e/accessibility.spec.ts`); `lefthook.yml`; `compose.yaml` (Postgres 17, RustFS, Mailpit, lažni OIDC); dbmate s 52 migracije i 50 pgTAP datoteka; provjera zabranjenih izraza u CI-ju. Provjereno na `main` `34b94dab` (1. 11. 2026.): E2E na Chromiumu, Firefoxu i WebKitu dio je obveznog statusa „Local stack (compose.yaml)” na svakom PR-u (#1097, M0.3); skener zabranjenih izraza čita i tekst svojstava izvan JSX-a (#552, `247efb68`, M0.4); testovi pravila hookova prolaze na Linuxu u obveznom poslu „Lint, typecheck, test and build” (DAN-136, M0.7). **Djelomično:** kriterij „isti broj prenesenih testova kao u izvoru” vlasnik je zamijenio dokumentiranom jednakovrijednošću (#87 c.6547174354); karta je u `docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md`, a od 273 izvorna slučaja 124 su pokrivena Ductus testom, 149 nema koda u Ductusu (dizajn je drukčiji ili funkcija još nije izgrađena), a 0 ih nedostaje kao test (provjereno na `main` `1df28c3`, 2. 11. 2026., DAN-376); ljuska još nije u konačnom vizualnom smjeru D-188.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M0.1 | Zapis prijenosa jezgre: broj testova u izvoru i na mainu (`docs/engineering/prijenos-jezgre-M0.1.md`) | P | | DAN-376 |
| M0.2 | Zaštitne mjere za dbmate (D-91) 1, 2, 4 i 6; mjere 3, 5 i 7 traže deploy i stvarna okruženja pa idu u B0.x (#87 c.6557413776); uvjet (mjere D-91 1, 2, 4 i 6 spojene) ispunjen 2. 11. 2026., dokaz u `docs/engineering/d91-mjere.md` | P | | DAN-71 |
| M0.3 | E2E na Firefoxu i WebKitu kao obvezna provjera | P | | DAN-114, DAN-232; gotovo: #1097 (`34b94dab`) |
| M0.4 | Skener zabranjenih izraza i za tekst izvan JSX-a | P | | DAN-133; gotovo: #552 (`247efb68`) |
| M0.5 | Ljuska u konačnom vizualnom smjeru „papir i grafit”: tokeni, navigacija, dijalozi, mobilni raspored | F | D-188 (#972) | DAN-344 (#973, #974) |
| M0.6 | Nalazi kontrolne ravnine i review gatea s rokom prije prvog stvarnog studenta (samo ID): F-010, F-011, F-012, F-013, F-014, F-015, F-017, F-023, F-027, F-033, F-035, F-039, F-040, F-041, F-045, F-046; F-040 i F-045 zatvaraju se za M0, ne tek prije M1, a dio F-010 koji je radnja vlasnika ide privatno (#87 c.6557413776) | P | | DAN-141 do DAN-144, DAN-153 do DAN-155, DAN-161, DAN-163, DAN-166, DAN-168, DAN-171 do DAN-173, DAN-177, DAN-178 |
| M0.7 | Testovi pravila hookova prolaze na Linuxu | P | | DAN-136; gotovo na `main` `34b94dab` |

**Ekrani:** Z-01 ljuska i navigacija, Z-04 greška i 404, Z-06 učitavanje, Z-08 dijalozi, Z-13 tema.

**Uvjet završetka:** CI zelen na `main` uz obvezan E2E na Chromiumu, Firefoxu i WebKitu; zapis M0.1 postoji; mjere D-91 1, 2, 4 i 6 spojene (3, 5 i 7 su u B0.x, #87 c.6557413776); nalazi iz M0.6 zatvoreni u privatnom registru; ljuska prošla vizualnu provjeru prema D-183.

**Prihvat M0 (M0.Z, DAN-575):** dokaz po stavki na `main` `b5d2b494` i nalazi su u `docs/engineering/prihvat-M0.md`; zapis ne zatvara M0 u Linearu.

## M1 Prijava preko AAI@EduHr

**Cilj:** studenti i nastavnici prijavljuju se isključivo preko AAI@EduHr (D-09, D-16), a račun je vezan uz izdavatelja i `hrEduPersonUniqueID`.

**Gotovo na mainu:** vlastiti OIDC klijent (`src/server/auth/`, `app/api/auth/{login,callback,logout}`) s PKCE, `state` i `nonce`; sesije u bazi; jedinstvenost (`oidc_issuer`, `hr_edu_person_unique_id`) bez spajanja po e-pošti (`db/migrations/20261003210100_identity_session.sql`, D-73), čime je D-104 pokriven na razini sheme; test da produkcijski build nema lažnog pružatelja (`tests/unit/auth/build-mode.test.ts`); pgTAP 020 do 022; ekran `/prijava`. **Nema:** prijave na stvarnom AAI@EduHr Labu.

**Prihvat tehničkog M1 (M1.Z, DAN-609):** dokaz po koraku na `main` `3160f329` i nalazi su u `docs/engineering/prihvat-M1-tehnicki.md`; M1.1 i M1.2 ostaju otvoreni kao vanjski ulaz vlasnika.

**Odluke plana M1:** atributi, istek sesije, adapter, odjava, proba na Labu, nositelj Test resursa i svježina podobnosti (P1 do P7) su D-200 u `docs/DECISIONS.md` (ODLUČENO 1. 11. 2026.).

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M1.1 | Ovlast za AAI@EduHr Lab i registracija usluge | V | FPZG, Srce | DAN-196, DAN-198 |
| M1.2 | Prijava na Labu: konfiguracija klijenta, mapiranje hrEdu atributa, zapis prolaza s testnim računom | B | M1.1 | DAN-377 |
| M1.3 | Afilijacija djelatnika pri potvrdi nastavničke uloge | B | M1.2 | DAN-304; ostatak u novi uski tiket (D-205 t. 4) |
| M1.4 | Odjava kod pružatelja (RP-initiated logout) | B | M1.2 | DAN-212 |
| M1.5 | Izravni unit testovi `flow.ts` i `oidc.ts` | B | | DAN-307 |
| M1.6 | CSP, HSTS, Permissions-Policy i istek neaktivne sesije | B | | DAN-296 |
| M1.7 | Nalazi identiteta i sesija (samo ID): F-020, F-021, F-022, F-036, F-151 | B | | DAN-158, DAN-159, DAN-160, DAN-169, DAN-342 (#861) |
| M1.8 | Ekran „nema ovlasti” (401/403) i poruka o isteku sesije | F | | DAN-378 |

**Ekrani:** S-01 prijava, Z-03 sesija istekla, Z-05 nema ovlasti.

Napomena (D-203 t. 4): M1.3 i M1.4 ovise o M1.2 samo za provjeru na Labu. Za tehnički M1 grade se i testiraju uz lažni pružatelj, a prolaz na Labu dodaje se kad Lab bude dostupan.

**Uvjet završetka (tehnički M1, D-203 t. 4):** spojeni koraci M1.3 do M1.8; `app_user` vezan uz `hrEduPersonUniqueID`; test da drugi izdavatelj s istim identifikatorom ne dobiva isti račun (D-104); CI test bez lažnog pružatelja u produkciji zelen; nalazi iz M1.7 zatvoreni.

**Prije stvarne uporabe:** zapisan uspješan prolaz prijave na Labu (M1.1, M1.2), uz staging M11.4 i GO uvjete. Lažni OIDC i CI nisu dokaz stvarnog AAI toka (D-203 D1).

## M2 Model fakulteta

**Cilj:** ustanova, kolegiji, članstva, zadaci i mentorstva s ovlastima koje dokazuje pgTAP matrica, uz administraciju ustanove u sučelju.

**Gotovo na mainu:** ustanova, uloge, kolegij s pravilom AI-ja (D-52, D-175), članstvo, upis kodom, zadatak i verzije, potvrda obavijesti, raspon riječi zadatka, mentorstvo kao tablica s RLS-om (#925); pgTAP 030 do 037; HTTP rute `app/api/institution/**`; revizijski trag upisa i članstva (#819, #840); ekrani `/zadaci`, `/upis`, `/zadatak/[id]`, `/nastavnik`, `/nastavnik/zadatak/novi`; ruta za novu verziju zadatka (#870). **Nema:** oznake prilagodbe (D-50), dodjele mentorstva i njezina sučelja, administracije ustanove, komentora i povjerenstva, jezika rada odvojenog od jezika sučelja (F-06).

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M2.1 | Rad nastaje tek na „Započni rad”, uz korak na poslužitelju | F, B | | DAN-330 (#830), DAN-331 (#831) |
| M2.2 | HTTP rute za preostale institucijske RPC-ove | B | | DAN-292; ostatak u novi uski tiket (D-205 t. 4) |
| M2.3 | Studentska projekcija kolegija, zadataka i radova; ekran Moji radovi (B1, B2) | B, F | | DAN-309, #941 |
| M2.4 | Zadatak u postojećem kolegiju, uređivanje s pregledom posljedica i čarobnjak zadatka (B3, B8) | F | M2.2 | DAN-310 |
| M2.5 | Popis studenata kolegija i zadatka s imenima | B, F | | #948 (DAN-344) |
| M2.6 | Mentorstva: put evidencije, čitači i RPC: studentov zahtjev i nastavnikovo odobrenje, uz revizijski trag i provjeru ustanove; mentor samo uz potvrđenu nastavničku ulogu; administrator ne dodjeljuje (D-204) | B | | DAN-349 (#947); ostatak u novi uski tiket (D-205 t. 4) |
| M2.7 | Nastavni tim kolegija i seminarske grupe | B | | DAN-351 |
| M2.8 | Komentor i povjerenstvo s vremenski ograničenim pristupom (model, N-08, N-09); komentor po radnjama, bez zadanog skupa ovlasti, a skup se određuje uz U-1 prije M6.12 (D-205 t. 3) | B | M2.6 | DAN-379 |
| M2.9 | Oznaka odobrene prilagodbe (D-50): nastavnik vidi oznaku, ne razlog | B, F | | DAN-380 |
| M2.10 | Jezik rada odvojen od jezika sučelja (F-06) | B | | DAN-386 |
| M2.11 | Administracija ustanove: pregled, korisnici i uloge, kolegiji i akademske godine (C1 do C3) | B, F | M1.3 | DAN-313 |
| M2.12 | Pravila fakulteta i njihove verzije (D-117, D-175) | B, F | M2.11 | DAN-315 |
| M2.13 | Potvrda obavijesti veže otisak teksta obavijesti | B | | DAN-306 |
| M2.14 | Mentorovi radni zapisi navedeni u obavijesti studentu (D-130) | F | | DAN-235 (#553) |
| M2.15 | Nalazi granice baze (samo ID): F-018, F-019; RLS uz `current_actor()` kao initplan | B | | DAN-156, DAN-157, DAN-51 |
| M2.16 | Ključ ustanove kroz `assignment_version` (preuzima FK dio DAN-301 N-1; D-199) | B | | DAN-442 |
| M2.17 | Konfiguracija po ustanovi (D-199) | B | | DAN-443 |

ISVU adapter (F-07) nije korak ove tablice: ide u zaseban tiket s rokom „prije stvarne uporabe” (D-205 t. 2).

**Ekrani:** S-02 studentska početna, S-03 moji kolegiji, S-04 upis kodom, S-05 obavijest (dio o zadatku), N-01 moji kolegiji, N-02 novi kolegij i zadatak, N-03 čarobnjak zadatka, N-04 popis studenata, N-16 radovi uz mentora (podaci), A-01 pregled ustanove, A-02 korisnici i uloge, A-03 kolegiji i akademske godine, A-04 pravila fakulteta.

**Uvjet završetka:** pgTAP matrica zelena za studenta, nastavnika, mentora, komentora, člana povjerenstva, administratora i osobu druge ustanove; E2E: administrator potvrdi nastavnika, nastavnik napravi kolegij i zadatak, student se upiše i potvrdi obavijest; svaki RPC koji mijenja stanje ima HTTP rutu ili zapisan razlog zašto je nema; administracija ustanove radi u sučelju. **Rokovi (D-205 t. 1):** ova jezgra do 30. 11. 2026., ostatak koraka M2 do 20. 12. 2026.

## M3 Evidencija

**Cilj:** svaka promjena dokumenta postaje cjelovit, potpisan i provjerljiv zapis, i kad student radi bez mreže.

**Gotovo na mainu:** JCS i hash lanac, odsječak v2 i v3, potvrda (`src/domain/forensics/`); izvori unosa uključujući lijepljenje (D-43) i vrste dokaza (D-44); rute `app/api/evidence/{commit,open,replay}`; jedan RPC za commit i `reserve`, odbijanje nepoznatih polja i granice veličine (B-8); provjera hasha uklonjenog raspona (B-12, `src/adapters/evidence/edit-steps-v1-rules.ts`); osam stanja sinkronizacije sa „spremljeno na poslužitelju” tek uz potpisanu potvrdu; journal vezan uz korisnika i odjava po D-118; format vremena po promjeni v1 i njegov verifikator (#942); pgTAP 040 do 049 i 088. **Djelomično:** potpis i rekonstrukcija u workeru izašli su iz demoa (D-98) i vraćeni su u opseg (D-191 t. 4); nema mjerenja rekonstrukcije velikog rada (B0.2) ni spikea D-54.

**Odluke za plan (D-207 do D-216, #87 c.6567392018):** worker se gradi u `src/runtime/worker/` (`docs/ARCHITECTURE.md`), a spike B0.2 u postojećem `spikes/b0.2-reconstruction`; putanja `src/worker/` iz paketa ne usvaja se (D-214). Ostatak DAN-84 i DAN-453 ide u nove uske tikete (D-210).

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M3.1 | Zatvoriti preostali opseg B-8 | B | | DAN-83 (#970) |
| M3.2 | Worker potpisuje potvrdu i oporavlja `pending_signature` (B-9); ostatak u novom uskom tiketu (D-210) | B | | DAN-84 |
| M3.3 | Kontrolne točke rekonstrukcije u B-12 i čitanje snimki dokumenta | B | M3.2 | DAN-293 |
| M3.4 | Spike B0.2: rekonstrukcija 15.000 i 80.000 riječi na stvarnom stroju; puni M3, ne osnovica (D-208) | P | stroj, B0.1 (D-08) | DAN-388 |
| M3.5 | Spike programskog unosa (D-54); M3.5-P01 je `Risk: critical`, a ugovor zabranjuje bilježenje tipki i trajanja (pravilo 4, D-216) | B | | DAN-390 |
| M3.6 | Ostaci evidencije i značenje odgovora na ponovljeni `ingest`; ponovno izdavanje nakon opoziva po varijanti A zapisuje se prije M3.6-P02 (D-212) | B | | DAN-301, DAN-46 |
| M3.7 | Nalazi evidencije, lokalnog zapisa i rekonstrukcije (samo ID): F-001, F-003 do F-008, F-028, F-029, F-030, F-034, F-037, F-038, F-043, F-048, F-049, F-154 | B, F | | DAN-140, DAN-145, DAN-146, DAN-147 do DAN-152, DAN-164, DAN-165, DAN-167, DAN-170, DAN-175, DAN-180, DAN-181, #913 |
| M3.8 | Produkcijski potpisnik preko KMS-a; puni M3, ne osnovica (D-208) | B | B0.1 (M11.1) | DAN-295 |
| M3.9 | Specifikacija i izvedba dnevnog korijena i žiga s CLI verifikatorom (B5, D-72, D-93); D-72 je ODLUČEN (D-209), a M3.9-P05 i P07 grade se tek nakon tog zapisa | B | M3.2 | DAN-55; izvedba DAN-391 |
| M3.10 | Fuzz parsera B-8 i B-12 (zasad fast-check, Jazzer tek nakon provjere licence i ovisnosti, D-213) te proba izgubljenog odgovora nakon prihvata bez Toxiproxyja (D-211) | P, B | | DAN-320 |
| M3.11 | Oznake stanja spremanja po rječniku i izlaz iz blokirane odjave; Z-02 slijedi D-118, bez blokirane odjave (D-216) | F | | DAN-99, DAN-103 |
| M3.12 | Kratki sintetički spike šifriranja i roka (D-122); datum unutar faze do 20. 12. 2026. (D-207) | B | | novo |

**Ekrani:** S-10 editor (stanja spremanja), Z-02 odjava i dijalog, Z-11 rad bez mreže, druga kartica i oporavak.

**Uvjet završetka:** izlazni kriterij M3 iz `docs/PROGRAM.md` (property testovi, idempotentno ponovno slanje, oporavak prekida između Storagea, RPC-a i potpisa, izmjereno CPU vrijeme rekonstrukcije doktorskog rada u zapisu B0.2); potvrdu potpisuje worker; B5 prolazi known-answer vektor i negativne slučajeve iz `docs/BACKEND.md` §8; nalazi iz M3.7 zatvoreni; pravilo 10 (zapis nastao bez mreže ostaje tako označen i nakon sinkronizacije) ima test (D-216).

**Osnovica 20. 12. 2026. (D-203 C2, D-208):** spremanje, worker koji potpisuje (M3.2) s testnim potpisnikom, potpisane potvrde, rekonstrukcija (M3.3) i oporavak. Osnovica se mjeri na kontrolnoj točki 20. 12. i ne zatvara M3. Puni B5 (M3.9) i ostali dijelovi uvjeta završetka prihvaćaju se prije nastavnog pilota; B5 se ne prebacuje iza pilota bez posebne odluke. Stvarni KMS (M3.8) i B0.2 na stroju (M3.4) dio su punog M3 i ovise o B0.1 (D-08).

**Poznata granica (D-215):** inventar v1 pretpostavlja da izvan razvojnih i demo računala nema trajnih izvora potvrda; Daniel tu pretpostavku može ispraviti.

## M4 Paket pravila Lekte

**Cilj:** pravila akademskog pisanja FPZG-a dolaze iz verzioniranog paketa Lekte, a Ductus ih samo čita i provjerava (D-117, pravilo 12).

**Gotovo na mainu:** FPZG citatni stil kopiran iz Lekte kao čista funkcija (`src/domain/citation/{style,format}.ts`, K-2). **Nema:** paketa, profila ni provjere oblika.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M4.1 | Licenca i pravo redistribucije Lekte | V | | Owner queue |
| M4.2 | U Lekti: generiran paket pravila (FPZG profili, oblik, citatni stilovi, naslovna stranica) s verzijom i testom zanošenja; izvodi ga Lekta sesija po Lektinim pravilima, uz Lekta tiket povezan s DAN-392, a Ductus orkestrator ne dodjeljuje Lekta pisce (D-224) | P | M4.1 | DAN-392 (repo Lekta) |
| M4.3 | Ductus učitava paket s verzijom; kopija iz K-2 prelazi na paket | B | M4.2 | DAN-393 |
| M4.3-P06 | Uvoz prvog paketa; spaja se samo na vlasnikov „Spoji n” (D-217) | B | M4.2, M4.3 | novo |
| M4.4 | Provjera oblika nad dokumentom i „S-11 — Panel Upute i provjera oblika” | F | M4.3, M5.3 | DAN-394 |

**Ovisnosti i podjela (plan M4 iz paketa „M4 v1.0”, nije u repou; uz D-217 do D-224):**
- Pin paketa na `assignment_version` ide iza M2.12-P01, M2.13-P01 i M2.4-P02.
- Citatni stil ima jedan izvor, pin paketa; M2.12-P02 ne uvodi vlastiti.
- Puna DOCX provjera dijeli se na P05a (ugovor, sada) i P05b (stvarna provjera, nakon M8.4); samo formalne provjere, informativne, nikad ne blokiraju predaju (D-222).
- M4.3-P06 je uvoz prvog paketa; M4.0a (docs PR s ovim odlukama) i svaki uvoz paketa idu na „Spoji n” (D-217).
- M4 ulazi u automatski red sa 25 koraka.

**Ekrani:** S-11 — Panel Upute i provjera oblika. Napomena o koliziji naziva: u `docs/FEATURES.md` (r. 19) i u M5.12 oznaka S-11 znači uvodni vodič od dvije minute; puni naziv razlikuje ova dva ekrana.

**Uvjet završetka:** izlazni kriterij M4 iz `docs/PROGRAM.md` (profili učitani s verzijom, test zanošenja u Lekti, provjera oblika javlja odstupanja na izmišljenim testnim radovima).

## M5 Akademski editor

**Cilj:** student u Ductusu napiše cijeli akademski rad u obliku fakulteta, sa svakim novim elementom zapisanim u evidenciji.

**Gotovo na mainu:** shema s odlomkom, naslovom, stavkom popisa i blok-citatom (`src/domain/document/schema.ts`); popis naslova; opseg u traci stanja; identitet blokova; format odsječka v3 s izvorom citata (#904). **U tijeku:** citati i literatura (#866, samo obrazac; ne zatvara M5.1). Traka alata (#976), ljuska editora (#980) i dopuna elemenata iz prototipa (#344) zatvoreni su bez spajanja; M5.2 polazi od maina i odobrene reference. **Nema:** fusnota, tablica, slika, sadržaja, naslovne stranice, citata i bibliografije kao čvorova, provjere DOI-ja, opsega po poglavlju, bilježnice izvora, traži i zamijeni, fokusa.

**V11 (D-201, D-203 t. 6):** prvo shema v2 (DAN-453, `Risk: critical`, ugovor i plan napada prije koda), s rezerviranim mjestom u formatu zapisa za prijedloge i izravne izmjene po D-34. U val 1 ulaze funkcije V11 koje pripadaju osnovnom editoru, komentarima, D-34 i izvozu; ostale idu u val 2 i 3 prema fazama M5 do M9. Koraci za funkcije V11 dodaju se s tiketima koje otvara orkestrator.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M5.1 | Citat u tekstu i bibliografija kao čvorovi dokumenta (D-191 t. 4) | F | | DAN-343 (#866) |
| M5.2 | Traka alata, popis naslova i napredak naspram opsega; ljuska editora | F | M0.5 | DAN-211 (#976), DAN-214 (#980) |
| M5.3 | Numerirani naslovi i sadržaj | F | | DAN-395 |
| M5.4 | Naslovna stranica: opća naslovnica bez paketa Lekte u valu 1, predložak iz paketa poslije; izjava tek u M7.5 (D-228) | F | M4.3 samo za predložak iz paketa | DAN-403 |
| M5.5 | Fusnote | F | | DAN-404 |
| M5.6 | Tablice, slike s opisima, popisi tablica i slika, pozivi na prikaze; sve vrste slika uz sigurnu obradu i privatan spremnik (D-231) | F, B | | DAN-405 |
| M5.7 | DOI i ISBN u bibliografskom zapisu (S-08); provjera „pronađeno / nije pronađeno” za DOI i URL (D-48) | B, F | M5.1 | DAN-406 |
| M5.8 | Opseg po poglavlju (D-60) | F | M5.3 | DAN-407 |
| M5.9 | Bilježnica izvora (D-59), kasnije uvoz iz Zotera | F, B | M5.1 | DAN-408 |
| M5.10 | Hrvatski navodnici, traži i zamijeni, način fokusa | F | | DAN-409 |
| M5.11 | Pravopis prema jeziku rada bez slanja teksta van (S-07) | F | M2.10 | DAN-410 |
| M5.12 | Uvodni vodič od dvije minute (ekran S-45; S-11 iz `docs/FEATURES.md`) | F | | DAN-418 |
| M5.13 | Nalaz identiteta blokova u editoru (samo ID): F-044 | F | | DAN-176 |
| M5.14a | Panel Nacrt (S-14), ljuska kartice i prikaz Obrnuti nacrt, samo izvedeno iz dokumenta (`docs/design/PANEL-NACRT-SPEC.md`) | F | M5.2, M5.3, M0.5, M5.13; naziv kartice „Struktura” i prikaza „Prve rečenice” (D-234) | novo |
| M5.14b | Panel Nacrt: pohrana plana (pitanje rada, svrhe poglavlja, pojmovnik) kao zapis uz rad; tablica s RLS-om, RPC, pgTAP | B | M5.14a, M3.11; pohrana, vidljivost i dorada prema D-234 | novo |
| M5.14c | Panel Nacrt: prikazi Nit i Pojmovnik nad pohranom | F | M5.14b, M2.10 | novo |
| M5.15 | Planer rada iz roka i opsega po poglavlju (S-06) | F | M5.8, spajanje #1030 (izuzetak u PRODUCT §5 pravilu 4: napredak po poglavlju i dani do roka) | novo |

Svaki novi čvor sheme traži pravilo u formatu koraka uređivanja i test reprodukcije prije spajanja (B-12).

Koraci M5.14a do M5.14c: odluka vlasnika 31. 10. 2026. da panel Nacrt ulazi u program (#87 c.6543799262, t. 5). Odgovori na pitanja 1, 2, 3, 4, 6 i 9 iz `docs/design/PANEL-NACRT-SPEC.md` §9 su D-234 (2. 11. 2026.): plan na poslužitelju izvan evidencije, mentor ga u valu 1 ne vidi, kartica „Struktura” i prikaz „Prve rečenice”, bez pragova, plan uređiv u doradi, podjela M5.14a/b/c prihvaćena. Pitanja 5, 7 i 8 ostaju PRIJEDLOG specifikacije; nisu bila uvjet za početak koraka.

**Ovisnosti i podjela (plan M5 iz paketa M5, nije u repou; uz D-225 do D-236):**
- Shema v2 ima vlastiti ugovor i plan napada prije koda (M5.0-S1); prihvaća se s prvim novim čvorom, navodom (M5.1-P04). Novi radovi počinju na v2, v1 ostaje v1 (D-225).
- Navod, izvori i bibliografija slijede D-226; trajni popis izvora i bilježnica izvora (M5.9) dijele isti model.
- Val 1 i val 2 prema D-227: dva prihvata, M5 osnovno (20. 1. 2027.) i puni uvjet faze.
- M5.4 se dijeli (D-228): opća naslovnica u valu 1, predložak iz paketa nakon M4.3; M8.4 ne čeka licencu Lekte.
- M5.3 daje jedinu projekciju poglavlja po stabilnom id-u bloka; M5.8, M5.14 i M4.4 je koriste, bez druge projekcije. M4.3-P03 ide iza spajanja #866.
- Numerirani popis (V11, D-201 t. 2) dobiva vlastiti korak M5.V1 kao čvor sheme v2.
- Slike (D-231): ugovor i plan napada M5.6, zatim pohrana s RLS-om i spremnik; spremnik u lokalnom stogu i stagingu ide na „Spoji n”.
- UI koraci M5 čekaju odobrene referentne slike (D-235); domena i backend ne čekaju.

**Ekrani:** S-10 editor, S-13 Literatura i bilježnica izvora, S-14 panel Nacrt, u sučelju kartica „Struktura” (`docs/design/PANEL-NACRT-SPEC.md`, D-234), S-45 prvi ulazak i vodič (S-11 iz `docs/FEATURES.md`).

**Uvjet završetka:** izlazni kriterij M5 iz `docs/PROGRAM.md` (izmišljeni testni rad od 15.000 riječi sa svim elementima uređuje se bez gubitka; citati i bibliografija usklađeni; napredak studenta iz verzija, D-63); rekonstrukcija tog rada podudarna. Prihvat M5 osnovno (val 1) nije završetak faze (D-227).

## M6 Suradnja

**Cilj:** mentor i nastavnik zadatka prate rad uživo, komentiraju i predlažu izmjene, a svaka izmjena pripisana je autoru (pravila 7 i 8).

**Gotovo na mainu:** komentari uz odlomak (B-10, `app/api/comments/[action]`); prikaz uživo kroz zaseban kanal zadnjeg stanja (`docs/BACKEND.md` §4.12, `app/api/live/[documentId]`, `/nastavnik/rad/[id]`); „Kako vidi nastavnik” (#815); čitanje reprodukcije na poslužitelju (#927, pgTAP 089). Prikaz uživo od D-142 radi prema §4.12; „polling, D-74” u `docs/PROGRAM.md` ispravljen je u M6.0a, D-74 vrijedi za obavijesti. **Nema:** prijedloga izmjena, izravnih izmjena nastavnika, sučelja reprodukcije, zahtjeva za doradu, obavijesti.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M6.1 | Prikaz uživo: predani rad prikazan kao predan; mentorski prikaz s komentarom | F, B | | DAN-332 (#911), DAN-215 |
| M6.2 | Reprodukcija za mentora, odnosno nastavnika zadatka, i za studenta (D-143, D-154); val 1 prikazuje samo redoslijed promjena, vremenski podaci tek uz DPIA (D-239) | F | M3.1 | DAN-344 (#932) |
| M6.3 | Prijedlozi izmjena s prihvaćanjem kao zasebnom promjenom s izvorom | B, F | M5.1 | DAN-419 |
| M6.4 | Izravne izmjene nastavnika s pripisivanjem i postavkom vidljivom na radu (D-21, D-34); val 1, cijeli tok po D-34 (D-203 B1) | B, F | M6.3 | DAN-420 |
| M6.5 | Zahtjev za doradu i odgovor studenta (D-45), uključujući „promijenjeno nakon prihvaćanja” | B, F | | DAN-314, DAN-266 |
| M6.6 | Obavijesti u aplikaciji, podsjetnici o roku (N-01, N-02); e-pošta tek nakon izbora pružatelja i DPA, bez tvrdnje „poslano točno jednom” (D-241) | B, F | | DAN-305 (#950) za spojeni dio, novi uski tiket za ostatak (D-246) |
| M6.7 | Odgođeno objavljivanje komentara (D-51), banka komentara (N-03), promjene od zadnjeg pregleda (N-05) | F, B | | DAN-421, novi uski tiket (D-246) |
| M6.8 | Mentorov pregled rada i komentari na mobitelu | F | M6.1 | DAN-422 |
| M6.9 | Konzultacije vezane uz verziju rada (D-47); dio „Bilješka mentora” je uvjetan (U-2, D-135) | B, F | M2.6 | DAN-423 |
| M6.10 | Zbirni pregled kolegija bez imena (N-11, ekran N-17); val 2, prag od najmanje 5 studenata, zaštita komplementa, zatvoren popis mjera, bez ljestvice (D-242) | B, F | | DAN-425 |
| M6.11 | Ključni rokovi mentorskog rada (N-07 iz `docs/FEATURES.md`) | B, F | M2.6, M6.6 | novo |
| M6.12 | (uvjetno) Sučelje komentora i povjerenstva s vremenski ograničenim pristupom (N-08, N-09, ekran P-01 povjerenstvo); model je M2.8; povjerenstvo ne vidi reprodukciju dok se ne izmijene Ustav v1.4 i D-154 (D-238) | F, B | M2.8, M6.1, uvjet U-1 | novo (D-246) |
| M6.13 | (uvjetno) Etape mentorskog rada s odobravanjem (N-15 etape) — u M6 se ne gradi (D-249) | B, F | M6.9, uvjet U-2 | novo |
| M6.14 | (uvjetno) Rubrika i nacrt izvješća kao mentorovi radni zapisi (N-15 rubrika i izvješće, D-130, D-135) — u M6 se ne gradi (D-249) | B, F | M6.13, uvjet U-2 | novo |
| M6.15 | (uvjetno) Ocjena vidljiva studentu tek nakon objave (N-15 ocjena, D-135) — u M6 se ne gradi (D-249) | B, F | M6.14, uvjet U-2 | novo |

**Odluke M6 (D-237 do D-250, #87 c.6581656612):**
- Usporedba poslanih verzija u oba profila, bez oznake i ocjene (D-237). Ponovni pregled nakon dorade je novi ciklus odgovora na novoj verziji zahtjeva, bez automatske presude (D-243).
- Zadano su prijedlozi; izravne izmjene samo uz vidljivu i opozivu postavku koju uključi student (D-244; M6.3, M6.4).
- Glasovni komentar (N-04) u val 2 sa sintetičkim podacima, za stvarne studente isključen do DPIA (D-240).
- Referentne slike za nove ekrane izrađuje M6.UX-R; UI čeka odobrenje slika, backend ne čeka (D-245). Linear: novi uski tiketi za reproduktor, ostatak obavijesti, M6.7 i M6.11 do M6.15; DAN-344 i DAN-305 se ne otvaraju ponovno (D-246).
- Samo hrvatski, engleski s M11 (D-247). Razina pristupačnosti koju repo već traži; WCAG 2.2 AA je cilj za nove ekrane (D-248).
- M6.13 do M6.15 (etape, rubrika, ocjena) i uvjet U-2 u M6 se ne grade (D-249); rez 1 iz `docs/PROGRAM.md` više ne vrijedi.
- M6.0a (ovaj docs PR) i M6.UX-R idu na „Spoji n”; M6 ulazi u automatski red.

**Ekrani:** S-12 komentari studenta, S-17 kako vidi nastavnik, S-34 reprodukcija vlastitog rada, S-40 komentari na mobitelu, S-41 i Z-07 obavijesti, N-06 rad uživo, N-07 pregled rada, N-08 komentari, prijedlozi i dorada, N-09 reprodukcija, N-12 konzultacije, N-17 zbirni pregled.

**Uvjet završetka:** izlazni kriterij M6 iz `docs/PROGRAM.md`; uz to pgTAP i E2E dokazuju da reprodukciju vide samo mentor, odnosno nastavnik zadatka, i student, a nitko drugi (pravilo 7); obavijest nastavniku ne stiže češće od P-03. Koraci M6.12 do M6.15 (uvjetno) nisu dio uvjeta završetka; M6.13 do M6.15 se u M6 ne grade (D-249).

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
| M7.13 | „Moj rad u brojkama” za studenta, bez ritma i usporedbe (A-10 iz `docs/FEATURES.md`, u mapi ekrana S-47; ne miješati s ekranom A-10 slučajevi i paket dokaza). Brojke samo iz verzija i samo za studenta, prema D-63 | F | M7.1, M5.8, spajanje #1030 (izuzetak u PRODUCT §5 pravilu 4) | novo |

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
| M8.4 | Izvoz DOCX-a u obliku fakulteta | B | M5.4 (provjera oblika: M4.3, D-203 t. 2) | DAN-398 |
| M8.5 | Izvoz PDF-a u obliku fakulteta | B | M8.4 | DAN-399 |
| M8.6 | Izvoz predanog rada, potvrde za referadu (R-06) i paket za Merlin (R-05); provjerljiv izvozni paket (D-173) | B, F | M7.1 | DAN-316, DAN-341 |
| M8.7 | PDF izvori u bilježnici s isticanjem i citatom sa stranicom (S-09) te provjera doslovnog citata u učitanom PDF-u (A-03) | F, B | M5.1, M5.9, M8.3 | DAN-441 |
| M8.8 | Paket, lockfile, OSV skeniranje i testovi za `spikes/docx-provenance` | P | | DAN-435 |
| M8.9 | Ugovor provenance i manifest uz `import_event`; `evidence-receipt-v2` se ne mijenja (D-198 t. 7) | B | M8.1, M8.2 | DAN-436 |
| M8.10 | Tragovi u PDF-u i ODT-u, bez povijesti pisanja | B | M8.3, M8.9 | DAN-437 |
| M8.11 | Čitanje spremljenih verzija iz OneDrivea, SharePointa i Google Drivea za odabranu datoteku (D-198 t. 1; granica podataka i opseg dozvola po D-198 t. 5) | B, F | M8.2, M8.9 | DAN-438 |
| M8.12 | Word i Google Docs dodaci, sljedeći val, ne pilot (D-198 t. 2; uvjet U-7) | B, F | M8.11 | DAN-439 |
| M8.13 | Ekran „Povijest dokumenta”: popis „uvezeno, tvrdnja iz datoteke”, isti za obje uloge (D-198 t. 6) | F | M8.2, M8.9 | DAN-440 |
| M8.14 | Izvoz PDF/A-2u; valjanost provjerava veraPDF u CI-ju s fiksnim profilom `-f 2u`, pinanom verzijom i digestom; PDF se označava kao PDF/A samo uz `isCompliant="true"` (D-206, D-203 A3) | B | M8.5 | novo |

Izvoz (M8.4, M8.5, M8.14) je u valu 1 (D-203 A3); uvozni opseg se ne mijenja.

**Ekrani:** S-19 uvoz teksta, S-20 izvoz, N-18 izvoz predanog rada i paket za Merlin.

**Uvjet završetka:** izlazni kriterij M8 iz `docs/PROGRAM.md` (uvoz označen u evidenciji; izvoz DOCX-a, PDF-a i PDF/A prihvaćen prije nastavnog pilota, PDF/A-2u uz veraPDF `isCompliant="true"` (D-206); izvezeni DOCX prolazi Lektinu provjeru za FPZG profil kad stigne licenca, D-203 t. 2).

## M9 AI pomoćnik

**Cilj:** student, kad zadatak to dopušta, koristi AI pomoćnika unutar Ductusa, a svako prenošenje teksta zapisano je s pružateljem, modelom i svrhom (pravilo 13). D-191 ga vraća u cilj programa, a D-194 uvodi u pilot (1. 3. 2027.) sa svim namjenama osim kineskih pružatelja i modela; ulazi u val 1 (D-199 t. 1). Odgovori O1 do O13 za M9 zapisani su u D-267 do D-270 (po vlasnikovoj delegaciji); model računa (O1) ostaje PRIJEDLOG.

**Gotovo na mainu:** pravilo AI-ja i dopuštene svrhe na kolegiju i zadatku (#943). **Nema:** posrednika prema pružatelju ni sučelja pomoćnika.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M9.0-S1 | Jedan ugovor nove verzije formata evidencije za „import” (M8) i „ai-transfer” (M9) te podrijetlo lijepljenja; `evidence-receipt-v2` i formati v2 i v3 ostaju (D-269 O8) | B | M3.1, M3.2-P03, M8.0-S1 | novo; nositelj M3 |
| M9.0-S2 | Port prema pružatelju i sintetički adapter; stvarni adapter tek nakon M9.1-P04; prazna konfiguracija troška znači da je AI isključen (D-267 O1, O5) | B | M9.0-S1 | novo |
| M9.0-S3 | Prekidač po ustanovi, isključen po zadanom, za transkripciju i alate pružatelja; pretraga weba samo kroz Ductusov alat s poslužiteljskim popisom odredišta; bez gumba za snimanje (D-267 O9, O10) | B | M9.0-S2 | novo |
| M9.UX | Referentne slike za S-16 panel Asistent, po D-183 (D-269 O7) | F | | novo |
| M9.UX-R | Odobrenje slika S-16 od vlasnika; UI koraci M9 čekaju ga, backend ne (D-269 O7) | V | M9.UX | novo; radnja vlasnika |
| M9.PRIV | Privatnost: pitanje FPZG-u o „objašnjenju pojma” (D-264 Q09, D-268 O2), pravno mišljenje i DPIA (D-257) kao uvjet uključivanja prekidača iz M9.0-S3 | V | | novo; radnja vlasnika |
| M9.AIACT | Klasifikacija AI pomoćnika prema Aktu o umjetnoj inteligenciji (D-256) prije uključivanja za stvarne studente | V | M9.PRIV | novo |
| M9.1 | Izbor pružatelja, model računa i ugovorni model (D-194 t. 6 i 7, PRIJEDLOG; razlog D-77), uz pravno mišljenje i DPIA. Rok 15. 12. 2026., kontrolna točka 30. 11. (D-270 O12) | V | | DAN-400 |
| M9.2 | Posrednik prema pružatelju: `provider.only`, ograničenje troška, tajne po modelu računa koji se odluči (D-74 pod preispitivanjem, D-194) | B | M9.1 | DAN-401 |
| M9.3 | Dopušteni pružatelji po fakultetu i zadatku; popis iz verzionirane konfiguracije `config/faculties`, potvrda FPZG-a (D-270 O11) | B | M2.12, M9.2 | DAN-402 |
| M9.4 | Panel Asistent i prenošenje teksta s bilježenjem pružatelja, modela i svrhe (D-42); ponovna primjena bez mreže samo uz aktualnu provjeru prava (D-268 O4); katalog od 10 svrha (D-268 O2) | F, B | M9.3, M3.1, M9.0-S1, M9.UX-R | DAN-411 |
| M9.5 | Razgovori priloženi uz izjavu; nepriloženi nisu vidljivi nastavniku (D-41); prijenos teksta koji je kasnije obrisan i dalje čini razgovor obveznim (D-268 O3, D-263 Q22) | B, F | M9.4, M7.5 | DAN-412 |
| M9.6 | Zaštita brojki i citata pri lekturi (D-46); poznato podrijetlo i podudaranje s odgovorom pomoćnika (D-58; oznaka podudaranja je uvjetna, U-4); oznaka ostaje isključena do M9.6-P04 nakon pilota, poznati prijenos i podrijetlo lijepljenja vrijede bez nje (D-268 O6) | B, F | M9.4 | DAN-413 |
| M9.7 | Svrhe razine 2 nedostupne dok ih nastavnik ne uključi, uključujući „objašnjenje pojma” (D-268 O2); pomoćnik koji pita (D-64) | F, B | M9.4 | DAN-414 |

**Ekrani:** S-16 panel Asistent. N-19 (AI pomoć nastavniku) je PRIJEDLOG i ne gradi se.

**Zatvaranje M9:**

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M9.Z1 | Provjera cjeline M9 na sintetičkim podacima: svaki prijenos zapisan s pružateljem, modelom i svrhom; prekidači isključeni po zadanom; prazna konfiguracija troška isključuje AI | B | M9.4, M9.5, M9.6, M9.7 | novo |
| M9.Z2 | Stanje na kontrolnoj točki 15. 1. 2027. i prijava vlasniku što je otvoreno (M9.1, M9.PRIV, M9.AIACT, M9.UX-R); M9 se ne reže bez vlasnika (D-199 t. 6, D-270 O12). Izvještaj je vezan za datum, ne za završetak koraka: ne čeka ni M9.1 (o njegovu stanju izvještava) ni M9.Z1 (zasebna završna provjera) | V | | novo |

**Ovisnosti izvan M9:** M3.1 (B-8) i M3.2-P03 (nositelj formata evidencije) te M8.0-S1 (zajednički ugovor formata, D-269 O8) navode se kako ih navodi objedinjeni plan rb27; naziva M3.2-P03 i M8.0-S1 još nema u ovom dokumentu, a tiketi se otvaraju nakon potvrde plana (M9.0b, D-270 O13). M7.5 je preduvjet za M9.5. **Redoslijed i rokovi (D-199 t. 6, D-266 t. 6):** M10 → M9 → M11; M9.1 do 15. 12. 2026., M9.2 i M9.3 oko 15. 1. 2027., M9.4 do M9.7 do 15. 2. 2027. (M9.5 nakon M7.5), M10 oko 10. 2., M11 22. 2.; kontrolne točke 30. 11. 2026. i 15. 1. 2027.

**Uvjet završetka:** izlazni kriterij M9 iz `docs/PROGRAM.md`, bez oznake podudaranja s odgovorom AI pomoćnika iz M9.6 (D-58, uvjet U-4): ta oznaka (stavka „prepisan AI odgovor označen” u izlaznom kriteriju) nije dio uvjeta završetka M9 dok se U-4 ne riješi.

## M10 Podaci

**Cilj:** podaci se čuvaju po klasama i rokovima, brišu se po roku tako da lanac ostaje provjerljiv, i mogu se izvesti. Odgovori MQ01 do MQ16 za M10 zapisani su u D-271 do D-275 (po vlasnikovoj delegaciji); rokovi čuvanja ostaju PRIJEDLOG do potvrde FPZG-a (D-30).

**Gotovo na mainu:** revizijski trag pristupa (pgTAP 080 do 083), upisa i članstva. **Nema:** klasa podataka, brisanja po roku, pravnog zadržavanja ni izvoza za studenta.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M10.0-S1 | Jedan ugovor brisanja: tablica `erasure` samo za dodavanje (nadgrobni zapis), uske SECURITY DEFINER funkcije samo za `ductus_retention`, zasebna migracija koja sužava okidač nad `audit.access_log`, potpisana kontrolna točka evidencije brisanja (D-272 MQ04, MQ05, MQ07) | B | M3.2-P03 | novo |
| M10.0-S2 | Raspored u workeru (pg-boss) s prvim poslom `purge_ended_sessions`; prije potvrde D-30 izvršavaju se samo već odlučeni poslovi, ostalo je probni prolaz (D-273 MQ08, MQ14) | B | M10.0-S1 | novo |
| M10.1 | Rokovi čuvanja s FPZG-om (D-30); popis DATA-CLASS od 30 klasa u 8 kategorija (C-21) nad mainom u trenutku izrade (M10.1-P01, D-271 MQ01, MQ03); tiket prati D-264 Q11 (D-275 MQ16) | V | FPZG | Owner queue |
| M10.2 | Klase podataka i brisanje po roku, uključujući stanje prikaza uživo, verzije i vrijeme po promjeni; hash i potvrde se čuvaju zasebno, radi dokaza predaje (D-272 MQ06) | B | M10.1, M10.0-S1, B0.1 (bucket kontrolne točke) | DAN-297 |
| M10.3 | Pravno zadržavanje (F-02); postavlja ga admin ustanove s referencom (broj slučaja), skida drugi admin ili operater, više zadržavanja vrijedi neovisno (D-274 MQ11) | B | M10.2 | DAN-415 |
| M10.4 | Student vidi tko je i kada otvorio njegov rad (pravilo 17, C4); M10.4-P02 popisuje sve putove koji vraćaju sadržaj ili sažetak, retci po 5 minuta grupirani po danu, bez zbroja posjeta i trajanja (D-274 MQ10) | B, F | M3.11 | DAN-294 |
| M10.5 | Izvoz za studenta i za bivšeg studenta preko referade: referada prima zahtjev i provjerava identitet, admin ustanove pokreće posao s referencom, jednokratna poveznica na 24 h (D-271 MQ02) | B, F | M8.6, M3.11 | DAN-316 (dio) |
| M10.6 | Izlaz iz usluge: izvoz svih podataka fakulteta (F-04); pokreće operater na pisani zahtjev ustanove, bez brisanja; P01 ugovor u valu 3, P02 i P03 nakon pilota a prije njegova kraja (D-274 MQ12) | B | M10.5 | DAN-416 |
| M10.7 | Administracija čuvanja, pravnog zadržavanja i revizijskog traga | F | M10.2, M2.11 | DAN-417 |
| M10.8 | (uvjetno) Studentova vlastita povijest rada (D-131); ne gradi se do pravnog mišljenja (D-55) i potvrde C-19, klasa 12 ostaje rezervirana u DATA-CLASS (D-274 MQ09, uvjet U-8) | B, F | pravno mišljenje D-55, C-19, uvjet U-8 | DAN-424 |
| M10.9 | (uvjetno) Paket za zaštitu studenta: proširenje prenosivog zapisa (D-49, S-01 iz `docs/FEATURES.md`; ekran S-46 paket zaštite) | B, F | M7.10, M10.5, uvjet U-5 | novo |
| M10.10 | (uvjetno) Izvješće za evaluaciju smjernica (F-01, FPZG čl. 13), samo agregati | B, F | M6.10, M10.7, uvjet U-6 | novo |
| M10.11 | Portfelj nakon studija: izvoz predanog rada za portfelj (S-10) | B, F | M8.6, M10.5 | novo |
| M10.UX-R | Odobrenje referentnih slika ekrana M10 od vlasnika, prije UI koraka (D-183, `docs/SESSIONS.md` §6) | V | | novo; radnja vlasnika |
| M10.PRIV | Privatnost: potvrda rokova i hasha (D-264 Q09, Q11), postupak provjere identiteta u referadi (D-271 MQ02), klauzula o izlazu u ugovoru o obradi (D-264 Q13) | V | | novo; radnja vlasnika |
| M10.Z1 | Proba povrata na sintetičkom obliku: kontrolna točka evidencije brisanja mora se podudarati prije otvaranja povrata (D-272 MQ07, D-273 MQ15) | B | M10.2, M10.3 | novo |
| M10.Z2 | Proba povrata na stagingu sa stvarnom infrastrukturom u valu 3 (D-273 MQ15) | P | M10.Z1, B0.1 | novo; računi i staging su radnja vlasnika |

**Ekrani:** S-18 vlastita povijest rada, S-42 dnevnik pristupa, S-44 izvoz vlastitih podataka, A-05 čuvanje i pravno zadržavanje, A-06 revizijski trag pristupa, A-08 izlaz iz usluge.

**Proba povrata:** M10 ne gradi zasebnu skriptu. Nositelj je M11.2-P04 u `scripts/operations/restore-drill/`; M10.2-P06b dodaje scenarij brisanja u istu skriptu, a M10.Z2 je koristi na stvarnoj infrastrukturi (D-277 NQ05).

**Uvjet završetka:** izlazni kriterij M10 iz `docs/PROGRAM.md` (brisanje po roku testirano; lanac provjerljiv nakon brisanja sadržaja); pravno zadržavanje zaustavlja brisanje (test). Koraci M10.8, M10.9 i M10.10 (uvjetno) nisu dio uvjeta završetka.

## M11 GO uvjeti

**Cilj:** produkcija i staging u EU-u s dokazanim povratom, pravnim dokumentima, pristupačnošću i operacijama, tako da je svaki GO uvjet iz `docs/PROGRAM.md` zelen.

**Gotovo na mainu:** axe E2E; test bez lažnog pružatelja u produkcijskom buildu; mapa `docs/privacy/`. **Nema:** `docs/OPERATIONS.md`, produkcijske i staging konfiguracije, statusne stranice, engleskog kataloga sučelja.

| Korak | Naziv | Uloga | Ovisi o | Tiket |
| --- | --- | --- | --- | --- |
| M11.1 | Računi dobavljača i spike B0.1 (PITR, RTT, KMS); DAN-52 ostaje uski tiket za objektnu pohranu (M11.1-P03), kišobran B0.1 za M11.1-P01 i P02 otvara orkestrator (D-277 NQ04). Računi su radnja vlasnika (D-278 NQ18) | V, P | računi | DAN-52 |
| M11.2 | Produkcijski Dockerfile, Caddy, OpenTofu, proba povrata baze i bucketa; jedini nositelj probe povrata je M11.2-P04 u `scripts/operations/restore-drill/`; D-91 t. 3 je spojen preko #1051, M11.2-P03 samo za eventualni ostatak (D-277 NQ05, NQ07) | P | M11.1 | DAN-298 |
| M11.3 | Health i readiness, provjera okoline pri pokretanju, strukturirani log u `src/server/log/`, kostur `docs/OPERATIONS.md`; DAN-299 ostaje Done, ostatak ide u tri uska nova tiketa (D-277 NQ03, NQ06) | P, B | | DAN-299 |
| M11.4 | Staging s AAI@EduHr Labom i sintetički prolaz evidencije na istim vrstama resursa | P | M11.2, M1.2 | DAN-426 |
| M11.5 | Sučelje na engleskom (D-70) i postavke profila | F | | DAN-427 |
| M11.6 | Pristupačnost WCAG 2.2 AA (D-276 NQ01, D-248), ručna provjera čitačem zaslona i izjava o pristupačnosti u obliku koji traži hrvatski propis, uz poziv na EN 301 549 (F-03) | F | | DAN-428 |
| M11.7 | Statusna stranica i postupak incidenta (F-10 iz `docs/FEATURES.md`) | P | M11.2 | DAN-429 |
| M11.8 | Obavijest o privatnosti, DPIA, ugovor o obradi i popis podizvršitelja s DPA-ima; DAN-430 dijele M9.PRIV i M11.8, jedan nositelj dokumenta je M11.8-P01 (D-278 NQ11) | V | FPZG, pravno mišljenje | DAN-430 |
| M11.9 | Prije pilota: nadzor i uzbune, build bez source mapa, vanjski penetracijski test, ograničenja zahtjeva, SBOM | P, B | M11.2 | DAN-184 do DAN-187, DAN-322 |
| M11.10 | „Prijavi problem”, mobilni prikaz svih ekrana, stranica „Kako Ductura radi” | F | | DAN-431 |
| M11.11 | Licenca, uvjeti korištenja i odluka o vidljivosti repoa; M11.11-P01 priprema licencu, uvjete i popis onoga što ne smije biti javno, odluka je vlasnikova uz pravnika (D-277 NQ02) | V | | DAN-188 |
| M11.12 | Brze bilješke s mobitela u bilježnicu projekta (S-03). Bilješka koja ulazi u rad je promjena dokumenta s vrstom izvora „mobilna bilješka” (pravilo 8). Nije GO uvjet i ne blokira M11.Z1; gradi se u valu 3 samo ako ostane kapaciteta, inače odmah nakon pilota (D-277 NQ09) | F, B | M5.9, M11.10 | novo |

**Ekrani:** A-07 integracije i status AAI@EduHr, A-09 zdravlje sustava i kopije, J-01 naslovnica, J-02 kako Ductura radi, J-05 statusna stranica i izjava o pristupačnosti, Z-09 postavke, Z-10 prijavi problem, Z-12 mobilni prikaz.

**Odgovori NQ01 do NQ18:** zapisani su u D-276 do D-279. Nadzor u pilotu bez novog vanjskog pružatelja praćenja grešaka: uzbune dolaze iz vlastitih provjera (spremnost, crveni worker, rok predaje) i prikaza u aplikaciji; vanjski pružatelj ide kroz M11.8-P02 uz unos na popis podizvršitelja i DPA (D-277 NQ10). Rizik M11.5-P02 (postavke profila) i M11.10-P01 (tablica prijava) podignut je na critical (D-278 NQ14). Pentest ide u rani val 3, nakon M11.4-P01 i M11.9-P03, samo nad stagingom (D-278 NQ16). Radnje vlasnika (paket zahtjeva FPZG-u, pentest, pravna osoba i ugovor o obradi, računi B0.1, licenca i vidljivost) ostaju otvorene u Owner queueu.

**Uvjet završetka:** svaki redak tablice „GO uvjeti za stvarne studente” u `docs/PROGRAM.md` zelen i zapisan s dokazom.

## Uvjetni koraci (val 3, T3)

Sadržaj vala 3 raspoređen je po fazama prema odluci orkestratora T3 (#87 c.6544288967, opcija C; delegirano u #87 c.6543799262, t. 3): stavke bez vanjskog preduvjeta su koraci svojih faza (M5.14 do M5.15, M6.11, M7.13, M8.7, M10.11, M11.12), a već raspoređene stavke ostaju gdje jesu (M6.9 konzultacije, M6.10 zbirni pregled, M7.6 vremeplov, M7.10 prenosiv zapis, M8.3 uvoz PDF-a, M5.7 provjera izvora, M6.2 reprodukcija s poviješću odlomka, M10.8 povijest rada, od D-274 MQ09 uvjetna i bez osnovnog prijema). Stavke ispod imaju pravni ili ustavni uvjet, ne grade se dok se on ne riješi i nisu dio uvjeta završetka svoje faze. Odluku o svakom uvjetu donosi vlasnik.

| Uvjet | Koraci | Što treba riješiti | Granica |
| --- | --- | --- | --- |
| U-1 | M6.12 | Što komentor i povjerenstvo smiju vidjeti (tekst, sažetak, reprodukciju, prikaz uživo) i hoće li se mijenjati PRODUCT §3 i §5 pravilo 7. Model u M2.8 ostaje; sučelje čeka. | Ustav C-23, D-154, pravilo 7 |
| U-2 | M6.13 do M6.15 | Pravno mišljenje D-55 i vlasnikova zasebna odluka o gradnji (D-136). Dio „Bilješka mentora” u M6.9 (D-47) vrijedi pod istim uvjetom (D-135). | D-130, D-135, D-136 |
| U-3 | M7.11, M7.12 | Vlasnik potvrđuje tekst kriterija prihvaćanja: popis mjesta je činjenica, bez rangiranja, težine ni zbroja; „razgovor održan” bez ocjene; student vidi identičan popis. | PRODUCT §5 pravila 1, 2, 3, 5, 13 |
| U-4 | dio M9.6 | Oznaka „podudara se s odgovorom AI pomoćnika” ostaje oznaka mjesta, ne tvrdnja o autoru. | pravilo 1 (C-9, C-10); D-194 |
| U-5 | M10.9 | Tekst paketa i QR provjere ne smije tvrditi autorstvo; dokument izlazi izvan sustava. | pravilo 9, C-13 |
| U-6 | M10.10 | Agregati bez rizika, ranga i ocjena; isti prag od najmanje 5 studenata kao N-11. | pravilo 2 |
| U-7 | M8.12 | Dodaci idu u sljedeći val, ne u pilot (D-198 t. 2, ODLUČENO 1. 11. 2026.). Prije gradnje pisana potvrda FPZG-a, pravno mišljenje, DPIA i provjera ograničenja Microsofta i Googlea. Do tada vrijede D-79 i D-80. | D-79, D-80 |
| U-8 | M10.8 | Pravno mišljenje D-55 (razmjernost čuvanja obrisanog teksta) i potvrda C-19. Do tada se ne gradi, a klasa 12 ostaje rezervirana u DATA-CLASS. DAN-424 i DAN-463 se ne udvostručuju. | D-131, D-55, D-274 MQ09 |

Planer (M5.15) i „Moj rad u brojkama” (M7.13) više nisu uvjetni prema odluci vlasnika o D-63 („1. da 2. da”, #87), ali izričiti izuzetak u PRODUCT §5 pravilu 4 (napredak po poglavlju, dani do roka, napredak iz verzija) upisuje tek docs PR #1030: **M5.15 i M7.13 ne počinju prije spajanja #1030.** A-08 (dnevni vremenski žig kod vanjskog pružatelja) ostaje izvan rasporeda.

## Ekrani izvan faza

Ovi ekrani iz mape nemaju mjesto u tablici faza i ne grade se dok vlasnik ne odluči: K-01 koordinator (zbrojevi po kolegiju), K-02 odobrenje istrage (mapa bilježi sukob s D-143 i D-154), A-10 slučajevi i paket dokaza, J-04 stranice za fakultete i nabavu.

## Otvorena pitanja za vlasnika

1. ~~Novi raspored i datum pilota.~~ Riješeno 1. 11. 2026.: pilot 1. 3. 2027. (D-194 t. 1), raspored D-199 t. 6 (#87 c.6551869348). Izmijenjeno D-203 E3: kod vala 1 spreman 22. 2. 2027., zatim proba od oko četiri tjedna; nastavna aktivacija oko 22. 3. 2027. ili poslije, uz prihvat i suglasnost FPZG-a. Datum 1. 3. 2027. ostaje kao trag.
2. M9: AI pomoćnik ulazi u pilot (D-194 t. 1, odlučeno), i to u val 1 (D-199 t. 1). Otvoreno ostaje: model računa, ugovorni model i izbor pružatelja (D-194 t. 6 i 7, PRIJEDLOG, uz pravno mišljenje i DPIA; `docs/privacy/05` t. 23 do 28).
3. ~~Raspored sadržaja vala 3 po fazama.~~ Riješeno 31. 10. 2026. odlukom orkestratora T3 (#87 c.6544288967): koraci u fazama M5 do M11, uvjetni koraci u odjeljku „Uvjetni koraci”. Preostaju pitanja U-1 do U-6 vlasniku, uz faze kojih se tiču.
4. Ekrani bez faze: K-01, K-02, A-10, J-04. Grade li se, i u kojoj fazi?
5. ~~Panel Nacrt (S-14: obrnuti nacrt, nit argumenta, pojmovnik).~~ Djelomično riješeno 31. 10. 2026.: ulazi u program (#87 c.6543799262, t. 5); koraci M5.14a do M5.14c prema `docs/design/PANEL-NACRT-SPEC.md` kao okvir. Riješeno 2. 11. 2026. (D-234): smještaj, pohrana, vidljivost, naziv i podjela (pitanja 1, 2, 3, 4, 6 i 9). Pitanja 5, 7 i 8 iz specifikacije ostaju PRIJEDLOG.
6. D-63 (napredak i „preskočena stanka”) prema D-56 i pravilu 4 (DAN-104).
7. Kriteriji popisa „tko treba pomoć” (N-12, DAN-102).
8. ~~RPC za dodjelu mentorstva (D-182 t. 1 čeka odluku nakon demoa; M2.6).~~ Riješeno 2. 11. 2026. (D-204): mentorstvo nastaje kad nastavnik odobri studentov rad; administrator ga ne dodjeljuje.
9. ~~Izlazni kriterij M0 „isti broj testova kao u izvoru”.~~ Riješeno 31. 10. 2026. odlukom vlasnika (#87 c.6547174354): umjesto broja vrijedi zapis jednakovrijednosti za svaki neprenesen izvorni slučaj (`docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md`); nepokriveno se vraća kao test.
10. Sastav backend dodatka (otvoreno pitanje uz D-99) gubi rok 16. 11. 2026. s rasporedom po valovima; rješava li se uz novi raspored.
11. M8 Document Provenance (D-198): rok čuvanja uvezenih verzija uz FPZG DPO i pravno mišljenje (t. 3). Dodaci za Word i Google Docs odlučeni su za sljedeći val (t. 2, U-7).
12. Uloge nastavnika i mentora (D-204). D-154 kaže da su mentor i nastavnik zadatka „jedna uloga općenito”, a D-204 da je ista osoba nastavnik na kolegiju i mentor na pisanom radu. Je li to jedna potvrđena uloga `teacher` s dva odnosa (kolegij, mentorstvo) ili dvije uloge, i treba li izmijeniti D-154? `docs/PRODUCT.md` §3 još navodi da administrator „potvrđuje ulogu nastavnika i mentora” i ulaz „dodjelom mentoru”, a popis vrsta mentorskog rada (završni, diplomski, specijalistički, doktorski) razlikuje se od D-204 (esej, završni, diplomski i drugi). Otvoreno je i što se događa s mentorstvima kad se nastavniku opozove uloga (D-200 P7). Točka 2 odluke o ulogama od 31. 10. 2026. (povjerenstvo u istrazi) čeka izmjenu Ustava.
13. Trajanje produljene probe D-196 (D-205 t. 5): zapis ne navodi novi završni datum. Traje li do jezgre M2 (30. 11. 2026.) ili do kraja M2 (20. 12. 2026.)? `docs/ORKESTRATOR.md` §4a još navodi „do 14. 11. 2026.”.
