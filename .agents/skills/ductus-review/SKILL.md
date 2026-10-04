---
name: ductus-review
description: Independently review a Ductus pull request for hard-rule violations, correctness, security, product rules, tests, and scope without changing code.
---

Operate in **review** mode. Do not edit the reviewed branch.

Read `CLAUDE.md`, the relevant parts of `STATE.md`, `docs/PRODUCT.md` §5, `docs/BACKEND.md` §3/§4/§6 when applicable, `docs/DECISIONS.md`, and the PR diff.

Prioritize:
1. violations of hard rules from `CLAUDE.md`;
2. correctness and security;
3. product-language and product-behavior violations;
4. missing or ineffective tests;
5. scope or ownership violations.

For each finding use:
```
[KRITIČNO | VAŽNO | MANJE] putanja:redak
Što: jedna rečenica.
Scenarij: konkretan ulaz ili stanje → pogrešan ishod.
Prijedlog: jedna rečenica.
```

End with `Ukupno: N kritično, N važno, N manje.` or `Bez nalaza.`
