# Sigurnosna zaglavlja: inventar builda i ciljani ugovor (M1.6, prvi dio)

Korak M1.6 iz `docs/PROGRAM-RAZRADA.md` (r. 55), Linear DAN-296. Ovaj zapis nije izvor pravila. Prvi dio bilježi što produkcijski build danas šalje i što stranice učitavaju te predlaže ciljani CSP i ugovor predmemorije. Produkcijska zaglavlja mijenja PR 2 (M1.6b, Linear DAN-489) prema ugovoru na #1091 (c.6574486389); njegovo stanje je u odjeljku 9. Sesije i istek neaktivne sesije (P2) nisu dio ovog koraka.

Stanje builda čuva `e2e/security-headers.spec.ts`: test čita zaglavlja s builda i pada čim se ona razlikuju od inventara. Od PR 2 pinira stanje iz odjeljka 9; odjeljci 2 do 5 ostaju zapis stanja prije njega.

## 1. Metoda

- Build: `pnpm build` i `pnpm start` (Next.js 15.5.28) na `origin/main` 6f58458b, uz iste lokalne vrijednosti okoline kao `playwright.config.ts` ("Demo prijava" namjerno konfigurirana, produkcijski build je odbija, D-09). Grane `main` do ec8cd7b1 ne diraju `app/`, `src/` ni `next.config.ts`.
- Zaglavlja: `curl -sD -` po ruti i Playwright `request` (test iz ovog PR-a).
- Izvori: Chromium (Playwright) bilježi svaki zahtjev stranice, inline skripte i stilove; zatim ista stranica s nametnutim probnim CSP-om bilježi `securitypolicyviolation` događaje.
- Kod: pregled svih `fetch`, `new Worker`, `navigator.*`, `postMessage` i vanjskih URL-ova u `src/` i `app/`.

## 2. Izvori po ruti

Sve što stranice učitavaju je s istog izvora. Nema slika, iframeova, obrazaca ni workera.

| Ruta | Skripte | Stilovi | Fontovi | connect | Inline skripte | Inline stil |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | `/_next/static/chunks/*` | `/_next/static/css/*` | `/_next/static/media/*.woff2` | RSC prefetch `/` | 13 | Tiptap `<style>` |
| `/prijava` | isto | isto | isto | RSC prefetch `/` | 7 | nema |
| `/rad` | isto | isto | isto | RSC prefetch `/` | 10 | Tiptap `<style>` |
| `/zadaci` | isto | isto | isto | RSC prefetch `/` | 6 | nema |
| `/upis` | isto | isto | isto | RSC prefetch `/` | 5 | nema |
| `/nastavnik` | isto | isto | isto | RSC prefetch `/` | 6 | nema |
| `/nastavnik/brz-put` | isto | isto | isto | RSC prefetch `/` | 5 | nema |
| `/nastavnik/zadatak/novi` | isto | isto | isto | RSC prefetch `/`, `/nastavnik` | 5 | nema |
| `/zadatak/[id]` | isto | isto | isto | RSC prefetch `/` | 6 | nema |
| 404 | isto | isto | isto | RSC prefetch `/` | 7 | nema |

Inline izvori:

- Next.js flight skripte (`self.__next_f.push(...)`) razlikuju se po zahtjevu, pa hash nije moguć; strogi `script-src` traži nonce.
- `THEME_SCRIPT` u `app/layout.tsx` i `app/global-error.tsx` (`dangerouslySetInnerHTML`).
- Tiptap/ProseMirror sam umeće `<style>` (zadani `injectCSS`) na stranicama s uređivačem.
- Atribut `style` na najavljivaču rute (`next-route-announcer`) postavlja se kroz CSSOM, što CSP dopušta.

Iz koda, izvan onoga što je sonda vidjela bez sesije:

- Svi klijentski `fetch` pozivi su relativni, s istog izvora: `src/client/comments.ts` (`/api/comments/*`), `src/client/evidence-session-deps.ts`, `src/client/fast-path.ts`, `src/client/live-publisher.ts`, `src/client/live-reader.ts`, odjava u `src/components/editor/LocalDocument.tsx` r. 621.
- Objektna pohrana dokaza (`src/adapters/evidence/s3-evidence-payload-store.ts`) radi samo na poslužitelju; preglednik je ne zove, pa `connect-src` ne treba vanjski izvor.
- API-ji preglednika: IndexedDB (Dexie), `navigator.locks`, `BroadcastChannel`, `navigator.clipboard` (`EarlierDraft.tsx` r. 62). Nijedan ne traži CSP izvor; `clipboard` je važan za Permissions-Policy.
- Jedini vanjski URL je poveznica `https://www.aaiedu.hr/kontakt` (navigacija, ne učitavanje).
- Prijava je poveznica (`<a href>`), ne obrazac.
- Skripta react-grab s `unpkg.com` učitava se samo u `next dev` uz `DUCTUS_DEV_REACT_GRAB=1` i izvan CI-ja; build je ne sadrži.

## 3. Probni CSP (Chromium, build)

Osnova svih proba: `default-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.

| `script-src` | `style-src` | Rezultat |
| --- | --- | --- |
| `'self'` | `'self'` | sve inline skripte blokirane; nijedna stranica se ne hidrira |
| `'self' 'unsafe-inline'` | `'self'` | jedno kršenje `style-src-elem` na `/` i `/rad` (Tiptap `<style>`); uređivač i dalje piše |
| `'self' 'unsafe-inline'` | `'self' 'unsafe-inline'` | nula kršenja |

Zaključak: osim inline skripti i Tiptap stila, ništa ne traži izvor izvan `'self'`.

## 4. Zaglavlja na buildu prije PR 2 (6f58458b)

`next.config.ts` postavlja na `/:path*`: `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`; `poweredByHeader: false`.

| Klasa odgovora | Cache-Control | Ostalo |
| --- | --- | --- |
| Dinamički HTML (`/`, `/prijava`, `/rad`, ostale stranice, 404) | `private, no-cache, no-store, max-age=0, must-revalidate` | tri zaglavlja iz konfiguracije; `Link` preload fontova |
| `/_next/static/chunks/*`, `/_next/static/css/*` | `public, max-age=31536000, immutable` | tri zaglavlja iz konfiguracije |
| `/favicon.ico` | `public, max-age=0, must-revalidate` | isto |
| `/api/health` | `no-store` | isto |
| `/api/auth/login`, `/api/auth/callback` (503 u buildu) | `no-store` | `Referrer-Policy: strict-origin-when-cross-origin` |
| `POST /api/auth/logout` (503 u buildu) | `no-store` | isto |
| odgovor rute 401, 403, 503 | `no-store` | isto |
| 405 okvira na API ruti | nema | isto |
| `/nastavnik/kolegiji` (statični prerender, 307 na `/nastavnik`) | `s-maxage=31536000` | `x-nextjs-stale-time: 300` |

Nijedan odgovor nema `Content-Security-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy` ni `X-Powered-By`.

## 5. Nalazi (razlika između namjere i builda)

- **N-1.** `src/server/auth/flow.ts` r. 43 traži `referrer-policy: no-referrer` na prijavi, povratnom pozivu i preusmjerenjima, a build šalje `strict-origin-when-cross-origin`: unos `/:path*` u `next.config.ts` prepisuje zaglavlje istog imena koje postavi ruta. `tests/unit/auth/flow.test.ts` r. 104 to ne vidi jer zove handler izravno.
- **N-2.** 405 koji okvir vraća za neobrađenu metodu na API ruti nema `Cache-Control`.
- **N-3.** Statični prerender `/nastavnik/kolegiji` vraća preusmjerenje s `s-maxage=31536000`. Ne nosi osobne podatke, ali dijeljena predmemorija ga smije čuvati godinu dana.
- **N-4.** Nema CSP-a, Permissions-Policy, HSTS-a ni COOP-a (komentar u `next.config.ts` ih najavljuje s prijenosom uređivača).
- **N-5.** Ugradnju u okvir brani samo `X-Frame-Options`; nema `frame-ancestors`.

## 6. Prijedlog ciljanog stanja (PRIJEDLOG; što je PR 2 izveo, a što ne, piše u odjeljku 9)

### 6.1 CSP

```
default-src 'self';
script-src 'self' 'nonce-<po zahtjevu>' 'strict-dynamic';
style-src 'self';
img-src 'self';
font-src 'self';
connect-src 'self';
worker-src 'none';
object-src 'none';
base-uri 'none';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

- Nonce se stvara po zahtjevu u `middleware.ts` (pod kritičnim podom rizika) i prosljeđuje Next.js-u kroz zaglavlje zahtjeva; `THEME_SCRIPT` ga dobiva kao atribut. Nonce prisiljava dinamičko renderiranje: dvije rute koje build označi statičnima (`○ /_not-found` i `○ /nastavnik/kolegiji`) treba ili prebaciti na dinamičke ili im dati politiku bez inline skripti.
- Tiptap stil: `injectCSS: false` i pravila iz umetnutog stila u vlastiti stylesheet (prednost: `style-src 'self'` bez noncea) ili `injectNonce` s istim nonceom.
- `img-src` dobiva `data:` samo ako PR 2 pokaže da ga uređivač treba.
- `upgrade-insecure-requests` ima smisla samo iza HTTPS ruba.
- `next dev` treba vlastitu politiku (`'unsafe-eval'` za brzo osvježavanje); react-grab ostaje samo u devu.
- Uvođenje: najprije `Content-Security-Policy-Report-Only` na stagingu, zatim provedba.

### 6.2 Ostala zaglavlja

- **Permissions-Policy:** `camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), interest-cohort=()`; `clipboard-write` ostaje dopušten za `self` (`EarlierDraft.tsx`).
- **Cross-Origin-Opener-Policy:** `same-origin`.
- **HSTS:** na Caddy rubu (`docs/backend/pregled.md`, pilot topologija): `max-age=63072000; includeSubDomains`. `preload` je vlasnikova odluka.
- **Referrer-Policy:** globalno ostaje `strict-origin-when-cross-origin`; novi unos u `next.config.ts` za `/api/auth/:path*` s `no-referrer`, jer konfiguracija prepisuje zaglavlja rute (N-1).
- **X-Frame-Options: DENY** ostaje uz `frame-ancestors 'none'` za starije preglednike.

### 6.3 Ugovor predmemorije

| Tok | Ugovor |
| --- | --- |
| Prijava (`/prijava`, `/api/auth/login`, `/api/auth/callback`) | `no-store` na svakom odgovoru, i na 303 i stranici neuspjeha; `no-referrer` |
| Uređivanje (`/rad`, `/zadatak/[id]`, nastavnički pogledi) | HTML `private, no-store` (zadano u Nextu, test ga čuva); pod za `/api/:path*` u konfiguraciji `no-store`, da ga dobije i 405 (N-2) |
| Odjava (`POST /api/auth/logout`) | 303 `no-store`; prijedlog `Clear-Site-Data: "cache"`, ali ne `"storage"`, jer brisanje lokalnog dnevnika (Dexie) pripada ogradi odjave u klijentu. Otvoreno pitanje za PR 2 |
| Istek | stranica prijave i 401 `no-store`; povratak kroz bfcache pokriva postojeća ponovna provjera na `pageshow` (`src/client/session-end.ts`, `LocalDocument.tsx`); istek neaktivne sesije je P2 |
| Statični resursi | `public, max-age=31536000, immutable` (hash u imenu) |
| Statični prerender | smije imati `s-maxage` samo ako ne nosi osobne podatke (N-3); PR 2 odlučuje ostaje li statičan |

## 7. Poznate granice

- HSTS i ponašanje Caddy ruba dokazivi su samo na stvarnom HTTPS rubu (staging); lokalni `next start` radi na HTTP-u.
- Prijavljeni pogledi nisu učitani sa sesijom (u okolini mjerenja nije bilo baze); izvori su za njih potvrđeni pregledom koda (odjeljak 2).
- Probni CSP proveden je samo u Chromiumu; test zaglavlja radi u sva četiri projekta.
- `next dev` nije mjeren.
- Nadogradnja Next.js-a može promijeniti zadana zaglavlja (npr. Cache-Control za HTML ili 405); test to uhvati.

## 8. Popis za PR 2 (izvorni; ishod u odjeljku 9)

1. `middleware.ts`: nonce po zahtjevu i CSP (najprije Report-Only).
2. Tiptap: `injectCSS: false` i stylesheet, ili `injectNonce`.
3. `next.config.ts`: Permissions-Policy, COOP, `/api/auth/:path*` s `no-referrer`, `/api/:path*` s `no-store`.
4. Odluka o statičnim stranicama i `s-maxage` preusmjerenju.
5. HSTS u Caddy konfiguraciji ruba (B0.x) i mjerenje na stagingu.
6. Ažurirati ovaj dokument i `e2e/security-headers.spec.ts` u istom PR-u.

## 9. Stanje nakon PR 2 (DAN-489)

Ugovor: #1091, c.6574486389, koji je orkestrator potvrdio. Mjereno na buildu (`pnpm build`, `next start`); sve rute su dinamičke (`ƒ`), statičnih više nema.

### 9.1 CSP stranica

`middleware.ts` za svaki zahtjev stranice stvara nonce od 128 slučajnih bitova i politiku (`src/server/http/content-security-policy.ts`). Postavlja je na zaglavlje zahtjeva, iz kojeg Next.js nonce stavlja na svoje skripte, i na odgovor, koji provodi preglednik. Na buildu:

```
default-src 'self';
script-src 'self' 'nonce-<po zahtjevu>' 'sha256-w5EUkO0mfeWuprqAVvvDQYH6baexqP0/rQ+LVq3kZ6I=' 'strict-dynamic';
style-src 'self';
img-src 'self';
font-src 'self';
connect-src 'self';
worker-src 'none';
object-src 'none';
base-uri 'none';
form-action 'self' <ishodište OIDC_ISSUER>;
frame-ancestors 'none'
```

- `THEME_SCRIPT` je dopušten svojim hashom, a ne nonceom. Unit test hash ponovno računa iz skripte, pa promjena skripte bez nove konstante pada.
- `form-action` uz `'self'` sadrži ishodište davatelja identiteta, jer 303 odjave vodi na `end_session`. Ako `OIDC_ISSUER` nedostaje ili nije http(s) URL, ostaje samo `'self'`.
- Samo `next dev` dodaje `'unsafe-eval'` u `script-src` i `'unsafe-inline'` u `style-src`.
- Middleware ne obuhvaća `/api/*`, `/_next/static/*` ni `/favicon.ico`. `/_next/image` ostaje obuhvaćen: odgovor 400 krajnje točke za slike nosi politiku stranice, optimizator na slike stavlja vlastitu politiku sa `sandbox`, a svaka putanja ispod nje je HTML 404 kojem treba nonce. Prvotno izuzeće `_next/image/` hvatalo je samo takve podputanje, pa je njihov 404 ostajao bez politike (nalaz drugog reviewa na PR-u 2).
- Izuzete putanje dobivaju iz `next.config.ts` politiku koja ništa ne dopušta. Next.js i ondje na GET odgovara HTML stranicom greške, npr. 416 za `Range` izvan duljine datoteke, a bez te politike ona bi ostala bez CSP-a (nalaz trećeg reviewa na PR-u 2, c.6581226772). Preglednik politiku na skripti ili stilu kao podresursu ne primjenjuje.
- Izostavljeno u odnosu na 6.1: `upgrade-insecure-requests` (ruši `http://localhost`) i Report-Only razdoblje.

### 9.2 Promjene koje politika traži u aplikaciji

- Tiptap: `injectCSS: false` u `LocalDocument.tsx` i `TwoSides.tsx`; njegov osnovni CSS, doslovno iz `@tiptap/core` 3.31.4, je u `app/prosemirror.css`, uvezen u root layout.
- `app/not-found.tsx` zove `await connection()`: prerenderirana 404 nema nonce, pa bi joj se skripte odbile.
- `app/api/[...path]/route.ts` nepoznatu `/api/*` putanju odbija JSON odgovorom 404 s `no-store`. Bez nje bi Next.js ondje renderirao `app/not-found.tsx` kao HTML pod politikom za API, bez noncea, pa bi stilovi i skripte bili odbijeni (nalaz reviewa na PR-u 2). Postojeće rute pod `app/api` imaju prednost.
- `AppShell.tsx`: pravila za rad bez JavaScripta (bočna traka i odjava ostaju u stranici, I5) prešla su iz `<noscript><style>` u `@media (scripting: none)` u `AppShell.module.css`, jer `style-src 'self'` odbija inline stil. Ovo nije bilo u ugovoru; dopuna je na #1091.

### 9.3 Zaglavlja po klasi odgovora

| Klasa odgovora | CSP | Cache-Control |
| --- | --- | --- |
| HTML stranice i 404 | politika iz 9.1, nonce nov za svaki zahtjev | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `/nastavnik/kolegiji` (307 na `/nastavnik`) | politika iz 9.1 | kao HTML; `s-maxage` je nestao, pa je N-3 zatvoren |
| `/api/*`, uključujući 405 okvira i JSON 404 nepoznate putanje | `default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (iz `next.config.ts`) | nepromijenjeno (N-2 ostaje) |
| `/_next/static/*`, `/favicon.ico`, uključujući HTML greške okvira (npr. 416) | ista politika kao za `/api/*` (iz `next.config.ts`) | nepromijenjeno |

Svi odgovori uz tri postojeća zaglavlja nose i `Strict-Transport-Security: max-age=63072000; includeSubDomains` te `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), clipboard-write=(self)`. `interest-cohort` iz 6.2 je izostavljen, kao u ugovoru, jer je FLoC napušten. Nijedan odgovor nema `Cross-Origin-Opener-Policy`, `Content-Security-Policy-Report-Only` ni `X-Powered-By`.

### 9.4 Otvoreno nakon PR 2

- COOP; N-1 (`no-referrer` na `/api/auth/*`); N-2 (405 bez `no-store`); Report-Only na stagingu i `report-to`; HSTS `preload` i HSTS na Caddy rubu; `Clear-Site-Data` na odjavi. Predlaže se nastavak pod DAN-296.
- HSTS preglednik preko HTTP-a zanemaruje (RFC 6797 §8.1); djeluje tek iza TLS-a na stagingu.
- `'strict-dynamic'` dopušta skripti s nonceom učitati daljnje skripte; sigurnost počiva na tome da nonce dobiva samo Next.js.

## 10. Rani odgovori usmjerivača (DAN-498)

Nalaz reviewa na PR-u 2 (#1323, c.6582425785), issue #1369. Tvrdnja iz 9.3 da sva zaglavlja nose „svi odgovori” nije vrijedila za odgovore koje usmjerivač Next.js šalje prije `headers()` iz `next.config.ts` i prije middlewarea. Ugovor: #1369, c.6584199310.

### 10.1 Što je nedostajalo

Mjereno na buildu `main` abff265 (`pnpm build`, `next start`), za GET, HEAD, POST i OPTIONS:

| Klasa ulaza | Primjer | Odgovor | Zaglavlja prije DAN-498 |
| --- | --- | --- | --- |
| dvostruka kosa crta | `/prijava//x`, `//evil.example`, `/api//health` | 308 na normaliziranu putanju | nijedno |
| obrnuta kosa crta | `/prijava\x`, `/\prijava` | 308 | nijedno |
| kosa crta na kraju | `/prijava/`, `/api/health/`, `/favicon.ico/` | 308 bez kose crte | nijedno |
| kodirani znak koji se ne može dekodirati | `/api/%`, `/zadatak/%E0%A4%A` | HTML 400 (stranica greške okvira) | nijedno, pa ni `frame-ancestors` ni `X-Frame-Options` |
| kodirani znak koji se dekodira | `/prijava%2F%2Fx`, `/%` | 404 normalnim putem | sva |
| velika i mala slova | `/Prijava//X` (308), `/PRIJAVA` (404) | prema ostalim klasama | 308 nijedno, 404 sva |
| upit | `/prijava//x?a=b` (308), `/prijava?%` (200) | upit ne mijenja put | 308 nijedno, 200 sva |

### 10.2 Popravak

- `src/server/http/security-headers.ts` drži zaglavlja iz 9.3 (`next.config.ts` ih sada uvozi odande) i „pod”: ta zaglavlja i politiku koja ništa ne dopušta (`default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`).
- `instrumentation.ts` pri pokretanju Node procesa omata `ServerResponse.prototype.writeHead`. Kroz njega prolaze i `end()` i `flushHeaders()`. Pod postavlja samo zaglavlje koje odgovor još nema, pa vrijednost rute, middlewarea ili `next.config.ts` ostaje; zaglavlja predana samom `writeHead` u Nodeu ionako zamjenjuju ranije, pa i ona imaju prednost. Dvostruka instalacija omata jednom.
- Edge bundle ga ne sadrži: kod je u bloku `NEXT_RUNTIME === "nodejs"`, koji webpack izbacuje zajedno s uvozom `node:http`.
- Normalne stranice, `/api/*` i statičke datoteke zadržavaju politike iz 9.3; svako zaglavlje stiže točno jednom.

Dokaz: tablični test u `e2e/security-headers.spec.ts` (svaki redak pinira status, pa dokazuje da je to baš rani put; za `/prijava//x` i `Location`) i unit test poda nad pravim `node:http` poslužiteljem (`src/server/http/security-headers.test.ts`).

### 10.3 Poznate granice

- Odgovor 400 koji Node sam piše na neispravan HTTP zahtjev (`clientError`) ne prolazi kroz `ServerResponse` i ostaje bez zaglavlja. Nema tijela, pa nema što uokviriti.
- HTML 400 stranica greške okvira sada nosi politiku koja ništa ne dopušta, pa se njezini stilovi ne primjenjuju; tekst ostaje čitljiv.
- Pod ovisi o tome da Next.js pozove `register()` prije prvog zahtjeva. Next.js 15.5 to čini; nadogradnja okvira mora ponovno proći tablični test.
- Mjereno na buildu (`next start`). `next dev` učitava isti `instrumentation.ts`, ali nije zaseban dio dokaza.
- Rub Caddy na stagingu nije dio ove mjere; HSTS ondje ostaje otvoren kao u 9.4.
