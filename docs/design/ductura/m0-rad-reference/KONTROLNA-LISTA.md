# Kontrolna lista funkcija editora i radnog prostora (DAN-564)

Vlasnik, 5. 11. 2026. (#87 c.6645361793): „editor mora imati sve funckije koje smo već prije definirali”. Svaki redak je definirana funkcija, njezin izvor i mjesto na slici. Kratice: RP = `radni-prostor.html`, ST = `stanja.html`. D-201 uvodi sve funkcije privatnog „Ductura Editor v11” kao ponašanje, bez vizualnog dijela.

| Funkcija | Izvor | Mjesto na slici |
|---|---|---|
| Glavna navigacija: Radni prostor, Moji zadaci, Moji radovi, Moji kolegiji | M0.5, PROGRAM-RAZRADA (S-03) | RP gornja traka |
| Tema ljuske | D-187, D-188 | RP gornja traka „Svijetla ljuska”, izbornik Prikaz |
| Tema lista: bijeli ili tamni list | D-123, D-188 | RP izbornik Prikaz; ST stanje 8 |
| Odjava, nikad blokirana; izmjene samo na uređaju; bez izvoza | D-118, D-216, #1331 | RP gornja traka; ST stanja 10 i 11 |
| Pisanje / Kako vidi nastavnik | #815 | RP putanja rada |
| Izvoz u Word i PDF | M8.4, M8.5, M8.14 | RP gumb „Izvoz” |
| Predaja | M7 | RP gumb „Predaja”; ST stanje 9 |
| Poništi, Ponovi, Odlomak i Naslov 1 do 3, Podebljano, Kurziv, Popis, Blok-citat | M5.2 | RP prva traka alata |
| Podcrtano, Precrtano | D-201 | RP prva traka alata |
| Numerirani popis | M5.V1, D-201 | RP prva traka alata; list |
| Numerirani naslovi i sadržaj | M5.3 | RP list „1.1.”; Umetni › Sadržaj |
| Naslovna stranica | M5.4, D-228 | RP naslovi u radu; Umetni |
| Naslovi u radu i opseg po poglavlju | M5.2, M5.8, D-60 | RP lijevi panel |
| Opseg rada i broj riječi | M5.8, D-60 | RP lijevi panel, traka stanja |
| Navod, citat i bibliografija, stil FPZG | M5.1, D-226, `m5-reference/navodi-bibliografija.html` | RP druga traka; list; kartica Literatura |
| Literatura: + Izvor, Citiraj | M5.1, D-226 | RP kartica Literatura |
| Provjera DOI | M5.7, D-48 | RP kartica Literatura |
| Bilježnica izvora (čitaj i bilježi) | M5.9, D-59 | RP kartica Literatura |
| Uvoz iz Zotera, DOI i ISBN | D-201 | RP kartica Literatura |
| Fusnote, Ctrl+Alt+F | M5.5, `m5-reference/fusnote.html` | RP druga traka; list; Umetni |
| Tablice i slike | M5.6, D-231, D-234 | RP druga traka; list; Umetni |
| Poveznica | M5.2 | RP druga traka; Umetni |
| Uputnica na poglavlje | D-201 | RP Umetni |
| Otvoreno mjesto za izvor | D-61, D-137, PRODUCT §5 | RP list; Umetni |
| Lijepljenje s oznakom izvora | D-43, PRODUCT §4 | RP Umetni |
| Traži i zamijeni, Ctrl+F | M5.10, `m5-reference/trazi-zamijeni.html` | RP druga traka; Prikaz |
| Hrvatski navodnici | M5.10 | RP list (ponašanje pri pisanju) |
| Fokus i izlaz iz fokusa | M5.10, `m5-reference/fokus.html` | RP prva traka; ST stanje 7 |
| Samo naslovi, puni tekst | M5.2, D-234 | RP lijevi panel; Prikaz |
| Kartica Struktura: Prve rečenice, Nit, Pojmovnik, pitanje rada, „Vidite samo Vi.” | S-14, M5.14, D-234, D-250 | RP kartica Struktura, stanje 5 |
| Komentari: komentar uz tekst, odgovor, glasovni komentar | B-10, M6, D-201 | RP druga traka; kartica Komentari |
| Upute i provjera oblika | M4.4, `m4-reference` | RP kartica Upute |
| Kartica Rad | FE-D9 | RP bočni panel |
| Asistent | S-16, M9.4 | RP kartica Asistent |
| Pravopis | S-07, M5.11 | RP list (valovita crta), traka stanja |
| Povijest i inačice, inačica odlomka | S-02, M7.6, D-201 | RP traka stanja; Više |
| Uvoz teksta | M8 (S-19) | RP Više |
| Akademske fraze, odloži označeni tekst | D-201 | RP Više |
| Čitaj naglas, diktiranje | D-201 | RP Više |
| Planer rada | S-06, M5.15 | RP Više |
| Vodič | M5.12 | RP Više |
| Obavijest o praćenju | PRODUCT §5 | RP Više |
| Stanja spremanja: Spremam lokalno, Spremljeno na uređaju, Sinkroniziram, Spremljeno na poslužitelju, Sukob, Potreban oporavak | `src/domain/sync/labels.ts`, M3 | ST stanja 1 do 5; RP traka stanja |
| Bez mreže | Z-11, `m3-reference` | ST stanje 3 |
| Pisanje u drugoj kartici | Z-11, `m3-reference` | ST stanje 6 |
| Izvezi tekst, Otvori raniji tekst | #1333, #711 | ST stanja 4, 5 i 11 |
| Predan rad samo za čitanje | DAN-289 | ST stanje 9 |

## U demu, nije definirano: pitanje vlasniku

Ove funkcije su u `demo-v3-editor-v11.html`, a nisu u FEATURES, DECISIONS ni spojenim referentnim slikama. Nisu nacrtane.

1. Istakni označeno (isticanje bojom).
2. Poravnaj lijevo, Centriraj, Obostrano poravnanje.
3. Vodoravna crta.
4. Predložak strukture.
5. Veći tekst (prikaz).
6. Oznake podrijetla u studentskom prikazu.
7. „Ostavite poruku sebi”.
8. Pretraži u gornjoj traci (pretraga cijele aplikacije).
9. Samo za demo, ne ulazi u proizvod: promjena demo uloge, vodič za demo, sigurnosna kopija i „Preuzmi kopiju” demo stanja, naslovna stranica demo datoteke.
