/* Ductura Editor, prototip (v0.2): dodaci do punog opsega Editora v11.
 * Novi čvorovi: footnote (fusnota), prikaz (tablica ili slika), xref (unakrsna referenca).
 * Nove oznake: paste (zalijepljeno), imported (uvezeno). Atribut odlomka: vg (skupina inačica).
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, RULES, TASK, PHRASES, esc, wc, uid, now, plural, $, toast, openPop, closePop, openDlg, closeDlg, renderDlg, jump, refresh, persist, renderAll, renderPanel, showTab, setMode, leafText, srcById, yearLabel, citeText, insertCitation, blocksText, plainText, runChecks, Decoration, Node, Mark, Extension, Plugin, PluginKey } = X;
  const ed = () => X.editor, D = () => X.D;
  const caps = {}; X.caps = caps;
  RULES.fig = { t: 'Prikaz s brojem, naslovom i izvorom', why: 'Svaka tablica i slika ima broj, naslov iznad i izvor ispod, a tekst se na nju poziva.', ex: 'Primjer: Tablica 2. Broj pročitanih knjiga po razredu · Izvor: izrada autora.' };
  PHRASES.splice(4, 0, ['Prijelaz', ['Osim toga, …', 'Nadalje, …', 'Iz toga proizlazi da …', 'Nakon što je opisano …, u nastavku se razmatra …']]);
  const PARTS = { uvod: ['Kontekst i dosadašnja istraživanja', 'Praznina i istraživačko pitanje', 'Važnost i doprinos', 'Metodologija', 'Nacrt strukture rada', 'Tezna rečenica'], zaklju: ['Sinteza novim riječima', 'Teza u drugoj formulaciji', 'Rezultati prema ciljevima', 'Otvorena pitanja'] };
  const partsOf = t => (/uvod/i.test(t) ? PARTS.uvod : /zaklju/i.test(t) ? PARTS.zaklju : null);
  const WARN = [
    ['paste', 'Porijeklo teksta', 'Zalijepljeni tekst dok ga ne parafrazirate ili citirate. Vidi ga i nastavnik.'],
    ['claim', 'Tvrdnje bez izvora', 'Rečenice o istraživanjima i literaturi bez navoda.'],
    ['term', 'Pojmovi', 'Pojam prije definicije ili pod drugim nazivom.'],
    ['abbr', 'Kratice', 'Kratica bez punog naziva kod prve upotrebe.'],
    ['long', 'Duge rečenice', 'Više od 40 riječi.'],
    ['colloq', 'Razgovorni izrazi', 'Riječi poput jako, puno, stvarno.'],
    ['absolute', 'Preapsolutne tvrdnje', 'Riječi poput dokazuje, uvijek, svi.'],
    ['first', 'Prvo lice', 'Upute FPZG-a traže treće lice.'],
    ['passive', 'Pasiv u nizu', 'Tri ili više rečenica zaredom u pasivu.'],
    ['trans', 'Prijelazi', 'Odlomak bez vidljive veze s prethodnim.'],
    ['short', 'Kratke rečenice u nizu', 'Dvije kratke rečenice s istim početkom.'],
    ['cmt', 'Komentari u tekstu', 'Kad su isključeni, ostaju u kartici Komentari.'],
  ];
  const LEVELS = { mirno: ['cmt'], osnovno: ['paste', 'claim', 'term', 'abbr', 'long', 'cmt'], sve: WARN.map(w => w[0]) };
  const LVL = { mirno: 'Mirno', osnovno: 'Osnovno', sve: 'Sve', vlastito: 'Vlastito' };
  const REG = {
    colloq: { jako: ['vrlo', 'izrazito'], puno: ['mnogo', 'znatno'], stvarno: ['doista'], 'u biti': ['u osnovi'], dosta: ['prilično'], super: ['vrlo dobro'] },
    absolute: { dokazuje: ['upućuje na', 'pokazuje'], dokazuju: ['upućuju na'], uvijek: ['često', 'u pravilu'], nikad: ['rijetko'], nikada: ['rijetko'], svi: ['većina'], sigurno: ['vjerojatno'], nedvojbeno: ['čini se da'], očito: ['može se reći'] },
    first: { mislim: ['može se pretpostaviti'], smatram: ['čini se da'], 'analizirat ću': ['analizira se'], 'istražit ću': ['istražuje se'], 'pokušat ću': ['nastoji se'] },
  };
  const KT = { colloq: ['Razgovorni izraz', 'Akademski tekst traži neutralniji izraz.'], absolute: ['Preapsolutna tvrdnja', 'Tvrdnja je jača od onoga što izvori mogu potvrditi.'], first: ['Prvo lice', 'Upute FPZG-a traže treće lice ili pasiv.'] };
  const REGX = {}; Object.keys(REG).forEach(k => { REGX[k] = Object.entries(REG[k]).map(([w, alts]) => [new RegExp('(?<!\\p{L})' + w + '(?!\\p{L})', 'giu'), alts]); });
  const PASS = /(?<!\p{L})(?:je|su|bio|bila|bilo|bili)\s+\p{L}{3,}(?:en|na|no|ni|ne)(?!\p{L})|(?<!\p{L})\p{L}{3,}(?:en|na|no|ni|ne)\s+(?:je|su)(?!\p{L})/iu;
  const CONN = /^(međutim|stoga|osim toga|nadalje|s druge strane|zato|također|primjerice|na primjer|ipak|dakle|iz toga|unatoč|usto|nasuprot|slično|za razliku|kao što|prema tome|zbog toga|time|nakon|u tom|u tome|takv|ta |taj |to |tu |ovaj|ova |ovo |ove |ovi |ovim|ovih|ti |te |tom |tim |njeg|njih|on |ona |oni |iako|no |ali |a |zaključno|pritom)/i;
  const DEF = /(shvaća|definira|označava|podrazumijeva|odnosi se na|naziva se)/i;
  const SENT = /[^.!?…]+(?:[.!?…]+[”"»)]*|$)/g;
  function sents(text) { const out = []; let m; SENT.lastIndex = 0; while ((m = SENT.exec(text))) { const raw = m[0]; if (!raw.length) { SENT.lastIndex++; continue; } if (!raw.trim()) continue; const a = m.index + (raw.length - raw.trimStart().length), e = m.index + raw.trimEnd().length; out.push({ a, e, s: text.slice(a, e) }); } return out; }
  const stems = x => new Set((x.toLowerCase().match(/\p{L}{5,}/gu) || []).map(w => w.slice(0, 5)));
  const toks = x => (x.toLowerCase().match(/\p{L}+/gu) || []);
  const tri = a => new Set(a.slice(2).map((w, i) => a[i] + ' ' + a[i + 1] + ' ' + w));
  const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stemRe = t => new RegExp('(?<!\\p{L})' + t.trim().split(/\s+/).map(w => rx(w.length > 5 ? w.slice(0, w.length - 2) : w) + '\\p{L}*').join('\\s+'), 'giu');
  const dotless = n => String(n || '').replace(/\.$/, '');

  X.hooks.defaults.push(s => {
    const def = (k, v) => { if (s[k] == null) s[k] = v; };
    def('targets', {}); def('dues', {}); def('hnotes', {}); def('checked', {}); def('collapsed', {}); def('transOk', {}); def('level', 'osnovno'); def('nacrt', 'ro'); def('rail', 'a');
    def('stash', [{ id: 'x1', text: 'Dio o povijesti čitanja naglas u školama 19. stoljeća; možda za uvod ili fusnotu.', from: 'Uvod' }]);
    def('glossary', [{ term: 'rječnik', def: 'Broj riječi koje dijete razumije i aktivno koristi.', variants: ['leksik'] }, { term: 'fonološka svjesnost', def: 'Prepoznavanje glasovne strukture riječi.', variants: [] }]);
    def('rnotes', { A: [{ id: 'n1', page: '14', text: 'Zajedničko čitanje u predškolskoj dobi povezano je s većim receptivnim rječnikom; za školsku dob autorica navodi manje podataka.' }], B: [{ id: 'n2', page: '33', text: 'U promatranim razredima učitelji su čitanje naglas najčešće koristili kao uvod u sat, rjeđe kao zasebnu aktivnost.' }] });
    def('points', []); def('koWhen', '9. 11. 2026.'); def('prep', null); def('sum', ''); def('kwEn', ''); def('imported', 0); def('onb', 0);
    def('tasks', [{ t: 'Napisati istraživačko pitanje u Uvodu', done: true }, { t: 'Dodati tri izvora u Teorijski okvir', done: false }, { t: 'Suziti temu na prve razrede', done: true }]);
  });

  /* ---------- Shema ---------- */
  const leafView = (name, cls, tag, set) => ({ node }) => { const dom = document.createElement(tag); dom.className = cls; dom.contentEditable = 'false'; set(dom, node); return { dom, update(n) { if (n.type.name !== name) return false; set(dom, n); return true; } }; };
  const attr = (k, d) => ({ default: d, parseHTML: el => { const v = el.getAttribute('data-' + k); return Array.isArray(d) ? JSON.parse(v || '[]') : (v || d); }, renderHTML: a => ({ ['data-' + k]: Array.isArray(d) ? JSON.stringify(a[k]) : a[k] }) });
  const Footnote = Node.create({
    name: 'footnote', group: 'inline', inline: true, atom: true,
    addAttributes() { return { text: attr('fn', '') }; },
    parseHTML() { return [{ tag: 'sup[data-fn]' }]; }, renderHTML({ HTMLAttributes }) { return ['sup', HTMLAttributes, '*']; }, renderText() { return ''; },
    addNodeView() { return leafView('footnote', 'fn', 'sup', (dom, n) => { dom.title = n.attrs.text; }); },
  });
  function xrefText(a) { const d = D(); if (a.kind === 'h') { const h = d.heads.find(x => x.hid === a.target); return h ? 'poglavlje ' + dotless(h.num) : null; } const p = (d.prikazi || []).find(x => x.pid === a.target); return p ? (p.kind === 'tablica' ? 'Tablica ' : 'Slika ') + p.n : null; }
  const XRef = Node.create({
    name: 'xref', group: 'inline', inline: true, atom: true,
    addAttributes() { return { kind: attr('xref', 'h'), target: attr('target', '') }; },
    parseHTML() { return [{ tag: 'span[data-xref]' }]; }, renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, '']; }, renderText({ node }) { return xrefText(node.attrs) || '[referenca?]'; },
    addNodeView() { return leafView('xref', 'xref', 'span', (dom, n) => { dom.dataset.kind = n.attrs.kind; dom.dataset.target = n.attrs.target; }); },
  });
  X.hooks.leaf.xref = n => xrefText(n.attrs) || '[referenca?]';
  function paintPrikaz(dom) {
    const a = dom._a, n = (D().prikazN || {})[a.pid] || '';
    let body = '';
    if (a.kind === 'tablica') body = '<table>' + (a.rows || []).map((r, i) => '<tr>' + r.map(c => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('') + '</tr>').join('') + '</table>';
    else body = a.img ? `<img src="${esc(a.img)}" alt="${esc(a.title)}">` : '<div class="imgph">Slika još nije priložena</div>';
    dom.innerHTML = `<figcaption><b>${a.kind === 'tablica' ? 'Tablica' : 'Slika'} ${n}.</b> ${a.title ? esc(a.title) : '<i>bez naslova</i>'}</figcaption>${body}<div class="psrc">Izvor: ${a.source ? esc(a.source) : '<i>nije upisan</i>'}</div>`;
  }
  const Prikaz = Node.create({
    name: 'prikaz', group: 'block', atom: true, selectable: true,
    addAttributes() { return { pid: attr('pid', ''), kind: attr('kind', 'tablica'), title: attr('title', ''), source: attr('source', ''), rows: attr('rows', []), img: attr('img', '') }; },
    parseHTML() { return [{ tag: 'figure[data-kind]' }]; }, renderHTML({ HTMLAttributes }) { return ['figure', HTMLAttributes]; },
    addNodeView() { return leafView('prikaz', 'prikaz', 'figure', (dom, n) => { dom._a = n.attrs; dom.dataset.pid = n.attrs.pid; paintPrikaz(dom); }); },
  });
  const Paste = Mark.create({ name: 'paste', inclusive: false, addAttributes() { return { orig: { default: '', rendered: false }, src: { default: '', rendered: false }, ok: { default: '', rendered: false } }; }, parseHTML() { return [{ tag: 'span[data-paste]' }]; }, renderHTML({ mark }) { return ['span', { class: 'paste' + (mark.attrs.ok ? ' ok' : ''), 'data-paste': '1' }, 0]; } });
  const Imported = Mark.create({ name: 'imported', inclusive: false, parseHTML() { return [{ tag: 'span[data-imp]' }]; }, renderHTML() { return ['span', { class: 'imp', 'data-imp': '1', title: 'Uvezeni tekst, nastao prije Ducture' }, 0]; } });
  const fkey = new PluginKey('ductura-dodaci');
  const Dodaci = Extension.create({
    name: 'dodaci',
    addGlobalAttributes() { return [{ types: ['paragraph'], attributes: { vg: { default: null, rendered: false } } }]; },
    addProseMirrorPlugins() {
      return [new Plugin({
        key: fkey,
        appendTransaction(trs, _o, st) {
          if (!trs.some(t => t.docChanged)) return null;
          let tr = null; const seen = new Set(), groups = {};
          st.doc.descendants((n, pos) => {
            if (n.type.name === 'prikaz') { if (!n.attrs.pid || seen.has(n.attrs.pid)) { tr = tr || st.tr; tr.setNodeMarkup(pos, null, { ...n.attrs, pid: uid('p') }); } else seen.add(n.attrs.pid); return false; }
            if (n.isText) { const m = n.marks.find(x => x.type.name === 'paste'); if (m && !m.attrs.ok) { const g = groups[m.attrs.orig] = groups[m.attrs.orig] || { text: '', ranges: [] }; g.text += n.text + ' '; g.ranges.push([pos, pos + n.nodeSize]); } }
            return true;
          });
          let para = false;
          Object.entries(groups).forEach(([orig, g]) => {
            const o = toks(orig), c = toks(g.text), O = tri(o), C = tri(c); let k = 0; C.forEach(x => { if (O.has(x)) k++; });
            if (c.length && o.length >= 6 && C.size && k / C.size < 0.35) { tr = tr || st.tr; g.ranges.forEach(r => tr.removeMark(r[0], r[1], st.schema.marks.paste)); para = true; }
          });
          if (para) setTimeout(() => toast('Tekst je parafraziran. Oznaka porijekla je uklonjena.'), 0);
          return tr;
        },
      })];
    },
  });
  X.hooks.ext.push(Footnote, XRef, Prikaz, Paste, Imported, Dodaci);

  /* ---------- Analiza teksta ---------- */
  function hint(ctx, base, a, e, kind, info) {
    const d = ctx.d, i = (d.hints = d.hints || []).push(Object.assign({ kind, pos: base + a, to: base + e }, info)) - 1;
    (d.cnt = d.cnt || {})[kind] = (d.cnt[kind] || 0) + 1;
    if (S.warn[kind] && S.mode === 'write') ctx.decos.push(Decoration.inline(base + a, base + e, { class: 'hint h-' + kind, 'data-h': String(i) }));
  }
  X.hooks.node.push(({ node, pos, d }) => {
    if (node.type.name !== 'prikaz') return;
    const a = node.attrs, list = d.prikazi = d.prikazi || [], n = list.filter(x => x.kind === a.kind).length + 1;
    list.push({ pid: a.pid, kind: a.kind, n, title: a.title, source: a.source, pos }); (d.prikazN = d.prikazN || {})[a.pid] = n;
    return false;
  });
  X.hooks.block.push(ctx => {
    const { node, pos, base, text, kids, decos, d, cur2, cur3, doc } = ctx, top = doc.resolve(pos).depth === 0;
    let inP = false;
    kids.forEach(k => {
      const t = k.ch.type.name;
      if (t === 'footnote') (d.fns = d.fns || []).push({ pos: base + k.off, text: k.ch.attrs.text });
      if (t === 'xref') (d.xrefs = d.xrefs || []).push({ pos: base + k.off, kind: k.ch.attrs.kind, target: k.ch.attrs.target });
      const pm = k.ch.isText && k.ch.marks.find(m => m.type.name === 'paste');
      if (pm && !pm.attrs.ok) { if (!inP) (d.pastes = d.pastes || []).push(base + k.off); inP = true; } else inP = false;
    });
    if (node.attrs.vg) { const g = d.vg = d.vg || {}; g[node.attrs.vg] = (g[node.attrs.vg] || 0) + 1; decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'variant', 'data-var': 'inačica ' + g[node.attrs.vg] })); }
    const ss = sents(text);
    (d.blocks = d.blocks || []).push({ text, base, pos, ss, isP: top && node.type.name === 'paragraph', sec: (cur3 || cur2 || {}).hid || '', h2: cur2 ? cur2.hid : '' });
    ['colloq', 'absolute', 'first'].forEach(kind => REGX[kind].forEach(([re, alts]) => { let m; re.lastIndex = 0; while ((m = re.exec(text))) hint(ctx, base, m.index, m.index + m[0].length, kind, { word: m[0], alts }); }));
    let run = []; const flush = () => { if (run.length >= 3) run.forEach(r => hint(ctx, base, r.a, r.e, 'passive', { n: run.length })); run = []; };
    ss.forEach(x => { if (PASS.test(x.s)) run.push(x); else flush(); }); flush();
    for (let i = 0; i + 1 < ss.length; i++) {
      const A = ss[i], B = ss[i + 1], fa = (A.s.match(/^\p{L}+/u) || [''])[0], fb = (B.s.match(/^\p{L}+/u) || [''])[0];
      if (fa && fa.toLowerCase() === fb.toLowerCase() && wc(A.s) <= 7 && wc(B.s) <= 7 && !/￼/.test(A.s + B.s)) { const rest = B.s.slice(fb.length).trim(); hint(ctx, base, A.a, B.e, 'short', { first: fa, joined: A.s.replace(/[.!?…]+$/, '') + ' i ' + rest }); i++; }
    }
  });
  X.hooks.end.push(ctx => {
    const { decos, d, doc } = ctx, blocks = d.blocks || [];
    // pojmovi
    d.gloss = {};
    S.glossary.forEach(g => {
      const re = stemRe(g.term), vre = (g.variants || []).filter(Boolean).map(stemRe);
      const defIdx = blocks.findIndex(b => { re.lastIndex = 0; return re.test(b.text) && DEF.test(b.text); });
      const info = d.gloss[g.term] = { uses: 0, issues: 0, places: [], defPos: defIdx >= 0 ? blocks[defIdx].pos : null }; let flagged = false;
      blocks.forEach((b, bi) => {
        let m; re.lastIndex = 0;
        while ((m = re.exec(b.text))) { info.uses++; info.places.push(b.base + m.index); if (defIdx >= 0 && bi < defIdx) { info.issues++; hint(ctx, b.base, m.index, m.index + m[0].length, 'term', { sub: 'early', term: g.term, def: g.def }); } else if (defIdx < 0 && !flagged) { flagged = true; info.issues++; hint(ctx, b.base, m.index, m.index + m[0].length, 'term', { sub: 'nodef', term: g.term, def: g.def }); } }
        vre.forEach(v => { let mv; v.lastIndex = 0; while ((mv = v.exec(b.text))) { info.issues++; hint(ctx, b.base, mv.index, mv.index + mv[0].length, 'term', { sub: 'variant', term: g.term, word: mv[0] }); } });
      });
    });
    // kratice i česte riječi
    const abbrs = {}, words = {}, full = {}; S.sources.forEach(x => { const m = x.full.match(/^(.*?)\s*\(([A-ZČĆŠŽĐ]{2,})\)$/); if (m) full[m[2]] = m[1]; });
    blocks.forEach(b => {
      const are = /(?<!\p{L})[A-ZČĆŠŽĐ]{2,6}(?!\p{L})/gu; let m;
      while ((m = are.exec(b.text))) { const ab = m[0]; if (abbrs[ab]) continue; const ok = b.text[m.index - 1] === '('; abbrs[ab] = { ab, ok, full: full[ab] || '', pos: b.base + m.index }; if (!ok) hint(ctx, b.base, m.index, m.index + ab.length, 'abbr', { ab, full: full[ab] || '' }); }
      (b.text.toLowerCase().match(/\p{L}{7,}/gu) || []).forEach(w => { const k = w.slice(0, 6); const o = words[k] = words[k] || { n: 0, f: {} }; o.n++; o.f[w] = (o.f[w] || 0) + 1; });
    });
    d.abbrs = Object.values(abbrs);
    const inGloss = k => S.glossary.some(g => g.term.toLowerCase().slice(0, 6) === k || (g.variants || []).some(v => v.toLowerCase().slice(0, 6) === k));
    d.glossSugg = Object.keys(words).filter(k => words[k].n >= 3 && !inGloss(k)).sort((a, b) => words[b].n - words[a].n).slice(0, 4).map(k => { const fr = words[k].f; return { w: Object.keys(fr).sort((a, b) => fr[b] - fr[a])[0], n: words[k].n }; });
    // prijelazi i duljina odlomaka
    d.paraOut = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]; if (!b.isP || !b.ss.length) continue;
      const w = wc(b.text); if (w < 35 || w > 230) d.paraOut.push(b.pos);
      const p = blocks[i - 1]; if (!p || !p.isP || !p.ss.length || p.sec !== b.sec) continue;
      const la = p.ss[p.ss.length - 1].s, fb = b.ss[0], key = fb.s.slice(0, 40), A = stems(la), B = stems(fb.s); let shared = false; B.forEach(x => { if (A.has(x)) shared = true; });
      if (!shared && !CONN.test(fb.s) && !S.transOk[key] && wc(fb.s) > 4) hint(ctx, b.base, fb.a, fb.e, 'trans', { prev: la, key });
    }
    // traženje
    d.hits = [];
    const f = U.find;
    if (f && f.q) {
      const q = f.q.toLowerCase(); let h2 = '';
      if (f.scope === 'chap') { const sel = ctx.st.selection.from; blocks.forEach(b => { if (b.pos <= sel) h2 = b.h2; }); }
      blocks.forEach(b => {
        if (f.scope === 'chap' && b.h2 !== h2) return;
        const low = b.text.toLowerCase(); let i = -1;
        while ((i = low.indexOf(q, i + 1)) >= 0) { if (f.scope === 'quote') { const o = b.text.lastIndexOf('„', i), c = b.text.lastIndexOf('”', i); if (o < 0 || c > o) continue; } d.hits.push({ from: b.base + i, to: b.base + i + q.length }); }
      });
      if (f.i >= d.hits.length) f.i = 0;
      d.hits.forEach((h, i) => decos.push(Decoration.inline(h.from, h.to, { class: 'found' + (i === f.i ? ' cur' : '') })));
    }
    // samo jedno poglavlje
    if (U.onlyHid) { const r = secRange(U.onlyHid, doc); if (r) doc.forEach((n, off) => { if (off < r.start || off >= r.end) decos.push(Decoration.node(off, off + n.nodeSize, { class: 'hid' })); }); else U.onlyHid = null; }
  });
  function secRange(hid, doc) { doc = doc || ed().state.doc; let s = -1, e = doc.content.size, lv = 0, done = false; doc.forEach((n, off) => { if (n.type.name !== 'heading' || done) return; if (s < 0) { if (n.attrs.hid === hid) { s = off; lv = n.attrs.level; } } else if (n.attrs.level <= lv) { e = off; done = true; } }); return s < 0 ? null : { start: s, end: e, level: lv }; }
  const headEnd = h => { const r = secRange(h.hid); return r ? r.end : h.end; };

  X.hooks.checks.push(add => {
    const d = D();
    if ((d.pastes || []).length) add('warn', `Zalijepljeni tekst: ${d.pastes.length}`, 'Parafrazirajte ga ili stavite u navodnike s navodom. Dok je označen, vidi ga i nastavnik.', d.pastes[0]);
    const broken = (d.xrefs || []).filter(x => !xrefText(x)); if (broken.length) add('warn', `Unakrsne reference bez cilja: ${broken.length}`, 'Ono na što referenca upućuje više ne postoji.', broken[0].pos);
    const pk = d.prikazi || [], refd = new Set((d.xrefs || []).map(x => x.target));
    const un = pk.filter(p => !refd.has(p.pid)); if (un.length) add('warn', `Prikazi koji se ne spominju u tekstu: ${un.length}`, RULES.fig.why, un[0].pos);
    const bare = pk.filter(p => !p.title || !p.source); if (bare.length) add('warn', `Prikazi bez naslova ili izvora: ${bare.length}`, 'Natpis ide iznad, a izvor ispod prikaza.', bare[0].pos);
    const fnc = (d.fns || []).filter(f => /\(\p{Lu}[^)]*\d{4}/u.test(f.text)); if (fnc.length) add('warn', `Fusnote s navodom: ${fnc.length}`, 'Fusnote su samo objasnidbene; navod ide u tekst.', fnc[0].pos);
    if ((d.paraOut || []).length) add('warn', `Odlomci izvan 5 do 15 redaka: ${d.paraOut.length}`, 'Prekratak odlomak spojite sa susjednim, a predug podijelite.', d.paraOut[0]);
    if (TASK.minRefs) { const n = S.sources.filter(x => d.cited[x.id]).length, b = S.sources.filter(x => d.cited[x.id] && x.kind === 'knjiga').length; add(n >= TASK.minRefs ? 'ok' : 'warn', `Izvori: ${n} od najmanje ${TASK.minRefs}`, 'Profil FPZG, diplomski rad Politologije.', null, 'lit'); add(b >= TASK.minBooks ? 'ok' : 'warn', `Knjige među izvorima: ${b} od najmanje ${TASK.minBooks}`, 'Profil FPZG, diplomski rad Politologije.', null, 'lit'); }
    const citedKinds = S.sources.filter(s => d.cited[s.id]); if (citedKinds.length && !citedKinds.some(s => s.kind === 'knjiga')) add('warn', 'Među citiranim izvorima nema knjige', 'Upute očekuju i knjige među izvorima.', null, 'lit');
    if (d.words >= 1000) { const u = d.heads.find(h => h.level === 2 && /uvod/i.test(h.title)), z = d.heads.find(h => h.level === 2 && /zaklju/i.test(h.title)); if (u && u.words > d.words / 10) add('warn', 'Uvod je duži od desetine teksta', `${u.words} od ${d.words} riječi.`, u.pos); if (z && (z.words < d.words / 20 || z.words > d.words / 10)) add('warn', 'Zaključak nije između dvadesetine i desetine teksta', `${z.words} od ${d.words} riječi.`, z.pos); }
    const c = d.cnt || {}; if (c.term) add('warn', `Pojmovi: ${c.term} ${plural(c.term, 'mjesto', 'mjesta', 'mjesta')} za pogledati`, RULES.def.why, (d.hints.find(h => h.kind === 'term') || {}).pos);
    if (c.abbr) add('warn', `Kratice bez punog naziva: ${c.abbr}`, 'Kad se kratica prvi put pojavi, ispred nje ide puni naziv.', (d.hints.find(h => h.kind === 'abbr') || {}).pos);
  });

  /* ---------- Bojenje nakon iscrtavanja ---------- */
  X.hooks.paint.push(() => {
    const d = D(), edEl = $('#ed');
    edEl.querySelectorAll('.fn').forEach((el, i) => { el.textContent = i + 1; });
    edEl.querySelectorAll('.prikaz').forEach(paintPrikaz);
    edEl.querySelectorAll('.xref').forEach(el => { const t = xrefText({ kind: el.dataset.kind, target: el.dataset.target }); el.textContent = t || '[referenca?]'; el.classList.toggle('missing', !t); });
    edEl.classList.toggle('nopaste', !S.warn.paste); edEl.classList.toggle('outline-only', !!U.outline);
    const pk = d.prikazi || [], lst = k => pk.filter(p => p.kind === k).map(p => `<button class="tocl" data-act="jump" data-pos="${p.pos}"><span>${k === 'tablica' ? 'Tablica' : 'Slika'} ${p.n}. ${esc(p.title || 'bez naslova')}</span></button>`).join('');
    $('#toc').innerHTML = S.toc && !U.outline ? `<div class="tocbox"><div class="tkind">${TASK.kind} · Sveučilište u Zagrebu, Fakultet političkih znanosti</div><h4>Sadržaj</h4>${d.heads.filter(h => h.level > 1).map(h => `<button class="tocl l${h.level}" data-act="jump" data-pos="${h.pos}"><span>${h.num} ${esc(h.title || 'Bez naslova')}</span></button>`).join('') || '<p class="tnote">Rad još nema naslova.</p>'}<button class="tocl" data-act="jumpBib"><span>Literatura</span></button>${pk.some(p => p.kind === 'tablica') ? `<h4>Popis tablica</h4>${lst('tablica')}` : ''}${pk.some(p => p.kind === 'slika') ? `<h4>Popis slika</h4>${lst('slika')}` : ''}<p class="tnote">Složeno iz naslova i opisa prikaza. Brojeve stranica upisuje Word pri izvozu.</p></div>` : '';
    $('#fnlist').innerHTML = (d.fns || []).length ? `<div class="fnl">${d.fns.map((f, i) => `<p><sup>${i + 1}</sup> ${esc(f.text) || '<i>prazna fusnota</i>'}</p>`).join('')}</div>` : '';
    const fb = $('#findMsg'); if (fb && U.find) fb.textContent = U.find.q ? (d.hits.length ? `${Math.min(U.find.i + 1, d.hits.length)} od ${d.hits.length}` : 'Nema pojava.') : '';
  });
  X.hooks.banner.push(() => {
    let h = '';
    if (U.otherTab) h += `<div class="banner"><span><b>Dokument je otvoren u drugoj kartici.</b> Ova kartica ništa ne sprema dok je druga otvorena.</span></div>`;
    if (!navigator.onLine) h += `<div class="banner"><span><b>Bez mreže.</b> Tekst se sprema na ovom uređaju. Slanje na poslužitelj nastavlja se kad se mreža vrati.</span></div>`;
    if (U.outline) h += `<div class="banner"><span>Prikaz samo naslova. Pisanje je isključeno dok je ovaj prikaz uključen.</span><span class="grow"></span><button class="lnk" data-act="outlineOnly">Nastavi pisati</button></div>`;
    if (U.onlyHid) { const hd = D().heads.find(x => x.hid === U.onlyHid); h += `<div class="banner"><span>Prikazano samo poglavlje „${esc(hd ? hd.title : '')}”.</span><span class="grow"></span><button class="lnk" data-act="showAll">Prikaži cijeli rad</button></div>`; }
    if (U.showNote && S.noteSelf) h += `<div class="banner"><span><b>Poruka od prošli put:</b> ${esc(S.noteSelf.text)}</span><span class="grow"></span><button class="lnk" data-act="noteGo">Idi tamo</button><button class="lnk" data-act="noteDel">Obriši</button></div>`;
    if (U.dict) h += `<div class="banner"><span><b>Diktiranje je uključeno.</b> ${esc(U.dictPart || 'Govorite…')}</span><span class="grow"></span><button class="lnk" data-act="dictate">Zaustavi</button></div>`;
    return h;
  });

  /* ---------- Klik u tekstu ---------- */
  function nodePos(dom, name) { const v = ed().view, doc = ed().state.doc; let p; try { p = v.posAtDOM(dom, 0); } catch (e) { return -1; } for (const q of [p, p - 1]) { const n = q >= 0 ? doc.nodeAt(q) : null; if (n && n.type.name === name) return q; } return -1; }
  function markRange(pos, name) {
    const doc = ed().state.doc, $p = doc.resolve(pos), par = $p.parent, start = $p.start(); let from = null, to = null, mk = null, hit = false, res = null;
    par.forEach((ch, off) => { const m = ch.isText && ch.marks.find(x => x.type.name === name); if (m && (!mk || mk.attrs.orig === m.attrs.orig)) { if (from == null) from = start + off; to = start + off + ch.nodeSize; mk = m; if (pos >= start + off && pos <= to) hit = true; } else { if (hit && !res) res = { from, to, mark: mk }; from = to = mk = null; hit = false; } });
    return res || (hit ? { from, to, mark: mk } : null);
  }
  X.hooks.click.push(e => {
    const t = e.target, ro = !ed().isEditable, rect = el => el.getBoundingClientRect(), pop = (html, el, pos) => { openPop(`<div class="pad">${html}</div>`, rect(el), 'menu'); if (pos != null) $('#pop').dataset.pos = pos; };
    const fn = t.closest('.fn'); if (fn) { const pos = nodePos(fn, 'footnote'); if (pos < 0) return true; const n = ed().state.doc.nodeAt(pos); pop(`<p><b>Fusnota ${esc(fn.textContent)}</b></p><p>${esc(n.attrs.text) || '<i>prazno</i>'}</p>${ro ? '' : '<div class="row"><button class="btn sm" data-act="fnEdit">Uredi</button><button class="lnk" data-act="leafDel">Ukloni</button></div>'}`, fn, pos); return true; }
    const xr = t.closest('.xref'); if (xr) { const pos = nodePos(xr, 'xref'); pop(`<p><b>Unakrsna referenca</b></p><p class="muted">${xr.classList.contains('missing') ? 'Ono na što referenca upućuje više ne postoji.' : 'Broj se mijenja sam kad premjestite poglavlje, tablicu ili sliku.'}</p>${ro ? '' : '<button class="lnk" data-act="leafDel">Ukloni</button>'}`, xr, pos); return true; }
    const pk = t.closest('.prikaz'); if (pk) { if (!ro) { const pos = nodePos(pk, 'prikaz'); if (pos >= 0) editPrikaz(pos); } return true; }
    if (!getSelection().isCollapsed) return false;
    const ps = t.closest('.paste');
    if (ps && S.warn.paste) {
      let pos; try { pos = ed().view.posAtDOM(ps, 0); } catch (x) { return false; } const r = markRange(pos + 1, 'paste') || markRange(pos, 'paste'); if (!r) return false;
      const a = r.mark.attrs, s = a.src ? srcById(a.src) : null;
      if (S.mode === 'teacher') pop(`<p><b>Zalijepljeni tekst</b></p><p>${a.ok ? 'Potvrđeno uz obrazloženje: ' + esc(a.ok) : s ? 'Student je ovaj tekst zalijepio iz izvora ' + esc(s.authors) + ' (' + yearLabel(s) + ').' : 'Student je ovaj tekst zalijepio izvana i još ga nije parafrazirao ni citirao.'}</p>`, ps);
      else if (!ro) { pop(`<p><b>Zalijepljeni tekst</b></p><p>${a.ok ? 'Potvrđeno uz obrazloženje: ' + esc(a.ok) : (s ? 'Zalijepljeno iz izvora ' + esc(s.authors) + ' (' + yearLabel(s) + '). ' : '') + 'Parafrazirajte ga svojim riječima ili ga stavite u navodnike s navodom. Dok je označen, vidi ga i nastavnik.'}</p>${a.ok ? '' : '<div class="row"><button class="btn sm" data-act="pasteQuote">Stavi u navodnike</button><button class="lnk" data-act="pasteOk">Potvrdi uz obrazloženje</button></div>'}`, ps); U.pasteR = r; }
      return true;
    }
    const h = t.closest('.hint[data-h]'); if (h && !ro) { hintPop(+h.dataset.h, rect(h)); return true; }
    const v = t.closest('p.variant'); if (v && !ro && e.offsetY < 0) return false;
    return false;
  });
  function hintPop(i, r) {
    const h = D().hints[i]; if (!h) return; const k = h.kind, b = (act, label, extra) => `<button class="btn sm" data-act="${act}" data-h="${i}"${extra || ''}>${label}</button>`; let html = '';
    if (KT[k]) html = `<p><b>${KT[k][0]}</b></p><p>${KT[k][1]}</p>` + (h.alts.length ? `<p class="muted">Zamijeni s</p><div class="row">${h.alts.map(a => b('hintRep', esc(a), ` data-alt="${esc(a)}"`)).join('')}</div>` : '');
    else if (k === 'passive') html = `<p><b>Pasiv u nizu</b></p><p>${h.n} rečenice zaredom u pasivu. Barem jednu preoblikujte tako da se vidi tko što čini.</p>`;
    else if (k === 'term') html = h.sub === 'variant' ? `<p><b>Drugi naziv za isti pojam</b></p><p>U radu koristite „${esc(h.term)}”. „${esc(h.word)}” je isti pojam pod drugim nazivom.</p><div class="row">${b('hintRep', 'Zamijeni s „' + esc(h.term) + '”', ` data-alt="${esc(h.term)}"`)}</div>` : `<p><b>${h.sub === 'early' ? 'Pojam prije definicije' : 'Pojam bez definicije'}</b></p><p>${esc(RULES.def.why)}</p><p class="q">${esc(h.def)}</p><button class="lnk" data-act="openGloss">Otvori pojmovnik</button>`;
    else if (k === 'abbr') html = `<p><b>Kratica bez punog naziva</b></p><p>Kad se kratica ${esc(h.ab)} prvi put pojavi, ispred nje ide puni naziv${h.full ? ': ' + esc(h.full) + ' (' + esc(h.ab) + ')' : ''}.</p>${h.full ? `<div class="row">${b('hintRep', 'Upiši puni naziv', ` data-alt="${esc(h.full + ' (' + h.ab + ')')}"`)}</div>` : ''}`;
    else if (k === 'trans') html = `<p><b>Prijelaz</b></p><p>Zadnja rečenica prethodnog odlomka i prva rečenica ovog nemaju zajedničkog pojma ni veznika. Čitatelj možda neće vidjeti vezu.</p><p class="muted">Prethodni odlomak završava</p><p class="q">${esc(h.prev.replace(/￼/g, ''))}</p><div class="row">${b('transPhr', 'Fraze za prijelaz')}${b('transOk', 'U redu je')}</div>`;
    else if (k === 'short') html = `<p><b>Dvije kratke rečenice</b></p><p>Obje počinju s „${esc(h.first)}”. Mogu se spojiti u jednu.</p><p class="muted">Ovako bi glasilo</p><p class="q">${esc(h.joined)}</p><div class="row">${b('hintRep', 'Spoji', ` data-alt="${esc(h.joined)}"`)}</div>`;
    openPop(`<div class="pad">${html}</div>`, r, 'menu');
  }

  /* ---------- Lijepljenje ---------- */
  X.hooks.paste = (view, e) => {
    if (!ed().isEditable) return false; const raw = ((e.clipboardData && e.clipboardData.getData('text/plain')) || '').replace(/\r/g, ''); if (wc(raw) < 8) return false;
    const clean = raw.replace(/-\n(?=\p{Ll})/gu, '').replace(/([^\n.!?:”"])\n(?!\n)/g, '$1 ').replace(/[ \t]+/g, ' '), fixed = clean !== raw.replace(/[ \t]+/g, ' ');
    const paras = clean.split(/\n+/).map(x => x.trim()).filter(Boolean);
    let src = '', page = ''; Object.entries(S.rnotes).forEach(([id, list]) => list.forEach(n => { if (n.text.length > 20 && clean.includes(n.text.slice(0, 40))) { src = id; page = n.page; } }));
    const tn = p => ({ type: 'text', text: p, marks: [{ type: 'paste', attrs: { orig: p, src, ok: '' } }] });
    ed().chain().focus().insertContent(paras.length === 1 ? tn(paras[0]) : paras.map(p => ({ type: 'paragraph', content: [tn(p)] }))).run();
    if (src) { const s = srcById(src), c = ed().view.coordsAtPos(ed().state.selection.from); openPop(`<div class="pad"><p><b>Prepoznat izvor:</b> ${esc(s.authors)} (${yearLabel(s)}), str. ${esc(page)}</p><button class="btn sm" data-act="pasteCite" data-id="${esc(src)}" data-page="${esc(page)}">Dodaj navod</button></div>`, c, 'menu'); }
    else if (fixed) toast('Prijelomi redaka iz PDF-a su uklonjeni.');
    return true;
  };

  /* ---------- Struktura ---------- */
  const STAT = ['skica', 'u radu', 'gotovo'];
  function flagsOf(h) {
    const d = D(), end = headEnd(h), inR = p => p >= h.pos && p < end, fix = [], miss = [], t = S.targets[h.hid];
    const oc = S.comments.filter(c => !c.resolved && !c.lost && c.role === 'teacher' && inR(c.from)).length; if (oc) fix.push(`Nastavnik je ostavio ${oc} ${plural(oc, 'otvoren komentar', 'otvorena komentara', 'otvorenih komentara')}.`);
    if (d.claims.some(inR)) fix.push('Tvrdnje o dosadašnjim istraživanjima trebaju izvor.');
    if (h.level === 2 && h.words && !h.cites && !/uvod|zaklju/i.test(h.title)) miss.push('Poglavlje još nema nijedan navod.');
    if (t && h.words < t) miss.push(`Do cilja poglavlja nedostaje još ${t - h.words} riječi.`);
    const nh = d.holes.filter(x => inR(x.pos)).length; if (nh) fix.push(`Rupe u tekstu: ${nh}.`);
    const np = (d.pastes || []).filter(inR).length; if (np) fix.push(`Zalijepljeni tekst bez navoda: ${np}.`);
    const nb = (d.prikazi || []).filter(x => inR(x.pos) && (!x.title || !x.source)).length; if (nb) miss.push(`Prikaz bez naslova ili izvora: ${nb}.`);
    return { fix, miss };
  }
  X.render.rail = function () {
    const d = D(), sel = ed().state.selection.from, ro = S.mode === 'teacher' || S.submitted || U.otherTab; let act = null; d.heads.forEach(h => { if (h.pos <= sel) act = h; });
    let html = `<div class="row" style="margin:0 6px 8px;flex-wrap:nowrap"><h2 style="margin:0">Struktura</h2><span class="grow"></span><button class="mini${U.outline ? ' on' : ''}" data-act="outlineOnly" title="Samo naslovi i svrhe poglavlja" aria-label="Samo naslovi">≡</button><button class="mini" data-act="copyToc" title="Kopiraj sadržaj rada" aria-label="Kopiraj sadržaj rada">⧉</button></div>`;
    html += `<button class="thesis" data-act="thesisEdit" title="Jedna rečenica: što rad tvrdi ili pita?"${ro ? ' disabled' : ''}>${S.thesis ? esc(S.thesis) : '+ Teza ili istraživačko pitanje'}</button>`;
    let hideUnder = null;
    d.heads.forEach(h => {
      if (h.level === 2) hideUnder = S.collapsed[h.hid] ? h.hid : null; else if (h.level === 3 && hideUnder) return;
      const on = act === h, st = S.statuses[h.hid] || 0, t = S.targets[h.hid], f = h.level > 1 ? flagsOf(h) : { fix: [], miss: [] }, nf = f.fix.length + f.miss.length;
      const kids = h.level === 2 && d.heads.some(x => x.level === 3 && x.pos > h.pos && x.pos < headEnd(h));
      html += `<div class="oiw"><button class="oi l${h.level}${on ? ' act' : ''}" data-act="jump" data-pos="${h.pos}" title="${esc(h.title)}${h.level > 1 ? ' · Alt+Shift+↑/↓ premješta poglavlje' : ''}"><span class="n">${h.num}</span><span class="t">${esc(h.title || 'Bez naslova')}</span>${nf ? `<span class="flag${f.fix.length ? ' fix' : ''}" title="${esc([...f.fix, ...f.miss].join(' '))}">${nf}</span>` : ''}${h.level > 1 ? `<span class="w${st === 2 ? ' done' : ''}">${h.words}${t ? '/' + t : ''}</span>` : ''}</button>${kids ? `<button class="car" data-act="collapse" data-hid="${h.hid}" aria-label="Sklopi ili rasklopi">${S.collapsed[h.hid] ? '▸' : '▾'}</button>` : ''}</div>`;
      if (U.outline && h.level > 1 && S.purposes[h.hid]) html += `<div class="opur">${esc(S.purposes[h.hid])}</div>`;
      if (on && h.level > 1) {
        const parts = partsOf(h.title), ck = S.checked[h.hid] || {};
        html += `<div class="oidet">` + (ro ? '' : `<div class="row"><button class="chip${st === 2 ? ' done' : ''}" data-act="status" data-hid="${h.hid}" title="Stanje poglavlja: ${STAT[st]}. Kliknite za promjenu.">${STAT[st]}</button><button class="chip" data-act="hTarget" data-hid="${h.hid}" title="Kliknite za promjenu cilja poglavlja">${t ? 'cilj ' + t : '+ cilj'}</button><button class="chip" data-act="hDue" data-hid="${h.hid}" title="Promijeni rok poglavlja">${S.dues[h.hid] ? 'rok ' + esc(S.dues[h.hid]) : '+ rok'}</button><span class="grow"></span><button class="mini" data-act="move" data-hid="${h.hid}" data-dir="-1" title="Premjesti gore" aria-label="Premjesti poglavlje gore">↑</button><button class="mini" data-act="move" data-hid="${h.hid}" data-dir="1" title="Premjesti dolje" aria-label="Premjesti poglavlje dolje">↓</button><button class="mini" data-act="hMenu" data-hid="${h.hid}" title="Radnje nad poglavljem" aria-label="Radnje nad poglavljem">⋯</button></div>`) +
          (f.fix.length ? `<div class="fl"><b>Popravi</b>${f.fix.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '') + (f.miss.length ? `<div class="fl"><b>Još nedostaje</b>${f.miss.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '') +
          (S.purposes[h.hid] ? `<div class="fl"><b>Svrha</b><span>${esc(S.purposes[h.hid])}</span></div>` : '') + (S.hnotes[h.hid] ? `<div class="fl"><b>Bilješka</b><span>${esc(S.hnotes[h.hid])}</span></div>` : '') +
          (parts ? `<div class="fl"><b>Dijelovi poglavlja prema Uputama FPZG-a</b>${parts.map((p, i) => `<label class="check"><input type="checkbox" data-part="${h.hid}" data-i="${i}"${ck[i] ? ' checked' : ''}${ro ? ' disabled' : ''}><span>${esc(p)}</span></label>`).join('')}</div>` : '') + `</div>`;
      }
    });
    if (!d.heads.some(h => h.level === 2)) html += `<p class="muted" style="margin:6px">Rad još nema naslova.</p>${ro ? '' : '<button class="btn sm" style="margin:0 6px" data-act="kostur">Umetni kostur FPZG</button>'}`;
    const pk = d.prikazi || [], sec = (t, body) => `<div class="rsec"><h2>${t}</h2>${body}</div>`;
    if (pk.length) html += sec('Popis prikaza', pk.map(p => `<button class="oi" data-act="jump" data-pos="${p.pos}"><span class="t">${p.kind === 'tablica' ? 'Tablica' : 'Slika'} ${p.n}. ${esc(p.title || 'bez naslova')}</span></button>`).join(''));
    if ((d.fns || []).length) html += sec('Fusnote', d.fns.map((f, i) => `<button class="oi" data-act="jump" data-pos="${f.pos}"><span class="n">${i + 1}</span><span class="t">${esc(f.text || 'prazna fusnota')}</span></button>`).join(''));
    html += sec('Odloženo', S.stash.length ? S.stash.map(x => `<div class="stash"><div>${esc(x.text.length > 120 ? x.text.slice(0, 117) + '…' : x.text)}</div><div class="meta"><span>iz: ${esc(x.from)}</span>${ro ? '' : `<button class="lnk" data-act="unstash" data-id="${x.id}" title="Vrati na mjesto kursora">vrati</button><button class="lnk" data-act="stashDel" data-id="${x.id}">obriši</button>`}</div></div>`).join('') : '<p class="muted" style="margin:0 6px">Označite tekst i odaberite „Odloži” u izborniku Više.</p>');
    const pct = Math.min(100, Math.round(d.words / TASK.min * 100)), sumT = Object.values(S.targets).reduce((a, b) => a + (+b || 0), 0), dueList = d.heads.filter(h => S.dues[h.hid]).map(h => `${dotless(h.num)} ${S.dues[h.hid]}`);
    const days = Math.ceil((new Date(2026, 10, 30) - new Date()) / 864e5), cited = S.sources.filter(s => d.cited[s.id]).length, ses = d.words - (U.startWords == null ? d.words : U.startWords);
    html += sec('Napredak', `<div class="prog"><div><span>Opseg</span><b>${d.words} / ${TASK.min} do ${TASK.max}</b></div><div class="bar"><i style="width:${pct}%"></i></div><div><span>Stranice</span><b>≈ ${Math.max(1, Math.ceil(d.words / 350))}</b></div><div><span>Izvori</span><b>${cited} citirano od ${S.sources.length}</b></div><div><span>Rok predaje</span><b>${TASK.due}${days >= 0 ? ' · ' + days + ' ' + plural(days, 'dan', 'dana', 'dana') : ''}</b></div><div><span>Ove sesije</span><b>${ses >= 0 ? '+' : ''}${ses} riječi</b></div>${sumT ? `<div><span>Zbroj ciljeva poglavlja</span><b>${sumT}</b></div>` : ''}${dueList.length ? `<div><span>Rokovi poglavlja</span><b>${esc(dueList.join(', '))}</b></div>` : ''}</div>`);
    $('#rail').innerHTML = html;
  };
  const coreStatus = X.render.status;
  X.render.status = function () {
    coreStatus();
    const st = $('#status'), first = st.firstElementChild;
    if (U.otherTab) first.innerHTML = '<span class="dot"></span>Otvoreno u drugoj kartici · samo čitanje'; else if (!navigator.onLine) first.innerHTML = '<span class="dot local"></span>Bez mreže · sprema se na ovom uređaju';
    first.insertAdjacentHTML('afterend', '<button data-act="logInfo" title="Što se bilježi">Što se bilježi</button>');
    if (S.mode === 'write' && !S.submitted) st.insertAdjacentHTML('beforeend', '<span class="grow"></span><button data-act="noteSelf" title="Jedna rečenica za sljedeći put">Poruka sebi</button>');
  };

  /* ---------- Kartice ---------- */
  const coreUpute = X.panels.upute, AIP = ['objašnjenje pojma', 'brainstorming', 'jezična dorada', 'prijevod', 'restrukturiranje'];
  X.panels.ai = () => `<div class="ptitle">Asistent <span class="tag">uskoro</span></div><p>Asistent u pilotu nije uključen. Vanjske alate možete koristiti prema čl. 8 i navesti ih u izjavi pri predaji. Kad bude uključen, tekst iz asistenta bilježi se kao „iz AI pomoćnika”, s modelom, vremenom i svrhom.</p><div class="ptitle">Svrha korištenja</div><div class="row">${AIP.map(p => `<span class="chip" style="opacity:.55">${p}</span>`).join('')}</div><input class="in" style="margin-top:12px" placeholder="Pitaj asistenta…" disabled>`;
  X.panels.upute = () => `<div class="ptitle">Zadatak</div><div class="card"><p style="margin:0">Napišite rad od ${TASK.min} do ${TASK.max} riječi s uvodom, razradom, zaključkom i popisom literature. Citirajte prema Uputama FPZG-a: (Prezime, godina: stranica). Dopuštene uporabe (čl. 8): formatiranje, lektura i jezična provjera, traženje literature, transkripcija, prijevod.</p><div class="row" style="margin-top:8px"><button class="lnk" data-act="taskNotice">Ponovno otvori obavijest zadatka</button></div></div>` + coreUpute() + `<div class="ptitle">Što se podcrtava u tekstu · ${LVL[S.level]}</div><button class="lnk" data-act="help">Promijeni pomoć u tekstu</button>`;
  X.panels.nacrt = () => {
    const d = D(), ro = S.mode === 'teacher' || S.submitted, v = S.nacrt;
    let html = `<div class="seg" style="margin-bottom:12px">${[['ro', 'Obrnuti nacrt'], ['nit', 'Nit'], ['poj', 'Pojmovnik']].map(([k, l]) => `<button data-act="nacrt" data-v="${k}" aria-pressed="${v === k}">${l}</button>`).join('')}</div>`;
    if (v === 'ro') {
      html += `<p class="muted">Prva rečenica svakog odlomka. Ako se ovako čita kao argument, odlomci su dobro složeni.</p>`; let any = false;
      ed().state.doc.forEach((n, off) => {
        if (n.type.name === 'heading' && n.attrs.level > 1) html += `<div class="muted" style="margin-top:10px;font-weight:600">${esc(n.textContent)}</div>`;
        else if (n.type.name === 'paragraph' && n.textContent.trim()) { const t = n.textBetween(0, n.content.size, ' ', leafText).trim(), fm = t.match(/^.*?[.!?…](?=\s|$)/), first = fm ? fm[0] : t, w = wc(first); any = true; html += `<button class="ro" data-act="jump" data-pos="${off}">${esc(first.length > 200 ? first.slice(0, 197) + '…' : first)}${w > 35 ? ` <span class="tag warn">Prva rečenica ima ${w} riječi; glavna misao se gubi.</span>` : ''}</button>`; }
      });
      if (!any) html += '<p class="muted">još nema odlomaka</p>';
    } else if (v === 'nit') {
      html += `<p class="muted">Od pitanja do zaključka. Svako poglavlje treba imati svoje mjesto u odgovoru.</p><label class="f">Pitanje rada</label><textarea class="ta" data-bind="S.thesis"${ro ? ' readonly' : ''} placeholder="Pitanje još nije zapisano.">${esc(S.thesis)}</textarea>`;
      d.heads.filter(h => h.level === 2).forEach(h => { html += `<label class="f">${h.num} ${esc(h.title)}</label><input class="in" data-bind="S.purposes.${h.hid}" value="${esc(S.purposes[h.hid] || '')}" placeholder="Svrha nije zapisana · zapišite što poglavlje radi u argumentu"${ro ? ' readonly' : ''}>`; });
      const z = d.heads.find(h => h.level === 2 && /zaklju/i.test(h.title));
      html += `<div class="ptitle">Odgovara li zaključak na pitanje</div>`;
      if (!z || !z.words) html += '<p class="muted">Zaključak još nije napisan.</p>';
      else { const r = secRange(z.hid), zt = ed().state.doc.textBetween(r.start, r.end, ' ').toLowerCase(), keys = [...new Set((S.thesis.toLowerCase().match(/\p{L}{6,}/gu) || []))], yes = keys.filter(k => zt.includes(k.slice(0, 5))), no = keys.filter(k => !zt.includes(k.slice(0, 5))); html += `<p><b>Spominje:</b> ${esc(yes.join(', ') || 'ništa')}</p><p><b>Ne spominje:</b> ${esc(no.join(', ') || 'ništa')}</p><button class="lnk" data-act="jump" data-pos="${z.pos}">Otvori zaključak</button>`; }
      html += `<div class="ptitle">Hipoteze kroz rad</div>` + (X.advice ? X.advice.threadHtml() : '');
    } else {
      html += `<p class="muted">Pojam definirate jednom. Ductura pazi da ga koristite tek nakon definicije i uvijek istim nazivom.</p>`;
      S.glossary.forEach((g, i) => { const gi = (d.gloss || {})[g.term] || { uses: 0, issues: 0, places: [] }, hd = gi.defPos != null ? [...d.heads].reverse().find(h => h.pos <= gi.defPos) : null;
        html += `<div class="card"><h4>${esc(g.term)}</h4><div>${esc(g.def)}</div><div class="meta" style="margin-top:4px"><span>${gi.defPos != null ? 'Definirano u ' + (hd ? dotless(hd.num) || 'uvodnom dijelu' : 'tekstu') : 'U tekstu još bez definicije'}</span><span>${gi.uses}× u tekstu</span>${gi.issues ? `<span class="tag warn">${gi.issues} podcrtano u tekstu</span>` : ''}${(g.variants || []).length ? `<span>ne koristiti: ${esc(g.variants.join(', '))}</span>` : ''}</div><div class="row" style="margin-top:6px">${gi.places.length ? `<button class="lnk" data-act="glossNext" data-i="${i}" title="Sljedeće mjesto u tekstu">Gdje se koristi ›</button>` : ''}${ro ? '' : `<button class="lnk" data-act="glossDel" data-i="${i}" title="Ukloni iz pojmovnika">Ukloni</button>`}</div></div>`; });
      if (!ro) html += U.glossForm ? `<div class="card on"><label class="f">Pojam</label><input class="in" data-bind="glossForm.term" value="${esc(U.glossForm.term)}"><label class="f">Kako se pojam shvaća u ovom radu</label><textarea class="ta" data-bind="glossForm.def">${esc(U.glossForm.def)}</textarea><label class="f">Drugi nazivi koje ne koristite, odvojeni zarezom</label><input class="in" data-bind="glossForm.vars" value="${esc(U.glossForm.vars)}"><div class="row" style="margin-top:8px"><button class="btn pri sm" data-act="glossSave">Dodaj</button><button class="btn sm" data-act="glossCancel">Odustani</button></div></div>` : `<button class="btn sm" data-act="glossNew">+ Novi pojam</button>`;
      if ((d.glossSugg || []).length) html += `<div class="ptitle">Često u tekstu</div><div class="row">${d.glossSugg.map(x => `<button class="chip" data-act="glossNew" data-w="${esc(x.w)}" title="Dodaj u pojmovnik"${ro ? ' disabled' : ''}>${esc(x.w)} · ${x.n}×</button>`).join('')}</div>`;
      if ((d.abbrs || []).length) html += `<div class="ptitle">Kratice</div>${d.abbrs.map(a => `<button class="fx" data-act="jump" data-pos="${a.pos}"><span class="s ${a.ok ? 'ok' : 'warn'}">${a.ok ? '✓' : '!'}</span><span><b>${esc(a.ab)}</b><span class="d">${a.ok ? 'uvedena s punim nazivom' : 'bez punog naziva' + (a.full ? ' · ' + esc(a.full) : '')}</span></span></button>`).join('')}`;
    }
    return html;
  };
  X.hooks.litCard = (s, ro) => {
    const notes = S.rnotes[s.id] || [], open = U.srcOpen === s.id;
    let h = `<div class="row" style="margin-top:6px"><button class="lnk" data-act="copyCite" data-id="${esc(s.id)}">Kopiraj navod</button><button class="lnk" data-act="srcOpen" data-id="${esc(s.id)}">${notes.length ? notes.length + ' ' + plural(notes.length, 'bilješka', 'bilješke', 'bilježaka') : 'Bilješke'} ${open ? '▴' : '▾'}</button></div>`;
    if (open) h += `<div class="rn"><p class="muted">PDF nije priložen. Kad priložite PDF izvora, ovdje se prikazuje sama stranica.</p>${notes.map(n => `<div class="rnote" draggable="${ro ? 'false' : 'true'}" data-drag="${esc(s.id)}|${n.id}" title="Povucite u tekst ili odaberite Umetni"><div class="muted">str. ${esc(n.page)}</div><div>${esc(n.text)}</div>${ro ? '' : `<div class="row"><button class="lnk" data-act="noteQuote" data-id="${esc(s.id)}" data-n="${n.id}">Umetni kao citat</button><button class="lnk" data-act="citeIns2" data-id="${esc(s.id)}" data-page="${esc(n.page)}">Samo navod</button><button class="lnk" data-act="noteDel" data-id="${esc(s.id)}" data-n="${n.id}">Obriši</button></div>`}</div>`).join('') || '<p class="muted">Za ovaj izvor nemate bilježaka.</p>'}${ro ? '' : (U.noteForm === s.id ? `<textarea class="ta" id="rnText" placeholder="Citat ili Vaša bilješka iz izvora"></textarea><div class="row" style="margin-top:6px"><input class="in" id="rnPage" style="width:90px" placeholder="str."><button class="btn pri sm" data-act="noteSave" data-id="${esc(s.id)}">Spremi</button><button class="btn sm" data-act="noteCancel">Odustani</button></div>` : `<button class="btn sm" data-act="noteNew" data-id="${esc(s.id)}">+ Bilješka iz čitanja</button>`)}</div>`;
    return h;
  };
  X.hooks.litExtra = () => {
    const d = D(), h2 = d.heads.filter(h => h.level === 2); if (!h2.length) return '';
    return `<div class="ptitle">Izvori po poglavljima</div>` + h2.map(h => { const end = headEnd(h), ids = S.sources.filter(s => (d.citePos[s.id] || []).some(p => p >= h.pos && p < end)); return `<div class="fx"><span><b>${h.num} ${esc(h.title)}</b><span class="d">${ids.length ? esc(ids.map(s => `${s.authors} (${yearLabel(s)})`).join(', ')) : 'nema navoda'}</span></span></div>`; }).join('') + `<p class="muted">Popis literature slaže se iz citiranih izvora. Bilješku povucite u tekst: upiše se kao citat s navodom i stranicom.</p>`;
  };
  X.hooks.atItems = s => (S.rnotes[s.id] || []).map(n => ({ label: `${s.authors} (${yearLabel(s)}), str. ${n.page}`, hint: n.text.slice(0, 26) + '…', run: () => insertCitation(s.id, n.page) }));
  X.hooks.cmds.push(['tablica', 'Tablica', 's brojem i izvorom', () => ACT.insPrikaz({ dataset: { kind: 'tablica' } })], ['slika', 'Slika', 's brojem, naslovom i izvorom', () => ACT.insPrikaz({ dataset: { kind: 'slika' } })], ['fusnota', 'Fusnota', 'objašnjenje na dnu', () => ACT.insFn()], ['ref', 'Unakrsna referenca', 'poglavlje, tablica, slika', () => ACT.insXref()]);

  function prepText() {
    const d = D(), base = (S.points.find(p => p.kons) || {}).blocks || S.review.snapshot || [], cur = blocksText(), changed = cur.filter(b => !base.includes(b)).length, res = S.comments.filter(c => c.resolved).length, open = S.comments.filter(c => !c.resolved);
    return `Priprema za konzultacije\nOd konzultacija ${S.koWhen} · izmijenjeno odlomaka: ${changed} · riješeni komentari: ${res}\n\nOd dogovorenog:\n${S.tasks.map(t => (t.done ? '✓ ' : '○ ') + t.t).join('\n')}\n\nOtvoreni komentari: ${open.length}\n${open.map(c => `#${c.n} ${c.text}`).join('\n')}\n\nOpseg: ${d.words} riječi · rupe: ${d.holes.length}\n\nŠto trebam od mentora:\n`;
  }
  X.panels.rad = () => {
    const T = S.mode === 'teacher', ro = T || S.submitted, a = S.ai, aw = wc(S.abs), sw = wc(S.sum), allPrev = i => S.stages.slice(0, i).every(s => s.st === 'ok'), ai = X.aiText();
    const stage = (s, i) => { let act = ''; if (!T && !S.submitted) { if (s.st === 'no' && allPrev(i)) act = `<button class="btn sm" data-act="stageSub" data-i="${i}">Predaj etapu</button>`; else if (s.st === 'back') act = `<button class="btn sm" data-act="stageSub" data-i="${i}">Predaj ponovno</button>`; } else if (T && s.st === 'sub') act = `<button class="btn sm" data-act="stageOk" data-i="${i}">Odobri</button><button class="btn sm" data-act="stageBack" data-i="${i}">Vrati s napomenom</button>`;
      return `<div class="stg ${s.st}"><span class="b">${s.st === 'ok' ? '✓' : ''}</span><span>${esc(s.n)}</span><span class="grow"></span><span class="muted">${s.st === 'ok' ? 'odobreno ' + (s.d || '') : s.st === 'sub' ? 'predano, čeka mentora' : s.st === 'back' ? 'vraćeno s napomenom' : ''}</span></div>${s.st === 'back' && s.note ? `<div class="muted" style="margin:0 0 4px 26px">${esc(s.note)}</div>` : ''}${act ? `<div class="row" style="margin:0 0 6px 26px">${act}</div>` : ''}`; };
    return `<div class="ptitle">Etape</div><p class="muted">Mentor: Nastavnik A. Mentor dobiva obavijest, a tekst se sprema kao točka u povijesti rada.</p>${S.stages.map(stage).join('')}
      <div class="ptitle">Dogovoreno na konzultacijama · ${esc(S.koWhen)}</div>${S.tasks.map((t, i) => `<label class="check"><input type="checkbox" data-task="${i}"${t.done ? ' checked' : ''}${S.submitted ? ' disabled' : ''}><span${t.done ? ' style="text-decoration:line-through;color:var(--ink-3)"' : ''}>${esc(t.t)}</span></label>`).join('')}${T ? '<button class="lnk" data-act="taskAdd">+ Dodaj dogovor</button>' : ''}
      <div class="ptitle">Priprema za konzultacije</div>${S.prep != null ? `<textarea class="ta" rows="9" data-bind="S.prep">${esc(S.prep)}</textarea><div class="row" style="margin-top:6px"><button class="btn pri sm" data-act="prepSend">Pošalji mentoru</button><button class="btn sm" data-act="prepCopy">Kopiraj</button><button class="lnk" data-act="prepMake">Složi ponovno</button></div>` : `<p class="muted">Ductura složi što ste napravili od zadnjih konzultacija, što je od dogovorenog gotovo i što je otvoreno.</p>${T ? '' : '<button class="btn sm" data-act="prepMake">Složi iz rada</button>'}`}
      <div class="ptitle">Sažetak i Summary</div><p class="muted">Prijedlog: 150 do 300 riječi i 3 do 5 ključnih riječi. Na kraju rada, iza priloga.</p><textarea class="ta" rows="4" data-bind="S.abs" data-count="absN" placeholder="Sažetak na hrvatskom"${ro ? ' readonly' : ''}>${esc(S.abs)}</textarea><div class="muted"><span id="absN">${aw}</span> riječi</div><input class="in" style="margin-top:6px" data-bind="S.kw" value="${esc(S.kw)}" placeholder="Ključne riječi, odvojene zarezom"${ro ? ' readonly' : ''}>
      <textarea class="ta" rows="4" style="margin-top:10px" data-bind="S.sum" data-count="sumN" placeholder="Summary in English"${ro ? ' readonly' : ''}>${esc(S.sum)}</textarea><div class="muted"><span id="sumN">${sw}</span> riječi</div><input class="in" style="margin-top:6px" data-bind="S.kwEn" value="${esc(S.kwEn)}" placeholder="Keywords, comma separated"${ro ? ' readonly' : ''}>
      <div class="ptitle">Uz rad</div>
      <div class="fx"><span style="flex:1"><b>Uvoz postojećeg teksta</b><span class="d">${S.imported ? 'Uvezeno ' + S.imported + ' riječi, označeno kao uvezeno.' : 'Tekst napisan prije Ducture dobiva oznaku uvezeno i Vašu izjavu.'}</span></span>${ro ? '' : '<button class="btn sm" data-act="impText">Uvezi</button>'}</div>
      <div class="fx"><span style="flex:1"><b>Izjava o korištenju AI-ja</b><span class="d">${ai ? 'Spremljeno, ide u Prilog rada.' : 'Još nije ispunjena.'}</span></span></div>
      <label class="check"><input type="checkbox" data-bind="S.ai.none"${a.none ? ' checked' : ''}${ro ? ' disabled' : ''}><span>Nisam koristio/la alate umjetne inteligencije</span></label>
      ${a.none ? '' : `<label class="f">Alati koje ste koristili izvan Ducture</label><input class="in" data-bind="S.ai.tools" value="${esc(a.tools)}" placeholder="Npr. ChatGPT, DeepL. Prazno ako niste koristili nijedan."${ro ? ' readonly' : ''}><label class="f">Svrha</label><div class="row">${[...new Set(['provjera pravopisa', 'prijevod izvora', 'pretraživanje literature', 'sažimanje izvora', ...AIP])].map(p => `<button class="chip${a.purposes.includes(p) ? ' done' : ''}" data-act="aiPurp" data-v="${p}"${ro ? ' disabled' : ''}>${a.purposes.includes(p) ? '✓ ' : ''}${p}</button>`).join('')}</div>`}
      ${ai ? `<div class="q" style="margin-top:8px">${esc(ai)}</div>` : ''}
      <div class="fx" style="margin-top:8px"><span style="flex:1"><b>Predajni paket</b><span class="d">${S.submitted ? 'Rad je predan ' + esc(S.submitted.when) + '.' : 'Rad, sažetak, izjava i autorska putovnica na jednom mjestu.'}</span></span><button class="btn sm" data-act="paket">Otvori</button></div>
      <div class="fx"><span style="flex:1"><b>Povijest rada</b><span class="d">${S.points.length} ${plural(S.points.length, 'spremljena točka', 'spremljene točke', 'spremljenih točaka')}</span></span><button class="btn sm" data-act="history">Otvori</button></div>
      <div class="ptitle">Predaja</div><div class="row">${S.submitted ? '<button class="btn sm" data-act="receipt">Potvrda o predaji</button>' : `<button class="btn pri" data-act="submit"${T ? ' disabled' : ''}>Predaj rad</button>`}<button class="btn sm" data-act="menu-export">Izvezi ▾</button></div>
      <div class="ptitle">Prototip</div><p class="muted">Sve se čuva samo u ovom pregledniku. Učitavanje primjera briše sadašnji tekst.</p><div class="row"><button class="btn sm" data-act="loadSample" data-f="diplomski">Učitaj diplomski rad</button><button class="btn sm" data-act="newWork">Novi prazan rad</button><button class="lnk" data-act="reset">Vrati početni primjer</button></div>`;
  };

  /* ---------- Dijalozi ---------- */
  function ask(o, cb) { U.askCb = cb; openDlg(Object.assign({ type: 'ask' }, o)); setTimeout(() => { const f = $('#askV'); if (f) { f.focus(); if (f.select && !o.multi) f.select(); } }, 30); }
  const foot = (ok, okAct, extra) => `<div class="foot">${extra || ''}<button class="btn" data-act="dlgClose">${ok ? 'Odustani' : 'Zatvori'}</button>${ok ? `<button class="btn pri" data-act="${okAct}">${ok}</button>` : ''}</div>`;
  X.hooks.dlg.ask = d => `<h3>${esc(d.title)}</h3>${d.desc ? `<p class="muted">${esc(d.desc)}</p>` : ''}${d.noField ? '' : `<label class="f">${esc(d.label || '')}</label>${d.multi ? `<textarea class="ta" id="askV" rows="4" placeholder="${esc(d.ph || '')}">${esc(d.value || '')}</textarea>` : `<input class="in" id="askV" value="${esc(d.value || '')}" placeholder="${esc(d.ph || '')}">`}`}${foot(d.ok || 'Spremi', 'askOk')}`;
  X.hooks.dlg.help = () => `<h3>Što Ductura podcrtava dok pišete</h3><p class="muted">Podcrtano nije greška nego mjesto za pogledati; objašnjenje dobijete klikom na podcrtani tekst.</p><div class="seg" style="margin:10px 0">${Object.keys(LVL).map(k => `<button data-act="level" data-v="${k}" aria-pressed="${S.level === k}">${LVL[k]}</button>`).join('')}</div>${WARN.map(([k, t, dsc]) => `<label class="check"><input type="checkbox" data-warn="${k}"${S.warn[k] ? ' checked' : ''}><span><b>${t}</b> <span class="muted">${dsc}${(D().cnt || {})[k] ? ' · u tekstu: ' + D().cnt[k] : ''}</span></span></label>`).join('')}${foot()}`;
  X.hooks.dlg.prikaz = d => `<h3>${d.kind === 'tablica' ? 'Tablica' : 'Slika'}</h3><p class="muted">${esc(RULES.fig.why)}</p><label class="f">Naslov (ide iznad prikaza)</label><input class="in" data-bind="dlg.title" value="${esc(d.title)}"><label class="f">Izvor (ide ispod prikaza)</label><input class="in" data-bind="dlg.source" value="${esc(d.source)}" placeholder="npr. izrada autora">${d.kind === 'tablica' ? `<label class="f">Ćelije: svaki redak u novi red, stupci odvojeni znakom |. Prvi redak je zaglavlje.</label><textarea class="ta mono" rows="6" data-bind="dlg.cells">${esc(d.cells)}</textarea>` : `<label class="f">Slika (do 400 KB)</label><input type="file" class="in" id="pkFile" accept="image/*">${d.img ? `<img src="${esc(d.img)}" alt="" style="max-width:100%;max-height:160px;margin-top:8px;display:block">` : ''}`}${foot('Spremi', 'pkSave', '<button class="lnk" data-act="pkDel" style="margin-right:auto">Ukloni prikaz</button>')}`;
  X.hooks.dlg.quick = d => `<h3>Brzi izvor</h3><p class="muted">U aplikaciji se podaci upisuju sami iz DOI-ja ili ISBN-a. U prototipu ih upišite ručno.</p><label class="f">DOI, ISBN ili poveznica</label><input class="in" data-bind="dlg.ident" value="${esc(d.ident)}"><label class="f">Vrsta</label><select class="in" data-bind="dlg.kind">${['knjiga', 'članak', 'poglavlje u knjizi', 'mrežni izvor', 'institucijski autor'].map(k => `<option${d.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select><label class="f">Autor u navodu</label><input class="in" data-bind="dlg.authors" value="${esc(d.authors)}"><label class="f">Autori u literaturi</label><input class="in" data-bind="dlg.full" value="${esc(d.full)}" placeholder="Prezime, Ime; Prezime, Ime"><label class="f">Godina</label><input class="in" inputmode="numeric" data-bind="dlg.year" value="${esc(d.year)}"><label class="f">Naslov</label><input class="in" data-bind="dlg.title" value="${esc(d.title)}"><label class="f">Izdanje (nakladnik ili časopis)</label><input class="in" data-bind="dlg.pub" value="${esc(d.pub)}"><div class="foot"><button class="btn" data-act="dlgClose">Odustani</button><button class="btn" data-act="quickAdd">Samo u Literaturu</button><button class="btn pri" data-act="quickAdd" data-cite="1">Dodaj i citiraj</button></div>`;
  X.hooks.dlg.imptext = d => `<h3>Uvoz postojećeg teksta</h3><p class="muted">Tekst napisan prije Ducture dobiva oznaku uvezeno, vrijeme uvoza i Vašu izjavu. Mentor ga vidi kao uvezen, a ne kao tekst nepoznatog podrijetla.</p><textarea class="ta" rows="7" id="itBody" placeholder="Zalijepite tekst. Odlomke odvojite praznim retkom."></textarea><label class="f">Ili datoteka (.txt)</label><input type="file" class="in" id="itFile" accept=".txt,.md"><label class="check" style="margin-top:10px"><input type="checkbox" data-bind="dlg.agree" data-rerender="keep"${d.agree ? ' checked' : ''}><span>Potvrđujem da je ovo moj tekst, nastao prije prelaska na Ducturu.</span></label>${foot('Uvezi na kraj rada', 'impTextDo')}`;
  function passport() { return S.submitted && /^sha256:/.test(S.submitted.hash) ? 'DUC-' + S.submitted.hash.slice(7, 19).toUpperCase().replace(/(.{4})(?=.)/g, '$1-') : ''; }
  X.hooks.dlg.paket = () => {
    const d = D(), aw = wc(S.abs), ok = '<span class="s ok">✓</span>', wn = '<span class="s warn">!</span>', bl = '<span class="s block">!</span>', r = S.review;
    const row = (st, t, dsc, btn) => `<div class="fx">${st}<span style="flex:1"><b>${t}</b><span class="d">${dsc}</span></span>${btn || ''}</div>`;
    return `<h3>Predajni paket</h3>` + row(d.holes.length ? bl : ok, 'Rad (.docx)', d.holes.length ? 'Prvo popunite rupe.' : 'po kućnom stilu FPZG-a, slaže se pri predaji', caps.downloads ? '<button class="btn sm" data-act="docx">Preuzmi</button>' : '') + row(aw >= 150 && aw <= 300 && S.sum.trim() ? ok : wn, 'Sažetak i Summary', aw ? aw + ' riječi' + (S.sum.trim() ? '' : ', Summary nedostaje') : 'Nije upisano', '<button class="lnk" data-act="goRad">Upiši</button>') + row(X.aiText() ? ok : wn, 'Izjava o AI-ju', X.aiText() ? 'u Prilogu' : 'Nije ispunjena') + row(r.status === 'accepted' ? ok : wn, 'Odobrenje mentora', r.status === 'accepted' ? 'rad je prihvaćen' : r.status === 'review' ? 'dorada čeka pregled' : 'dorada je zatražena') +
      `<div class="ptitle">Autorska putovnica</div>${S.submitted ? `<div class="receipt"><div class="mono" style="font-size:16px">${passport()}</div><p class="muted" style="margin:6px 0 0">Kod potvrđuje da je rad nastao u Ducturi i da se predani tekst nije mijenjao. Provjerava se bez prijave.</p></div>` : '<p class="muted">Kod putovnice nastaje pri predaji.</p>'}<p class="muted">Žute stavke ne sprječavaju predaju.</p>${foot(S.submitted ? '' : 'Nastavi na predaju', 'submit')}`;
  };
  X.hooks.dlg.history = d => `<h3>Povijest rada</h3><p class="muted">Spremljene točke. Točka nastaje sama pri predaji etape, slanju dorade i predaji rada.</p>${S.mode === 'write' && !S.submitted ? '<button class="btn sm" data-act="pointSave">Spremi točku</button>' : ''}<div style="margin-top:8px">${S.points.map((p, i) => `<div class="fx"><span style="flex:1"><b>${esc(p.name)}</b><span class="d">${esc(p.when)} · ${p.words} riječi</span></span><button class="lnk" data-act="pointCmp" data-i="${i}">Usporedi sa sadašnjim</button>${S.mode === 'write' && !S.submitted ? `<button class="lnk" data-act="pointBack" data-i="${i}">${d.confirm === i ? 'Potvrdi vraćanje' : 'Vrati'}</button>` : ''}</div>`).join('') || '<p class="muted">Još nema spremljenih točaka.</p>'}</div>${foot()}`;
  X.hooks.dlg.send = () => { const c = S.comments, n = k => c.filter(k).length; return `<h3>Pošalji doradu na pregled</h3><div class="ptitle">Što je promijenjeno</div><p>${blocksText().join('\n') === (S.review.snapshot || []).join('\n') ? 'Tekst nije mijenjan' : 'Tekst je mijenjan od zadnjeg pregleda'} · Riješeni komentari: ${n(x => x.resolved)} · Prihvaćeni prijedlozi: ${n(x => x.sugg && x.sugg.state === 'accepted')} · Odbijeni prijedlozi: ${n(x => x.sugg && x.sugg.state === 'rejected')} · Još otvoreno: ${n(x => !x.resolved)}</p><label class="f">Poruka mentoru (neobavezno): što ste promijenili i zašto</label><textarea class="ta" id="sendMsg" rows="3"></textarea><p class="muted">Mentor će vidjeti što se promijenilo od njegova pregleda. Možete nastaviti pisati; promjene ulaze u sljedeći pregled.</p>${foot('Pošalji', 'sendDo')}`; };
  X.hooks.dlg.loginfo = () => `<h3>Što se bilježi</h3><div class="fx"><span><b>Spremljeni koraci</b><span class="d">Tekst se sprema u koracima. Uz svaki korak bilježi se vrijeme na minutu i sažetak stanja teksta.</span></span></div><div class="fx"><span><b>Podrijetlo teksta</b><span class="d">Lijepljenje, uvoz postojećeg teksta i Vaša izjava o alatima.</span></span></div><div class="fx"><span><b>Što vidi nastavnik</b><span class="d">Spremljeno stanje teksta, komentare, povijest verzija i isti sažetak procesa koji vidite i Vi.</span></span></div><div class="fx"><span><b>Što se ne bilježi</b><span class="d">Pojedinačni unosi tipkovnicom i ritam pisanja.</span></span></div><p class="muted">Prema važećim odlukama u repou (D-24, D-56). Zapis svakog unosa i istraga iz Editora v11 ostaju prijedlog i ovdje nisu ugrađeni. U prototipu se ništa ne šalje na poslužitelj.</p>${foot()}`;
  X.hooks.dlg.notice = () => `<h3>Prije prve rečenice</h3><div class="card"><h4>${TASK.course} / ${TASK.title}</h4><div class="muted">Rok ${TASK.due} · opseg ${TASK.min} do ${TASK.max} riječi</div></div><p>Pišete samo u Ducturi. Dopuštene uporabe alata (čl. 8): formatiranje, lektura i jezična provjera, traženje literature, transkripcija, prijevod.</p><p class="muted">Potvrda nije privola. Tekst čl. 8 u aplikaciji ide doslovno iz Pravilnika.</p>${foot()}`;
  const ONB = [['Navod s @', 'Upišite @ i početak prezimena autora. Ductura ponudi izvore iz literature, a Enter umeće navod.'], ['Naredbe s /', 'Upišite / za tablicu, sliku, fusnotu, frazu ili rupu koju ćete popuniti kasnije.'], ['Pomoć u tekstu', 'U izborniku Prikaz birate koliko Vam Ductura pomaže u tekstu, tamni ili bijeli list i stil citiranja.']];
  X.hooks.dlg.onb = d => `<p class="muted">Prvi koraci · ${d.i + 1} od 3</p><h3>${ONB[d.i][0]}</h3><p>${ONB[d.i][1]}</p><div class="foot"><button class="btn" data-act="onbEnd">Preskoči</button><button class="btn pri" data-act="${d.i < 2 ? 'onbNext' : 'onbEnd'}">${d.i < 2 ? 'Dalje' : 'Počni pisati'}</button></div>`;
  X.hooks.dlg.print = () => {
    const d = D(), title = (d.heads.find(h => h.level === 1) || {}).title || 'Bez naslova', body = $('#ed .ProseMirror').innerHTML, cited = S.sources.filter(s => d.cited[s.id]).sort((a, b) => a.full.localeCompare(b.full, 'hr'));
    return `<h3>Pregled ispisa</h3><p class="muted">A4 po FPZG-u: Times New Roman 12, prored 1,5, margine 2,5 cm. Stranice slaže Word pri izvozu.</p><div class="a4"><div class="a4p cover"><div>Sveučilište u Zagrebu<br>Fakultet političkih znanosti</div><div class="ct">${esc(title)}</div><div>${TASK.kind}</div><div>Student A<br>${TASK.course}<br>Zagreb, 2026.</div></div><div class="a4p"><h2>Sadržaj</h2>${d.heads.filter(h => h.level > 1).map(h => `<div class="${h.level === 3 ? 'i' : ''}">${h.num} ${esc(h.title)}</div>`).join('')}<div>Literatura</div></div><div class="a4p">${body}${(d.fns || []).length ? '<hr>' + d.fns.map((f, i) => `<p class="f10"><sup>${i + 1}</sup> ${esc(f.text)}</p>`).join('') : ''}<h2>Literatura</h2>${cited.map(s => `<p class="hang">${X.bibEntry(s)}</p>`).join('')}${S.abs ? `<h2>Sažetak</h2><p>${esc(S.abs)}</p><p><b>Ključne riječi:</b> ${esc(S.kw)}</p>` : ''}${S.sum ? `<h2>Summary</h2><p>${esc(S.sum)}</p><p><b>Keywords:</b> ${esc(S.kwEn)}</p>` : ''}</div></div>${foot('', '', caps.downloads ? '<button class="btn pri" data-act="docx" style="margin-right:auto">Preuzmi Word (.docx)</button>' : '')}`;
  };

  /* ---------- Radnje ---------- */
  const chain = () => ed().chain().focus();
  function curBlock() { const $f = ed().state.selection.$from; if ($f.depth < 1) return null; return { pos: $f.before(1), node: $f.node(1), after: $f.after(1) }; }
  function curChapter() { const sel = ed().state.selection.from; let h = null; D().heads.forEach(x => { if (x.level > 1 && x.pos <= sel) h = x; }); return h; }
  function savePoint(name, extra) { S.points.unshift(Object.assign({ id: uid('pt'), name, when: now(), words: D().words, doc: ed().getJSON(), blocks: blocksText() }, extra)); if (S.points.length > 10) S.points.length = 10; persist(); }
  function editPrikaz(pos) { const n = ed().state.doc.nodeAt(pos); if (!n) return; const a = n.attrs; openDlg({ type: 'prikaz', pos, kind: a.kind, title: a.title, source: a.source, cells: (a.rows || []).map(r => r.join(' | ')).join('\n'), img: a.img }); }
  const pop = (el, html) => openPop(html, el.getBoundingClientRect ? el.getBoundingClientRect() : ed().view.coordsAtPos(ed().state.selection.from), 'menu');
  const mi = (act, label, hint, extra) => `<button class="mi" data-act="${act}"${extra || ''}><span>${label}</span><small>${hint || ''}</small></button>`;
  Object.assign(ACT, {
    loadSample: async el => {
      if (U.loadAsk !== el.dataset.f) { U.loadAsk = el.dataset.f; return toast('Kliknite još jednom: sadašnji tekst u prototipu bit će zamijenjen.'); }
      try {
        const r = await fetch('samples/' + el.dataset.f + '.json'), j = await r.json(), n = X.fresh(); X.hooks.defaults.forEach(f => f(n));
        Object.assign(n, { theme: S.theme, sheet: S.sheet, citeStyle: S.citeStyle, warn: S.warn, level: S.level, onb: 1, tab: 'lit', sources: j.sources, thesis: j.thesis || '', abs: j.abs, kw: j.kw, sum: j.sum, kwEn: j.kwEn, stash: [], rnotes: {}, seeds: j.seeds || [],
          glossary: [{ term: 'deindustrijalizacija', def: 'Ključni pojam rada, određen u potpoglavlju 2.3.', variants: [] }, { term: 'brownfield', def: 'Napušteni industrijski ili vojni prostor.', variants: [] }],
          task: { course: 'Diplomski rad', title: 'Politologija', due: '30. 11. 2026.', min: 10000, max: 12000, kind: 'Diplomski rad', minRefs: 15, minBooks: 3, profile: 'fpzg-politologija-diplomski' }, profileId: 'fpzg-politologija-diplomski', seedMentor: [[0, '12. 11.'], [1, '12. 11.', 1], [2, '12. 11.'], [3, '12. 11.']], seedMeta: { statuses: [2, 2, 2, 2, 1, 1, 1, 0, 0], targets: [1200, 2400, 1600, 1800, 2600, 2000, 2200, 1800, 900] } });
        n.review.req.text = 'Empirijska poglavlja su dobro razrađena. U raspravi izravnije povežite nalaze s hipotezama i riješite označene komentare.';
        X.store.save({ doc: j.doc, S: n }); location.reload();
      } catch (e) { toast('Primjer se nije mogao učitati.'); }
    },
    askOk: () => { const f = $('#askV'), v = f ? f.value : '', cb = U.askCb; U.askCb = null; closeDlg(); if (cb) cb(v); },
    'menu-ins': el => pop(el, `<div class="mh">Umetni</div>${mi('insPrikaz', 'Tablica', 's brojem i izvorom', ' data-kind="tablica"')}${mi('insPrikaz', 'Slika', 's brojem, naslovom i izvorom', ' data-kind="slika"')}${mi('insFn', 'Fusnota', 'objašnjenje na dnu')}${mi('insXref', 'Unakrsna referenca', 'poglavlje, tablica, slika')}${mi('insVar', 'Inačica odlomka', 'dodaj još jednu')}`),
    'menu-conv': el => { const b = curBlock(), v = b && b.node.attrs.vg; pop(el, `<div class="mh">Pretvori</div>${mi('toQuote', 'Označeno u blok-citat', 'uvučeno, bez navodnika')}${mi('fromQuote', 'Blok-citat u odlomak', 'vraća navodnike')}${mi('toFn', 'Označeno u fusnotu', '')}${v ? `<div class="mh">Inačice</div>${mi('varKeep', 'Zadrži samo ovu inačicu', 'ostale se brišu')}${mi('varAsk', 'Pitaj mentora koja je bolja', '')}` : ''}`); },
    'menu-more': el => pop(el, `<div class="mh">Više</div>${mi('stash', 'Odloži', 'označeni tekst')}${caps.tts ? mi('readAloud', U.reading ? '■ Zaustavi čitanje' : 'Čitaj naglas', 'odlomak s kursorom') : ''}${caps.dictation ? mi('dictate', U.dict ? '■ Zaustavi diktiranje' : 'Diktiraj', 'pišite govorom') : ''}${mi('bars', 'Oblik rečenica', 'duljine u odlomku')}${mi('sentUp', 'Rečenica gore', 'Alt+↑')}${mi('sentDown', 'Rečenica dolje', 'Alt+↓')}${mi('findOpen', 'Traži i zamijeni', 'Ctrl+F')}${mi('noteSelf', 'Poruka sebi', '')}`),
    'menu-export': el => pop(el, `<div class="mh">Izvezi</div>${caps.downloads ? mi('docx', 'Word (.docx)', 'kućni stil FPZG') : '<div class="pad muted">Preuzimanje .docx radi u objavljenom artefaktu.</div>'}${mi('print', 'Pregled ispisa', 'A4 po FPZG-u')}${mi('copy', 'Kopiraj tekst rada', '')}`),
    'menu-view': el => { const o = (g, v, l) => mi('setView', l, S[g] === v ? '✓' : '', ` data-g="${g}" data-v="${v}"`); pop(el, `${mi('help', 'Pomoć u tekstu', LVL[S.level])}<div class="mh">List</div>${o('sheet', 'light', 'Bijeli')}${o('sheet', 'dark', 'Tamni')}<div class="mh">Ljuska</div>${o('theme', 'dark', 'Tamna')}${o('theme', 'light', 'Svijetla')}<div class="mh">Stil citiranja</div>${o('citeStyle', 'fpzg', 'FPZG')}${o('citeStyle', 'apa', 'APA')}${o('citeStyle', 'chicago', 'Chicago')}<div class="mh">Prikaz</div>${mi('tocToggle', 'Sadržaj na listu', S.toc ? '✓' : '')}${mi('diff', 'Promjene od predaje mentoru', '')}${mi('history', 'Povijest rada', '')}${mi('print', 'Pregled ispisa', 'A4 po FPZG-u')}${mi('firstLines', 'Prvi redovi', '')}${mi('railToggle', 'Struktura', 'Ctrl+\\')}`); },
    help: () => openDlg({ type: 'help' }),
    level: el => { S.level = el.dataset.v; if (LEVELS[S.level]) WARN.forEach(w => { S.warn[w[0]] = LEVELS[S.level].includes(w[0]); }); refresh(); persist(); renderDlg(); renderPanel(true); },
    tocToggle: () => { S.toc = !S.toc; closePop(); persist(); renderAll(); }, firstLines: () => { closePop(); S.nacrt = 'ro'; showTab('nacrt'); },
    railToggle: () => { closePop(); if (innerWidth <= 1250) ACT.rail(); else $('#app').classList.toggle('norail'); },
    jumpBib: () => $('#bib').scrollIntoView({ behavior: 'smooth' }), goRad: () => { closeDlg(); showTab('rad'); }, print: () => openDlg({ type: 'print', wide: true }),
    logInfo: () => openDlg({ type: 'loginfo' }), taskNotice: () => openDlg({ type: 'notice' }), paket: () => openDlg({ type: 'paket' }), history: () => openDlg({ type: 'history' }),
    onbNext: () => { U.dlg.i++; renderDlg(); }, onbEnd: () => { S.onb = 1; persist(); closeDlg(); },
    nacrt: el => { S.nacrt = el.dataset.v; persist(); renderPanel(true); }, openGloss: () => { closePop(); S.nacrt = 'poj'; showTab('nacrt'); },
    // umetanje
    insPrikaz: el => { closePop(); const b = curBlock(); if (!b) return; const kind = el.dataset.kind; chain().insertContentAt(b.after, { type: 'prikaz', attrs: { kind, title: '', source: kind === 'tablica' ? 'izrada autora' : '', rows: kind === 'tablica' ? [['', ''], ['', '']] : [], img: '' } }).run(); setTimeout(() => editPrikaz(b.after), 30); },
    pkSave: () => { const d = U.dlg, n = ed().state.doc.nodeAt(d.pos); if (!n) return closeDlg(); const rows = d.kind === 'tablica' ? d.cells.split('\n').filter(l => l.trim()).map(l => l.split('|').map(c => c.trim())) : []; ed().view.dispatch(ed().state.tr.setNodeMarkup(d.pos, null, { ...n.attrs, title: d.title.trim(), source: d.source.trim(), rows, img: d.img })); closeDlg(); },
    pkDel: () => { const d = U.dlg; ed().view.dispatch(ed().state.tr.delete(d.pos, d.pos + 1)); closeDlg(); },
    insFn: () => { closePop(); ask({ title: 'Fusnota', label: 'Tekst fusnote (samo objašnjenje, bez citiranja)', multi: true, ok: 'Umetni' }, v => { if (v.trim()) chain().insertContent({ type: 'footnote', attrs: { text: v.trim() } }).run(); }); },
    fnEdit: () => { const pos = +$('#pop').dataset.pos, n = ed().state.doc.nodeAt(pos); closePop(); ask({ title: 'Fusnota', label: 'Tekst fusnote (samo objašnjenje, bez citiranja)', multi: true, value: n.attrs.text }, v => ed().view.dispatch(ed().state.tr.setNodeMarkup(pos, null, { text: v.trim() }))); },
    leafDel: () => { const pos = +$('#pop').dataset.pos; closePop(); if (pos >= 0) ed().view.dispatch(ed().state.tr.delete(pos, pos + 1)); },
    insXref: () => { const d = D(), pk = d.prikazi || [], it = (k, t, l) => mi('xrefIns', l, '', ` data-kind="${k}" data-target="${esc(t)}"`), r = ed().view.coordsAtPos(ed().state.selection.from); openPop(`<div class="mh">Unakrsna referenca</div><div class="pad muted">Broj se sam mijenja kad premjestite poglavlje, tablicu ili sliku.</div><div class="mh">Poglavlja</div>${d.heads.filter(h => h.level > 1).map(h => it('h', h.hid, `${h.num} ${esc(h.title)}`)).join('')}${pk.length ? '<div class="mh">Prikazi</div>' + pk.map(p => it(p.kind === 'tablica' ? 't' : 's', p.pid, `${p.kind === 'tablica' ? 'Tablica' : 'Slika'} ${p.n}. ${esc(p.title)}`)).join('') : ''}`, r, 'menu'); },
    xrefIns: el => { closePop(); chain().insertContent([{ type: 'xref', attrs: { kind: el.dataset.kind, target: el.dataset.target } }, { type: 'text', text: ' ' }]).run(); },
    insVar: () => { closePop(); const b = curBlock(); if (!b || b.node.type.name !== 'paragraph' || !b.node.textContent.trim()) return toast('Postavite kursor u odlomak s tekstom.'); const vg = b.node.attrs.vg || uid('v'), tr = ed().state.tr; tr.setNodeMarkup(b.pos, null, { ...b.node.attrs, vg }); tr.insert(b.after, b.node.type.create({ ...b.node.attrs, vg }, b.node.content)); ed().view.dispatch(tr); toast('Nova inačica je ispod. Pišite je drukčije pa odaberite bolju.'); },
    varKeep: () => { closePop(); const b = curBlock(), vg = b && b.node.attrs.vg; if (!vg) return; const tr = ed().state.tr, del = []; ed().state.doc.forEach((n, off) => { if (n.attrs.vg === vg && off !== b.pos) del.push([off, off + n.nodeSize]); }); tr.setNodeMarkup(b.pos, null, { ...b.node.attrs, vg: null }); del.reverse().forEach(r => tr.delete(r[0], r[1])); ed().view.dispatch(tr); toast('Zadržana je prikazana inačica. Ostale su obrisane.'); },
    varAsk: () => { closePop(); const b = curBlock(); if (!b) return; ed().commands.setTextSelection({ from: b.pos + 1, to: b.after - 1 }); X.startComment(); if (U.draft) { U.draft.text = 'Pitanje mentoru: koja je inačica ovog odlomka bolja?'; renderPanel(true); } },
    toQuote: () => { closePop(); const s = ed().state.selection, doc = ed().state.doc; if (s.empty || !s.$from.sameParent(s.$to) || s.$from.depth !== 1) return toast('Označite citat unutar jednog odlomka.'); const json = doc.slice(s.from, s.to).content.toJSON() || [], tx = json.filter(q => q.type === 'text'); if (tx[0]) tx[0].text = tx[0].text.replace(/^\s*[„"“]/, ''); tx.forEach(q => { q.text = q.text.replace(/[”"](\s*)$/, '$1'); }); const clean = json.filter(q => q.type !== 'text' || q.text); const after = s.$from.after(1) - (s.to - s.from); chain().deleteRange({ from: s.from, to: s.to }).insertContentAt(after, { type: 'blockquote', content: [{ type: 'paragraph', content: clean }] }).run(); toast('Citat je u blok-citatu. Navodnici su uklonjeni, navod je ostao uz citat.'); },
    fromQuote: () => { closePop(); const $f = ed().state.selection.$from; let dq = -1; for (let i = $f.depth; i > 0; i--) if ($f.node(i).type.name === 'blockquote') dq = i; if (dq < 0) return toast('Postavite kursor u blok-citat.'); const s = $f.start($f.depth), e = $f.end($f.depth); ed().chain().focus().command(({ tr }) => { tr.insertText('”', e); tr.insertText('„', s); return true; }).lift('blockquote').run(); },
    toFn: () => { closePop(); const s = ed().state.selection; if (s.empty || !s.$from.sameParent(s.$to)) return toast('Označite tekst unutar jednog odlomka.'); const text = ed().state.doc.textBetween(s.from, s.to, ' ', leafText).trim(); chain().deleteRange({ from: s.from, to: s.to }).insertContent({ type: 'footnote', attrs: { text } }).run(); },
    // odloženo, rečenice, oblik
    stash: () => { closePop(); const s = ed().state.selection; if (s.empty) return toast('Označite tekst koji želite odložiti.'); const ch = curChapter(); S.stash.unshift({ id: uid('x'), text: ed().state.doc.textBetween(s.from, s.to, '\n', leafText), from: ch ? ch.title : 'početak rada' }); chain().deleteSelection().run(); persist(); toast('Odloženo. Vratite ga iz Strukture kad zatreba.'); },
    unstash: el => { const i = S.stash.findIndex(x => x.id === el.dataset.id); if (i < 0) return; chain().insertContent(S.stash[i].text).run(); S.stash.splice(i, 1); persist(); },
    stashDel: el => { S.stash = S.stash.filter(x => x.id !== el.dataset.id); persist(); X.render.rail(); },
    bars: () => { const b = curBlock(); if (!b || !b.node.isTextblock) return closePop(); let t = ''; b.node.forEach(ch => { t += ch.isText ? ch.text : '￼'; }); const ss = sents(t), mx = Math.max(1, ...ss.map(x => wc(x.s))); openPop(`<div class="pad"><p><b>Oblik rečenica</b></p>${ss.map(x => { const w = wc(x.s); return `<div class="sb"><i style="width:${Math.round(w / mx * 100)}%${w > 40 ? ';background:var(--warn)' : ''}"></i><span>${w}</span></div>`; }).join('') || '<p class="muted">U odlomku nema rečenica.</p>'}<p class="muted">Izmjena kratkih i dugih rečenica čini tekst čitljivijim.</p></div>`, ed().view.coordsAtPos(ed().state.selection.from), 'menu'); },
    sentUp: () => moveSentence(-1), sentDown: () => moveSentence(1),
    // izvori
    quick: () => openDlg({ type: 'quick', ident: '', kind: 'knjiga', authors: '', full: '', year: '', title: '', pub: '' }),
    quickAdd: el => { const d = U.dlg; if (!d.authors.trim() || !d.year.trim()) return toast('Upišite barem autora i godinu.'); const id = uid('s'), ident = d.ident.trim(), tail = (d.pub.trim() ? `. ${d.pub.trim().replace(/\.$/, '')}.` : '') + (ident ? ` ${/^10\./.test(ident) ? 'https://doi.org/' + ident : ident}` : ''); S.sources.push({ id, kind: d.kind, authors: d.authors.trim(), full: d.full.trim() || d.authors.trim(), year: d.year.trim(), title: d.title.trim(), tail }); closeDlg(); X.repaintCites(); if (el.dataset.cite) { insertCitation(id, ''); toast('Izvor je u Literaturi i citiran. Stranicu dodajete upisom :31 odmah iza navoda.'); } else { refresh(); toast('Izvor je dodan u Literaturu.'); } persist(); renderAll(true); },
    copyCite: async el => { const s = srcById(el.dataset.id); try { await navigator.clipboard.writeText(citeText(s.id, '')); toast('Navod je kopiran.'); } catch (e) { toast('Kopiranje nije dopušteno u ovom prikazu.'); } },
    srcOpen: el => { U.srcOpen = U.srcOpen === el.dataset.id ? null : el.dataset.id; U.noteForm = null; renderPanel(true); },
    noteNew: el => { U.noteForm = el.dataset.id; renderPanel(true); setTimeout(() => $('#rnText')?.focus(), 30); }, noteCancel: () => { U.noteForm = null; renderPanel(true); },
    noteSave: el => { const t = $('#rnText').value.trim(); if (!t) return toast('Upišite bilješku.'); (S.rnotes[el.dataset.id] = S.rnotes[el.dataset.id] || []).push({ id: uid('n'), page: $('#rnPage').value.trim(), text: t }); U.noteForm = null; persist(); renderPanel(true); },
    noteDel: el => { if (el.dataset.n) { S.rnotes[el.dataset.id] = (S.rnotes[el.dataset.id] || []).filter(n => n.id !== el.dataset.n); persist(); renderPanel(true); } else { S.noteSelf = null; U.showNote = false; persist(); renderAll(); } },
    noteQuote: el => { const n = (S.rnotes[el.dataset.id] || []).find(x => x.id === el.dataset.n); if (n) insertNoteQuote(el.dataset.id, n); },
    citeIns2: el => { insertCitation(el.dataset.id, el.dataset.page); if (innerWidth <= 1050) X.closeDrawers(); },
    pasteCite: el => { closePop(); insertCitation(el.dataset.id, el.dataset.page); toast('Navod je dodan iza zalijepljenog teksta.'); },
    pasteQuote: () => { const r = U.pasteR; closePop(); if (!r) return; ed().chain().focus().command(({ tr, state }) => { tr.removeMark(r.from, r.to, state.schema.marks.paste); tr.insertText('”', r.to); tr.insertText('„', r.from); return true; }).setTextSelection(r.to + 2).run(); if (r.mark.attrs.src) insertCitation(r.mark.attrs.src, ''); else X.ACT.cite({ getBoundingClientRect: () => ed().view.coordsAtPos(ed().state.selection.from) }); },
    pasteOk: () => { const r = U.pasteR; closePop(); if (!r) return; ask({ title: 'Potvrdi uz obrazloženje', label: 'Zašto tekst ostaje kakav jest?', ph: 'Npr. službena definicija iz zakona.', multi: true, ok: 'Potvrdi' }, v => { if (!v.trim()) return toast('Upišite obrazloženje.'); const st = ed().state, tr = st.tr; tr.removeMark(r.from, r.to, st.schema.marks.paste); tr.addMark(r.from, r.to, st.schema.marks.paste.create({ ...r.mark.attrs, ok: v.trim() })); ed().view.dispatch(tr); }); },
    // savjeti
    hintRep: el => { const h = D().hints[+el.dataset.h]; closePop(); if (!h) return; let alt = el.dataset.alt; const cur = ed().state.doc.textBetween(h.pos, h.to); if (/^\p{Lu}/u.test(cur) && h.kind !== 'short') alt = alt[0].toUpperCase() + alt.slice(1); ed().view.dispatch(ed().state.tr.insertText(alt, h.pos, h.to)); },
    transOk: el => { const h = D().hints[+el.dataset.h]; closePop(); if (h) { S.transOk[h.key] = 1; refresh(); persist(); } },
    transPhr: el => { const h = D().hints[+el.dataset.h]; closePop(); if (h) { ed().commands.setTextSelection(h.pos); openDlg({ type: 'phrases', cat: PHRASES.findIndex(p => p[0] === 'Prijelaz') }); } },
    // pojmovnik
    glossNew: el => { U.glossForm = { term: el.dataset.w || '', def: '', vars: '' }; renderPanel(true); }, glossCancel: () => { U.glossForm = null; renderPanel(true); },
    glossSave: () => { const f = U.glossForm; if (!f.term.trim()) return toast('Upišite pojam.'); S.glossary.push({ term: f.term.trim(), def: f.def.trim(), variants: f.vars.split(',').map(x => x.trim()).filter(Boolean) }); U.glossForm = null; refresh(); persist(); renderPanel(true); },
    glossDel: el => { S.glossary.splice(+el.dataset.i, 1); refresh(); persist(); renderPanel(true); },
    glossNext: el => { const g = S.glossary[+el.dataset.i], pl = ((D().gloss || {})[g.term] || {}).places || []; if (!pl.length) return toast('Pojam se u tekstu ne pojavljuje.'); const k = 'g' + g.term; U[k] = ((U[k] == null ? -1 : U[k]) + 1) % pl.length; jump(pl[U[k]], false); },
    // struktura
    thesisEdit: () => ask({ title: 'Teza ili istraživačko pitanje', label: 'Jedna rečenica: što rad tvrdi ili pita?', multi: true, value: S.thesis }, v => { S.thesis = v.trim(); persist(); renderAll(true); }),
    outlineOnly: () => { U.outline = !U.outline; U.ro = U.outline || U.otherTab; setMode(); renderAll(); },
    showAll: () => { U.onlyHid = null; refresh(); },
    copyToc: async () => { const txt = (S.thesis ? 'Teza: ' + S.thesis + '\n\n' : '') + D().heads.filter(h => h.level > 1).map(h => (h.level === 3 ? '   ' : '') + h.num + ' ' + h.title).join('\n'); try { await navigator.clipboard.writeText(txt); toast('Sadržaj rada je kopiran.'); } catch (e) { toast('Kopiranje nije dopušteno u ovom prikazu.'); } },
    collapse: el => { S.collapsed[el.dataset.hid] = !S.collapsed[el.dataset.hid]; persist(); X.render.rail(); },
    kostur: () => { const end = ed().state.doc.content.size, H = t => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] }), P = { type: 'paragraph' }; chain().insertContentAt(end, [H('Uvod'), P, H('Razrada'), P, H('Zaključak'), P]).run(); toast('Umetnut je kostur prema Uputama FPZG-a.'); },
    hTarget: el => { const hid = el.dataset.hid; ask({ title: 'Cilj poglavlja', label: 'Broj riječi (prazno uklanja cilj)', value: S.targets[hid] || '' }, v => { const n = parseInt(v, 10); if (n > 0) S.targets[hid] = n; else delete S.targets[hid]; persist(); X.render.rail(); }); },
    hDue: el => { const hid = el.dataset.hid; closePop(); ask({ title: 'Rok poglavlja', label: 'Vaš rok za ovo poglavlje (prazno uklanja rok)', value: S.dues[hid] || '', ph: 'npr. 22. 11.' }, v => { if (v.trim()) S.dues[hid] = v.trim(); else delete S.dues[hid]; persist(); X.render.rail(); }); },
    hMenu: el => { const hid = el.dataset.hid, h = D().heads.find(x => x.hid === hid), x = ` data-hid="${hid}"`; pop(el, `${h.level === 2 ? mi('hSub', 'Dodaj podnaslov', '', x) : ''}${mi('hRename', 'Preimenuj', '', x)}${h.level === 3 ? mi('hLevel', 'Podigni razinu (poglavlje)', '', x) : mi('hLevel', 'Spusti razinu (podnaslov)', '', x)}${mi('hPurpose', 'Svrha poglavlja', '', x)}${mi('hNote', 'Bilješka uz poglavlje', '', x)}${mi('hDue', 'Rok poglavlja', '', x)}${mi('hAsk', 'Pitaj mentora', '', x)}${mi('hOnly', 'Prikaži samo ovo poglavlje', '', x)}${mi('hDel', 'Obriši poglavlje', '', x)}`); },
    hSub: el => { closePop(); const r = secRange(el.dataset.hid); ask({ title: 'Novi podnaslov', label: 'Naslov' }, v => { if (v.trim()) chain().insertContentAt(r.end, [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: v.trim() }] }, { type: 'paragraph' }]).run(); }); },
    hRename: el => { closePop(); const h = D().heads.find(x => x.hid === el.dataset.hid); ask({ title: 'Preimenuj', label: 'Novi naslov poglavlja:', value: h.title }, v => { if (v.trim()) ed().view.dispatch(ed().state.tr.insertText(v.trim(), h.pos + 1, h.end - 1)); }); },
    hLevel: el => { closePop(); const h = D().heads.find(x => x.hid === el.dataset.hid), n = ed().state.doc.nodeAt(h.pos); ed().view.dispatch(ed().state.tr.setNodeMarkup(h.pos, null, { ...n.attrs, level: h.level === 3 ? 2 : 3 })); },
    hPurpose: el => { closePop(); const hid = el.dataset.hid; ask({ title: 'Svrha poglavlja', label: 'Što ovo poglavlje radi u argumentu?', multi: true, value: S.purposes[hid] || '' }, v => { S.purposes[hid] = v.trim(); persist(); renderAll(true); }); },
    hNote: el => { closePop(); const hid = el.dataset.hid; ask({ title: 'Bilješka uz poglavlje', label: 'Što ovdje još treba…', multi: true, value: S.hnotes[hid] || '' }, v => { S.hnotes[hid] = v.trim(); persist(); X.render.rail(); }); },
    hAsk: el => { closePop(); const h = D().heads.find(x => x.hid === el.dataset.hid); ask({ title: 'Pitanje mentoru', label: 'Pitanje uz poglavlje „' + h.title + '”', ph: 'Npr. je li ovaj okvir preširok?', multi: true, ok: 'Pošalji' }, v => { if (!v.trim()) return; S.cmSeq++; S.comments.push({ id: uid('c'), n: S.cmSeq, from: h.pos + 1, to: h.end - 1, quote: h.title, text: v.trim(), rule: '', sugg: null, role: 'student', who: 'Student A', when: now(), resolved: false, replies: [], q: true }); refresh(); persist(); showTab('cmt'); }); },
    hOnly: el => { closePop(); U.onlyHid = el.dataset.hid; refresh(); },
    hDel: el => { closePop(); const hid = el.dataset.hid, h = D().heads.find(x => x.hid === hid); ask({ title: 'Obriši poglavlje', desc: `Obrisati poglavlje „${h.title}” zajedno s tekstom? Prije brisanja sprema se točka u povijesti rada.`, noField: true, ok: 'Obriši' }, () => { savePoint('Prije brisanja poglavlja „' + h.title + '”'); const r = secRange(hid); ed().view.dispatch(ed().state.tr.delete(r.start, r.end)); }); },
    // komentari i dorada
    cmResolve: el => { const c = S.comments.find(x => x.id === el.dataset.id), done = () => { refresh(); persist(); renderPanel(true); }; if (c.resolved) { c.resolved = false; delete c.why; return done(); } const cur = c.lost ? '' : ed().state.doc.textBetween(c.from, c.to, ' ', leafText); if (S.mode === 'write' && c.role === 'teacher' && !c.lost && cur === c.quote && !(c.sugg && c.sugg.state)) return ask({ title: 'Riješeno bez izmjene odlomka', label: 'Zašto tekst ostaje kakav jest? (neobavezno)', ph: 'Npr. službena definicija iz zakona.', multi: true, ok: 'Označi riješeno' }, v => { c.resolved = true; c.why = v.trim(); done(); }); c.resolved = true; done(); },
    sendReview: () => openDlg({ type: 'send' }),
    sendDo: () => { const msg = $('#sendMsg').value.trim(), r = S.review; r.round++; r.status = 'review'; r.snapshot = blocksText(); r.log.push({ who: 'Student A', what: `Dorada poslana na pregled (runda ${r.round})${msg ? ': ' + msg : ''}`, when: now() }); savePoint('Poslano na pregled, runda ' + r.round); closeDlg(); renderPanel(true); toast('Dorada je poslana. Mentor dobiva obavijest.'); },
    // rad
    stageSub: el => { const s = S.stages[+el.dataset.i]; s.st = 'sub'; s.d = now().split(',')[0]; delete s.note; savePoint('Etapa: ' + s.n); renderPanel(true); toast('Etapa je predana mentoru.'); },
    stageOk: el => { const s = S.stages[+el.dataset.i]; s.st = 'ok'; s.d = now().split(',')[0].replace(/\s?\d{4}\.$/, ''); persist(); renderPanel(true); },
    stageBack: el => { const s = S.stages[+el.dataset.i]; ask({ title: 'Vrati s napomenom', label: 'Što treba doraditi u etapi „' + s.n + '”', multi: true, ok: 'Vrati' }, v => { s.st = 'back'; s.note = v.trim(); persist(); renderPanel(true); }); },
    taskAdd: () => ask({ title: 'Dogovoreno na konzultacijama', label: 'Novi dogovor' }, v => { if (v.trim()) { S.tasks.push({ t: v.trim(), done: false }); persist(); renderPanel(true); } }),
    prepMake: () => { S.prep = prepText(); persist(); renderPanel(true); },
    prepCopy: async () => { try { await navigator.clipboard.writeText(S.prep); toast('Priprema je kopirana.'); } catch (e) { toast('Kopiranje nije dopušteno u ovom prikazu.'); } },
    prepSend: () => { S.review.log.push({ who: 'Student A', what: 'Priprema za konzultacije poslana mentoru', when: now() }); savePoint('Priprema za konzultacije', { kons: true }); S.koWhen = now().split(',')[0]; toast('Priprema je poslana mentoru uz najavu konzultacija.'); renderPanel(true); },
    impText: () => openDlg({ type: 'imptext', agree: false }),
    impTextDo: () => { const d = U.dlg, body = $('#itBody').value.trim(); if (!body) return toast('Zalijepite tekst ili odaberite datoteku.'); if (!d.agree) return toast('Potvrdite izjavu o uvezenom tekstu.'); const paras = body.split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean); chain().insertContentAt(ed().state.doc.content.size, paras.map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p, marks: [{ type: 'imported' }] }] }))).run(); S.imported += wc(body); S.review.log.push({ who: 'Student A', what: `Uvezen postojeći tekst (${wc(body)} riječi) uz izjavu`, when: now() }); persist(); closeDlg(); renderAll(true); toast('Tekst je uvezen na kraj rada i označen kao uvezen.'); },
    pointSave: () => ask({ title: 'Spremi točku', label: 'Naziv nove točke', ph: 'npr. Prije preslagivanja Analize' }, v => { savePoint(v.trim() || 'Točka ' + now()); openDlg({ type: 'history' }); }),
    pointCmp: el => { const p = S.points[+el.dataset.i]; openDlg({ type: 'diff', base: p.blocks, title: 'Usporedba s točkom „' + p.name + '”' }); },
    pointBack: el => { const i = +el.dataset.i, p = S.points[i]; if (U.dlg.confirm !== i) { U.dlg.confirm = i; return renderDlg(); } const doc = p.doc; savePoint('Prije vraćanja na „' + p.name + '”'); ed().commands.setContent(doc); closeDlg(); toast('Rad je vraćen na odabranu točku.'); },
    // poruka sebi
    noteSelf: () => { closePop(); ask({ title: 'Poruka sebi', desc: 'Jedna rečenica za sljedeći put. Kursor će Vas čekati u odlomku u kojem sada pišete.', label: 'Poruka', ph: 'npr. sutra: dovrši primjer u 2.2', value: S.noteSelf ? S.noteSelf.text : '' }, v => { S.noteSelf = v.trim() ? { text: v.trim(), pos: ed().state.selection.from } : null; U.showNote = false; persist(); toast(S.noteSelf ? 'Poruka je spremljena za sljedeći put.' : 'Poruka je obrisana.'); }); },
    noteGo: () => { const p = S.noteSelf.pos; U.showNote = false; jump(Math.max(0, p - 1)); try { ed().commands.setTextSelection(Math.min(p, ed().state.doc.content.size)); } catch (e) { /* izvan teksta */ } renderAll(); },
    // traženje
    findOpen: () => { closePop(); $('#find').hidden = false; U.find = U.find || { q: '', scope: 'all', i: 0 }; $('#findQ').focus(); $('#findQ').select(); },
    findClose: () => { $('#find').hidden = true; U.find = null; refresh(); },
    findNext: () => { const f = U.find, n = D().hits.length; if (!f || !n) return; f.i = (f.i + 1) % n; refresh(); jump(D().hits[f.i].from, false); },
    findRep: () => { const f = U.find, h = f && D().hits[f.i]; if (!h || !ed().isEditable) return; ed().view.dispatch(ed().state.tr.insertText($('#findR').value, h.from, h.to)); },
    findAll: () => { const hits = D().hits; if (!hits.length || !ed().isEditable) return; const tr = ed().state.tr, rep = $('#findR').value; hits.slice().reverse().forEach(h => (rep ? tr.insertText(rep, h.from, h.to) : tr.delete(h.from, h.to))); ed().view.dispatch(tr); toast(`Zamijenjeno: ${hits.length}.`); },
    // izvoz, govor
    docx: async () => { closePop(); if (!caps.downloads) return toast('Preuzimanje nije dostupno u ovom prikazu.'); try { await caps.downloads.save({ filename: 'rad-fpzg.docx', data: buildDocx() }); toast('Preuzet je .docx: Times New Roman 12, prored 1,5, margine 2,5 cm, brojevi stranica.'); } catch (e) { if (!e || e.code !== 'declined') toast('Preuzimanje nije uspjelo.'); } },
    readAloud: async () => { closePop(); const t = caps.tts; if (!t) return; if (U.reading) { U.reading = false; return t.stop(); } const b = curBlock(); const txt = b ? b.node.textBetween(0, b.node.content.size, ' ', leafText).trim() : ''; if (!txt) return toast('Postavite kursor u odlomak s tekstom.'); U.reading = true; try { await t.speak(txt.slice(0, 2000), { language: 'hr' }); } catch (e) { if (e && e.code && !/stopped|viewer/.test(e.code)) toast('Čitanje naglas trenutačno nije dostupno.'); } U.reading = false; },
    dictate: () => { closePop(); const d = caps.dictation; if (!d) return; if (U.dict) { d.stop().catch(() => {}); return; } d.start().catch(e => toast(e && e.code === 'not_granted' ? 'Diktiranje nije dopušteno.' : 'Diktiranje se ne može pokrenuti.')); },
  });
  const coreSubDo = ACT.subDo; ACT.subDo = async () => { savePoint('Predana završna verzija'); await coreSubDo(); };
  const coreSetView = ACT.setView; ACT.setView = el => { coreSetView(el); };
  function insertNoteQuote(id, n) { chain().insertContent('„' + n.text.replace(/[.!?…]+$/, '') + '” ').run(); insertCitation(id, n.page); toast('Citat je upisan s navodom i stranicom.'); }
  function moveSentence(dir) {
    closePop(); const b = curBlock(); if (!b || b.node.type.name !== 'paragraph') return; let t = ''; b.node.forEach(ch => { t += ch.isText ? ch.text : '￼'; });
    const ss = sents(t), base = b.pos + 1, off = ed().state.selection.from - base, i = ss.findIndex(x => off >= x.a && off <= x.e);
    if (ss.length < 2) return toast('U odlomku je samo jedna rečenica.'); if (i < 0) return; const j = i + dir; if (j < 0) return toast('Rečenica je već prva u odlomku.'); if (j >= ss.length) return toast('Rečenica je već zadnja u odlomku.');
    const A = ss[Math.min(i, j)], B = ss[Math.max(i, j)], doc = ed().state.doc, sl = (a, e) => doc.slice(base + a, base + e).content;
    ed().view.dispatch(ed().state.tr.replaceWith(base + A.a, base + B.e, sl(B.a, B.e).append(sl(A.e, B.a)).append(sl(A.a, A.e))));
    try { ed().commands.setTextSelection(base + (dir < 0 ? A.a : A.a + (B.e - B.a) + (B.a - A.e)) + 1); } catch (e) { /* izvan teksta */ }
  }

  /* ---------- Izvoz u .docx ---------- */
  function buildDocx() {
    const d = D(), doc = ed().state.doc, x = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])), fns = [];
    const run = (t, o) => `<w:r>${o ? `<w:rPr>${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
    const runs = node => { let out = ''; node.forEach(ch => { const n = ch.type.name; if (ch.isText) out += run(ch.text, { b: ch.marks.some(m => m.type.name === 'bold'), i: ch.marks.some(m => m.type.name === 'italic') }); else if (n === 'footnote') { fns.push(ch.attrs.text); out += `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${fns.length}"/></w:r>`; } else if (n === 'hardBreak') out += '<w:r><w:br/></w:r>'; else out += run(leafText(ch)); }); return out; };
    const p = (inner, st, ppr) => `<w:p><w:pPr>${st ? `<w:pStyle w:val="${st}"/>` : ''}${ppr || ''}</w:pPr>${inner}</w:p>`;
    let body = '';
    const block = (n, pos, ind) => {
      const t = n.type.name;
      if (t === 'heading') { const h = d.heads.find(q => q.pos === pos); body += p((h && h.num ? run(h.num + ' ') : '') + runs(n), n.attrs.level === 1 ? 'Title' : n.attrs.level === 2 ? 'Heading1' : 'Heading2'); }
      else if (t === 'paragraph') { if (n.content.size) body += p(runs(n), '', ind ? `<w:ind w:left="${ind}"/>` : ''); }
      else if (t === 'blockquote') n.forEach(c => block(c, -1, 709));
      else if (t === 'bulletList' || t === 'orderedList') { let k = 0; n.forEach(li => li.forEach(c => { k++; if (c.type.name === 'paragraph') body += p(run(t === 'bulletList' ? '• ' : k + '. ') + runs(c), '', '<w:ind w:left="709" w:hanging="283"/>'); else block(c, -1, 709); })); }
      else if (t === 'prikaz') { const a = n.attrs, num = (d.prikazN || {})[a.pid] || '';
        body += p(run((a.kind === 'tablica' ? 'Tablica ' : 'Slika ') + num + '. ', { b: 1 }) + run(a.title), '', '<w:keepNext/><w:jc w:val="left"/>');
        if (a.kind === 'tablica' && a.rows.length) body += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('')}</w:tblBorders></w:tblPr>${a.rows.map((r, i) => `<w:tr>${r.map(c => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p(run(c, i ? null : { b: 1 }), '', '<w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
        else if (a.kind === 'slika') body += p(run('[Slika se umeće u Wordu]', { i: 1 }), '', '<w:jc w:val="center"/>');
        body += p(run('Izvor: ' + a.source), '', '<w:jc w:val="left"/>'); }
    };
    doc.forEach((n, off) => block(n, off, 0));
    const cited = S.sources.filter(s => d.cited[s.id]).sort((a, b) => a.full.localeCompare(b.full, 'hr'));
    if (cited.length) { body += p(run('Literatura'), 'Heading1'); cited.forEach(s => { const tmp = document.createElement('div'); tmp.innerHTML = X.bibEntry(s); let inner = ''; tmp.childNodes.forEach(c => { inner += run(c.textContent, c.nodeName === 'I' ? { i: 1 } : null); }); body += p(inner, '', '<w:ind w:left="709" w:hanging="709"/><w:jc w:val="left"/>'); }); }
    if (S.abs.trim()) { body += p(run('Sažetak'), 'Heading1') + p(run(S.abs.trim())) + p(run('Ključne riječi: ', { b: 1 }) + run(S.kw)); }
    if (S.sum.trim()) { body += p(run('Summary'), 'Heading1') + p(run(S.sum.trim())) + p(run('Keywords: ', { b: 1 }) + run(S.kwEn)); }
    if (X.aiText()) body += p(run('Prilog: Izjava o korištenju alata umjetne inteligencije'), 'Heading1') + p(run(X.aiText()));
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"', HD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', RL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const font = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>';
    const files = {
      '[Content_Types].xml': `${HD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
      '_rels/.rels': `${HD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RL}/officeDocument" Target="word/document.xml"/></Relationships>`,
      'word/_rels/document.xml.rels': `${HD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${RL}/footer" Target="footer1.xml"/><Relationship Id="rId3" Type="${RL}/footnotes" Target="footnotes.xml"/></Relationships>`,
      'word/styles.xml': `${HD}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="hr-HR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="360"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style></w:styles>`,
      'word/footer1.xml': `${HD}<w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`,
      'word/footnotes.xml': `${HD}<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${fns.map((t, i) => `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>${run(' ' + t)}</w:p></w:footnote>`).join('')}</w:footnotes>`,
      'word/document.xml': `${HD}<w:document ${NS}><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    };
    return zip(files);
  }
  X.buildDocx = buildDocx;
  function zip(files) {
    const T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
    const crc = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    Object.entries(files).forEach(([name, text]) => {
      const nb = enc.encode(name), data = enc.encode(text), c = crc(data), head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
      parts.push(new Uint8Array(head), nb, data);
      cen.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
      off += head.length + nb.length + data.length;
    });
    const cs = cen.reduce((a, b) => a + b.length, 0), end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(cen.length / 2), ...u16(cen.length / 2), ...u32(cs), ...u32(off), ...u16(0)]);
    const all = [...parts, ...cen, end], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; all.forEach(b => { out.set(b, p); p += b.length; }); return out;
  }

  /* ---------- Događaji ---------- */
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.warn) { S.warn[t.dataset.warn] = t.checked; S.level = Object.keys(LEVELS).find(k => WARN.every(w => S.warn[w[0]] === LEVELS[k].includes(w[0]))) || 'vlastito'; refresh(); persist(); renderDlg(); renderPanel(true); }
    if (t.dataset.part) { const c = S.checked[t.dataset.part] = S.checked[t.dataset.part] || {}; c[t.dataset.i] = t.checked; persist(); }
    if (t.dataset.task) { S.tasks[+t.dataset.task].done = t.checked; persist(); renderPanel(true); }
    const file = t.files && t.files[0]; if (!file) return;
    if (t.id === 'impFile' || t.id === 'itFile') { const r = new FileReader(); r.onload = () => { const ta = $(t.id === 'impFile' ? '#impTxt' : '#itBody'); if (ta) ta.value = String(r.result); }; r.readAsText(file); }
    if (t.id === 'pkFile') { if (file.size > 400 * 1024) return toast('Slika je prevelika za prototip (najviše 400 KB).'); const r = new FileReader(); r.onload = () => { if (U.dlg && U.dlg.type === 'prikaz') { U.dlg.img = String(r.result); renderDlg(); } }; r.readAsDataURL(file); }
  });
  document.addEventListener('input', e => { const t = e.target; if (t.id === 'findQ' || t.id === 'findScope') { U.find = U.find || { q: '', scope: 'all', i: 0 }; U.find.q = $('#findQ').value; U.find.scope = $('#findScope').value; U.find.i = 0; refresh(); } });
  document.addEventListener('contextmenu', e => { if (!$('#ed').contains(e.target)) return; const s = getSelection(); if (s && !s.isCollapsed && $('#ed').contains(s.anchorNode)) { e.preventDefault(); X.startComment(); } });
  document.addEventListener('dragstart', e => { const n = e.target.closest && e.target.closest('[data-drag]'); if (n) { e.dataTransfer.setData('text/x-ductura-note', n.dataset.drag); e.dataTransfer.effectAllowed = 'copy'; } });
  $('#ed').addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-ductura-note')) e.preventDefault(); });
  $('#ed').addEventListener('drop', e => { const v = e.dataTransfer.getData('text/x-ductura-note'); if (!v || !ed().isEditable) return; e.preventDefault(); e.stopPropagation(); const [id, nid] = v.split('|'), n = (S.rnotes[id] || []).find(x => x.id === nid), at = ed().view.posAtCoords({ left: e.clientX, top: e.clientY }); if (n && at) { ed().commands.setTextSelection(at.pos); insertNoteQuote(id, n); } }, true);
  X.hooks.key.push(e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); ACT.findOpen(); return true; }
    if (mod && e.key === '\\') { e.preventDefault(); ACT.railToggle(); return true; }
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'findQ') { e.preventDefault(); ACT.findNext(); return true; }
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'askV' && document.activeElement.tagName === 'INPUT') { e.preventDefault(); ACT.askOk(); return true; }
    if (e.key === 'Escape' && !$('#find').hidden && !U.dlg && $('#pop').hidden) { ACT.findClose(); return true; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && ed().isFocused && ed().isEditable) { e.preventDefault(); const dir = e.key === 'ArrowUp' ? -1 : 1; if (e.shiftKey || mod) { const h = curChapter(); if (h) ACT.move({ dataset: { hid: h.hid, dir } }); } else moveSentence(dir); return true; }
    return false;
  });
  X.hooks.tx.push(tr => {
    if (!tr.docChanged || U.inPg) return; const e = ed(), sel = e.state.selection; if (!sel.empty || !sel.$from.parent.isTextblock) return;
    const m = sel.$from.parent.textBetween(0, sel.$from.parentOffset, null, '￼').match(/￼:(\d{1,4}(?:-\d{1,4})?)([ .,;)])$/); if (!m) return;
    const cp = sel.from - m[0].length, n = e.state.doc.nodeAt(cp); if (!n || n.type.name !== 'citation') return;
    U.inPg = true; setTimeout(() => { const cur = e.state.doc.nodeAt(cp); if (cur && cur.type.name === 'citation') { e.view.dispatch(e.state.tr.delete(cp + 1, cp + 2 + m[1].length).setNodeMarkup(cp, null, { ...cur.attrs, page: m[1] })); toast('Stranica je dodana u navod.'); } U.inPg = false; }, 0);
  });
  addEventListener('online', () => renderAll()); addEventListener('offline', () => renderAll());

  X.fx = { flagsOf, headEnd, secRange, partsOf, ask, STAT, mi };
  X.afterBoot = fresh => {
    if (S.seedMeta) { D().heads.filter(h => h.level === 2).forEach((h, i) => { if (S.seedMeta.statuses[i]) S.statuses[h.hid] = S.seedMeta.statuses[i]; if (S.seedMeta.targets[i]) S.targets[h.hid] = S.seedMeta.targets[i]; }); delete S.seedMeta; S.review.snapshot = blocksText(); persist(); }
    U.startWords = D().words; U.showNote = !!S.noteSelf;
    if (fresh && !S.points.length) savePoint('Prva predaja na pregled, runda 1');
    try { const bc = new BroadcastChannel('ductura-proto'), me = uid('t'); bc.onmessage = ev => { const m = ev.data || {}; if (m.t === 'hello' && m.id !== me && !U.otherTab) bc.postMessage({ t: 'here', to: m.id }); if (m.t === 'here' && m.to === me) { U.otherTab = true; U.ro = true; setMode(); renderAll(true); } }; bc.postMessage({ t: 'hello', id: me }); } catch (e) { /* bez kanala */ }
    const initCaps = n0 => { if (!(window.claude && window.claude.use)) { if (n0 < 20) setTimeout(() => initCaps(n0 + 1), 300); return; } ['downloads', 'dictation', 'tts'].forEach(n => { try { window.claude.use(n).then(ns => { caps[n] = ns; if (n === 'dictation' && ns) { ns.onFinal(({ text }) => { if (text && U.dictTo) U.dictTo(text); else if (text && ed().isEditable) ed().chain().insertContent(text + ' ').run(); U.dictPart = ''; }); ns.onPartial(({ text }) => { U.dictPart = text; X.render.chrome(); }); ns.onState(({ state }) => { U.dict = state === 'listening'; if (!U.dict && U.dictTo) { U.dictTo = null; X.renderPanel(); } U.dictPart = ''; X.render.chrome(); }); } }).catch(() => {}); } catch (e) { /* nije dostupno */ } }); };
    initCaps(0);
    renderAll(true);
    if (!S.onb && fresh) openDlg({ type: 'onb', i: 0 });
  };
})();
