# Mergify: aktivacija tri spekulativne provjere (DAN-263)

Ovo je operativni postupak za ENGINEERING_SYSTEM §10, ne dokaz da je postavka
već aktivna. Izvor: Danielova uputa 23. 10. 2026., DAN-263 i plan napada #605.
Konfiguracija se primjenjuje tek s default grane. Na kandidatu `serial`/3/1 znači
tri kumulativne provjere, jedan PR po batchu, bez dodatnog čekanja pune grupe.
Od D-177 je profil bio `serial`/3/3: grupa do tri PR-a s jednim CI-jem, uz čekanje
najviše tri minute; grupa koja padne dijeli se dok se ne izdvoji PR koji ju je srušio.
Od DAN-447 (vlasnikov zahtjev 1. 11. 2026.) profil je `serial`/1/5: u svakom trenutku
radi samo jedna spekulativna provjera, a ona testira grupu do pet PR-ova (jedan CI za
cijelu grupu). Čekanje grupe i dijeljenje grupe koja padne ostaju isti. S jednom
provjerom prvih n − 1 PR-ova grupe reže se na dva dijela koji se provjeravaju jedan
za drugim, svaki na vrhu prethodnog. Zadnji PR se ne testira ponovno. Ako svi
dijelovi prođu, on je srušio grupu i izlazi iz reda. Prvi dio koji padne dijeli se
dalje, a PR-ovi iza njega vraćaju se u red. Broj krugova nije ograničen
(`batch_max_failure_resolution_attempts` nije postavljen). Uz ograničenje bi red s
jednom provjerom u zadnjem krugu provjerio samo prvi dio, a sve iza njega izbacio
neprovjereno. Nema ni `checks_timeout`, jer se istek dijeli kao pad.

Od DAN-449 (vlasnik, 1. 11. 2026.) postoje dva reda s istim uvjetima i postavkama.
Prvi je `critical` s `batch_size: 2`, a drugi `main` s `batch_size: 5`. Naredba
`@Mergifyio queue` bez imena ide u prvi red čiji uvjeti vrijede, dakle u
`critical`. Za low i standard piše se `@Mergifyio queue main`. Grupa od dva ima
jedan krug dijeljenja: prvi PR se provjerava sam. Ako padne, izlazi, a drugi se
vraća u red. Ako prođe, spaja se, a drugi izlazi eliminacijom. Tako je 1. 11. 2026.
izašao #1073 iz grupe s #1213 („round 1/1”, poruka „Not proven to be this pull
request's failure”). #1073 je i sam pao na istom headu, pa je bio kriv. Grupa
critical reda košta jedan CI kad je zelena, a kad padne, točno još jedan. Grupa od
pet u najgorem slučaju traži nekoliko uzastopnih carriera. `batch_size: 1` se ne
koristi jer znači provjeru na mjestu. Retry (`max_checks_retries`) se ne koristi
(ENGINEERING_SYSTEM §10). Kod sumnje na nestabilan test u grupi vlasnik ručno piše `@Mergifyio requeue`.

Mergify više ne osvježava PR koji čeka vlasnikovu naredbu na svaki pomak maina
(svako osvježavanje pokretalo je puni CI na tom PR-u). Carrier testira PR na
aktualnom mainu, pa izvorni head ne mora biti svjež. Naredba imenuje taj head i
vrijedi dok se on ne promijeni. Kad PR treba osvježiti (konflikt ili ručno
spajanje), osvježava se jednom, u trenutku spajanja, a naredba preživljava čisto
update-branch po D-156.

`reset_on_external_merge: always` ostaje. Commit koji na main stigne izvan reda
(ručno spajanje) poništava provjeru u tijeku, pa se grupa ponovno gradi na novom
mainu prije ijednog spajanja. Grupa nije testirana s tim commitom, pa bi `never`
mogao spojiti netestiranu kombinaciju. S jednom provjerom reset košta jedan CI run
za cijelu grupu, a ne do tri kao prije.

## Prije spajanja

1. Završiti neovisni review i QA točnog heada; autorovi testovi nisu ti verdikti.
2. Izabrati jedan Mergify PR. Ovaj kandidat zamjenjuje alternative #601, #603 i
   #604; ne spajati njihove konfiguracije naknadno. #585 (instalacija) i #600
   (shardovi) zasebni su radovi: redoslijed #585 pa #600 uz provjeru zajedničkog
   CI diffa. Ne mijenjati tuđe grane radi osvježavanja.
3. U GitHub Settings → Branches i Rules → Rulesets provjeriti sve zaštite maina,
   uključujući ruleset Tamara. Zabilježiti čitljivi presjek postavki prije izmjene.
   `Require branches to be up to date before merging` mora biti isključen za
   speculative squash. #601 tvrdi da već jest; bez API/UI readbacka to nije dokaz.
   Obvezni checkovi, PR, razgovori, zabrane force pusha/deleta i squash ostaju.
   Ne dodavati opći bypass ni GitHub native merge queue.
4. Provjeriti Mergify paket/limit za tri provjere i raspoloživ Actions kapacitet.
   Tri PR-a × build/security/E2E/login (nakon #600 dva standardna sharda) troše
   više paralelnih runnera, uz redovne PR i main runove. Veći limit nije dokaz
   kraćeg trajanja ako runneri čekaju na resurse.
5. Za prijelaz isprazniti red ili ga pauzirati u Mergifyju i zaustaviti nova
   enqueueanja dok se potvrđuju postavke. `strict` mijenja Daniel, uz pripremljen
   red i zadržane required provjere; ne ostavljati prijelaz kao trajno stanje.
6. Daniel daje naredbu za konkretan broj PR-a i puni SHA. Spojiti tek kad su svi
   postojeći gateovi zeleni. Ako je red pauziran, primijeniti dogovoreni kontrolirani
   merge konfiguracije pa provjeriti main CI i nastaviti red. Ne zaobilaziti gate.

## Živi prihvat

- Na 2–3 mala, stvarna i već odobrena PR-a zabilježiti originalne SHA-ove, oba
  governance statusa, queue vrijeme i Mergify draft brojeve/headove.
- Potvrditi da su draftovi od `mergify[bot]`, da svi required poslovi doista rade,
  da dva carrier statusa navode svoju ulogu, a izvorni headovi nisu osvježavani
  samo zbog reda. Draft ne smije sam ući u red niti biti zasebno spojen.
- U kontroliranom pokusu novim pushom na izvorni PR ili povlačenjem njegova
  kanonskog odobrenja dokazati da više ne može biti spojen na starom zelenom
  batchu. Zabilježiti oba SHA-a i Mergify dequeue/rebuild rezultat. Ne koristiti
  lažni review/QA verdict kao dokaz. Ako pokus nije izveden, prihvat je nepotpun.
- Dokazati da neuspješan CI na kombinaciji blokira spajanje te da uspješan kasniji
  rezultat ne preskače raniji neuspjeh (`skip_intermediate_results: false`).
- D-177 i DAN-447: na prvoj grupi od dva do pet PR-ova zabilježiti jedan draft carrier za cijelu grupu i zaseban squash commit za svaki izvorni PR. Ako grupa padne, zabilježiti dijeljenje i koji je PR izdvojen. Critical ili D-97 PR u grupi mora imati svoju naredbu na točnom headu.
- DAN-449: prvi PR u redu `critical` dati naredbom bez imena i zabilježiti da je
  završio u `critical`, a ne u `main`. Potvrditi da njegov carrier ima granu oblika
  `mergify/merge-queue/` + deset hex znakova i oba carrier statusa
  (`mergify-queue-pr.mjs`). Ako ih nema, carrier čeka bez isteka. Tada pauzirati
  red i ne nastavljati. Zabilježiti i da low PR naredbom `queue main` ide u grupu
  do pet, te da grupa nikad ne miješa PR-ove dvaju redova.
- Potvrditi redoslijed squash mergeova i zelen main. Kod neočekivanog ponašanja
  odmah pauzirati red; sačuvati status/logove prije povratka.

Lokalni testovi potvrđuju odbijanje lažnog carriera i API/publish kvarova, ali
ne zamjenjuju pokus stvarnog Mergifyja, njegovu revalidaciju članstva niti provjeru
živih GitHub postavki. Mergify ostaje pouzdani izvršitelj izvornih queue uvjeta.

## Mjerenje i povrat

Za prvih deset usporedivih PR-ova pratiti vrijeme do zelenog CI-ja, do review/QA,
do owner naredbe te od ulaska u red do mergea; broj ponovljenih runova i ukupne
runner-minute. Prikazati medijan i najsporiji prolaz uz veličinu uzorka. Ne
obećavati trostruko ubrzanje: login E2E i dostupni runneri mogu ostati usko grlo.

Povrat: pauzirati red i pripremiti mali odobreni PR koji vraća
`max_parallel_checks: 1`, uz `mode: serial`, `batch_size: 1`, retry 0 i jednake
queue/merge uvjete. Tada Mergify provjerava PR na mjestu: osvježava izvornu granu
s mainom, što mijenja head i poništava review, QA i naredbu. Zato `batch_size`
ostaje iznad 1 dok god naredbe vrijede po headu. Pričekati/ukloniti postojeće spekulativne draftove preko
Mergifyja. Nakon potvrde in-place provjera Daniel vraća prethodno dogovoreni
strict profil. Carrier prepoznavanje može ostati: običan PR nema izuzeće.

Dokumentacija pružatelja:
- https://docs.mergify.com/merge-queue/batches
- https://docs.mergify.com/merge-queue/priority
- https://docs.mergify.com/commands/queue
- https://docs.mergify.com/merge-queue/draft-pull-requests
- https://docs.mergify.com/merge-queue/queue-modes
- https://docs.mergify.com/merge-queue/github-rulesets
- https://docs.mergify.com/merge-queue/lifecycle
