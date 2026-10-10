# Zajedničke projektne operacije

Ovo su postupci čitanja i pripreme, ne CLI naredbe ni novi kontroler. Čitati aktualne `AGENTS.md`, `CLAUDE.md`, `STATE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/MULTI-ACCOUNT.md` i `docs/SESSIONS.md` iz ciljnog repoa na odabranom punom SHA. Prihvaćeni repo i izričita aktualna autorizacija korisnika određuju ovlasti; privatni skill, chat ili deklarirana uloga ne dodaju ih. Poštovati dodijeljene putanje i neovisne gateove.

## Zapis izvora

Za **svako polje**, uključujući nepoznato, vratiti `value`, `source` (putanja/URL i revizija gdje postoji), `observed_at` (UTC ili unknown), `evidence_layer` (deklaracija, artefakt, statički izvor, izvedeni test, opaženo ponašanje) i `status` (`OBSERVED`, `UNKNOWN`, `UNVERIFIED`, `STALE`). Vrijeme čitanja odvojiti od vremena izvođenja. Sačuvati izvorni rezultat; zaključak i njegove granice zapisati zasebno. Za pomične izvore zapisati kada su pročitani i na koju reviziju se odnose.

## snapshot

1. Pročitati identitet uređaja i repoa, worktree, dirty stanje i puni `HEAD`. Aktualni branch očitati zasebno (`git branch --show-current`); detached HEAD označiti. Ne izvoditi branch iz PR baze.
2. Zasebno zabilježiti opaženi lokalni `main`, `origin/main`, live GitHub main, PR base ref/base SHA i PR head SHA. `base_sha` može biti baza PR-a ili radnog taska: imenovati značenje. Nijedno od toga nije automatski prihvaćeni/testirani head. Dated Pages, task-plan ili frozen snapshot ostaje povijesni presjek, čak i kad se zove main.
3. Čitati relevantan task/PR, izvorne checks i dostupne dokazne datoteke. Live Linear metadata koristiti za prioritet, assignee i status kad se koristi u projektu; GitHub/repo za implementacijske dokaze i gateove. Ne pretvarati Linear DONE ili staru Pages oznaku u prihvat repoa.
4. Odvojiti deklarirane profile, opažene rezervacije i dokazano žive procese; broj profila nije broj procesa, rezervacija nije dokaz života, stale heartbeat nije dokaz da je proces završio. Ne pozivati runtime radi popunjavanja tablice.

DAN-41 javni `status` opažen je kao mutirajući put (konstruktor registra i orphan recovery). Dok vlasnikov čisti reader nije implementiran **i prihvaćen**, runtime polja ostaju `UNVERIFIED`. Ne pozivati `status`, `probe`, `heartbeat`, `claim`, `recovery`, `prepare`, `run` ni `session_registry.py`; ne stvarati DB, popravljati orphan, migrirati registar, pisati lease ili uvoditi drugi scheduler/evaluator. Čitati samo postojeće autorizirane artefakte; nedostajuću datoteku prijaviti bez stvaranja. Izvršivi dokaz nemutacije pripada zadatku kontrolera i nije isporučen ovim paketom.

## prepareTask

Koristiti postojeći `coordinate-project-sessions` način **Prepare the next session** i njegov brief kad je dostupan; ovaj popis omogućuje isti postupak bez privatne ovisnosti. Vratiti **nacrt / pripremljeno**, s postojećim ID-em, ciljem, runtime:slot:role, uređajem/vezom, repoom/worktreeom/branchom, polaznim punim SHA, dopuštenim putanjama, riskom, provjerljivim prihvatom, ovisnostima, izvorima i potrebnim dokazima. Ne generirati ID, kreirati task/worktree, enqueue, preuzimati rezervaciju/lease, slati poruke ili pokretati rad. Neprovjereni dispatch preduvjeti ostaju otvoreni.

## readEvidence

Zahtijevati task ID i **puni tested/reviewed head SHA**; ako jedan nedostaje, prikazati postojeće artefakte uz `UNVERIFIED`, bez verdicta prihvata. Za svaki test/review povezati isti task/repo, puni SHA, vrijeme izvođenja, uređaj/verzije, naredbu ili radnju, originalni rezultat, opseg i putanju dokaza. Razlikovati `base_sha`, završni lokalni head, testirani head, pregledani head i prihvaćeni main. Lokalni `completed` i `canonical_review:false` očuvati; ne prevoditi ih u PASS.

Čitati aktualni Engineering System i stvarni gate status. Green engineering evaluator nije actual gate PASS. Kanonski review/QA komentar mora imati propisanu prvu nepraznu liniju, puni aktualni `Review-Head`/`QA-Head`, verdict i valjan autentificirani App identitet. Za critical reviewer i QA potrebni su odvojeni PASS-ovi različitih GitHub Appova; druga deklarirana uloga ili slot istog Appa to ne zadovoljava. Aktualni valjani FAIL/BLOCK ostaje blokada prema kanonskim pravilima. Novi head invalidira stare dokaze. Ne objavljivati vlastiti kanonski PASS niti Owner Override kroz ovaj reader.

## Sintetički primjeri tumačenja (nisu runtime rezultati)

| Sirovi podatak | Ograničeno tumačenje |
| --- | --- |
| Task DAN-X ima `completed`; result.json nedostaje | Procesni status postoji; završni SHA i rezultat `UNVERIFIED`; ne stvarati artefakt. |
| Test navodi head `1111111111111111111111111111111111111111`, PR head je `2222222222222222222222222222222222222222` | Izvorni prolaz sačuvati; `STALE` za aktualni head. |
| Heartbeat star sat vremena, postoji reservation | Opažena zastarjela rezervacija; život procesa `UNVERIFIED`; ne zapisivati orphaned. |
| Review PASS i QA PASS na istom headu, oba iz `chatgpt-codex-connector` | Dva komentara postoje; critical zahtjev različitih Appova nije ispunjen. |

## Odnos prema postojećim postupcima

Evidence-First koristi petlju Inspect → Prove → Prioritize → Change → Verify → Report; `verify-repo-integrations` razlikuje prisutnost, povezanost i izvršenje. Ponovno koristiti dostupne procedure, bez kopiranja tijela ili obvezne privatne verzijske ovisnosti. Opaženi objavljeni Operator 0.2.0 i Mentor Tools 0.1.0 nisu dokaz host aktivacije. Operator 0.1.1 je samo zamrznuti povijesni B01 baseline: kontrolirana usporedba drži njega i iste raw ulaze, a kandidat je jedina nova varijabla. Ponašanje aktualnog hosta s 0.2.0 zasebno je neopaženo.
