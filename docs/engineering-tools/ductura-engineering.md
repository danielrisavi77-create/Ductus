# Ductura Engineering 0.1.0

Reviewable skills-only source kandidat za DAN-44: provenance invariants, offline recovery i identity isolation. Kanonski paket je [`plugins/ductura-engineering`](../../plugins/ductura-engineering/plugin.json); šest novih `.agents`/`.claude` adaptera povezuje jedno tijelo po domeni. Manifest nema MCP, app dependency ili novi runtime. Postojećih šest uloga ostaje nositelj ovlasti i gateova.

| Domenski postupak | Kanonski skill | Zajednički postupak |
| --- | --- | --- |
| JCS/hash/potpis, request/segment, receipt/replay | [ductus-provenance-invariants](../../plugins/ductura-engineering/skills/ductus-provenance-invariants/SKILL.md) | snapshot / readEvidence |
| Journal, ACK, prekid/reload i lokalni sadržaj | [ductus-offline-recovery](../../plugins/ductura-engineering/skills/ductus-offline-recovery/SKILL.md) | snapshot / prepareTask / readEvidence |
| Akter × resurs × radnja, SQL/RLS i sesija | [ductus-identity-isolation](../../plugins/ductura-engineering/skills/ductus-identity-isolation/SKILL.md) | snapshot / readEvidence |

[Zajedničke operacije](../../plugins/ductura-engineering/references/project-operations.md) samo čitaju postojeće izvore/pripremaju brief. DAN-41 status nije čisti reader: runtime ostaje UNVERIFIED do prihvaćenog vlasnikova readera; nemutacija nije ovdje izvršno dokazana. [Mapa izvora](../../plugins/ductura-engineering/references/source-map.md) razlikuje main `ac65c71d797e29417d3d0f07aa9bd7ad63f2ff06`, DAN-25 i #39/#46 kandidate te primjenjive postojeće probe. Pomični main/PR status osvježiti prije rada.

Evidence-First je opći postupak; coordinate-project-sessions brief i verify-repo-integrations ponovno koristiti uvjetno kad su dostupni. Opaženi objavljeni Operator 0.2.0 i Mentor Tools 0.1.0 nisu host activation dokaz; ne kopirati ni privatno pinati njihove procedure. B01 kontrolirana usporedba zadržava frozen Operator 0.1.1 i iste raw ulaze; 0.2.0 nije drugi promijenjeni faktor. Check-academic-suite-integration cilja Lekta/Katedra; ne zaključivati shared Ductus arhitekturu. Generic faculty-pilot/mentor priprema ostaje u postojećim sposobnostima.

## Host i dokaz

| Host | Source present | Adapter resolves | Observed host load | Actual behavior |
| --- | --- | --- | --- | --- |
| Windows desktop Codex / `.agents` | Izvor ovog kandidata | Strukturno provjeriti putanju/digest | NOT_TESTED | NOT_TESTED |
| Windows desktop Claude / `.claude` | Izvor ovog kandidata | Strukturno provjeriti putanju/digest | NOT_TESTED | NOT_TESTED |
| Laptop, svaki host zasebno | UNVERIFIED | UNVERIFIED | NOT_TESTED | NOT_TESTED |
| ChatGPT plugin | Nije distribuiran ovim taskom | n/a | NOT_TESTED | NOT_TESTED |

Helper/frontmatter/schema/link/digest provjera potvrđuje strukturu izvora. Puni tested head, naredbe i rezultati idu u DAN-44 izvještaj; to nije canonical PASS, behavior prihvat, browser recovery, RLS, KMS ili production integration dokaz. Raw synthetic ulazi su `assets/raw-scenarios.json` svakog skilla, bez answer keya i bez B01 izlaza/dijagnoze. Evaluatoru dati ulaze i task bez autorovih odgovora.

## Rollout i povratak

Koordinator nakon neovisnog critical reviewa/QA na aktualnom headu vodi prihvat, paket i distribuciju; writer ne push/publish/install. Za svaki host zasebno zapisati source commit/digest, opaženo load i izvedenu bezazlenu probu. Identican prihvaćeni sadržaj ne registrirati ponovno radi provjere. Povratak: odobrenim revertom povući samo ovaj source commit ili deaktivirati samo nove adaptere/izdanje podržanim host postupkom; ne obećavati downgrade koji host ne podržava. Sačuvati originalne dokaze i postojeće role/operatore.

Pending: neovisna behavioral evaluacija i kontrolirana usporedba; actual host load; controller nonmutation; puni Postgres/RLS, storage/browser, OIDC/AAI/KMS slojevi i prihvat kandidata; tri kasnija domenska skilla editor-roundtrip/pilot-evidence/laya-evaluation. Nema praznih placeholdera niti tvrdnje opće učinkovitosti iz strukturne provjere ili jednog fixturea. Produktni defekti ostaju zasebni zadaci.
