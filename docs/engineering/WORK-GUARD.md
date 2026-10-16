# Provjera dodjele prije rada i pusha

DAN-202, issue #348. Dodatak postojećem `orch:push`, ne novi orkestrator.
Mjerodavni ostaju `CLAUDE.md`, `docs/MULTI-ACCOUNT.md`, `docs/SESSIONS.md`
i `docs/ENGINEERING_SYSTEM.md` (§13, §14.6 i §16). Linear vodi zadatak i status;
GitHub nosi izvedbu, pregled i dokaze. Ovaj alat ne mijenja njihove ovlasti.

## Okidač i vlasnik

Jedini aktivni orkestrator izdaje kratkotrajni JSON presjek dodjela i predaje ga
piscu u njegovu izoliranom worktreeju. Datoteka ostaje izvan repoa. Pisac ne izdaje
sam sebi dodjelu, ne uklanja blokade i ne resetira povijest neuspjeha.

Prije početka pisanja pisac pokreće:

```sh
node scripts/orchestrator/work-guard.mjs /put/do/dodjele.json DAN-202 chatgpt:workguard:platforma
```

Automatski okidač je postojeći `pnpm orch:push`: kad je sesija konfigurirana,
`push-verify.mjs` poziva provjeru prije prvog `git push`. Izlaz `BLOCKED` prekida
push, a `ALLOWED` veže push uz točno provjereni SHA, ne uz ref koji se može pomaknuti.
Provjera nakon pusha uspoređuje taj SHA s odredištem. Kasnije nastali lokalni commit
ne šalje se slučajno; za njega treba novi prolaz.

Bash, samo u toj sesiji:

```sh
export DUCTUS_WORK_CONTRACT=/put/do/dodjele.json
export DUCTUS_WORK_TASK=DAN-202
export DUCTUS_WORK_AGENT=chatgpt:workguard:platforma
pnpm orch:push origin --to platforma/dan-202-work-guard
```

PowerShell, samo u toj sesiji:

```powershell
$env:DUCTUS_WORK_CONTRACT = 'D:\Ductus-artifacts\DAN-202\dodjela.json'
$env:DUCTUS_WORK_TASK = 'DAN-202'
$env:DUCTUS_WORK_AGENT = 'chatgpt:workguard:platforma'
pnpm orch:push origin --to platforma/dan-202-work-guard
```

Ako nijedna od tri varijable nije postavljena, postojeći push put ostaje isti.
Djelomična ili prazna konfiguracija blokira; ne prelazi prešutno na stari put.
Spajanje ovog PR-a samo po sebi ne konfigurira druge uređaje ili cloud sesije.
Nema promjene globalnih postavki, hookova, zaštite grane ili GitHub ovlasti.

## Oblik presjeka

Ovo je **sintetički primjer**, ne važeća dodjela. Orkestrator popunjava stvarni
SHA aktualnog `main`, trenutna UTC vremena, stvarni PR (ili `null` prije njegova
otvaranja), sve aktivne dodjele i cjelovitu povijest zadatka. Valjanost je najviše
15 minuta; primjer s ovim fiksnim vremenima ne koristiti za stvarni rad.

```json
{
  "schema": 1,
  "repository": "danielrisavi77-create/Ductus",
  "issuedAt": "2026-10-13T04:00:00Z",
  "expiresAt": "2026-10-13T04:10:00Z",
  "assignments": [{
    "task": "DAN-202",
    "agent": "chatgpt:workguard:platforma",
    "branch": "platforma/dan-202-work-guard",
    "baseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "paths": ["scripts/orchestrator/work-guard-core.mjs"],
    "pr": null,
    "failures": [],
    "regressions": 0,
    "blockers": []
  }]
}
```

`paths` su točne datoteke ili direktoriji sa završnim `/`; nema globova.
Kod preimenovanja odobrena moraju biti oba imena. Četvrti pisac nije podržan
ovim konzervativnim profilom; iznimka zahtijeva zasebno prihvaćenu dopunu.
`pr` mora biti stvarni otvoreni PR ove grane u ovom repozitoriju. Tuđi fork s
istim imenom grane nije vlastiti PR. Povezani PR koji se preklapa nije automatska
iznimka: prvo se spoji njegova ovisnost ili se razdvoji dodijeljeni opseg.

Jedan zapis neuspjeha ima oblik:

```json
{"id":"comment-123","root":"stable-root-id","round":1,"head":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
```

`id` je jedinstveni identifikator dokaza. `root` stabilno označava isti korijen,
a `round` broj neuspjelog kruga, ne broj komentara. Review i QA na istom krugu
ne broje se kao dva pokušaja. Drugi neuspjeli krug znači da daljnji automatski
popravak ulazi u treći i traži predaju orkestratoru/vlasniku (§14.6).
`regressions` broji uzastopne popravke koji su donijeli novi nalaz u istom kodu;
dva blokiraju. `blockers` dopušta `infrastructure`, `decision`, `ownership`,
`dependency`: bilo koja blokada odmah zaustavlja nastavak.

Promjena heada, grane ili osvježavanje isteka ne briše prethodne krugove.
Tek novi prihvaćeni ugovor ili podjela zadatka može otvoriti novi tijek; ovaj alat
ne provodi niti odobrava takvu odluku i ne nudi zastavicu za zaobilaženje.

## Što se provjerava

Provjera čita aktualni `main` dvaput i zahtijeva ga kao pretka lokalnog heada.
Prikuplja zasebno committed diff, lokalne promjene i nepraćene neignorirane
putanje. Time lokalno vraćanje datoteke ne skriva neodobreni već commitani kod.
Čita sve stranice otvorenih PR-ova i njihovih datoteka preko postojećeg `ghList`;
nepotpun odgovor, nedostajuće ime datoteke, nepotpuno preimenovanje ili granica
GitHubova popisa od 3000 datoteka ne smiju postati prolaz.

Preklapanja se traže i među planiranim dodjelama, prije postojanja PR-a.
`db/migrations/` i `db/tests/` su kolizijske domene čak i za različite datoteke,
kao u postojećem `orch:overlap`. Provjera ne mijenja tu informativnu naredbu.

Izlaz je jedan JSON s `state: ALLOWED | BLOCKED`, zadatkom, headom, bazom,
kodovima razloga i sljedećim korakom. Izlazni kod je 0 ili 1. Nema sirovih
API/OS grešaka, sadržaja datoteka, ključeva ili tokena. `ALLOWED` nikad ne znači
review/QA PASS, spremnost za spajanje ili zatvaranje Linear zadatka.

## Granice jamstva

Ovo **nije distribuirana brava ni sigurnosni sandbox**. Potpis izdavatelja i
cjelovitost presjeka ne provjeravaju se kriptografski. Jedini orkestrator mora
voditi cjelovit popis aktivnih rezervacija, ne izdavati preklapajuće dodjele dok
stare vrijede i prenositi povijest neuspjeha u svaki novi presjek. Novu dodjelu
izdanu nakon snimanja lokalni presjek ne može sam otkriti. Rok trajanja smanjuje,
ali ne uklanja tu granicu. Za distribuirano automatsko preuzimanje treba zaseban
atomarni servis, koji ovaj PR ne dodaje.

Provjera je vremenski presjek, ne zaključavanje udaljenog `main` ili drugih
PR-ova. Izravni `git push`, Contents API i sesija bez konfiguracije nisu
obuhvaćeni. Ni odobrena putanja ne ograničava što proces može čitati izvan nje.
Ignorirane datoteke nisu u necommitanoj provjeri, ali svaka praćena promjena
ulazi u Git diff. Nema automatske instalacije, fetcha, resetiranja ili brisanja.
Potrebni su Git, autentificirani `gh` za ovaj repo i lokalno dostupan aktualni
main commit. Pozivi su ograničeni na 15 sekundi i 4 MiB izlaza; nakon 60 sekundi
više se ne pokreću novi pozivi (već pokrenuti može potrošiti preostalih 15 s).

## Provjera i prvi pilot

```sh
node --test scripts/orchestrator/work-guard*.test.mjs
```

Testovi koriste isključivo sintetičke ugovore i privremene Git repozitorije.
Test pozivatelja izolira samo neizmijenjene parser/status helpere; sam guard,
`push-verify`, pokretanje procesa i Git su stvarni. Mreža je zabranjena i u RED
scenariju. Test REST adaptera simulira odgovore; nije dokaz živog GitHub poziva.

Nakon neovisnog reviewa, zasebnog QA-a i dopuštenog spajanja, orkestrator može
izdati prvu stvarnu dodjelu za svoj sljedeći dopušteni zadatak. DAN-189 ostaje
Backendov posao: ovaj PR ga ne preuzima, ne zatvara i ne tvrdi da je njegov pilot
izveden. PR #288 ostaje zasebna provjera prije reviewa/QA-a; ovdje se ne duplicira.
