# Referenca uvoza rada i Ducturina paketa, prototip v0.30 i v0.31

Ovo je dizajnerska i funkcionalna **referenca**, ne kod koji se preuzima. Nadovezuje se na referencu editora u `docs/design/ductura/editor-v027/`; ljuska, paleta („papir i grafit”, D-188) i iznimke odande vrijede i ovdje.

## Što prikazuje

- **v0.30, uvoz rada iz drugih programa.** Student bira datoteku (.docx, .odt, .md, .html, .tex, .rtf, .pdf, .txt). Za .doc i skenirani PDF dobiva poruku što učiniti, a uvoza nema. Prije izbora vidi koliko se iz kojeg oblika prenosi. Uvezena datoteka čuva se nepromijenjena, s otiskom SHA-256. Izvještaj ima četiri dijela: Preneseno, Pretvoreno, Navodi i Nije preneseno, a iz izvještaja se skače na mjesto u tekstu. Navodi se predlažu za povezivanje s literaturom. Sav uvezeni tekst ostaje označen kao uvezen. Bez izjave nema uvoza. Za PDF postoji usporedba teksta sa slikom stranice. Plan je vlasnik potvrdio 18. 11. 2026. („Može”).
- **v0.31a, Ducturin paket.** Paket (`.ductura`) nosi tekst, povijest pisanja, točke spremanja i predaju, otisak sadržaja i potpis. Pri učitavanju se otisak ponovno računa, a potpis i lanac povijesti provjeravaju. Mijenjan paket se ne učitava i piše kod kojeg je događaja lanac prekinut. Ispravan se učitava i povijest se nastavlja.
- **v0.31b, kartica „Uvezena datoteka: naznake, ne dokaz”** u Provjeri. Prikazuje podatke koje datoteka nosi: autora, vrijeme izrade i izmjene, program, oznake sesija uređivanja, praćene promjene i komentare. Uz to su otisak, vrijeme uvoza i izjava. Za svaki oblik piše što datoteka nosi, što je prazno i što taj oblik uopće ne nosi. Kartica ima četiri ograde, a student podatke vidi prije mentora.

## Odluke vlasnika (#2012, komentar 6966734609)

1. Kartica „Uvezena datoteka” ulazi u proizvod.
2. Vide je samo student i mentor, student prvi.
3. Čuva se dok traje studij. To je otvoren nesklad s D-30 (PRIJEDLOG), Q-16 (čeka FPZG) i P29 (Q-20), pa se kod čuvanja ne gradi dok se to ne uskladi.
4. Paket potpisuje poslužitelj i ključ nikad ne izlazi s njega. Ključ u prototipu služi samo za pokazivanje i nije siguran; to piše i u sučelju.
5. Kanonski zapis paketa je po B-8: JCS i SHA-256, nepoznata polja se odbijaju, a veličina je ograničena i na klijentu i na poslužitelju. Prototip toga nema.

Odluke još nisu u `docs/DECISIONS.md`; tamo ulaze kroz Q-18.

## Što je u mapi

| Datoteka | Sadržaj |
|---|---|
| `snimke/uvoz-izvjestaj-<1440\|390>.png` | izvještaj nakon uvoza .docx-a (v0.30) |
| `snimke/uvoz-usporedba-<1440\|390>.png` | usporedba uvezenog teksta sa slikom stranice PDF-a (v0.30) |
| `snimke/uvezena-datoteka-kartica-<1440\|390>.png` | kartica „Uvezena datoteka” u Provjeri (v0.31b) |
| `snimke/ducturin-paket-<1440\|390>.png` | dijalog Ducturin paket s odbijenim mijenjanim paketom (v0.31a) |
| `SHA256SUMS` | kontrolni zbrojevi svih datoteka u mapi osim njega samog (`sha256sum -c SHA256SUMS`) |

Snimke: Playwright Chromium, lokalni statički poslužitelj nad prototipom, prozor 1440 × 900 i 390 × 800, tamna ljuska. Napravljene su usred automatskog testa, pa se na nekima vidi poruka prethodnog koraka („Povezano navoda: 4.”, „Paket je učitan; povijest se nastavlja.”); te poruke nisu dio prikazanog zaslona.

Sav sadržaj je izmišljen: ogledne datoteke slaže skripta prototipa (umjetni tekst, izmišljena imena poput „Student Izmišljeni” i „Horvatić, Ana (2019)”, izmišljena knjižnica Lipovac). Nijedna nije iz stvarnog Worda, LibreOfficea ni stvarnog rada.

## Što nije u repou

- JavaScript moduli prototipa (`uvoz.js`, `paket.js`, `uvkarta.js` i ostali), `vendor/` (pdf.js) i ogledne datoteke, iz istog razloga kao u `editor-v027/README.md`.
- `index.html` i `editor.css`: ljuska je ona iz `editor-v027`; v0.30 i v0.31 joj dodaju samo oznake skripti i stavku „Ducturin paket” u izborniku izvoza i ploči „Uz rad”.

## Što nije provjereno

- PDF iz stvarnog programa (dva stupca, zaglavlja, rastavljanje riječi, ligature) nije isproban; ogledni PDF je ručno složen. Naslovi iz PDF-a pogađaju se iz veličine slova.
- .tex i .rtf su podskupi; .odt i .html bez vanjskih stilova. Razine prijenosa po obliku su procjena.
- Prepoznavanje navoda je heuristika; veliki radovi (100+ stranica) nisu mjereni.
- Značenje raspodjele oznaka sesija uređivanja nije provjereno na stvarnim radovima, a vrijeme uređivanja i broj spremanja Word bilježi nepouzdano.
- Paket u prototipu nosi najviše 400 zadnjih događaja i samo otiske uvezenih datoteka, ne same datoteke.
- Ništa nije isprobano sa studentima ni mentorima.

## Rječnik

Na snimkama nema izraza iz rječnika `docs/PRODUCT.md` §5 u zabranjenom smislu. Otvoreno za izvedbu: polja „Zadnji spremio” i „Broj spremanja” na kartici prenose Wordove podatke, a rječnik traži da „spremljeno” kaže gdje. U izvedbi ih treba nazvati tako da je jasno da su to podaci iz datoteke.
