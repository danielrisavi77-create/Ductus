# Prototip desnog panela editora v0.16: referenca

**Izgled je odobren (D-316, vlasnik 24. 11. 2026.: „Odobravam desni panel.”).** Ovo je vizualna i funkcionalna referenca desnog panela editora, ne kod za preuzimanje. D-316 mijenja D-315 samo u dijelu o izgledu; ostaje da pristanak na funkcije nije odluka o opsegu pilota ni o redoslijedu gradnje. Gdje se preklapa sa starijim referencama (S-13, S-15, S-16, komentari), mjerodavan je ovaj prototip (`docs/design/EKRANI.md` §2a). Paleta je „papir i grafit” (D-188); rječnik zabranjenih izraza (`docs/PRODUCT.md` §5) i WCAG 2.2 AA (D-248) imaju prednost.

> Povijest: do 24. 11. 2026. ovdje je pisalo da izgled nije odobren (D-183; vlasnik 17. 11. 2026., #2012 [c.6956819971](https://github.com/danielrisavi77-create/Ductus/issues/2012#issuecomment-6956819971) t. 2).

Prototip je običan JavaScript nad Tiptapom koji HTML slaže iz teksta. U Ducturi se gradi u Reactu, CSS modulima i katalogu tekstova, na shemi dokumenta iz repoa. Nova se gradnja radi u `ductura/web` i `ductura/server` (D-294, D-306).

## Što je u mapi

| Datoteka | Sadržaj |
|---|---|
| `PREDAJA-DESNI-PANEL.md` | predaja orkestratoru za desni panel, bez §7 (odluke vlasnika, sada D-311 do D-315) |
| `PREDAJA-LIJEVI-PANEL.md` | predaja orkestratoru za lijevi panel, bez §8 (odluke i Lektina pravila, sada D-307 do D-310) |
| `index.html`, `editor.css` | ljuska i stilovi prototipa (razlikuju se od `../lijevi-panel-v07/`); `index.html` je doslovna kopija i učitava skripte kojih ovdje nema |
| `SHA256SUMS` | kontrolni zbrojevi svih datoteka u mapi osim njega samog (`sha256sum -c SHA256SUMS`) |

Tekst obiju predaja prenesen je doslovno, bez izbačenog odjeljka. Upute u tekstu na „§7” (desni panel) i „§8” (lijevi panel) odnose se na izbačene odjeljke; te su odluke sada D-307 do D-315. Tvrdnje o repou u predajama pisane su nad HEAD-om `c7f469ec` (7. 11. 2026.) i djelomično su zastarjele (vidi niže).

## Što nije u repou i zašto

- Skripte prototipa (`app.js`, `features.js`, `rail.js`, `right.js`, `sources2.js`, `proofs.js`, `comments2.js`, `review2.js`, `mentor2.js`, `assist.js`, `assist2.js`, `tools.js`, `rules.js`, `advice.js`, `plus.js`, `prune.js`): ostaju u vlasnikovu paketu izvan repoa (vlasnik 17. 11. 2026., #2012). Prototip nije referenca i iz njega se uzima samo funkcija, koju opisuju predaje u ovoj mapi. Skripte HTML slažu iz teksta, pa ih sigurnosni skener repoa (Semgrep) s pravom odbija; u repo se ne stavljaju i skener se zbog njih ne utišava.
- `vendor/` (`tiptap.js`, `pdf.js`) i izvori za pakiranje `src/vendor.js` i `src/pdf.js`: paketi treće strane, ne preuzimaju se (#2012 c.6956819971 t. 2).
- `samples/diplomski.json`: stvaran studentski rad. Ne smije u repo (`CLAUDE.md`, tvrda pravila). `features.js` ga traži, ali datoteke nema.
- `rules/unizg.json`: vrijednosti iz Lektina paketa izvan dozvole za FPZG (D-217, D-224). `rules.js` je samo učitač; vrijednosti nema.
- Snimke zaslona: nisu bile u paketu. Prototip se ovdje ne pokreće.
- Bez vendor paketa `index.html` se iz repoa ne može pokrenuti. `index.html` učitava fontove s Google Fontsa; u izvedbi se koriste fontovi iz repoa.

## Provjera osobnih podataka

Sve datoteke su pročitane prije upisa. Imena su izmišljena (Student A do E, Nastavnik A, Autor A do E, Nakladnik A i B, „Primjer”). Nema stvarnih osoba ni imena djelatnika FPZG-a. FPZG se spominje samo kao ustanova, citatni stil i oznaka profila (npr. `fpzg-politologija-diplomski`). Nijedna datoteka nije izostavljena zbog osobnih podataka; izostavljene su samo one iz prethodnog odjeljka.

## Rječnik zabranjenih izraza

Skener (`scripts/forbidden-terms/terms.ts`) čita samo `app/` i `src/`, pa ova mapa nije u njegovu opsegu. Ručno pokrenut nad mapom nalazi: „Kopirano.” kao potvrdu kopiranja u međuspremnik, „spremljeno” bez navoda gdje, „Izjava o izvornosti rada” kao naziv obrasca, riječ „prepisano” u nekoliko tekstova i engleski `hidden` iz koda. Pri prijenosu u Ducturu svaki tekst prolazi kroz katalog i skener (`docs/PRODUCT.md` §5); ovdje se tekst ne mijenja.

## Otvoreni neskladi (odlučuje Daniel)

1. **`PREDAJA-LIJEVI-PANEL.md`, izvorni §8 C** tvrdi da Lektina dozvola pokriva širi opseg pravila. To proturječi D-309. Odjeljak nije u repou; vrijedi D-309.
2. **Status referenci M9** (S-16, S31-AI, N-AI-ATT, A-AI-POL): po Q-8 u `STATE.md` spojene su reference odobrene, a README-i `../m9-reference-a` i `../m9-reference-b` kažu PRIJEDLOG do vlasnikove potvrde. Zatvoreno 24. 11. 2026. (`docs/design/EKRANI.md` §2): vrijedi Q-8.
3. **`../lijevi-panel-v07/README.md`** naziva prototip v0.7 „referencom”, što je od D-316 (24. 11. 2026.) točno i za ovaj prototip.
4. **Zastarjele tvrdnje u predajama** (stanje na `main` 17. 11. 2026.):
   - S-15 postoji (`../m7-reference/`, #1815); predaja kaže da ga nema.
   - S-16 ima djelomičan kod i ugovore (`src/domain/assistant/purpose-catalog.ts` #1668, `docs/contracts/ai-request-v1.md`, `docs/contracts/ai-tools-v1.md`, `docs/AI-PRUZATELJI-MATRICA.md`, `docs/AI-HRVATSKI-PROTOKOL.md`).
   - S31-AI (#1698) i N-AI-ATT (#1731) postoje.
   - F-9 i B-11 su demo zadaci; komentari pripadaju M6, a nova gradnja ide u `ductura/web` i `ductura/server` (D-294, D-306).
   - Odluka B s #2012 je D-308; odluke lijevog panela zapisane su kao D-307 do D-310.
5. **Status po funkciji:** D-311, D-312 i D-313 (a) su ODLUČENO; D-313 (b) (studentov privatni ključ ili pretplata) i D-314 (priložena potvrda) su PRIJEDLOG do pravnog mišljenja i DPIA. Na njima se ništa ne gradi.
