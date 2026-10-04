# Ductus: UX evaluacija povjerenja

Verzija 1.0 · 4. 10. 2026.

Kod Ductusa pogrešno razumijevanje sučelja može biti ozbiljan bug čak i kad je kod tehnički točan.

## 1. Cilj

Prije stvarnog pilota provjeriti razumiju li student i nastavnik:
- što je Ductus stvarno opažao;
- što nije opažao;
- što nastavnik vidi;
- da integritet zapisa nije dokaz autorstva;
- da lijepljenje bez poznatog izvora nije dokaz AI-ja;
- da praznina u zapisu nije krivnja.

## 2. Minimalni test

Najmanje 5 studenata i 5 nastavnika/mentora koji nisu gradili proizvod.

### Student

Pokaži obavijest zadatka, save status i sažetak procesa. Pitaj:
1. Što nastavnik može vidjeti?
2. Može li Ductus zaključiti jesi li koristio AI na drugom uređaju?
3. Što znači "lijepljenje, izvor nije opažen"?
4. Što znači praznina u zapisu?
5. Kad je rad stvarno spremljen na poslužitelju?

### Nastavnik

Pokaži isti rad i procesni sažetak. Pitaj:
1. Što možete tvrditi na temelju ovog prikaza?
2. Što znači "3 lijepljenja bez poznatog izvora"?
3. Biste li na temelju toga sami pokrenuli sankciju?
4. Što znači "zapis je cjelovit"?
5. Koju biste informaciju otvorili prije razgovora sa studentom?

## 3. UX bug kriterij

UX bug postoji ako korisnik iz neutralnog prikaza redovito zaključuje nešto što Ductus ne zna.

Posebno:
- "lijepljenje bez izvora = AI";
- "cjelovit zapis = student je autor";
- "praznina = skrivanje";
- broj događaja = risk score;
- trenutno spremljeno stanje = live nadzor.

Takav nalaz ide Product/UX issueu prije pilotiranja, čak i ako nema tehničke greške.

## 4. D-06 naspram D-39

Prije konačne odluke napraviti usporedni test:
- varijanta A: nastavnik vidi spremljeno stanje do P-03 prozora;
- varijanta B: nastavnik vidi samo stanje na kraju sesije.

Mjeriti:
- osjećaj nadzora kod studenta;
- korisnost nastavniku;
- broj pogrešnih zaključaka;
- potrebu za stvarnim pedagoškim intervencijama.

## 5. Brz put nastavnika

Posebno testirati retke poput "lijepljenja bez izvora". Ako nastavnici počnu mentalno rangirati studente po broju, prikaz se mora promijeniti čak i bez formalnog scorea, boje ili upozorenja.

## 6. Izlaz

Product/UX zapisuje:
- što je korisnik mislio da prikaz znači;
- što prikaz stvarno znači;
- ozbiljnost nesporazuma;
- predloženu izmjenu;
- acceptance criterion za ponovljeni test.

Nema implementacije iz iste Product/UX sesije. Issue ide Orkestratoru.
