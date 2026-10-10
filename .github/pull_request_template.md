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

## Dokaz

- [ ] relevantni testovi su zeleni
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

Za `critical` PR QA dodaje **zaseban komentar čija je prva neprazna linija `QA-Agent:`**:

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
- 

Otvoreno ili blokira: ništa

Treba Daniel: ništa
