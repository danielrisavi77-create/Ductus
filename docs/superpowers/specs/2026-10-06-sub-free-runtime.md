# Ductura SUB+Free — izvršni sloj (DAN-41)

Izvedbeni dio odobrenog SESSION_PLAN v1.1, nakon vlasnikove poruke „sve implementiraj i napravi sam”. Ne mijenja produktni Ustav, postojeće App/SHA review gateove ili otvorene tuđe PR-ove.

## Opseg

Lokalni CLI kontroler za jedan Git common-dir i DESKTOP-LJMIVR9. Dvanaest profila, najviše tri managed izvršavanja, jedan writer u catch-up modu, najviše dva u normal modu; jedna teška provjera. Jedna orkestratorska instanca među managed izvršavanjima. Nije distribuirana brava za drugi uređaj ili ručno pokrenute razgovore.

Task nosi stabilan ID, owner, profil, provider, puni base SHA, worktree, dopuštene relativne putanje, cilj, kriterij prihvata i risk. Samo zasebni Git worktreeovi ispravnog repoa; nikad main. Nema prepisivanja tuđih mapa, resetiranja rada, automatskog commita/merga niti produkcijskih migracija.

SQLite BEGIN IMMEDIATE serijalizira rezervacije. Isti task, worktree, preklopljene writer putanje, drugi orkestrator ili prekoračenje kapaciteta odbijaju se. Istek heartbeat-a ne oslobađa kapacitet: zapis postaje orphaned. Oporavak rezervacije prije spawna zahtijeva potvrđeno odsustvo kontrolera. Nakon spawna treba neovisna provjera cijelog process treea; sami mrtvi PID-ovi nisu dovoljan dokaz. Svi managed subagenti su isključeni, ne dobivaju dodatni budžet.

Financiranje mora imati svjež lokalni zapis dokaza za konkretnog providera i izvršnu datoteku, potvrđenu prijavu, raspoloživu uključenu kvotu i isključenu dodatnu potrošnju. Zapis je evidencija vlasnika/operatera, ne kriptografska potvrda pružatelja ni garancija buduće kvote. Izostanak dokaza znači blocked_funding. Nema automatskog API/PAYG/fallbacka. Mistral Free je pomoćni read-only kanal; Meta web i DeepSeek bez potvrđenog kanala ne pokreću CLI.

Kontroler ne kopira OAuth tajne. Naslijeđene API ključeve i alternativne endpoint varijable uklanja iz okoline djeteta. Native CLI config i account-side naplata provjeravaju se prije aktivacije; ne označavaju se potvrđenima samo zbog postojanja datoteke. Izvršni timeout, ograničen izlaz, zapis ishoda i post-run scope audit obvezni. Audit putanja detektira nedopušten diff; nije OS sandbox. Codex zadržava native sandbox; Claude koristi restricted file alate; Grok/Mistral početno su advisory. Svaki adapter ostaje blokiran do provjere svoje stvarne verzije i konfiguracije.

## Dokaz

Negativni testovi konkurencije, stale evidence, financiranja, scopea, pogrešnog repoa/SHA-a, živog orphan procesa, timeouta, ograničenog izlaza i maskiranja tajni. Mock CLI testovi jasno se razlikuju od stvarnog provider poziva. Bez prijava/kvote nema lažnog „aktivnog tima”.
