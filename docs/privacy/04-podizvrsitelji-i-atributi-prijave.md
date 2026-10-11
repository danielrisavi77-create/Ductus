# 04 Podizvršitelji i atributi prijave

> **Ovo je radni nacrt, nije pravni savjet.** Popis odražava što predlažu dokumenti; ništa nije ugovoreno ni odabrano.

**Samo pravnik ili ustanova odlučuje:** je li pojedini subjekt podizvršitelj, zajednički voditelj ili samostalni primatelj; treba li pisano odobrenje ustanove (čl. 28. st. 2. GDPR-a); koji je mehanizam prijenosa izvan EU-a; je li lokacija obrade dovoljna kad matična grupa dobavljača ima sjedište izvan EU-a.

## 1. Podizvršitelji kako ih predlažu dokumenti

Cijeli dobavljački sloj je **PRIJEDLOG D-08, uvjetan**: potvrda tek nakon B0.1 i B0.2, a trošak premašuje D-66 (ARCHITECTURE §9, BACKEND §1, §7). Država sjedišta dobavljača i njegove matične grupe nije navedena u dokumentima; upisuje se iz ugovora i DPA-a, ne iz ovog nacrta. Ništa iz tablice nije izgrađeno: `package.json` nema klijente za pohranu objekata, KMS, e-poštu ni praćenje grešaka.

| Subjekt | Namjena | Što može vidjeti | Lokacija obrade u dokumentima | Provjeriti | Status |
| --- | --- | --- | --- | --- | --- |
| UpCloud | VM (web, worker) i upravljana PostgreSQL baza s PITR-om | Sve u bazi, uključujući kontrolne točke s punim tekstom rada | "EU" (BACKEND §3) | Država, grupa, DPA | PRIJEDLOG D-08 |
| Scaleway | Privatni bucket s odsječcima (po hashu) i e-pošta (TEM) | Sadržaj odsječaka; adrese primatelja e-pošte | Nije navedena | Država, grupa, DPA | PRIJEDLOG D-08 |
| AWS (samo KMS, eu-central-1) | Potpis potvrda i kontrolnih točaka | Samo prefiksirani digest (D-92) odnosno tekst kontrolne točke (D-71), bez sadržaja i identifikatora | eu-central-1 (ARCHITECTURE §9) | Pripadnost grupi izvan EU-a | PRIJEDLOG D-08, D-71 potvrđena |
| Drugi dobavljač za kopije (Hetzner Object Storage "ili sl.") | Dnevna replika bucketa i šifrirani dump (`age`) | Šifrirani sadržaj; ključ drži vlasnik | Nije određena | Odabir dobavljača, DPA | PRIJEDLOG (BACKEND §4.7) |
| Neon | Rezerva za bazu (ARCHITECTURE §9) | Kao baza | Nije navedena | Treba li uopće ostati u popisu | PRIJEDLOG, rezerva |
| TSA (DigiCert i Sectigo; FINA kad postoji obrt) | RFC 3161 vremenski žig dnevne kontrolne točke | Samo hash kontrolne točke | Nije navedena | Je li to obrada osobnih podataka | D-72, val 2 |
| Javna objava korijena: javni repozitorij (GitHub) i neovisni primatelji (e-pošta koordinatoru ustanove, Internet Archive ili Software Heritage) | Provjerljivost kontrolnih točaka | Potpisani korijen i ukupni broj potvrda (D-93), bez sadržaja | Nije navedena | Je li broj potvrda i korijen osobni podatak | D-72, D-93, val 2; GitHub je u PROGRAM GO popisu |
| GlitchTip EU ili Sentry EU | Praćenje grešaka bez tijela zahtjeva | Metapodaci greške; ne smije sadržavati tekst rada (BACKEND §4.9) | "EU" | Odabir; je li canary test dokaz | PRIJEDLOG, nije odabrano |
| Vanjski uptime monitor | Alarm dostupnosti (BACKEND §4.9) | Samo javnu adresu | Nije određena | Odabir | Nije odabrano |

**Ne ulaze u popis u pilotu:** OpenRouter i svi AI pružatelji (ugrađeni AI izvan pilota, D-77; ARCHITECTURE §5b); GitHub i Linear kao razvojni alati (prema `CLAUDE.md` u njih ne idu stvarni osobni podaci); AAI@EduHr (Srce), koji je izvor identiteta, a ne izvršitelj Ductusa, i čiju uslugu registrira ustanova (ARCHITECTURE §4); Caddy (softver na VM-u). Sam Ductus (izvršitelj, fizička osoba) je u `05` kao otvoreno pitanje.

## 2. Atributi prijave

Protokol: OIDC Authorization Code s PKCE-om prema AAI@EduHr (D-09, `docs/PRODUCT.md` §4). Odobravanje atributa ide kroz registraciju usluge koju podnosi ustanova (BACKEND §4.3); nije provedeno.

| Atribut | Što kaže PRODUCT §4 | Što radi kod na `main` | Svrha | Napomena |
| --- | --- | --- | --- | --- |
| `openid`, `sub` | Traži se | Čita se i sprema (`identity.user_account.oidc_subject`) | Provjera ID tokena i userinfo odgovora | Uz `hrEduPersonUniqueID` do potvrde Srca koji je trajan |
| `hrEduPersonUniqueID` | Traži se; identitet korisnika, nikad e-pošta | Čita se i sprema | Ključ računa uz izdavatelja | Oblik `lokalni@realm` provjerava se pri svakoj prijavi |
| `hrEduPersonHomeOrg` | Traži se | Čita se; bira ustanovu; **ne sprema se** uz korisnika | Odabir ustanove, upis samo za istu ustanovu | Nepoznata ustanova daje odbijenu prijavu |
| `hrEduPersonAffiliation` | Traži se; `djelatnik` znači samo da osoba može dobiti ulogu | **Ne čita se** | Predviđeno za potvrdu uloge nastavnika | Uloge potvrđuje administrator; je li atribut potreban `[ODLUKA]` |
| `email` | "Po potrebi" | Ne čita se, ne sprema | Moguće obavijesti | Prijava radi i bez njega; potreba nije utvrđena `[ODLUKA]` |
| `profile` (opseg) | Nije na popisu | **Zatražen:** `scope: "openid profile"` (`src/server/auth/oidc.ts`) | Nije naveden | Razlika od PRODUCT §4; što AAI pod tim opsegom pušta, nije provjereno; kod ne sprema ništa osim gornjeg `[IZVEDBA]` |
| Ime za prikaz | Nije na popisu | Ne sprema se | Nastavnik bi vidio ime studenata (ARCHITECTURE §3) | Izvor imena nije određen `[ODLUKA]` |
| OIB | Ne traži se | Ne traži se | | Ostaje pravilo `[PRAVILO]` |

Prijedlog najmanjeg skupa za razgovor sa Srcem i ustanovom (nije odluka): `openid`, `hrEduPersonUniqueID`, `hrEduPersonHomeOrg`, i `hrEduPersonAffiliation` samo ako se potvrda uloga ne rješava drukčije; bez `profile`, bez `email`, bez imena dok se ne utvrdi potreba.
