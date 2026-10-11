# Prijava (AAI@EduHr), sesije i identitet

Ako se ovaj vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod; nesklad prijavi u IZVJEŠTAJU.

Tvrdo pravilo (D-09, `CLAUDE.md`, `docs/PRODUCT.md` §4): studenti se prijavljuju isključivo AAI@EduHr računom. Nijedan drugi način prijave se ne dodaje, ni privremeno. Jedina iznimka je lažni OIDC pružatelj ("demo prijava") koji radi samo lokalno i u CI-ju. Drugi izdavatelj identiteta (D-104) traži novu odluku vlasnika; ovaj vodič ne opisuje i ne smije se koristiti za dodavanje druge metode prijave.

## 1. Kada koristiti

- Svaka izmjena u `src/server/auth/`, `src/server/http/`, `app/api/auth/`, `src/server/db/open-session.ts`, `src/server/db/with-actor.ts`.
- Izmjena `infra/fake-oidc/`, `compose.yaml` (servis `oidc`), `.env.example` (OIDC_*), `playwright.login.config.ts`, `e2e/login/`, `e2e/auth.spec.ts`.
- Migracije koje diraju sheme `identity` i `app` (`current_actor`, `open_session`, `close_current_session`), uloge `ductus_auth` i `ductus_identity`, pgTAP `db/tests/020`, `021`, `022`.
- Rad na D-104 (model računa za drugog izdavatelja), na odjavi, na istoj-origin zaštiti ruta.

Uz ovaj vodič primijeni kratke kontrolne liste iz `.claude/skills/`: `ductus-identity-isolation` (izolacija identiteta), `ductus-new-table` (nove tablice, uloge, RLS, pgTAP), `ductus-local-storage-logout` (odjava i brisanje lokalnog journala), `ductus-attack-plan` (obvezan za `critical` identitet), `ductus-synthetic-data` (fixturei), `ductus-ui-copy` (poruke prijave). Pravilo po putanjama: `.claude/rules/evidencija-i-prijava.md`.

## 2. Karta

Implementirano (potvrđeno čitanjem koda):

- `app/api/auth/login/route.ts` (GET), `callback/route.ts` (GET), `logout/route.ts` (POST). Sve su `authRoute(handler)`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`. To su jedine auth rute.
- `src/server/auth/config.ts`: `loadAuthConfig(env)`, `AuthConfig`, `AuthConfigError`. Izbor pružatelja, fail-closed provjera okoliša, provjera URL-ova, prikvačen algoritam ID tokena (`RS256|PS256|ES256|EdDSA`), tolerancija sata 0 do 120 s (zadano 30).
- `src/server/auth/deps.ts`: `authDeps()` (lijeno gradi konfiguraciju, OIDC klijent, `openSession`, `closeSession`) i `authRoute()` (ako konfiguracija ne učita, neutralna stranica 503, log samo `config` i ime greške).
- `src/server/auth/oidc.ts`: jedina datoteka koja uvozi `openid-client`. `createOidcClient`, `newLoginChecks` (state, nonce, PKCE verifier, svaki 32 slučajna bajta base64url), `limitedFetch` (limit 256 KiB, `PROVIDER_TIMEOUT_SECONDS = 10`), `ProviderUnavailableError`, `isProviderUnavailable`.
- `src/server/auth/flow.ts`: `startLogin`, `finishLogin`, `logout`, `isSameOrigin`, `failurePage`, `LOGIN_COOKIE_NAME = "__Host-ductus_login"`, tipovi `AuthDeps`, `OpenSessionPort`.
- `src/server/auth/claims.ts`: `identityFromClaims(idToken, userinfo)` daje `{subject, uniqueId, homeOrg}` ili razlog (`missing_claim`, `invalid_claim`, `subject_mismatch`).
- `src/server/auth/return-to.ts`: `safeReturnTo`, `DEFAULT_RETURN_TO = "/"`.
- `src/server/auth/session-token.ts`: `SESSION_COOKIE_NAME = "__Host-ductus_session"`, `newSessionToken`, `hashSessionToken` (SHA-256 nad UTF-8 tokena), `sessionCookieOptions`, `clearedSessionCookieOptions`.
- `src/server/db/open-session.ts`: `createOpenSession(pool)`; poziva `identity.open_session` samo ako je konekcija prijava koja je član `ductus_auth`, nije član `ductus_app`, nije superuser ni BYPASSRLS. `src/server/db/with-actor.ts`: `createWithActor`, `leadingKeyword`. `src/server/db/index.ts`: `openSession`, `withActor`, čitaju `AUTH_DATABASE_URL` odnosno `APP_DATABASE_URL`; bez njih pristup ostaje zatvoren.
- `src/server/http/mutation-request.ts`: `checkMutationRequest(request, expectedOrigin)` (samo POST, obavezan `Origin`, `Sec-Fetch-Site` mora biti `same-origin` ako postoji) i `readBodyWithLimit(request, maxBytes)`. U kodu ga trenutno koristi samo vlastiti test (`mutation-request.test.ts`); nijedna ruta ga još ne poziva.
- `infra/fake-oidc/server.mjs` (+ `Dockerfile`, `package.json`): `oidc-provider`, klijent `ductus-local`, računi `demo-student` i `demo-teacher`, home org `demo.ductus.test`, PKCE obavezan. Compose servis `oidc` na `127.0.0.1:8090`.
- SQL: `db/migrations/20261003210000_roles.sql` (uloga `ductus_auth`), `20261003210100_identity_session.sql` (tablice `identity.institution`, `identity.user_account`, `identity.session`, `app.current_actor()`, `app.current_user_id()`, `app.current_institution_id()`, `identity.close_current_session()`), `20261010210000_open_session.sql` (`aai_home_org`, `identity.open_session`), `20261010220000_open_session_realm.sql` (oblik `lokalni@realm`). Uloge i članstva nastavnika: `20261010180000_institution_model.sql` (`institution.institution_role`, `require_actor`, `actor_has_role`, `actor_course_role`).
- Lokalno: `db/local/auth-login.sql` (prijava `ductus_auth_local`, lozinka dolazi izvana, najmanje 16 znakova, samo lokalni socket), `db/local/seed.sql` (ustanove s `aai_home_org`).

Planirano, nije u kodu (ne gradi se kao da postoji):

- RP-initiated logout prema `end_session_endpoint` AAI-ja i back-channel logout (`docs/BACKEND.md` §4.3, `docs/ARCHITECTURE.md` §4 točka 6). Shema dopušta `close_reason = 'backchannel_logout'`, ali ruta ne postoji; `logout` zatvara samo lokalnu sesiju.
- `can(actor, action, object)` kao jedino mjesto odluke (`docs/ARCHITECTURE.md` §7) nisam našao u `src/server/`; ovlasti su zasad u SQL funkcijama.
- Stupci `app_user` poput imena za prikaz i posljednje prijave iz `docs/ARCHITECTURE.md` §3 ne postoje u `identity.user_account`.

Slojevi: ruta (`app/api/auth/*`) poziva `authRoute` iz `deps.ts`, koji sklapa `flow.ts` s `oidc.ts`, `config.ts` i `src/server/db`. `flow.ts` ne zna za `openid-client` ni za pg; vidi samo sučelja `OidcClient` i `OpenSessionPort`. Zato se testira bez Next.js-a.

## 3. Tok podataka

Prijava:
1. Gumb vodi na `GET /api/auth/login?returnTo=/put`. `startLogin` čisti `returnTo` kroz `safeReturnTo`, pravi `newLoginChecks()`, traži `authorizationUrl` (scope `openid profile`, `code_challenge_method=S256`) i vraća 303 uz kolačić `__Host-ductus_login` (Max-Age 600) koji nosi `{v:1, state, nonce, codeVerifier, returnTo}` u base64url JSON-u. Kolačić nije potpisan (`__Host-` i HttpOnly), ali se čita kao nepouzdan ulaz (`decodeAttempt`: najviše 1024 znaka, svaka slučajna vrijednost točno 43 znaka base64url).
2. Pružatelj vraća preglednik na `GET /api/auth/callback?code&state`. `finishLogin` odmah briše kolačić pokušaja (jednokratan), pa ponovljen callback nema state.
3. `oidc.verify` razmjenjuje kod (redirect URI je konfigurirani, nikad izveden iz `Host`), provjerava state, nonce, PKCE, `iss`, potpis prema JWKS-u i pinirani algoritam, zatim dohvaća userinfo za isti `sub`.
4. `identityFromClaims`: `sub` iz userinfoa mora biti jednak `sub` iz ID tokena; atributi iz userinfoa imaju prednost. Uzimaju se samo `sub`, `hrEduPersonUniqueID`, `hrEduPersonHomeOrg`; e-pošta i OIB se ne čitaju. Vrijednost je string, neprazna, do 255 code pointova, bez kontrolnih, formatnih, separatorskih i surogatnih znakova.
5. `newSessionToken()` pravi 32 slučajna bajta (token) i SHA-256; u bazu ide samo hash. `openSession` poziva `identity.open_session(issuer, subject, uniqueId, homeOrg, tokenHash)` kao `ductus_auth`.
6. U `open_session`: provjera ulaza (ZD422), homeOrg se normalizira (rubni razmaci, ASCII mala slova pod "C" collationom), `uniqueId` mora biti `lokalni@realm` s točno jednim `@` i realm jednak homeOrg (inače ZD503), ustanova se bira po `identity.institution.aai_home_org` (nema je: ZD503), prvi login stvara `identity.user_account`, promijenjen subject ili ustanova daje ZD403 (račun se ne spaja), `identity.session` dobiva `expires_at = now() + 12 sati`; iskorišten hash daje ZD409.
7. `createOpenSession` mapira ZD403, ZD422 i ZD503 u `refused` (stranica 403), ZD409 u `conflict` (400); druge greške bacaju (503).
8. Ako preglednik već ima kolačić sesije, `closeSession` ga zatvara (nova sesija uvijek dobiva novi token). Odgovor: 303 na `new URL(returnTo, redirectUri.origin)`, brisanje kolačića pokušaja i `__Host-ductus_session` s `Expires` sesije.

Svaki neuspjeh završava istom neutralnom hrvatskom stranicom (`failurePage`, statusi 400, 403, 503, `cache-control: no-store`, `referrer-policy: no-referrer`); preglednik ne uči koja je provjera pala ni postoji li ustanova. Log nosi samo fazu i kod (`logFailure`).

Identitet nakon prijave: svaki pristup bazi ide kroz `withActor(token, fn)`. Token se prije slanja provjerava formatom (43 znaka base64url, inače anoniman), postavlja se `app.session_token` s `set_config(..., true)` (transakcijski), a `app.current_actor()` hashira token, traži otvorenu neistekle sesiju i vraća `user_id` i `institution_id`. Sirovi ID korisnika nikad nije parametar ni GUC. Konekcija mora biti prijava koja je član `ductus_app`, bez SUPERUSER i BYPASSRLS (`APP_ROLE_SQL`, provjerava se pri ulazu i prije COMMIT-a). Dopuštene su samo naredbe SELECT, WITH, INSERT, UPDATE, DELETE, MERGE, VALUES, TABLE, CALL; ugniježđeni `withActor` baca grešku.

Ustanova: izvodi se samo iz `hrEduPersonHomeOrg` preko `aai_home_org` (podatak, ne kod). Ustanova bez vrijednosti ne prima prijave. Sesija i račun nose istu ustanovu (složeni strani ključ `(user_id, institution_id)`).

Uloge i ovlasti: na HTTP granici nema provjere uloge; rute prijave su javne po prirodi, a ostale još ne postoje u `app/api`. Odluka je u bazi: `institution.require_actor()` (ZD401 bez sesije), `institution.actor_has_role('teacher'|'admin')` (potvrđena, neopozvana uloga u vlastitoj ustanovi), `institution.actor_course_role(course)`. Uloga nastavnika ne nastaje automatski, potvrđuje je administrator (`docs/PRODUCT.md` §4, `docs/ARCHITECTURE.md` §4 točka 7). Prema D-16 (PRIJEDLOG) isto vrijedi za nastavnike.

Odjava: `POST /api/auth/logout`. `isSameOrigin`: `Sec-Fetch-Site` ako postoji (mora biti `same-origin`), inače `Origin` mora biti jednak; bez oba je 403. Zatim `closeSession(token)` (`withActor` + `identity.close_current_session()`), kolačić se briše uvijek, i kad baza ne radi (sesija tada završava istekom). Redirect na `/`. GET nikad ne odjavljuje.

Lažni pružatelj: vidi invarijantu 3.

## 4. Invarijante

1. Samo AAI@EduHr za prijavu; auth API su točno tri rute. Izvor: D-09, `CLAUDE.md`, `docs/PRODUCT.md` §4. Test: `tests/unit/auth/routes.test.ts` ("has login, callback and logout under app/api/auth and nothing else", plus zabrana ruta s imenom login, session, passw, token, oauth, oidc, saml izvan `api/auth`). Četvrta ruta ili drugi pružatelj traži odluku prije koda.
2. Identitet je izdavatelj plus `hrEduPersonUniqueID`, nikad e-pošta; računi se ne spajaju po e-pošti; OIB se ne traži. Izvor: D-73, `docs/BACKEND.md` §4.3, `docs/ARCHITECTURE.md` §4. Provedba: `claims.ts`, `UNIQUE (oidc_issuer, hr_edu_person_unique_id)` i `UNIQUE (oidc_issuer, oidc_subject)`. Testovi: `src/server/auth/claims.test.ts`, `db/tests/021-open-session.sql`.
3. Lažni pružatelj samo lokalno i u CI-ju; svaka vrijednost `NODE_ENV` osim `development` i `test` (i neodređena ili krivo napisana) smatra se produkcijom i `loadAuthConfig` baca grešku. D-09 je svojstvo builda: `deps.ts` prosljeđuje `process.env.NODE_ENV` kao literal koji `next build` zamjenjuje, pa vrijednost pri `next start` ne mijenja izbor. Izvor: D-09, `docs/PRODUCT.md` §4, `docs/ARCHITECTURE.md` §4 ("CI test dokazuje da ga produkcija nema"). Testovi: `src/server/auth/config.test.ts`, `tests/unit/auth/build-mode.test.ts` (zabrana `allowDevelopmentBuild` i točan literal u `deps.ts`), `tests/unit/auth/routes.test.ts` (503 bez imena varijable), `e2e/auth.spec.ts` (produkcijski build na tri vrijednosti `NODE_ENV`, nikakav zahtjev prema portu 8090, nema kolačića).
4. U produkciji su `OIDC_ISSUER` i `OIDC_REDIRECT_URI` https, standardni port, javni DNS host, bez korisnika, upita i fragmenta; IP literali, jednooznačna imena i rezervirani sufiksi se odbijaju; `allowInsecureRequests` je samo za lažni pružatelj na loopbacku izvan produkcije. Izvor u kodu (`config.ts`), `docs/BACKEND.md` §4.3 govori općenito; test: `config.test.ts`.
5. Provjere OIDC odgovora: state, nonce, PKCE S256, `iss`, `aud`, potpis, prikvačen asimetričan algoritam (`none` odbijen), tolerancija sata, `sub` userinfoa jednak ID tokenu, limit veličine odgovora pružatelja, timeout. Izvor: `docs/BACKEND.md` §4.3 "Obvezno". Testovi: `tests/unit/auth/flow.test.ts` (označeni brojevima napada #1 do #20, uz lokalnog pružatelja u `tests/unit/auth/test-idp.ts`).
6. Kolačić sesije i pokušaja: `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, bez `Domain`. Token je 32 slučajna bajta, u bazi samo SHA-256. Izvor: `docs/BACKEND.md` §4.3, `docs/ARCHITECTURE.md` §4 točka 4. Testovi: `flow.test.ts` (#13), `session-token.test.ts`.
7. Nova sesija pri svakoj prijavi, prethodni kolačić sesije se zatvara (session fixation). Test: `flow.test.ts` #12. Callback se ne može ponoviti (#2).
8. `returnTo` je samo putanja ove aplikacije, pohranjena uz pokušaj, nikad iz callback upita; `//host`, obrnute kose crte, kontrolni znakovi i `/api` (u svim pisanjima do tri kruga dekodiranja) vraćaju `/`. Test: `return-to.test.ts`, `return-to.property.test.ts`, `flow.test.ts` #17.
9. Neutralna poruka: neuspjeh ne otkriva koja je provjera pala ni postoji li ustanova (ZD403, ZD422, ZD503 isti ishod). Izvor: komentar migracije `20261010210000`, `docs/ARCHITECTURE.md` §3. Testovi: `flow.test.ts`, `db/tests/021-open-session.sql`.
10. Samo `ductus_auth` ima EXECUTE na `identity.open_session`; `ductus_app` nema SELECT/UPDATE/DELETE na `identity.session`, `user_account`, `institution`; tablice imaju FORCE RLS s politikom samo za `ductus_identity`; funkcije su `SECURITY DEFINER` s praznim `search_path`. Izvor: D-90, `docs/BACKEND.md` §3 i §4.3. Testovi: `db/tests/020-identity-session.sql`, `021-open-session.sql`, `022-open-session-realm.sql`, `db/tests/010-roles-and-privileges.sql`, `tests/integration/open-session.integration.test.ts`.
11. Istek sesije (12 sati) nije odjava: lokalni journal ostaje do ponovne prijave istog korisnika. Izvor: `docs/BACKEND.md` §4.3, komentar `open_session`. Brisanje journala pri odjavi pokriva skill `ductus-local-storage-logout`.
12. Mijenjajuće rute traže `Origin` (bez zaglavlja odbij) i `Sec-Fetch-Site`; tijelo se čita kao sirovi bajtovi uz tvrdi limit prije parsiranja. Izvor: `docs/BACKEND.md` §4.3, `docs/ARCHITECTURE.md` §4 točka 4. Test: `src/server/http/mutation-request.test.ts`. Nesklad: `isSameOrigin` u odjavi prihvaća i `Origin` kad nema `Sec-Fetch-Site`, a `checkMutationRequest` traži `Origin` uvijek (vidi Zamke).
13. Logovi nose fazu i kod greške, nikad vrijednost iz zahtjeva ili od pružatelja; greške konfiguracije imenuju varijablu, ne vrijednost. Test: `flow.test.ts` ("logs a stage and a code..."), `config.test.ts`.
14. `ductus_app` prijava nikad ne drži `open_session`, a prijava `ductus_auth` ne prolazi kroz `withActor`. Provedba: `OPEN_SESSION_SQL` i `APP_ROLE_SQL`; test: `src/server/db/with-actor.test.ts`, `tests/integration/with-actor.integration.test.ts`.
15. Tajne nikad u repou: `DUCTUS_AUTH_LOCAL_PASSWORD` i `AUTH_DATABASE_URL` nemaju zadanu vrijednost (CI ih pravi po pokretanju). `OIDC_CLIENT_SECRET=ductus-local-only` u `.env.example` i fake-oidc je poznata lokalna vrijednost lažnog pružatelja.

## 5. Kako napraviti promjenu

Risk razina (`docs/ENGINEERING_SYSTEM.md` §5): sve što dira identity/auth/OIDC/login/session, `app/api/**` trust granice, `db/migrations/`, `db/local/`, `src/server/db/` i cijeli `tests/` je najmanje `critical`. `critical` traži neovisni review i QA s različitim GitHub Appovima (§5 i §6), plan napada (`ductus-attack-plan`) i ostalo što za `critical` PR navodi kartica uloge u `.claude/uloge/`. D-97 putanje (`.github/`, `.claude/`, `scripts/engineering/` i druge) spajaju se samo na Danielovu naredbu; ovaj vodič ne mijenja te putanje.

A. Promjena provjere u `claims.ts` ili `return-to.ts`: dodaj negativni test prvo (`claims.test.ts` ili `return-to.test.ts`, svojstveni test uz `return-to.property.test.ts`), zatim kod. Ako se mijenja skup znakova, uskladi ga s `open_session` (SQL je stroži od `claims.ts`, komentar migracije `20261010220000`).

B. Promjena toka u `flow.ts` ili `oidc.ts`: ruta ostaje tanka, logika u `flow.ts`; svaki novi neuspjeh završava u `failurePage`; dodaj test u `tests/unit/auth/flow.test.ts` s lokalnim pružateljem iz `test-idp.ts`. `openid-client` se uvozi samo u `oidc.ts`.

C. Nova varijabla konfiguracije: dodaj u `loadAuthConfig` (poruka imenuje varijablu, ne vrijednost), u `.env.example` i `config.test.ts`. Ako ulazi u CI, to je promjena workflowa (skill `ductus-ci-change`, D-97).

D. Migracija identiteta: nova migracija, nikad izmjena stare; prati obrazac `GRANT CREATE ... TO ductus_identity`, `SET LOCAL ROLE`, vlasništvo i vraćanje na `ductus_migrator`; funkcije `SECURITY DEFINER`, `SET search_path = ''`, `REVOKE ALL ... FROM PUBLIC`, EXECUTE samo ciljnoj ulozi; greške bez ulaza (ZD kodovi). Nova tablica: RLS i FORCE, politika, redak u pgTAP matrici (skill `ductus-new-table`). Migracije se ne primjenjuju na produkciju iz agenta.

E. Promjena lažnog pružatelja: `infra/fake-oidc/server.mjs`; računi ostaju izmišljeni, poruka "Ovo nije AAI@EduHr" ostaje; ne dodaje se mogućnost da ga produkcija odabere. Provjeri `e2e/login/` i `e2e/auth.spec.ts`.

F. D-104 (drugi izdavatelj): vidi Otvoreno. Smije se mijenjati samo model podataka; nikakav novi način prijave.

## 6. Provjera

- `pnpm test:unit` (obuhvaća `src/server/auth/*.test.ts`, `src/server/http/*.test.ts`, `tests/unit/auth/*`); `pnpm test:property` za `return-to.property.test.ts`. Brzo: `pnpm exec vitest run --project unit src/server/auth tests/unit/auth src/server/http`.
- `pnpm lint`, `pnpm typecheck`.
- Baza (lokalni stack i migriran, vidi `docs/vodici/testovi.md`): `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:db` (pgTAP `db/tests`), `pnpm test:integration`.
- `pnpm test:e2e` (glavni skup, uključuje `e2e/auth.spec.ts` na produkcijskom buildu) i `pnpm test:e2e:login` (cijela prijava preko lažnog pružatelja uz `next dev`; treba compose stack, migriranu i seedanu bazu i `AUTH_DATABASE_URL`).
- CI: posao "Lint, typecheck, test and build" (`build`) za unit i build; posao "Local stack (compose.yaml)" (`stack`) za pgTAP, E2E i "Full login E2E"; "Security scanners" za Gitleaks, Semgrep, zizmor, OSV.

## 7. Zamke

- `NODE_ENV` čita se kao literal u `deps.ts`; ne zamjenjuj ga drugom konstrukcijom, ne uvodi `allowDevelopmentBuild` (`build-mode.test.ts` to hvata).
- Lista dopuštenih okoliša, ne pogađanje "production": prazno ili krivo napisano znači produkcija (QA #191).
- `new URL` briše prazan `?` i `#`; `isPlainHttpsUrl` zato provjerava i sirovu vrijednost.
- `limitedFetch` pretvara mrežnu grešku i 5xx u `ProviderUnavailableError` (stranica 503); bez toga bi spor pružatelj izgledao kao pogrešna prijava.
- Neuspjeli discovery se ne kešira (`discovered = undefined`).
- `isSameOrigin` (odjava) i `checkMutationRequest` imaju različita pravila za nedostajući `Origin`; nova mijenjajuća ruta koristi `checkMutationRequest`, a odjava ostaje kakva je dok se ne uskladi odlukom.
- `readBodyWithLimit` namjerno nema vremenski limit; njega moraju postaviti ruta ili infrastruktura (komentar u `mutation-request.ts`).
- `withActor` zabranjuje transakcijske i sesijske naredbe i ugniježđeni poziv; `set_config` mora ostati transakcijski (`true`), inače token curi na sljedeći zahtjev preko spremnika veza.
- `open_session` provjera `lokalni@realm` vrijedi pri svakoj prijavi, i za postojeće račune; pohranjeni `hrEduPersonUniqueID` se ne kanonizira. Ne jamči se da AAI@EduHr garantira jednakost realma i homeOrg-a (`docs/ARCHITECTURE.md` §3); nije potvrđeno sa Srcem.
- `claims.ts` propušta Zs razmake, SQL ih odbija (komentar u `20261010220000`).
- Rute s imenom koje sadrži login, session, token i slično izvan `app/api/auth` ruši `routes.test.ts`.
- Seed: ustanova bez `aai_home_org` ne prima prijave; lažni pružatelj daje `demo.ductus.test`. Stvarni studentski podaci ne smiju u testove (`ductus-synthetic-data`).
- Prijava `ductus_auth_local` nema lozinku u repou; `db:provision:auth` zahtijeva `DUCTUS_AUTH_LOCAL_PASSWORD`.

## 8. Otvoreno

- D-104 (potvrđeno 11. 10. 2026.): model računa se priprema za drugog izdavatelja prije M1, D-09 nepromijenjen, zadatak `critical` s planom napada. Stanje u kodu: `identity.user_account` je već ključan po `(oidc_issuer, hr_edu_person_unique_id)` i `(oidc_issuer, oidc_subject)`, a `open_session` prima izdavatelja iz tokena; `AuthConfig` ima jednog izdavatelja. Ostatak D-104 zadatka u repou nisam potvrdio. Drugi pružatelj prijave traži novu odluku vlasnika (komentar 6105021669, `docs/DECISIONS.md` D-104); do tada ga ne gradi.
- D-73: izbor OIDC biblioteke ostaje PRIJEDLOG (kod koristi `openid-client`); Better Auth je alternativa u dokumentu.
- D-16 (isti AAI@EduHr za nastavnike, mentore, administratore) je PRIJEDLOG; STATE.md Owner queue traži potvrdu D-16, D-20, D-38.
- STATE.md Owner queue: "FPZG AAI: ovlast za AAI@EduHr Lab i kasnije registracija Ductusa kao usluge. Blokira M1, ne demo." Daniel ne može sam registrirati klijenta (`docs/BACKEND.md` §4.3, Dodatak B). Nitko ne pretpostavlja stvarne AAI vrijednosti dok Lab ne prođe.
- Nepotvrđeno sa Srcem: koji je identifikator trajan (`sub` ili `hrEduPersonUniqueID`) i jamči li AAI jednakost realma i homeOrg-a; do odgovora promjena subjecta ili ustanove odbija prijavu umjesto spajanja.
- RP-initiated i back-channel logout su obvezni cilj (`docs/BACKEND.md` §4.3), još ne implementirani.
- Odnos D-08 (dobavljači, B0.1) i staging/produkcijskog provisioninga uloga `ductus_auth`: lokalno ga zamjenjuje `db/local/auth-login.sql`.
