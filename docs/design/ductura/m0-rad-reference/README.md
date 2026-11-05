# Referentne slike radnog prostora i editora (paket 2, DAN-564)

Paket 2 iz plana dizajna: radni prostor studenta (Z-01) s editorom (S-10), tema i list (Z-13), oporavak i druga kartica (Z-11) i odjava (Z-02), u smjeru „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje ovih slika kao reference (D-183); dotad su prijedlog.

## Vlasnikove odluke

- 5. 11. 2026., o starim prototipovima (#87 c.6645288294): „Ok, solidni su, ali treba prilagoditi našoj boji”. Raspored iz `editor-v11.dc.html` vrijedi, boje ne.
- 5. 11. 2026., o datoteci Ductura DEMO V3 · Editor v11 (vlasnikova datoteka, izvan repoa) ([#87 c.6645361793](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6645361793)): „Želim da preuzmemo dio i iz ovoga, a editor mora imati sve funckije koje smo već prije definirali”. Datoteka je samo izvor rasporeda i nije u repou.

## Stranice

| Stranica | Sadržaj |
|---|---|
| `radni-prostor.html` | Z-01 i S-10 zadano: ljuska, naslovi u radu, dvije trake alata, bijeli list, bočni panel s karticama, traka stanja; otvoreni izbornici Umetni, Prikaz i Više; kartica Struktura |
| `stanja.html` | sprema se, spremljeno na poslužitelju, bez mreže, sukob, potreban oporavak, ne sprema se na uređaj, druga kartica, fokus, tamni list, predan rad, dvije odjave |

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`: Playwright Chromium, cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`.

`reference.css` uvozi tokene i zajedničke dijelove iz `../m5-reference/reference.css` i dodaje samo ljusku, trake alata i tamni list.

## Kontrolna lista

Svaka već definirana funkcija editora i radnog prostora, s izvorom i mjestom na slici, je u `KONTROLNA-LISTA.md`. Ondje je i popis funkcija koje su u demo datoteci, a nisu definirane: one nisu nacrtane i idu vlasniku kao pitanje.

## Granice

- Slika određuje raspored, redoslijed i tekst. Ponašanje je u izvorima iz kontrolne liste, ne ovdje.
- Panel Upute, Komentari, Literatura u punom obliku, provjera oblika, asistent i predaja imaju vlastite referentne slike (M4 do M9); ovdje je samo ulaz.
- „Preuzmi pisanje ovdje” (m3-reference, Z-11) nije nacrtano: čeka vlasnikov izbor.
- Ikone nisu dio ove slike; gumbi nose tekst. Izvedba može dodati ikonu uz isti naziv.
- Redoslijed tipkovnice (EQ6): gornja traka, putanja i radnje rada, naslovi u radu, prva pa druga traka alata, list, bočni panel, traka stanja. Esc izlazi iz fokusa i zatvara izbornik.
- Podaci su izmišljeni (Student A, Autor A, Udruga A).

## Provjera rječnika

Tekst obiju stranica prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
