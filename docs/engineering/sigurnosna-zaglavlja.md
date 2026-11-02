# Sigurnosna zaglavlja: inventar builda i ciljani ugovor (M1.6, prvi dio)

Korak M1.6 iz `docs/PROGRAM-RAZRADA.md` (r. 55), Linear DAN-296. Ovaj zapis nije izvor pravila. Prvi dio bilježi što produkcijski build danas šalje i što stranice učitavaju te predlaže ciljani CSP i ugovor predmemorije. Produkcijska zaglavlja mijenja tek PR 2, nakon ugovora na #1091. Sesije i istek neaktivne sesije (P2) nisu dio ovog koraka.

Stanje "danas" čuva `e2e/security-headers.spec.ts`: test čita zaglavlja s builda i pada čim se ona razlikuju od ovog inventara. PR 2 zato mijenja konfiguraciju, ovaj dokument i test u istom PR-u.

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

## 4. Zaglavlja na buildu danas

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

## 6. Prijedlog ciljanog stanja (PRIJEDLOG, gradi PR 2)

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

## 8. Popis za PR 2

1. `middleware.ts`: nonce po zahtjevu i CSP (najprije Report-Only).
2. Tiptap: `injectCSS: false` i stylesheet, ili `injectNonce`.
3. `next.config.ts`: Permissions-Policy, COOP, `/api/auth/:path*` s `no-referrer`, `/api/:path*` s `no-store`.
4. Odluka o statičnim stranicama i `s-maxage` preusmjerenju.
5. HSTS u Caddy konfiguraciji ruba (B0.x) i mjerenje na stagingu.
6. Ažurirati ovaj dokument i `e2e/security-headers.spec.ts` u istom PR-u.
