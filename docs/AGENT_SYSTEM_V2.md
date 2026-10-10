# Ductus Agent System V2

Verzija 2.0 · 5. 10. 2026. · Odgovorna osoba: Daniel Rišavi

## 1. Svrha

Agent System V2 uvodi jasan roster specijaliziranih AI uloga bez pretvaranja repoa u zbirku dupliciranih promptova. Postojeći Engineering System, GitHub control plane i kanonski dokumenti ostaju izvor istine.

Sloj V2 odgovara na četiri različita pitanja:

1. **Agent profil** — tko radi i koja je njegova uloga.
2. **Skill** — kako se ponovljivi tip posla izvršava.
3. **Kanonski dokument** — koja pravila proizvoda, arhitekture i governancea vrijede.
4. **GitHub task/PR** — što se radi sada, u kojem opsegu i s kojim acceptance kriterijima.

Agent profil ne smije kopirati sadržaj kanonskih pravila. On samo upućuje na njih.

## 2. Kanonski red prvenstva

Agent System V2 ne mijenja postojeću hijerarhiju. Za rad i dalje vrijede, prema kontekstu:

- Product Vision / Product Constitution;
- `CLAUDE.md` i `AGENTS.md`;
- `STATE.md`;
- `docs/ENGINEERING_SYSTEM.md`;
- `docs/SESSIONS.md`, `docs/ORKESTRATOR.md`, `docs/MULTI-ACCOUNT.md`;
- proizvodni i tehnički dokumenti (`PRODUCT.md`, `BACKEND.md`, `ARCHITECTURE.md`, `DECISIONS.md`, ...);
- aktivni issue/PR.

Ako se agent profil i kanonski dokument razilaze, profil gubi.

## 3. Struktura

Claude Code projektni subagenti nalaze se u `.claude/agents/`:

```text
.claude/agents/
├── leadership/
│   └── ductus-orchestrator.md
├── engineering/
│   ├── ductus-backend-data.md
│   ├── ductus-frontend-editor.md
│   └── ductus-platform-sre.md
├── quality/
│   ├── ductus-independent-reviewer.md
│   ├── ductus-adversarial-qa.md
│   ├── ductus-bug-hunter.md
│   └── ductus-security-reviewer.md
├── product/
│   ├── ductus-product-ux.md
│   └── ductus-accessibility.md
└── governance/
    ├── ductus-privacy-legal-pilot.md
    └── ductus-architecture-performance.md
```

Datoteke su namjerno kratke. Claude Code ih može pronaći rekurzivno u podmapama, a identitet svake uloge dolazi iz jedinstvenog `name` polja u YAML frontmatteru.

## 4. Roster

| Uloga | Piše proizvodni kod po defaultu | Primarna svrha |
| --- | --- | --- |
| Orchestrator | ne | red rada, ovisnosti, gateovi, merge readiness, stanje |
| Backend + Data | da | baza, identity/authz, evidence, submission, worker, rekonstrukcija |
| Frontend + Editor | da | editor, browser sync/recovery, studentsko/nastavničko sučelje |
| Platform / SRE | da | CI, local stack, deploy/tooling, dependencies, observability, supply chain |
| Independent Reviewer | ne | neovisni pregled aktualnog PR heada |
| Adversarial QA | ne; testovi samo u zasebnom QA zadatku | pokušaj falsificiranja kritičnih i regresijski osjetljivih promjena |
| Bug Hunter | ne | reproducibilni bugovi na main/stagingu |
| Security Reviewer | ne | fokusirani security/trust-boundary audit |
| Product + UX | ne | tokovi, copy, vrijednost proizvoda, product issuei |
| Accessibility | ne | keyboard, semantics, focus, AT i WCAG audit |
| Privacy / Legal / Pilot | ne | privacy, retention, institucionalni i pilot gateovi |
| Architecture / Performance | ne | granice sustava, pouzdanost, skaliranje i performance audit |

Ovo nije signal da svih 12 uloga treba raditi istodobno. WIP limit iz `docs/ENGINEERING_SYSTEM.md` ostaje nadređen: normalno tri stalna writera, kontrolne i auditorske uloge po potrebi.

## 5. Agent nije isto što i skill

Primjer:

- `ductus-backend-data` = **tko** radi;
- `ductus-worker` = **kako** worker radi zadatak;
- `docs/BACKEND.md` = **koja** tehnička pravila vrijede;
- issue #123 = **što** konkretno treba isporučiti.

Zato backend, frontend i platform agent svi mogu preloadati isti `ductus-worker` skill, a ipak imaju različito vlasništvo i stručni fokus.

Postojeći skillovi ostaju nepromijenjeni:

```text
.claude/skills/
.agents/skills/
```

Agent System V2 ih ne zamjenjuje.

## 6. Claude subagent nasuprot neovisnoj sesiji

`.claude/agents/` služi za specijaliziranu delegaciju unutar Claude Codea i izolaciju konteksta. To **nije** zamjena za cross-account/multi-provider governance.

Posebno:

- subagent nasljeđuje iste projektne vjerodajnice/runtime okruženje;
- samo činjenica da je pokrenut drugi subagent ne stvara novi GitHub App principal;
- zato subagent iz iste autorske sesije ne smije sam sebi proizvesti kanonski Independent Review PASS ili QA PASS kad Engineering System traži neovisnost;
- za kanonske gateove i dalje se koriste odvojene dopuštene instance/računi/provideri prema `docs/ENGINEERING_SYSTEM.md`.

Subagent može napraviti **advisory** review/QA i vratiti nalaz roditeljskoj sesiji, ali to nije dokaz neovisnosti.

## 7. Izolacija writera

Backend, Frontend i Platform profili koriste:

```yaml
isolation: worktree
```

kad ih Claude Code pokrene kao subagente. Time se njihove izmjene odvijaju u zasebnom git worktreeu umjesto u glavnom checkoutu.

To je dodatna zaštita, a ne zamjena za pravila iz `docs/SESSIONS.md`. Za trajne paralelne workere i dalje vrijedi zaseban branch/worktree po tasku i GitHub handoff.

## 8. Routing

Orkestrator ili glavna sesija bira najmanji potreban profil:

- implementacija API/RLS/evidence → Backend;
- editor/sync/UI → Frontend;
- CI/dependency/infra → Platform;
- pregled PR-a → Independent Reviewer;
- critical adversarial test → QA;
- pokušaj razbijanja maina → Bug Hunter;
- uski trust-boundary audit → Security Reviewer;
- tok/copy/product vrijednost → Product + UX;
- pristupačnost → Accessibility;
- privacy/pilot/institucionalni preduvjet → Privacy / Legal / Pilot;
- cross-cutting arhitektura/performance → Architecture / Performance.

Ne stvarati novu agent datoteku samo zato što postoji novi task. Nova uloga je opravdana tek kad ima trajan, jasno odvojen mandat koji se ponavlja.

## 9. Pravila protiv "agent slopa"

1. Cilj nije broj agenata nego jasne odgovornosti.
2. Jedno pravilo ima jedno kanonsko mjesto.
3. Agent profil ostaje kratak; detalji idu u kanonski dokument ili skill.
4. Ne stvarati `database-agent`, `postgres-agent`, `rls-agent`, `sql-agent` ako sve pripada Backend + Data ulozi.
5. Product/UX i Bug Hunter ne implementiraju vlastite nalaze.
6. Autor nije vlastiti neovisni reviewer ni QA.
7. Specijalist se gasi nakon zadatka ako nema trajno ponovljiv mandat.
8. WIP limit ima prednost pred dostupnim brojem agenata.

## 10. Provider-neutralnost

Claude Code nativno čita `.claude/agents/`. Codex/ChatGPT i drugi runtimei i dalje dobivaju isti projektni identitet kroz `AGENTS.md`, `docs/MULTI-ACCOUNT.md`, GitHub task i repo-local `.agents/skills/`.

Ne uvodi se izmišljeni `.agents/agents/` runtime sloj samo radi simetrije. Provider-neutralnost dolazi iz kanonskih pravila i GitHub control planea, ne iz identičnog direktorija za svaki alat.

## 11. Operativna napomena

Kad se `.claude/agents/` direktorij prvi put pojavi u repou, već pokrenuta Claude Code sesija može trebati restart prije nego što vidi prve projektne subagente. Nakon toga se izmjene postojećih agent datoteka u pravilu otkrivaju automatski.

Ovaj V2 ne mijenja `.claude/settings.json`, postojeće skillove, CI/workflowe, review parser ni proizvodni kod.
