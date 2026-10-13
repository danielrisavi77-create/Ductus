# Ductus Istraživač — popis ideja

Popis vodi **Ductus Istraživač** (istraživački bot). Svaki dan (oko 7:20, Europe/Zagreb) pretražuje web: konkurenciju i slične alate, nova istraživanja o AI detekciji i provenance pisanja, regulativu (EU AI Act, GDPR, pravila sveučilišta) i UX/tehničke ideje za stack (Next.js, Tiptap, Dexie, Postgres). Najbolje prijedloge upisuje ovdje i u dnevni komentar u #271.

Svrha popisa: da se ideje ne ponavljaju i da se prati ishod. Status mijenja Daniel: `predloženo` → `prihvaćeno` / `odbijeno`.

## 2026-10-13

| # | Ideja | Izvori | Trud | Povezani issuei | Status |
|---|---|---|---|---|---|
| 1 | **Pravila AI-ja po zadatku i obavezno označavanje vanjske pomoći.** Turnitin Clarity dodaje nastavničke kontrole „odgovorne upotrebe AI-ja“ po zadatku i vremenske oznake u Writing Reportu, ali prihvaćene LLM gramatičke prijedloge ne označava. Ductus: polje „dopuštena pomoć/AI“ u čarobnjaku zadatka i uvijek označena vanjska pomoć u replayu. | [PR Newswire, 7. 10. 2026.](https://www.prnewswire.com/news-releases/data-shows-a-nearly-50-drop-in-near-total-outsourcing-of-student-writing-when-done-in-a-transparent-writing-environment-302900709.html), [Turnitin product updates](https://guides.turnitin.com/hc/en-us/articles/29645383597965-Turnitin-product-updates), [HumanPen](https://humanpen.net/blog/turnitin-clarity-grammar-check) | srednji | #337, #330 | predloženo |
| 2 | **Tipkanje dokazuje prisutnost, ne autorstvo.** Copytype napad: vrijeme tipkanja ne nosi informaciju o porijeklu sadržaja; povijest revizija nosi više signala. Ductus: u replayu, Audit & Appeals paketu i rječniku sučelja izbjegavati formulacije da ritam tipkanja dokazuje autorstvo, isticati putanju revizija. | [arXiv 2601.17280](https://arxiv.org/pdf/2601.17280), [arXiv 2603.00177](https://arxiv.org/html/2603.00177v3), [arXiv 2610.07700](https://arxiv.org/html/2610.07700) | mali | #330, #329, #342 | predloženo |
| 3 | **EU AI Act: dokumentirati zašto Ductus nije visokorizičan.** Prilog III. t. 3(b)/3(d) su visokorizični, obveze od 2. 12. 2027. Ductus: kratka bilješka u `docs/` (prikaz procesa bez ocjene/presude, procjena prema čl. 6(3)) za nabavu i GDPR/DPIA s FPZG-om. | [AI Act Service Desk — Annex III](https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3), [EK — AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) | mali | — | predloženo |

Dnevni sažetak: https://github.com/danielrisavi77-create/Ductus/issues/271#issuecomment-6138121184
