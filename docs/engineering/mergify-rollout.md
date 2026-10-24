# Mergify: aktivacija tri spekulativne provjere (DAN-263)

Ovo je operativni postupak za ENGINEERING_SYSTEM §10, ne dokaz da je postavka
već aktivna. Izvor: Danielova uputa 23. 10. 2026., DAN-263 i plan napada #605.
Konfiguracija se primjenjuje tek s default grane. Na kandidatu `serial`/3/1 znači
tri kumulativne provjere, jedan PR po batchu, bez dodatnog čekanja pune grupe.

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
queue/merge uvjete. Pričekati/ukloniti postojeće spekulativne draftove preko
Mergifyja. Nakon potvrde in-place provjera Daniel vraća prethodno dogovoreni
strict profil. Carrier prepoznavanje može ostati: običan PR nema izuzeće.

Dokumentacija pružatelja:
- https://docs.mergify.com/merge-queue/draft-pull-requests
- https://docs.mergify.com/merge-queue/queue-modes
- https://docs.mergify.com/merge-queue/github-rulesets
- https://docs.mergify.com/merge-queue/lifecycle
