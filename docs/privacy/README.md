# Nacrti o privatnosti za razgovor s ustanovom

> **Ovo je radni nacrt, nije pravni savjet.** Tekstove ne smije prihvatiti nitko kao pravno obvezujuće prije nego ih potvrde pravnik i službenik za zaštitu podataka ustanove.

Stanje: nacrt od 11. 10. 2026. na `main` (zadatak 1.7 iz issuea #239). Namjena: vlasnik ih nosi na prvi razgovor sa službenikom za zaštitu podataka (DPO) pilot-ustanove. Ništa ovdje ne mijenja `docs/PRODUCT.md` §5 ni neku odluku iz `docs/DECISIONS.md`; gdje je odluka otvorena, tako i piše.

## Sadržaj

| Datoteka | Što je |
| --- | --- |
| `01-tokovi-podataka.md` | Popis osobnih podataka: izvor, mjesto, tko čita, rok čuvanja |
| `02-procjena-ucinka-kostur.md` | Kostur procjene učinka (DPIA): opis, nužnost i razmjernost, rizici, mjere |
| `03-obavijest-o-privatnosti-nacrt.md` | Nacrt obavijesti za studente |
| `04-podizvrsitelji-i-atributi-prijave.md` | Podizvršitelji kako ih predlažu dokumenti i atributi prijave |
| `05-otvorena-pitanja.md` | Pitanja za ustanovu i vlasnika, po redoslijedu blokade; dokazi potrebni prije pilota |

## Oznake koje se koriste u svim datotekama

- **Stanje izvedbe:** `izgrađeno` (postoji na `main`, putanja je navedena) ili `planirano` (samo u dokumentu). Što nije provjereno u kodu, piše kao `nije provjereno`.
- **Vrsta tvrdnje:** `[PRAVILO]` potvrđeno pravilo (PRODUCT §5, odluka sa statusom ODLUČENO ili potvrđeno); `[IZVEDBA]` rupa u izvedbi; `[DOKAZ]` dokaz koji još ne postoji; `[ODLUKA]` odluka vlasnika, ustanove ili pravnika. Odluka sa statusom PRIJEDLOG ili ČEKA FPZG nije pravilo.
- Riječ "rizik" u ovim nacrtima znači rizik za prava i slobode ispitanika u smislu čl. 35. GDPR-a. U sučelju proizvoda ta riječ i dalje ne smije postojati (PRODUCT §5, rječnik sučelja).
- Pilot-ustanova je u dokumentima FPZG (D-15). Imena i kontakti osoba nisu u ovim datotekama; mjesta za njih su označena u uglatim zagradama.

## Granice nacrta

- Nema stvarnih osobnih ni studentskih podataka; primjeri su izmišljeni.
- Nema pojedinosti sigurnosnih nalaza; sigurnosne mjere navedene su samo onako kako su već opisane u `docs/BACKEND.md` i `docs/ARCHITECTURE.md`.
- Pravni zaključci nisu izvedeni. Gdje je potrebno pravno tumačenje, pitanje je upisano u `05-otvorena-pitanja.md`.
