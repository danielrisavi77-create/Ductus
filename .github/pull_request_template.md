## Sažetak

<!-- Što ovaj PR radi i zašto? -->

## Engineering metadata

Agent: <claude|codex|chatgpt>:<slot>:<role>
Risk: <low|standard|critical>
Task: <ID ili kratki identifikator>

## Opseg

**Ulazi:**
- 

**Ne ulazi:**
- 

## Ugovor i priprema reviewa

`Invarijanta` i `Mjesta` obvezni su za critical (ENGINEERING_SYSTEM §14); ostala tri polja preflight traži za svaki risk (ORKESTRATOR §8).

Invarijanta: <što mora vrijediti>
Mjesta: <putanje na kojima vrijedi>
Stvarni pozivatelj: <datoteka i put poziva, ili još ne postoji>
Poznate granice: <granica jamstva i izvor odobrenja ako je ugovor sužen>
Što bi ovaj PR moglo oboriti na QA-i?: <konkretan scenarij>

## Dokaz

- [ ] u `IZVJEŠTAJ → Testovi` su stvarni rezultati za puni testirani SHA i primjenjivi lokalni/CI/staging dokazi; neizvedeno je izričito navedeno
- [ ] branch je provjeren prema aktualnom `main`
- [ ] nema tajni ni stvarnih osobnih podataka
- [ ] promjena ima acceptance criterion

## Review

Neovisni reviewer dodaje **zaseban komentar čija je prva neprazna linija `Agent-Review:`**:

```
Agent-Review: <runtime>:<slot>:reviewer
Review-Head: <sha>
Review-Verdict: PASS
```

Za `critical` PR, osim izuzeća iz ENGINEERING_SYSTEM §5, zaseban QA kreće istodobno s reviewerom na istom headu i dodaje **zaseban komentar čija je prva neprazna linija `QA-Agent:`**. QA ne čita review prije vlastitog verdikta:

```
QA-Agent: <runtime>:<slot>:qa
QA-Head: <sha>
QA-Verdict: PASS
QA-Scope: <adversarialni scenariji>
```

## IZVJEŠTAJ

Napravljeno:
- 

Testovi:
- <puni testirani SHA; naredba/scenarij; rezultat; poveznica/putanja primarnog zapisa; lokalno, CI ili neovisna QA>
- Neizvedeno ili nedostaje: <navesti izričito; zeleni CI nije dokaz zasebne lokalne probe>

Otvoreno ili blokira: ništa

Treba Daniel: ništa
