/* Ductura Editor, prototip (v0.1).
 * Tekst je pravi Tiptap/ProseMirror dokument. Navod je atom (čvor `citation`), rupe, savjeti i komentari
 * su dekoracije (komentar je zaseban zapis sa sidrom, D-34). Sve što se čuva prolazi kroz `store`:
 * to je mjesto na kojem se kasnije spaja poslužitelj.
 */
(function () {
  'use strict';
  const { Editor, Node, Mark, Extension, StarterKit, Plugin, PluginKey, Decoration, DecorationSet } = window.TT;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const WORD = /[\p{L}\d]+(?:[-'][\p{L}\d]+)*/gu;
  const wc = t => (String(t || '').match(WORD) || []).length;
  const now = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}., ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c); };

  /* ---------- Spoj s poslužiteljem ---------- */
  const KEY = 'ductura-proto-v1';
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    save(data) { try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; } },
    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* bez pohrane */ } },
  };

  const TASK = { course: 'Kolegij A', title: 'Zadatak 1', due: '30. 11. 2026.', min: 2000, max: 2500, kind: 'Seminarski rad' };
  const RULES = {
    page: { t: 'Navod sa stranicom', why: 'Doslovni navod i preuzeta tvrdnja navode stranicu izvora, kako bi se mogla provjeriti.', ex: 'Primjer: (Kovač, 2019: 14) ili Kovač (2019: 14) navodi da…' },
    claim: { t: 'Tvrdnja traži izvor', why: 'Svaka tvrdnja koja nije opće poznata ima navod izvora iz kojeg je preuzeta.', ex: 'Primjer: Čitanje naglas povezano je s većim rječnikom (Autor A, 2019: 14).' },
    quote: { t: 'Doslovni navod u navodnicima', why: 'Preuzete riječi idu u navodnike „ ”, a navod duži od tri retka u zaseban blok.', ex: 'Primjer: Autor B navodi da je „učinak najjasniji kod mlađe djece” (2021: 33).' },
    sent: { t: 'Duga rečenica', why: 'Rečenica dulja od 40 riječi dijeli se na dvije kako bi tvrdnja ostala jasna.', ex: 'Primjer: dvije tvrdnje povezane s „a” postaju dvije rečenice.' },
    def: { t: 'Pojam pri prvoj uporabi', why: 'Ključni pojam definira se kad se prvi put spomene, s izvorom definicije.', ex: 'Primjer: Rječnik je broj riječi koje dijete razumije i koristi (Autor C, 2017: 7).' },
  };
  const PHRASES = [
    ['Uvod i cilj', ['Cilj je ovog rada …', 'Rad polazi od pitanja …', 'U radu se analizira …', 'Rad je podijeljen na … dijela.']],
    ['Pregled literature', ['Prema …, …', '… ističe da …', 'U literaturi se razlikuju dva pristupa: …', 'Za razliku od …, … tvrdi da …']],
    ['Argument', ['Iz toga proizlazi da …', 'To upućuje na zaključak da …', 'Ključan razlog za to jest …']],
    ['Ograda', ['Međutim, …', 'S druge strane, …', 'Ta se tvrdnja može osporiti jer …', 'Unatoč tome, …']],
    ['Primjer', ['Primjerice, …', 'To se vidi na primjeru …', 'Kao ilustracija može poslužiti …']],
    ['Zaključak', ['Zaključno, …', 'Analiza je pokazala da …', 'Ograničenje je ovog rada …', 'Otvorenim ostaje pitanje …']],
  ];
  const AI_PURPOSES = ['provjera pravopisa', 'prijevod izvora', 'pretraživanje literature', 'sažimanje izvora', 'objašnjenje pojma'];
  const SAMPLE = `
<h1>Čitanje naglas i razvoj rječnika u prvim razredima</h1>
<h2>Uvod</h2>
<p>Čitanje naglas u razredu često se opisuje kao jednostavna i jeftina praksa koja djeci otvara svijet knjige. Ovaj rad pita koliko je ta praksa povezana s razvojem rječnika u prva dva razreda osnovne škole i zašto se izvori u tome razlikuju.</p>
<p>Rječnik se ovdje shvaća kao broj riječi koje dijete razumije i aktivno koristi <span data-cite="C" data-page="7"></span>. Rad se oslanja na tri skupine izvora, a podatke o broju sati čitanja u nastavi treba još provjeriti [provjeri].</p>
<h2>Teorijski okvir</h2>
<h3>Rječnik i fonološka svjesnost</h3>
<p>Više autora tvrdi da redovito zajedničko čitanje proširuje rječnik djeteta <span data-cite="A"></span>. Brojna istraživanja pokazuju da je učinak najjasniji kod djece koja kod kuće rjeđe čitaju. Pritom se navodi da je „učinak najjasniji kod mlađe djece, osobito u prvom polugodištu” (Autor B, 2021).</p>
<p>Kurikulum predviđa čitanje naglas kao redovitu aktivnost u razrednoj nastavi <span data-cite="D"></span>.</p>
<h2>Analiza</h2>
<p></p>
<h2>Zaključak</h2>
<p>Zaključno, pregledani izvori slažu se da čitanje naglas pomaže, ali se razlikuju u procjeni koliko [izvor].</p>`;

  /* ---------- Stanje ---------- */
  const fresh = () => ({
    mode: 'write', tab: 'lit', citeStyle: 'fpzg', sheet: 'light', theme: 'dark', warn: { paste: true, claim: true, term: true, abbr: true, colloq: false, absolute: false, first: false, long: true, passive: false, cmt: true, trans: false, short: false }, toc: true,
    sources: [
      { id: 'A', kind: 'knjiga', authors: 'Autor A', full: 'Autor A, Ana', year: '2019', title: 'Naslov knjige', tail: '. Zagreb: Nakladnik.' },
      { id: 'B', kind: 'članak', authors: 'Autor B', full: 'Autor B, Boris', year: '2021', title: 'Naslov članka', tail: '. Naziv časopisa 12(3): 45-60.' },
      { id: 'C', kind: 'knjiga', authors: 'Autor C', full: 'Autor C, Cvita', year: '2017', title: 'Jezični razvoj u školi', tail: '. Zagreb: Nakladnik.' },
      { id: 'E', kind: 'članak', authors: 'Autor A', full: 'Autor A, Ana', year: '2019', title: 'Čitanje naglas u razrednoj nastavi', tail: '. Školski vjesnik 68(1).' },
      { id: 'D', kind: 'institucijski autor', authors: 'MZO', full: 'Ministarstvo znanosti i obrazovanja (MZO)', year: '2023', title: 'Kurikulum nastavnoga predmeta Hrvatski jezik', tail: '. Zagreb: MZO.' },
    ],
    comments: [], cmSeq: 0,
    review: { status: 'revise', round: 1, req: { text: 'Uvod je dobro postavljen. Teorijski okvir i Analiza još nemaju dovoljno navoda; dopunite ih izvorima i riješite označene komentare.', due: '24. 11. 2026.', when: '16. 11. 2026.' }, log: [{ who: 'Student A', what: 'Prva predaja na pregled', when: '15. 11. 2026.' }, { who: 'Nastavnik A', what: 'Zatražena dorada', when: '16. 11. 2026.' }], snapshot: null },
    stages: [{ n: 'Prijava teme', st: 'ok', d: '20. 10.' }, { n: 'Nacrt', st: 'ok', d: '30. 10.' }, { n: 'Prvo poglavlje', st: 'sub', d: '15. 11.' }, { n: 'Cijeli nacrt', st: 'no' }, { n: 'Predajna verzija', st: 'no' }],
    thesis: 'Redovito čitanje naglas u prvim razredima povezano je s većim rječnikom djece, ali izvori se razlikuju u tome koliko i zašto.',
    purposes: {}, statuses: {}, abs: '', kw: '', ai: { none: false, tools: '', purposes: [] }, agree: false, submitted: null,
  });
  const S = fresh();
  const U = { active: null, draft: null, dlg: null, litQ: '', litForm: null, litImport: false, replyFor: null, ruleOpen: {}, selWords: 0, save: 'local', reqForm: null };
  let D = { heads: [], holes: [], plain: [], claims: [], longs: [], words: 0, cited: {}, citePos: {}, quotesNoPage: [], badCites: [] };
  const X = window.DU = { S, U, RULES, TASK, PHRASES, hooks: { defaults: [], ext: [], node: [], block: [], end: [], checks: [], click: [], paint: [], tx: [], key: [], banner: [], dlg: {}, leaf: {}, atItems: null, cmds: [], litCard: null, litExtra: null, paste: null } };
  let editor, skipMap = false, trig = null, trigDismiss = -1, citeCursor = {};

  /* ---------- Izvori i navodi ---------- */
  const srcById = id => S.sources.find(x => x.id === id);
  function yearLabel(src) {
    if (!src.year) return 'b. g.';
    const same = S.sources.filter(x => x.authors === src.authors && x.year === src.year).sort((a, b) => a.title.localeCompare(b.title, 'hr'));
    return src.year + (same.length > 1 ? 'abcdefgh'[same.indexOf(src)] : '');
  }
  function citeInner(id, page, via) {
    const base = citeBase(id, page); return base && via ? `${via}, cit. prema ${base}` : base;
  }
  function citeBase(id, page) {
    const s = srcById(id); if (!s) return null; const y = yearLabel(s);
    if (S.citeStyle === 'apa') return `${s.authors}, ${y}${page ? `, str. ${page}` : ''}`;
    if (S.citeStyle === 'chicago') return `${s.authors} ${y}${page ? `, ${page}` : ''}`;
    return `${s.authors}, ${y}${page ? `: ${page}` : ''}`;
  }
  const citeText = (id, page, via) => '(' + (citeInner(id, page, via) || 'izvor nije u popisu') + ')';
  function paintCite(dom) {
    const inner = citeInner(dom.dataset.src, dom.dataset.page, dom.dataset.via);
    dom.classList.toggle('missing', !inner);
    dom.innerHTML = `<span class="co">(</span>${esc(inner || 'izvor nije u popisu')}<span class="cc">)</span>`;
  }
  const repaintCites = () => document.querySelectorAll('#ed .cite').forEach(paintCite);
  function bibEntry(s) {
    const y = yearLabel(s), t = s.kind === 'knjiga' ? `<i>${esc(s.title)}</i>` : esc(s.title);
    if (S.citeStyle === 'apa') return `${esc(s.full)} (${y}). ${t}${esc(s.tail)}`;
    if (S.citeStyle === 'chicago') return `${esc(s.full)}. ${y}. ${t}${esc(s.tail)}`;
    return `${esc(s.full)} (${y}) ${t}${esc(s.tail)}`;
  }
  function srcIssues(s) {
    const out = [];
    if (!s.year) out.push('Nedostaje godina.');
    if (!s.title) out.push('Nedostaje naslov.');
    if (!s.tail) out.push('Nedostaje nakladnik ili časopis.');
    if (S.sources.some(x => x !== s && x.authors === s.authors && x.year === s.year && x.title === s.title)) out.push('Mogući duplikat.');
    return out;
  }
  function shortAuthors(list) { return list.length === 1 ? list[0].l : list.length === 2 ? `${list[0].l} i ${list[1].l}` : `${list[0].l} i dr.`; }
  function mkSource(kind, people, year, title, tail) {
    const list = people.filter(p => p.l);
    return { id: uid('s'), kind, authors: list.length ? shortAuthors(list) : 'Nepoznat autor', full: list.map(a => a.l + (a.f ? ', ' + a.f : '')).join('; ') || 'Nepoznat autor', year: String(year || '').slice(0, 4), title: title || '', tail };
  }
  const person = a => { a = a.trim(); if (a.includes(',')) { const [l, f] = a.split(','); return { l: l.trim(), f: (f || '').trim() }; } const p = a.split(/\s+/); return { l: p.pop(), f: p.join(' ') }; };
  function parseRefs(txt) {
    const out = [];
    if (/@\w+\s*\{/.test(txt)) {
      txt.split(/(?=@\w+\s*\{)/).forEach(chunk => {
        const m = chunk.match(/^@(\w+)\s*\{/); if (!m) return; const f = {};
        const re = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g; let x;
        while ((x = re.exec(chunk))) f[x[1].toLowerCase()] = (x[2] ?? x[3] ?? x[4] ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
        if (!f.title && !f.author) return;
        const art = /article/i.test(m[1]);
        const tail = art ? (f.journal ? `. ${f.journal}${f.volume ? ' ' + f.volume : ''}${f.number ? `(${f.number})` : ''}${f.pages ? ': ' + f.pages.replace(/--/g, '-') : ''}.` : '') : (f.publisher ? `. ${f.address ? f.address + ': ' : ''}${f.publisher}.` : '');
        out.push(mkSource(art ? 'članak' : 'knjiga', (f.author || '').split(/\s+and\s+/i).filter(Boolean).map(person), f.year, f.title, tail));
      });
    }
    if (/^TY\s+-/m.test(txt)) {
      txt.split(/^ER\s+-.*$/m).forEach(chunk => {
        if (!/^TY\s+-/m.test(chunk)) return; chunk = chunk.slice(chunk.search(/^TY\s+-/m));
        const f = { AU: [] }; chunk.split(/\r?\n/).forEach(line => { const m = line.match(/^([A-Z][A-Z0-9])\s+-\s*(.*)$/); if (!m) return; if (m[1] === 'AU' || m[1] === 'A1') f.AU.push(m[2]); else f[m[1]] = m[2].trim(); });
        const title = f.TI || f.T1; if (!title && !f.AU.length) return;
        const art = /JOUR/i.test(f.TY || ''), j = f.JO || f.T2 || f.JF;
        const tail = art ? (j ? `. ${j}${f.VL ? ' ' + f.VL : ''}${f.IS ? `(${f.IS})` : ''}${f.SP ? ': ' + f.SP + (f.EP ? '-' + f.EP : '') : ''}.` : '') : (f.PB ? `. ${f.CY ? f.CY + ': ' : ''}${f.PB}.` : '');
        out.push(mkSource(art ? 'članak' : 'knjiga', f.AU.map(person), f.PY || f.Y1, title, tail));
      });
    }
    return out;
  }

  /* ---------- Tiptap: čvor navoda i dekoracije ---------- */
  const Citation = Node.create({
    name: 'citation', group: 'inline', inline: true, atom: true, selectable: true,
    addAttributes() {
      return {
        sourceId: { default: null, parseHTML: el => el.getAttribute('data-cite'), renderHTML: a => ({ 'data-cite': a.sourceId }) },
        page: { default: '', parseHTML: el => el.getAttribute('data-page') || '', renderHTML: a => (a.page ? { 'data-page': a.page } : {}) },
        via: { default: '', parseHTML: el => el.getAttribute('data-via') || '', renderHTML: a => (a.via ? { 'data-via': a.via } : {}) },
        rq: { default: '', parseHTML: el => el.getAttribute('data-rq') || '', renderHTML: a => (a.rq ? { 'data-rq': a.rq } : {}) },
      };
    },
    parseHTML() { return [{ tag: 'span[data-cite]' }]; },
    renderHTML({ HTMLAttributes, node }) { return ['span', HTMLAttributes, citeText(node.attrs.sourceId, node.attrs.page, node.attrs.via)]; },
    renderText({ node }) { return citeText(node.attrs.sourceId, node.attrs.page, node.attrs.via); },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span'); dom.className = 'cite'; dom.contentEditable = 'false';
        const set = n => { dom.dataset.src = n.attrs.sourceId || ''; dom.dataset.page = n.attrs.page || ''; dom.dataset.via = n.attrs.via || ''; dom.dataset.rq = n.attrs.rq || ''; paintCite(dom); };
        set(node);
        return { dom, update(n) { if (n.type.name !== 'citation') return false; set(n); return true; } };
      };
    },
  });
  const leafText = n => (n.type.name === 'citation' ? citeText(n.attrs.sourceId, n.attrs.page, n.attrs.via) : (X.hooks.leaf[n.type.name] ? X.hooks.leaf[n.type.name](n) : ''));
  const CLAIM = /(brojn\p{L}* (istraživanj|autor|studij)|istraživanja (su )?pokaz|pokazalo se|u literaturi se|smatra se da|poznato je da|dokazano je|uvriježen|općenito se|više autora tvrdi|često se (navodi|ističe))/iu;
  const HOLE = /\[(?:\?|izvor|provjeri|broj|stranica|citat)[^\]￼]{0,40}\]/giu;
  const PLAIN = /\((\p{Lu}[\p{L}.\- ]{1,40}?),? (\d{4})[a-z]?(?::\s*([\d-]+))?\)/gu;
  const SENT = /[^.!?…]+(?:[.!?…]+[”"»)]*|$)/g;

  function ghostText(title) {
    if (!title) return 'Počnite pisati. Upišite @ za navod ili / za naredbe.';
    if (/uvod/i.test(title)) return 'Uvod: predmet i problem rada → cilj i istraživačko pitanje → izvori i metoda → kratak pregled poglavlja';
    if (/zaklju/i.test(title)) return 'Zaključak: odgovor na pitanje iz uvoda → glavni nalazi → ograničenja rada → što ostaje otvoreno';
    return `Pitanja za početak (nestaju kad počnete pisati):\n· Što čitatelj mora znati na kraju poglavlja „${title}”?\n· Koji izvor ovdje najviše koristite i zašto?\n· Tvrdnja → dokaz s navodom (@) → objašnjenje → veza sa sljedećim odlomkom`;
  }
  function build(st) {
    const doc = st.doc, decos = [], sel = st.selection, editable = !editor || editor.isEditable;
    const d = { heads: [], holes: [], plain: [], claims: [], longs: [], words: 0, cited: {}, citePos: {}, quotesNoPage: [], badCites: [] };
    let n2 = 0, n3 = 0, cur2 = null, cur3 = null;
    doc.descendants((node, pos) => {
      for (const f of X.hooks.node) if (f({ node, pos, decos, d, cur2, cur3, doc }) === false) return false;
      if (node.type.name === 'heading') {
        const lv = node.attrs.level; let num = '';
        if (lv === 2) { n2++; n3 = 0; num = n2 + '.'; } else if (lv === 3) { n3++; num = n2 + '.' + n3 + '.'; }
        const h = { hid: node.attrs.hid, level: lv, title: node.textContent.trim(), num, pos, end: pos + node.nodeSize, words: 0, cites: 0 };
        if (lv === 2) { cur2 = h; cur3 = null; } else if (lv === 3) cur3 = h; else { cur2 = cur3 = null; }
        d.heads.push(h);
        if (num) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num': num }));
        return false;
      }
      if (!node.isTextblock) return true;
      let text = ''; const kids = [];
      node.forEach((ch, off) => { text += ch.isText ? ch.text : '￼'; kids.push({ ch, off }); });
      const base = pos + 1, w = wc(text.replace(/￼/g, ' '));
      d.words += w; if (cur2) cur2.words += w; if (cur3) cur3.words += w;
      kids.forEach((k, i) => {
        if (k.ch.type.name !== 'citation') return;
        const id = k.ch.attrs.sourceId, p = base + k.off;
        d.cited[id] = (d.cited[id] || 0) + 1; (d.citePos[id] = d.citePos[id] || []).push(p);
        if (!srcById(id)) d.badCites.push(p);
        if (cur2) cur2.cites++; if (cur3) cur3.cites++;
        const nx = kids[i + 1];
        if (nx && nx.ch.type.name === 'citation') { decos.push(Decoration.node(p, p + 1, { class: 'jn' })); decos.push(Decoration.node(base + nx.off, base + nx.off + 1, { class: 'jp' })); }
      });
      const num = (cur3 || cur2 || {}).num || '';
      let m; HOLE.lastIndex = 0;
      while ((m = HOLE.exec(text))) {
        decos.push(Decoration.inline(base + m.index, base + m.index + m[0].length, { class: 'hole' }));
        d.holes.push({ pos: base + m.index, num: num.replace(/\.$/, '') || '·', ctx: (text.slice(Math.max(0, m.index - 44), m.index).replace(/^\S*\s/, '…').replace(/￼/g, '') + m[0]).trim() });
      }
      PLAIN.lastIndex = 0;
      while ((m = PLAIN.exec(text))) {
        decos.push(Decoration.inline(base + m.index, base + m.index + m[0].length, { class: 'plain-cite' }));
        d.plain.push({ from: base + m.index, to: base + m.index + m[0].length, author: m[1].trim(), year: m[2], page: m[3] || '', text: m[0] });
      }
      SENT.lastIndex = 0;
      while ((m = SENT.exec(text))) {
        const raw = m[0]; if (!raw.trim()) { if (!raw.length) SENT.lastIndex++; continue; }
        const a = m.index + (raw.length - raw.trimStart().length), e = m.index + raw.trimEnd().length, sent = text.slice(a, e);
        const cited = sent.includes('￼') || PLAIN.test(sent); PLAIN.lastIndex = 0;
        if (CLAIM.test(sent) && !cited) { d.claims.push(base + a); if (S.warn.claim && S.mode === 'write') decos.push(Decoration.inline(base + a, base + e, { class: 'hint-claim' })); }
        if (wc(sent) > 40) { d.longs.push(base + a); if (S.warn.long && S.mode === 'write') decos.push(Decoration.inline(base + a, base + e, { class: 'hint-long' })); }
      }
      const QUOTE = /„[^”]{15,}”/g;
      while ((m = QUOTE.exec(text))) {
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60), ci = after.indexOf('￼');
        const n = ci >= 0 ? doc.nodeAt(base + m.index + m[0].length + ci) : null;
        const plainPage = /^\s*\([^)]*\d{4}[a-z]?:\s*\d/.test(after);
        if (!(n && n.attrs.page) && !plainPage) d.quotesNoPage.push(base + m.index);
      }
      if (editable && sel.empty && node.type.name === 'paragraph' && node.content.size === 0 && sel.from === base && doc.resolve(pos).depth === 0)
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ghost', 'data-ghost': ghostText(cur2 ? cur2.title : '') }));
      X.hooks.block.forEach(f => f({ node, pos, base, text, kids, decos, d, cur2, cur3, doc, num }));
      return false;
    });
    S.comments.forEach(c => { if (!c.lost && ((!c.resolved && S.warn.cmt) || U.active === c.id)) decos.push(Decoration.inline(c.from, c.to, { class: 'cmt' + (U.active === c.id ? ' on' : ''), 'data-c': c.id })); });
    if (U.draft) decos.push(Decoration.inline(U.draft.from, U.draft.to, { class: 'cmt draft on' }));
    X.hooks.end.forEach(f => f({ doc, decos, d, st }));
    D = d;
    return DecorationSet.create(doc, decos);
  }
  function mapAnchors(tr) {
    const one = c => { const f = tr.mapping.map(c.from, 1), t = tr.mapping.map(c.to, -1); if (t <= f) { c.lost = true; c.from = c.to = f; } else { c.from = f; c.to = t; } };
    S.comments.forEach(c => { if (!c.lost) one(c); });
    if (U.draft) { one(U.draft); if (U.draft.lost) U.draft = null; }
  }
  const pkey = new PluginKey('ductura');
  const Ductura = Extension.create({
    name: 'ductura',
    addGlobalAttributes() {
      return [{ types: ['heading'], attributes: { hid: { default: null, parseHTML: el => el.getAttribute('data-hid'), renderHTML: a => (a.hid ? { 'data-hid': a.hid } : {}) } } }];
    },
    addProseMirrorPlugins() {
      return [new Plugin({
        key: pkey,
        state: { init: (_, st) => build(st), apply(tr, _old, _o, st) { if (tr.docChanged && !skipMap) mapAnchors(tr); return build(st); } },
        props: { decorations(st) { return pkey.getState(st); }, handleKeyDown(_v, e) { return trigKey(e); } },
        appendTransaction(_trs, _o, st) {
          const seen = new Set(); let tr = null;
          st.doc.descendants((n, pos) => { if (n.type.name !== 'heading') return n.type.name !== 'paragraph'; if (!n.attrs.hid || seen.has(n.attrs.hid)) { tr = tr || st.tr; tr.setNodeMarkup(pos, null, { ...n.attrs, hid: uid('h') }); } else seen.add(n.attrs.hid); return false; });
          return tr;
        },
      })];
    },
  });

  /* ---------- Pomoćne radnje nad dokumentom ---------- */
  const refresh = () => editor.view.dispatch(editor.state.tr.setMeta('refresh', 1));
  function jump(pos, select) {
    pos = Math.max(0, Math.min(pos, editor.state.doc.content.size));
    let dom = editor.view.nodeDOM(pos) || editor.view.domAtPos(pos).node; if (dom && dom.nodeType === 3) dom = dom.parentElement;
    if (editor.isEditable && select !== false) { try { editor.commands.setTextSelection(Math.min(pos + 1, editor.state.doc.content.size)); } catch (e) { /* izvan teksta */ } }
    if (dom && dom.scrollIntoView) { dom.scrollIntoView({ block: 'center', behavior: 'smooth' }); dom.classList.remove('flash'); void dom.offsetWidth; dom.classList.add('flash'); }
    closeDrawers();
  }
  function insertCitation(id, page) {
    const { state } = editor, $f = state.selection.$from, nb = $f.nodeBefore;
    let chain = editor.chain().focus();
    if (nb && nb.isText && nb.text === ' ' && $f.parent.childBefore($f.parentOffset - 1).node?.type.name === 'citation') chain = chain.deleteRange({ from: $f.pos - 1, to: $f.pos });
    chain.insertContent([{ type: 'citation', attrs: { sourceId: id, page: page || '' } }, { type: 'text', text: ' ' }]).run();
  }
  function blocksText() { const out = []; editor.state.doc.forEach(n => { const t = n.textBetween(0, n.content.size, ' ', leafText).trim(); if (t) out.push((n.type.name === 'heading' ? '# ' : '') + t); }); return out; }
  function plainText() { return blocksText().map(t => t.replace(/^# /, '')).join('\n\n'); }
  function moveSection(hid, dir) {
    const doc = editor.state.doc, tops = []; doc.forEach((n, off) => tops.push({ n, pos: off }));
    const idx = tops.findIndex(t => t.n.type.name === 'heading' && t.n.attrs.hid === hid); if (idx < 0) return;
    const lv = tops[idx].n.attrs.level; if (lv < 2) return;
    const endOf = i => { let j = i + 1; while (j < tops.length && !(tops[j].n.type.name === 'heading' && tops[j].n.attrs.level <= lv)) j++; return j; };
    let a, b;
    if (dir > 0) { a = idx; b = endOf(idx); if (b >= tops.length || tops[b].n.type.name !== 'heading' || tops[b].n.attrs.level !== lv) return toast('Poglavlje je već zadnje.'); }
    else { let p = idx - 1; while (p >= 0 && !(tops[p].n.type.name === 'heading' && tops[p].n.attrs.level <= lv)) p--; if (p < 0 || tops[p].n.attrs.level !== lv) return toast('Poglavlje je već prvo.'); a = p; b = idx; }
    const c = endOf(b), posOf = i => (i < tops.length ? tops[i].pos : doc.content.size);
    const A = posOf(a), B = posOf(b), C = posOf(c);
    const tr = editor.state.tr.replaceWith(A, C, doc.slice(B, C).content.append(doc.slice(A, B).content));
    skipMap = true; editor.view.dispatch(tr); skipMap = false;
    const fix = x => { if (x.from >= A && x.to <= B) { x.from += C - B; x.to += C - B; } else if (x.from >= B && x.to <= C) { x.from -= B - A; x.to -= B - A; } };
    S.comments.forEach(fix); refresh();
    const h = D.heads.find(x => x.hid === hid); if (h) jump(h.pos);
  }

  /* ---------- Izbornik @ i / ---------- */
  function trigItems() {
    const q = trig.q.toLowerCase();
    if (trig.mode === 'at') return S.sources.filter(s => !q || (s.authors + ' ' + s.full + ' ' + s.year + ' ' + s.title).toLowerCase().split(/[\s,()]+/).some(w => w.startsWith(q))).slice(0, 8)
      .flatMap(s => [{ label: `${s.authors} (${yearLabel(s)})`, hint: s.title.slice(0, 30), run: () => insertCitation(s.id, '') }, ...(X.hooks.atItems ? X.hooks.atItems(s) : [])]).slice(0, 9);
    const C = [
      ['navod', 'Navod', 'isto kao @', () => openCiteMenu()],
      ['rupa', 'Rupa [?]', 'vratite se poslije', () => editor.chain().focus().insertContent('[?] ').run()],
      ['izvor', 'Rupa [izvor]', 'ovdje treba izvor', () => editor.chain().focus().insertContent('[izvor] ').run()],
      ['fraza', 'Fraze', 'akademske fraze', () => openDlg({ type: 'phrases', cat: 0 })],
      ['poglavlje', 'Poglavlje', 'naslov druge razine', () => editor.chain().focus().setHeading({ level: 2 }).run()],
      ['potpoglavlje', 'Potpoglavlje', 'naslov treće razine', () => editor.chain().focus().setHeading({ level: 3 }).run()],
      ['citat', 'Blok-citat', 'navod duži od tri retka', () => editor.chain().focus().toggleBlockquote().run()],
      ['popis', 'Popis', 'natuknice', () => editor.chain().focus().toggleBulletList().run()],
      ...X.hooks.cmds,
    ];
    return C.filter(c => !q || c[0].startsWith(q) || c[1].toLowerCase().startsWith(q)).map(c => ({ label: '/' + c[0], hint: c[2], run: c[3] }));
  }
  function trigCheck() {
    if (!editor.isEditable || !editor.isFocused) return trigClose();
    const sel = editor.state.selection, $f = sel.$from;
    if (!sel.empty || !$f.parent.isTextblock) return trigClose();
    const m = $f.parent.textBetween(0, $f.parentOffset, null, '￼').match(/(^|[\s(￼])([@/])([\p{L}\d]{0,14})$/u);
    if (!m) { trigDismiss = -1; return trigClose(); }
    const start = sel.from - m[3].length - 1; if (start === trigDismiss) return trigClose();
    const idx = trig && trig.start === start && trig.q === m[3] ? trig.idx : 0;
    trig = { mode: m[2] === '@' ? 'at' : 'cmd', q: m[3], start, idx };
    const items = trigItems(); trig.items = items;
    const c = editor.view.coordsAtPos(sel.from);
    openPop((trig.mode === 'at' ? '<div class="mh">Izvori</div>' : '<div class="mh">Naredbe</div>') + (items.length ? items.map((it, i) => `<button class="mi${i === trig.idx ? ' sel' : ''}" data-act="trig" data-i="${i}"><span>${esc(it.label)}</span><small>${esc(it.hint)}</small></button>`).join('') : `<div class="pad muted">${trig.mode === 'at' ? 'Nema takvog izvora. Dodajte ga u kartici Literatura.' : 'Nema takve naredbe.'}</div>`), { left: c.left, right: c.left, top: c.top, bottom: c.bottom }, 'trig');
  }
  function trigClose() { if (trig) { trig = null; if (popKind === 'trig') closePop(); } }
  function trigApply(i) {
    const it = trig && trig.items[i]; if (!it) return;
    const from = trig.start, to = editor.state.selection.from; trigClose();
    editor.chain().focus().deleteRange({ from, to }).run(); it.run();
  }
  function trigKey(e) {
    if (!trig) return false; const n = trig.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!n) return false; trig.idx = (trig.idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; trigCheck(); return true; }
    if ((e.key === 'Enter' || e.key === 'Tab') && n) { trigApply(trig.idx); return true; }
    if (e.key === 'Escape') { trigDismiss = trig.start; trigClose(); return true; }
    return false;
  }
  function openCiteMenu(anchor) {
    const r = anchor ? anchor.getBoundingClientRect() : editor.view.coordsAtPos(editor.state.selection.from);
    openPop('<div class="mh">Umetni navod</div>' + S.sources.map(s => `<button class="mi" data-act="citeIns" data-id="${esc(s.id)}"><span>${esc(s.authors)} (${yearLabel(s)})</span><small>${esc(s.title.slice(0, 26))}</small></button>`).join('') + '<div class="pad muted">Brže: upišite @ u tekstu.</div>', r, 'menu');
  }

  /* ---------- Plutajući prozori ---------- */
  let popKind = null;
  function openPop(html, r, kind) {
    const p = $('#pop'); p.innerHTML = html; p.hidden = false; popKind = kind || 'menu';
    const w = p.offsetWidth, h = p.offsetHeight, vw = innerWidth, vh = innerHeight;
    let left = Math.min(Math.max(8, r.left), vw - w - 8), top = r.bottom + 6; if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    p.style.left = left + 'px'; p.style.top = top + 'px';
  }
  function closePop() { $('#pop').hidden = true; popKind = null; }
  function openDlg(d) { U.dlg = d; closePop(); renderDlg(); }
  function closeDlg() { U.dlg = null; renderDlg(); }
  let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  function closeDrawers() { $('#app').classList.remove('rail-open', 'panel-open'); }
  function showTab(tab) { S.tab = tab; if (innerWidth <= 1050) $('#app').classList.add('panel-open'); renderPanel(true); }

  /* ---------- Provjere ---------- */
  function runChecks() {
    const out = [], add = (sev, t, d, pos, tab) => out.push({ sev, t, d, pos, tab });
    if (D.holes.length) add('block', `Rupe u tekstu: ${D.holes.length}`, 'Oznake poput [?] i [izvor] moraju biti riješene prije predaje.', D.holes[0].pos);
    if (D.badCites.length) add('block', `Navodi čiji izvor više nije u popisu: ${D.badCites.length}`, 'Vratite izvor u Literaturu ili uklonite navod.', D.badCites[0]);
    if (D.words < TASK.min) add('warn', 'Opseg je ispod zadanog', `${D.words} od najmanje ${TASK.min} riječi.`);
    else if (D.words > TASK.max) add('warn', 'Opseg je iznad zadanog', `${D.words} od najviše ${TASK.max} riječi.`);
    else add('ok', 'Opseg je u zadanim granicama', `${D.words} riječi.`);
    const h2 = D.heads.filter(h => h.level === 2);
    if (!h2.some(h => /uvod/i.test(h.title))) add('warn', 'Nedostaje poglavlje Uvod', 'Rad počinje uvodom s ciljem i pitanjem.');
    if (!h2.some(h => /zaklju/i.test(h.title))) add('warn', 'Nedostaje poglavlje Zaključak', 'Rad završava odgovorom na pitanje iz uvoda.');
    h2.filter(h => !h.words).forEach(h => add('warn', `Poglavlje „${h.title || 'bez naslova'}” nema teksta`, 'Naslov bez teksta ispod sebe.', h.pos));
    h2.filter(h => h.words && !h.cites && !/uvod|zaklju/i.test(h.title)).forEach(h => add('warn', `Poglavlje „${h.title}” nema nijedan navod`, RULES.claim.why, h.pos));
    if (D.quotesNoPage.length) add('warn', `Doslovni navodi bez stranice: ${D.quotesNoPage.length}`, RULES.page.why, D.quotesNoPage[0]);
    if (D.claims.length) add('warn', `Tvrdnje bez izvora: ${D.claims.length}`, RULES.claim.why, D.claims[0]);
    if (D.longs.length) add('warn', `Duge rečenice: ${D.longs.length}`, RULES.sent.why, D.longs[0]);
    if (D.plain.length) add('warn', `Navodi upisani kao tekst: ${D.plain.length}`, 'Nisu povezani s izvorom u popisu, pa ne ulaze u Literaturu.', D.plain[0].from, 'lit');
    const unc = S.sources.filter(s => !D.cited[s.id]).length;
    if (unc) add('warn', `Izvori koji nisu citirani: ${unc}`, 'U popis literature ulaze samo citirani izvori.', null, 'lit');
    const aw = wc(S.abs), kw = S.kw.split(/[,;]/).map(x => x.trim()).filter(Boolean).length;
    if (aw < 150 || aw > 300) add('warn', 'Sažetak nije u granicama', `${aw} riječi; očekuje se 150 do 300 (potvrditi prema Uputama).`, null, 'rad'); else add('ok', 'Sažetak je u granicama', `${aw} riječi.`);
    if (kw < 3 || kw > 5) add('warn', 'Ključne riječi', `${kw} upisano; očekuje se 3 do 5 (potvrditi prema Uputama).`, null, 'rad');
    const open = S.comments.filter(c => !c.resolved).length;
    if (open) add('warn', `Otvoreni komentari: ${open}`, 'Odgovorite ili označite kao riješeno prije slanja.', null, 'cmt');
    X.hooks.checks.forEach(f => f(add));
    return out;
  }

  /* ---------- Iscrtavanje ---------- */
  const STAT = ['skica', 'u radu', 'gotovo'];
  function renderRail() {
    const sel = editor.state.selection.from; let act = null; D.heads.forEach(h => { if (h.pos <= sel) act = h; });
    const pct = Math.min(100, Math.round(D.words / TASK.min * 100));
    $('#rail').innerHTML = `<h2>Struktura</h2>` + (D.heads.length ? D.heads.map(h => {
      const on = act === h, st = S.statuses[h.hid] || 0;
      return `<button class="oi l${h.level}${on ? ' act' : ''}" data-act="jump" data-pos="${h.pos}"><span class="n">${h.num}</span><span class="t">${esc(h.title || 'Bez naslova')}</span>${h.level > 1 ? `<span class="w">${h.words}</span>` : ''}</button>` +
        (on && h.level > 1 && S.mode === 'write' && !S.submitted ? `<div class="oirow"><button class="chip${st === 2 ? ' done' : ''}" data-act="status" data-hid="${h.hid}" title="Promijeni stanje poglavlja">${STAT[st]}</button><span class="grow"></span><button class="mini" data-act="move" data-hid="${h.hid}" data-dir="-1" title="Premjesti gore" aria-label="Premjesti poglavlje gore">↑</button><button class="mini" data-act="move" data-hid="${h.hid}" data-dir="1" title="Premjesti dolje" aria-label="Premjesti poglavlje dolje">↓</button></div>` : '');
    }).join('') : '<p class="muted" style="margin:6px">Još nema naslova. Upišite /poglavlje u tekstu.</p>') +
      `<div class="railfoot"><div>${D.words} od ${TASK.min} do ${TASK.max} riječi</div><div class="bar"><i style="width:${pct}%"></i></div><div>Rok: ${TASK.due}</div></div>`;
  }
  function renderBib() {
    const list = S.sources.filter(s => D.cited[s.id]).sort((a, b) => a.full.localeCompare(b.full, 'hr') || String(a.year).localeCompare(String(b.year)) || a.title.localeCompare(b.title, 'hr'));
    $('#bib').innerHTML = `<h2>Literatura</h2>` + (list.length ? list.map(s => `<p>${bibEntry(s)}</p>`).join('') : '<p class="note">Popis se slaže sam iz navoda u tekstu.</p>') + `<p class="note">Popis se slaže sam iz navoda u tekstu, stil: ${{ fpzg: 'FPZG', apa: 'APA', chicago: 'Chicago' }[S.citeStyle]}.</p>`;
  }
  function renderStatus() {
    const pages = Math.max(1, Math.ceil(D.words / 350));
    const sv = U.save === 'saving' ? '<span class="dot saving"></span>Sprema se…' : U.save === 'none' ? '<span class="dot"></span>Pohrana u pregledniku nije dostupna' : '<span class="dot local"></span>Spremljeno na ovom uređaju · poslužitelj nije spojen';
    $('#status').innerHTML = `<span>${sv}</span><span>${D.words} / ${TASK.min} do ${TASK.max} riječi · ≈ ${pages} str.</span>` +
      (D.holes.length ? `<button class="err" data-act="holes">${D.holes.length} ${plural(D.holes.length, 'rupa', 'rupe', 'rupa')}</button>` : '<span>bez rupa</span>') +
      (U.selWords ? `<span>označeno: ${U.selWords} ${plural(U.selWords, 'riječ', 'riječi', 'riječi')}</span>` : '') +
      (S.submitted ? '<span>Rad je predan, tekst je zaključan</span>' : '');
  }
  function renderChrome() {
    const app = $('#app'); app.dataset.mode = S.mode; if (S.submitted) app.dataset.locked = '1'; else delete app.dataset.locked;
    document.documentElement.dataset.theme = S.theme; $('#sheet').dataset.sheetTheme = S.sheet;
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.mode)));
    const on = (a, v) => { const b = $(`.tb[data-act="${a}"]`); if (b) b.classList.toggle('on', !!v); };
    on('bold', editor.isActive('bold')); on('italic', editor.isActive('italic')); on('list', editor.isActive('bulletList')); on('quote', editor.isActive('blockquote'));
    $('#blockStyle').value = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
    $('#banner').innerHTML = X.hooks.banner.map(f => f()).join('') + (S.submitted ? `<div class="banner"><span><b>Rad je predan</b> ${esc(S.submitted.when)}. Tekst je zaključan.</span><span class="grow"></span><button class="lnk" data-act="receipt">Potvrda</button><button class="lnk" data-act="unsubmit">Vrati u uređivanje (samo prototip)</button></div>`
      : S.mode === 'teacher' ? `<div class="banner"><span><b>Pogled nastavnika.</b> Tekst je samo za čitanje. Označite dio odlomka i odaberite Komentar.</span></div>` : '');
  }
  const TABS = [['lit', 'Literatura'], ['nacrt', 'Nacrt'], ['upute', 'Upute'], ['cmt', 'Komentari'], ['rad', 'Rad'], ['ai', 'Asistent']];
  function renderPanel(force) {
    const ae = document.activeElement;
    if (!force && ae && $('#pbody').contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    if (X.rpRender) return X.rpRender();
    const open = S.comments.filter(c => !c.resolved).length, blocks = runChecks().filter(f => f.sev !== 'ok').length;
    $('#tabs').innerHTML = `<button class="pclose" data-act="closeDrawers" aria-label="Zatvori panel" title="Zatvori panel">✕</button>` + TABS.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-act="tab" data-v="${k}">${l}${k === 'cmt' && open ? `<span class="cnt">${open}</span>` : ''}${k === 'upute' && blocks ? `<span class="cnt">${blocks}</span>` : ''}</button>`).join('');
    const keep = $('#pbody').scrollTop;
    $('#pbody').innerHTML = (X.panels[S.tab] || X.panels.lit)();
    $('#pbody').scrollTop = keep;
  }
  function panelLit() {
    const ro = S.mode === 'teacher' || S.submitted, q = U.litQ.toLowerCase();
    const list = S.sources.filter(s => !q || (s.full + ' ' + s.title + ' ' + s.year).toLowerCase().includes(q));
    const card = s => {
      const n = D.cited[s.id] || 0, iss = srcIssues(s);
      return `<div class="card"><h4>${esc(s.authors)} (${yearLabel(s)})</h4><div>${esc(s.title)}</div><div class="meta" style="margin-top:4px"><span class="tag">${esc(s.kind)}</span>${n ? `<button class="lnk" data-act="citeNext" data-id="${esc(s.id)}">citirano ${n}× ›</button>` : '<span>nije citirano</span>'}${iss.map(i => `<span class="tag warn">${esc(i)}</span>`).join('')}</div>${ro ? '' : `<div class="row" style="margin-top:8px"><button class="btn sm" data-act="citeIns" data-id="${esc(s.id)}">Citiraj</button><button class="lnk" data-act="srcEdit" data-id="${esc(s.id)}">Uredi</button><button class="lnk" data-act="srcDel" data-id="${esc(s.id)}">Ukloni</button></div>`}${X.hooks.litCard ? X.hooks.litCard(s, ro) : ''}</div>`;
    };
    const f = U.litForm;
    const form = f ? `<div class="card on"><h4>${f.id ? 'Uredi izvor' : 'Novi izvor'}</h4>
      <label class="f">Vrsta</label><select class="in" data-bind="litForm.kind">${['knjiga', 'članak', 'poglavlje', 'institucijski autor', 'mrežni izvor'].map(k => `<option${f.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select>
      <label class="f">Autor u navodu (npr. Kovač ili Kovač i Horvat)</label><input class="in" data-bind="litForm.authors" value="${esc(f.authors)}">
      <label class="f">Autor u popisu (npr. Kovač, Ana)</label><input class="in" data-bind="litForm.full" value="${esc(f.full)}">
      <label class="f">Godina</label><input class="in" inputmode="numeric" data-bind="litForm.year" value="${esc(f.year)}">
      <label class="f">Naslov</label><input class="in" data-bind="litForm.title" value="${esc(f.title)}">
      <label class="f">Nakladnik ili časopis (npr. Zagreb: Nakladnik)</label><input class="in" data-bind="litForm.pub" value="${esc(f.pub)}">
      <div class="row" style="margin-top:10px"><button class="btn pri sm" data-act="srcSave">Spremi</button><button class="btn sm" data-act="srcCancel">Odustani</button></div></div>` : '';
    const imp = U.litImport ? `<div class="card on"><h4>Uvoz literature</h4><p class="muted">Zalijepite BibTeX ili RIS zapis (izvoz iz Zotera, Mendeleya ili kataloga).</p><textarea class="ta" id="impTxt" rows="6" placeholder="@book{kovac2019, author = {Kovač, Ana}, title = {…}, year = {2019}, publisher = {…}}"></textarea><label class="f">Ili odaberite datoteku .bib / .ris</label><input type="file" id="impFile" accept=".bib,.ris,.txt" class="in"><div class="row" style="margin-top:8px"><button class="btn pri sm" data-act="impRun">Uvezi</button><button class="btn sm" data-act="impCancel">Odustani</button></div></div>` : '';
    const plain = D.plain.length ? `<div class="ptitle">Navodi bez izvora (${D.plain.length})</div>` + D.plain.map((p, i) => {
      const m = S.sources.find(s => s.authors.toLowerCase() === p.author.toLowerCase() && String(s.year) === p.year);
      return `<div class="card"><div class="q">${esc(p.text)}</div><div class="row"><button class="lnk" data-act="jump" data-pos="${p.from}">Pokaži</button>${ro ? '' : m ? `<button class="btn sm" data-act="plainLink" data-i="${i}" data-id="${esc(m.id)}">Poveži s izvorom</button>` : `<button class="btn sm" data-act="plainAdd" data-i="${i}">Dodaj izvor</button>`}</div></div>`;
    }).join('') : '';
    const cited = list.filter(s => D.cited[s.id]), un = list.filter(s => !D.cited[s.id]);
    return `<div class="row"><input class="in" style="flex:1;min-width:120px" placeholder="Traži izvor" data-bind="litQ" data-live="1" value="${esc(U.litQ)}">${ro ? '' : '<button class="btn sm" data-act="quick">+ Izvor</button><button class="btn sm" data-act="impOpen">Uvezi</button>'}</div>
      <div style="margin-top:10px">${form}${imp}</div>${plain}
      <div class="ptitle">Citirano (${cited.length})</div>${cited.map(card).join('') || '<p class="muted">Još nema navoda u tekstu.</p>'}
      <div class="ptitle">Nije citirano (${un.length})</div>${un.map(card).join('') || '<p class="muted">Svi izvori su citirani.</p>'}${X.hooks.litExtra ? X.hooks.litExtra(ro) : ''}`;
  }
  function panelNacrt() {
    const ro = S.mode === 'teacher' || S.submitted; let html = `<div class="ptitle">Nit argumenta</div><label class="f">Glavna tvrdnja rada</label><textarea class="ta" data-bind="S.thesis"${ro ? ' readonly' : ''}>${esc(S.thesis)}</textarea>`;
    D.heads.filter(h => h.level === 2).forEach(h => { html += `<label class="f">${h.num} ${esc(h.title)}: čemu služi?</label><input class="in" data-bind="S.purposes.${h.hid}" value="${esc(S.purposes[h.hid] || '')}" placeholder="Jedna rečenica o svrsi poglavlja"${ro ? ' readonly' : ''}>`; });
    html += `<div class="ptitle">Obrnuti nacrt</div><p class="muted">Prva rečenica svakog odlomka. Ako se iz njih ne vidi tijek rada, odlomak treba jasniji početak.</p>`;
    let any = false;
    editor.state.doc.forEach((n, off) => {
      if (n.type.name === 'heading' && n.attrs.level > 1) html += `<div class="muted" style="margin-top:10px;font-weight:600">${esc(n.textContent)}</div>`;
      else if (n.type.name === 'paragraph' && n.textContent.trim()) { const t = n.textBetween(0, n.content.size, ' ', leafText).trim(), fm = t.match(/^.*?[.!?…](?=\s|$)/), first = fm ? fm[0] : t, w = wc(first); any = true; html += `<button class="ro" data-act="jump" data-pos="${off}">${esc(first.length > 200 ? first.slice(0, 197) + '…' : first)}${w > 35 ? ` <span class="tag warn">${w} riječi</span>` : ''}</button>`; }
    });
    return html + (any ? '' : '<p class="muted">Još nema odlomaka.</p>');
  }
  function panelUpute() {
    const f = runChecks(), b = f.filter(x => x.sev === 'block').length, w = f.filter(x => x.sev === 'warn').length;
    return `<div class="ptitle">Provjere u tekstu</div><p class="muted">Zahtjevi fakulteta su u lijevom panelu, pod Zahtjevi rada. ${b ? `${b} ${plural(b, 'stavka blokira', 'stavke blokiraju', 'stavki blokira')} predaju` : 'Ništa ne blokira predaju'} · ${w} ${plural(w, 'upozorenje', 'upozorenja', 'upozorenja')}.</p>` +
      f.map(x => { const inner = `<span class="s ${x.sev}">${x.sev === 'ok' ? '✓' : '!'}</span><span><b>${esc(x.t)}</b><span class="d">${esc(x.d)}</span></span>`; return x.pos != null || x.tab ? `<button class="fx" data-act="finding" data-pos="${x.pos ?? ''}" data-tab="${x.tab || ''}">${inner}</button>` : `<div class="fx">${inner}</div>`; }).join('') +
      `<div class="ptitle">Pravila</div>` + Object.entries(RULES).map(([k, r]) => `<div class="card"><button class="lnk" data-act="rule" data-k="${k}">${esc(r.t)}</button>${U.ruleOpen[k] ? `<p style="margin:6px 0 2px">${esc(r.why)}</p><p class="muted" style="margin:0">${esc(r.ex)}</p>` : ''}</div>`).join('');
  }
  function panelCmt() {
    const T = S.mode === 'teacher', r = S.review, lbl = { revise: 'Čeka doradu', review: 'Na pregledu kod nastavnika', accepted: 'Prihvaćeno', draft: 'Još nije slano mentoru' }[r.status];
    let html = `<div class="card"><div class="meta"><span class="tag ${r.status === 'accepted' ? 'ok' : r.status === 'revise' ? 'warn' : ''}">${lbl}</span><span>runda ${r.round}</span>${r.status === 'revise' && r.req ? `<span>rok ${esc(r.req.due)}</span>` : ''}</div>${r.status === 'revise' && r.req ? `<p style="margin:8px 0 4px">${esc(r.req.text)}</p><div class="muted">Nastavnik A, ${esc(r.req.when)}</div>` : ''}<div class="row" style="margin-top:8px">` +
      (T ? (r.status !== 'accepted' ? `<button class="btn sm" data-act="reqOpen">Zatraži doradu</button><button class="btn sm" data-act="accept">Prihvati rad</button>` : '') + `<button class="lnk" data-act="diff">Promjene od runde ${r.round}</button>` : ((r.status === 'revise' || r.status === 'draft') && !S.submitted ? `<button class="btn pri sm" data-act="sendReview">${r.status === 'draft' ? 'Pošalji mentoru na pregled' : 'Pošalji doradu na pregled'}</button>` : '') + `<button class="lnk" data-act="diff">Što sam promijenio/la</button>`) + `<button class="lnk" data-act="log">Dnevnik</button></div></div>`;
    if (U.reqForm) html += `<div class="card on"><h4>Zahtjev za doradu</h4><label class="f">Što treba doraditi</label><textarea class="ta" data-bind="reqForm.text">${esc(U.reqForm.text)}</textarea><label class="f">Rok</label><input class="in" data-bind="reqForm.due" value="${esc(U.reqForm.due)}" placeholder="npr. 30. 11. 2026."><div class="row" style="margin-top:8px"><button class="btn pri sm" data-act="reqSend">Pošalji</button><button class="btn sm" data-act="reqCancel">Odustani</button></div></div>`;
    if (U.draft) html += `<div class="card on"><h4>Novi komentar</h4><div class="q">${esc(U.draft.quote)}</div><textarea class="ta" id="cmText" data-bind="draft.text" placeholder="Komentar (Ctrl+Enter objavi, Esc odustani)">${esc(U.draft.text || '')}</textarea>` +
      (T ? `<label class="f">Prijedlog izmjene (nije obvezno)</label><input class="in" data-bind="draft.neu" value="${esc(U.draft.neu || '')}" placeholder="Tekst koji bi zamijenio označeno"><label class="f">Pravilo uz komentar</label><select class="in" data-bind="draft.rule"><option value="">bez pravila</option>${Object.entries(RULES).map(([k, x]) => `<option value="${k}"${U.draft.rule === k ? ' selected' : ''}>${esc(x.t)}</option>`).join('')}</select>` : '') +
      `<div class="row" style="margin-top:8px"><button class="btn pri sm" data-act="cmPost">Objavi</button><button class="btn sm" data-act="cmCancel">Odustani</button></div></div>`;
    const sorted = [...S.comments].sort((a, b) => (a.resolved - b.resolved) || (a.from - b.from));
    if (!sorted.length && !U.draft) html += `<p class="muted">Nema komentara. Označite dio odlomka i odaberite Komentar.</p>`;
    sorted.forEach(c => {
      const cur = c.lost ? '' : editor.state.doc.textBetween(c.from, c.to, ' ', leafText), changed = !c.lost && cur !== c.quote && !(c.sugg && c.sugg.state === 'accepted');
      html += `<div class="card${U.active === c.id ? ' on' : ''}" data-cid="${c.id}"><div class="meta"><b style="color:var(--ink)">#${c.n}</b><span>${esc(c.who)}</span><span>${esc(c.when)}</span>${c.resolved ? `<span class="tag ok">${c.why != null ? 'riješeno bez izmjene' : 'riješeno'}</span>` : ''}${c.q ? '<span class="tag">pitanje mentoru</span>' : ''}${c.lost ? '<span class="tag">tekst je obrisan</span>' : changed ? '<span class="tag warn">izmijenjeno nakon komentara</span>' : ''}</div>
        <button class="q" style="display:block;width:100%;text-align:left" data-act="cmFocus" data-id="${c.id}">${esc(c.quote)}</button><div>${esc(c.text)}</div>${c.why ? `<div class="muted" style="margin-top:4px">Obrazloženje: ${esc(c.why)}</div>` : ''}` +
        (c.rule && RULES[c.rule] ? `<div style="margin-top:6px"><button class="lnk" data-act="rule" data-k="${c.rule}">Pravilo: ${esc(RULES[c.rule].t)}</button>${U.ruleOpen[c.rule] ? `<p class="muted" style="margin:4px 0 0">${esc(RULES[c.rule].why)} ${esc(RULES[c.rule].ex)}</p>` : ''}</div>` : '') +
        (c.sugg ? `<div class="sugg"><del>${esc(c.sugg.old)}</del> → <ins>${esc(c.sugg.neu)}</ins>${c.sugg.state ? `<div class="muted" style="font-family:var(--ff-ui);margin-top:4px">${c.sugg.state === 'accepted' ? 'Prijedlog je prihvaćen.' : 'Prijedlog je odbijen.'}</div>` : (!T && !S.submitted && !c.lost ? `<div class="row" style="margin-top:6px;font-family:var(--ff-ui)"><button class="btn sm" data-act="suggOk" data-id="${c.id}">Prihvati</button><button class="btn sm" data-act="suggNo" data-id="${c.id}">Odbij</button></div>` : '')}</div>` : '') +
        c.replies.map(x => `<div class="reply"><div class="meta"><span>${esc(x.who)}</span><span>${esc(x.when)}</span></div>${esc(x.text)}</div>`).join('') +
        (U.replyFor === c.id ? `<div class="reply"><textarea class="ta" id="rpText" placeholder="Odgovor"></textarea><div class="row" style="margin-top:6px"><button class="btn pri sm" data-act="rpSend" data-id="${c.id}">Pošalji</button><button class="btn sm" data-act="rpCancel">Odustani</button></div></div>`
          : `<div class="row" style="margin-top:8px"><button class="lnk" data-act="rpOpen" data-id="${c.id}">Odgovori</button><button class="lnk" data-act="cmResolve" data-id="${c.id}">${c.resolved ? 'Otvori ponovno' : 'Označi riješeno'}</button></div>`) + `</div>`;
    });
    return html;
  }
  function aiText() { const a = S.ai; if (a.none) return 'Izjavljujem da u izradi ovog rada nisam koristio/la alate umjetne inteligencije.'; if (!a.tools.trim()) return ''; return `U izradi ovog rada korišteni su sljedeći alati: ${a.tools.trim()}. Svrha uporabe: ${a.purposes.length ? a.purposes.join(', ') : 'nije navedena'}. Sav tekst rada napisao/la sam samostalno i odgovaram za njegov sadržaj.`; }
  function panelRad() {
    const ro = S.mode === 'teacher' || S.submitted, aw = wc(S.abs), a = S.ai;
    return `<div class="ptitle">Zadatak</div><div class="card"><h4>${TASK.course} / ${TASK.title}</h4><div class="muted">Rok ${TASK.due} · opseg ${TASK.min} do ${TASK.max} riječi · stil navođenja FPZG</div></div>
      <div class="ptitle">Etape</div>${S.stages.map(s => `<div class="stg ${s.st}"><span class="b">${s.st === 'ok' ? '✓' : ''}</span><span>${esc(s.n)}</span><span class="grow"></span><span class="muted">${s.st === 'ok' ? 'odobreno ' + s.d : s.st === 'sub' ? 'predano ' + s.d : ''}</span></div>`).join('')}
      <div class="ptitle">Sažetak i ključne riječi</div><textarea class="ta" rows="5" data-bind="S.abs" data-count="absN" placeholder="Sažetak, 150 do 300 riječi"${ro ? ' readonly' : ''}>${esc(S.abs)}</textarea><div class="muted"><span id="absN">${aw}</span> riječi</div>
      <label class="f">Ključne riječi (3 do 5, odvojene zarezom)</label><input class="in" data-bind="S.kw" value="${esc(S.kw)}"${ro ? ' readonly' : ''}>
      <div class="ptitle">Izjava o alatima</div><label class="check"><input type="checkbox" data-bind="S.ai.none"${a.none ? ' checked' : ''}${ro ? ' disabled' : ''}><span>Nisam koristio/la alate umjetne inteligencije</span></label>
      ${a.none ? '' : `<label class="f">Koji alati</label><input class="in" data-bind="S.ai.tools" value="${esc(a.tools)}" placeholder="npr. alat za provjeru pravopisa"${ro ? ' readonly' : ''}><label class="f">Za što</label><div class="row">${AI_PURPOSES.map(p => `<button class="chip${a.purposes.includes(p) ? ' done' : ''}" data-act="aiPurp" data-v="${p}"${ro ? ' disabled' : ''}>${a.purposes.includes(p) ? '✓ ' : ''}${p}</button>`).join('')}</div>`}
      ${aiText() ? `<div class="q" style="margin-top:8px" id="aiOut">${esc(aiText())}</div>` : '<p class="muted" id="aiOut">Izjava se slaže iz odgovora i ide u Prilog rada.</p>'}
      <div class="ptitle">Predaja</div><div class="row">${S.submitted ? '<button class="btn sm" data-act="receipt">Potvrda o predaji</button>' : `<button class="btn pri" data-act="submit"${S.mode === 'teacher' ? ' disabled' : ''}>Predaj rad</button>`}<button class="btn sm" data-act="copy">Kopiraj tekst rada</button></div>
      <div class="ptitle">Prototip</div><p class="muted">Sve se čuva samo u ovom pregledniku. Izvoz u .docx i PDF dolazi kad se spoji poslužitelj.</p><button class="lnk" data-act="reset">Vrati početni primjer</button>`;
  }

  function wdiff(a, b) {
    const A = a.split(/(\s+)/), B = b.split(/(\s+)/), n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let out = '', i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { out += esc(A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out += `<del>${esc(A[i++])}</del>`; else out += `<ins>${esc(B[j++])}</ins>`; }
    while (i < n) out += `<del>${esc(A[i++])}</del>`; while (j < m) out += `<ins>${esc(B[j++])}</ins>`; return out;
  }
  function diffHtml(A0) {
    const A = A0 || S.review.snapshot || [], B = blocksText(), n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = []; let i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', A[i++]]); else ops.push(['+', B[j++]]); }
    while (i < n) ops.push(['-', A[i++]]); while (j < m) ops.push(['+', B[j++]]);
    let html = '', head = '', k = 0, any = false; const show = t => esc(t.replace(/^# /, ''));
    const hd = () => { if (head) { html += `<h5>${esc(head)}</h5>`; head = ''; } };
    while (k < ops.length) {
      const [op, t] = ops[k];
      if (op === '=') { if (t.startsWith('# ')) head = t.slice(2); k++; continue; }
      any = true; hd();
      if (op === '-' && ops[k + 1] && ops[k + 1][0] === '+') { html += `<p>${wdiff(t.replace(/^# /, ''), ops[k + 1][1].replace(/^# /, ''))}</p>`; k += 2; }
      else { html += op === '-' ? `<p><del>${show(t)}</del></p>` : `<p><ins>${show(t)}</ins></p>`; k++; }
    }
    return any ? html : '<p class="muted" style="font-family:var(--ff-ui)">Nema promjena od zadnje predaje na pregled.</p>';
  }
  function renderDlg() {
    const d = U.dlg, el = $('#dlg'); if (!d) { el.hidden = true; el.innerHTML = ''; return; }
    let h = X.hooks.dlg[d.type] ? X.hooks.dlg[d.type](d) : '';
    if (h) { /* dodatak */ } else if (d.type === 'phrases') h = `<h3>Fraze</h3><p class="muted">Fraza se umeće na mjesto kursora, a oznaka … ostaje označena da je odmah zamijenite.</p><div class="row" style="margin:10px 0">${PHRASES.map((p, i) => `<button class="chip${d.cat === i ? ' done' : ''}" data-act="phrCat" data-i="${i}">${p[0]}</button>`).join('')}</div>${PHRASES[d.cat][1].map(t => `<button class="phr" data-act="phrIns" data-t="${esc(t)}">${esc(t)}</button>`).join('')}<div class="foot"><button class="btn" data-act="dlgClose">Zatvori</button></div>`;
    else if (d.type === 'holes') h = `<h3>Rupe u tekstu</h3><p class="muted">Rupe blokiraju predaju dok se ne riješe.</p>${D.holes.map(x => `<button class="fx" data-act="jumpClose" data-pos="${x.pos}"><span class="s block">!</span><span><b>Poglavlje ${esc(x.num)}</b><span class="d">${esc(x.ctx)}</span></span></button>`).join('')}<div class="foot"><button class="btn" data-act="dlgClose">Zatvori</button></div>`;
    else if (d.type === 'diff') h = `<h3>${esc(d.title || 'Promjene od runde ' + S.review.round)}</h3><p class="muted">Brisano je precrtano, dodano je označeno.</p><div class="diff">${diffHtml(d.base)}</div><div class="foot"><button class="btn" data-act="dlgClose">Zatvori</button></div>`;
    else if (d.type === 'log') h = `<h3>Dnevnik dorade</h3>${S.review.log.map(x => `<div class="fx"><span><b>${esc(x.what)}</b><span class="d">${esc(x.who)}, ${esc(x.when)}</span></span></div>`).join('')}<div class="foot"><button class="btn" data-act="dlgClose">Zatvori</button></div>`;
    else if (d.type === 'receipt') { const r = S.submitted; h = `<h3>Potvrda o predaji</h3><div class="receipt"><dl><dt>Rad</dt><dd>${esc(r.title)}</dd><dt>Student</dt><dd>Student A</dd><dt>Kolegij</dt><dd>${TASK.course} / ${TASK.title}</dd><dt>Vrijeme</dt><dd>${esc(r.when)} (sat ovog uređaja)</dd><dt>Opseg</dt><dd>${r.words} riječi</dd><dt>Sažetak dokumenta</dt><dd class="mono">${esc(r.hash)}</dd></dl></div><p class="muted" style="margin-top:10px">Prototip: ništa nije poslano na poslužitelj. Vrijeme i potpis u aplikaciji daje poslužitelj.</p><div class="foot"><button class="btn" data-act="dlgClose">Zatvori</button></div>`; }
    else if (d.type === 'submit') {
      const f = runChecks(), blocks = f.filter(x => x.sev === 'block'), warns = f.filter(x => x.sev === 'warn');
      const steps = `<div class="steps">${['Provjera', 'Izjava', 'Potvrda'].map((s, i) => `<span class="${d.step === i ? 'cur' : ''}">${i + 1} ${s}</span>`).join('')}</div>`;
      if (d.step === 0) h = `<h3>Prije predaje</h3>${steps}${blocks.length ? `<p><b>Predaja je blokirana.</b> Riješite označeno pa pokušajte ponovno.</p>` : '<p>Ništa ne blokira predaju.</p>'}${[...blocks, ...warns].map(x => `<div class="fx"><span class="s ${x.sev}">!</span><span><b>${esc(x.t)}</b><span class="d">${esc(x.d)}</span></span></div>`).join('')}${warns.length ? '<p class="muted">Upozorenja ne blokiraju predaju.</p>' : ''}<div class="foot"><button class="btn" data-act="dlgClose">Odustani</button><button class="btn pri" data-act="subNext"${blocks.length ? ' disabled' : ''}>Dalje</button></div>`;
      else if (d.step === 1) h = `<h3>Izjava</h3>${steps}<div class="ptitle">Alati</div>${aiText() ? `<div class="q">${esc(aiText())}</div>` : '<p class="muted">Izjava o alatima nije ispunjena (kartica Rad). Možete nastaviti; ostaje prazna u Prilogu.</p>'}<div class="ptitle">Autorstvo</div><label class="check"><input type="checkbox" data-bind="S.agree" data-rerender="dlg"${S.agree ? ' checked' : ''}><span>Izjavljujem da sam ovaj rad napisao/la samostalno i da su svi preuzeti dijelovi označeni navodom izvora.</span></label><div class="foot"><button class="btn" data-act="subBack">Natrag</button><button class="btn pri" data-act="subDo"${S.agree ? '' : ' disabled'}>Predaj rad</button></div>`;
    }
    el.innerHTML = `<div class="dialog${d.wide ? ' wide' : ''}" role="dialog" aria-modal="true">${h}</div>`; el.hidden = false;
  }

  let raf = 0, saveT = 0;
  function renderAll(forcePanel) { X.render.chrome(); X.render.rail(); X.render.bib(); X.render.status(); X.hooks.paint.forEach(f => f()); renderPanel(forcePanel); }
  let slowT = 0;
  function schedule() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; X.render.chrome(); X.render.status(); X.hooks.paint.forEach(f => f()); });
    clearTimeout(slowT); slowT = setTimeout(() => { X.render.rail(); X.render.bib(); renderPanel(); }, 180);
  }
  function persist() {
    U.save = 'saving'; clearTimeout(saveT);
    saveT = setTimeout(() => { U.save = store.save({ doc: editor.getJSON(), S }) ? 'local' : 'none'; X.render.status(); }, 500);
  }
  function setMode() { editor.setEditable(S.mode === 'write' && !S.submitted && !U.ro); refresh(); }

  /* ---------- Radnje ---------- */
  function startComment() {
    let from, to; const ds = getSelection();
    if (ds && ds.rangeCount && !ds.isCollapsed && $('#ed').contains(ds.anchorNode)) { const r = ds.getRangeAt(0); try { from = editor.view.posAtDOM(r.startContainer, r.startOffset); to = editor.view.posAtDOM(r.endContainer, r.endOffset); } catch (e) { /* pad na PM odabir */ } }
    if (from == null || to == null || from === to) { const s = editor.state.selection; from = s.from; to = s.to; }
    if (from > to) [from, to] = [to, from];
    if (from === to) return toast('Označite dio teksta unutar jednog odlomka.');
    const doc = editor.state.doc; if (!doc.resolve(from).sameParent(doc.resolve(to))) return toast('Komentar može obuhvatiti samo jedan odlomak.');
    U.draft = { from, to, quote: doc.textBetween(from, to, ' ', leafText), text: '', neu: '', rule: '' };
    refresh(); showTab('cmt'); setTimeout(() => $('#cmText')?.focus(), 30);
  }
  function postComment() {
    const d = U.draft; if (!d) return; const T = S.mode === 'teacher';
    if (!d.text.trim() && !(T && d.neu.trim())) return toast('Upišite komentar.');
    S.cmSeq++; S.comments.push({ id: uid('c'), n: S.cmSeq, from: d.from, to: d.to, quote: d.quote, text: d.text.trim() || 'Prijedlog izmjene.', rule: T ? d.rule : '', sugg: T && d.neu.trim() ? { old: d.quote, neu: d.neu.trim() } : null, role: T ? 'teacher' : 'student', who: T ? 'Nastavnik A' : 'Student A', when: now(), resolved: false, replies: [] });
    U.active = S.comments[S.comments.length - 1].id; U.draft = null; refresh(); persist(); renderPanel(true);
  }
  async function doSubmit() {
    const text = plainText(); let hash;
    try { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); hash = 'sha256:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { hash = 'nedostupno u ovom pregledniku'; }
    S.submitted = { when: now(), hash, words: D.words, title: (D.heads.find(h => h.level === 1) || {}).title || 'Bez naslova' };
    S.stages[S.stages.length - 1].st = 'sub'; S.stages[S.stages.length - 1].d = S.submitted.when.split(',')[0];
    setMode(); persist(); openDlg({ type: 'receipt' }); renderAll(true);
  }
  const bindTarget = path => { const p = path.split('.'); let o = p[0] === 'S' ? S : U; if (p[0] === 'S') p.shift(); const k = p.pop(); p.forEach(x => { o = o[x] = o[x] || {}; }); return [o, k]; };

  const ACT = {
    undo: () => editor.chain().focus().undo().run(), redo: () => editor.chain().focus().redo().run(),
    bold: () => editor.chain().focus().toggleBold().run(), italic: () => editor.chain().focus().toggleItalic().run(),
    list: () => editor.chain().focus().toggleBulletList().run(), quote: () => editor.chain().focus().toggleBlockquote().run(),
    cite: el => openCiteMenu(el), citeIns: el => { closePop(); insertCitation(el.dataset.id, ''); if (innerWidth <= 1050) closeDrawers(); },
    hole: () => editor.chain().focus().insertContent('[?] ').run(),
    phrases: () => openDlg({ type: 'phrases', cat: 0 }), phrCat: el => { U.dlg.cat = +el.dataset.i; renderDlg(); },
    phrIns: el => { const t = el.dataset.t; closeDlg(); const before = editor.state.selection.$from.nodeBefore, sp = before && before.isText && !/\s$/.test(before.text) ? ' ' : ''; editor.chain().focus().insertContent(sp + t).run(); const end = editor.state.selection.from, i = t.indexOf('…'); if (i >= 0) editor.commands.setTextSelection({ from: end - t.length + i, to: end - t.length + i + 1 }); },
    comment: () => startComment(), cmPost: () => postComment(), cmCancel: () => { U.draft = null; refresh(); renderPanel(true); },
    cmFocus: el => { const c = S.comments.find(x => x.id === el.dataset.id); U.active = c.id; refresh(); if (!c.lost) jump(c.from, false); renderPanel(true); },
    cmResolve: el => { const c = S.comments.find(x => x.id === el.dataset.id); c.resolved = !c.resolved; refresh(); persist(); renderPanel(true); },
    rpOpen: el => { U.replyFor = el.dataset.id; renderPanel(true); setTimeout(() => $('#rpText')?.focus(), 30); }, rpCancel: () => { U.replyFor = null; renderPanel(true); },
    rpSend: el => { const t = $('#rpText').value.trim(); if (!t) return toast('Upišite odgovor.'); S.comments.find(x => x.id === el.dataset.id).replies.push({ who: S.mode === 'teacher' ? 'Nastavnik A' : 'Student A', when: now(), text: t }); U.replyFor = null; persist(); renderPanel(true); },
    suggOk: el => { const c = S.comments.find(x => x.id === el.dataset.id), from = c.from, neu = c.sugg.neu; editor.view.dispatch(editor.state.tr.insertText(neu, c.from, c.to)); c.from = from; c.to = from + neu.length; c.lost = false; c.quote = neu; c.sugg.state = 'accepted'; c.resolved = true; refresh(); persist(); renderPanel(true); toast('Prijedlog je unesen u tekst.'); },
    suggNo: el => { S.comments.find(x => x.id === el.dataset.id).sugg.state = 'rejected'; persist(); renderPanel(true); },
    sendReview: () => { const r = S.review; r.round++; r.status = 'review'; r.snapshot = blocksText(); r.log.push({ who: 'Student A', what: `Dorada poslana na pregled (runda ${r.round})`, when: now() }); persist(); renderPanel(true); toast('Dorada je poslana nastavniku.'); },
    reqOpen: () => { U.reqForm = { text: '', due: '' }; renderPanel(true); }, reqCancel: () => { U.reqForm = null; renderPanel(true); },
    reqSend: () => { const f = U.reqForm; if (!f.text.trim()) return toast('Upišite što treba doraditi.'); const r = S.review; r.status = 'revise'; r.req = { text: f.text.trim(), due: f.due.trim() || 'bez roka', when: now() }; r.log.push({ who: 'Nastavnik A', what: 'Zatražena dorada', when: now() }); U.reqForm = null; persist(); renderPanel(true); },
    accept: () => { S.review.status = 'accepted'; S.review.log.push({ who: 'Nastavnik A', what: 'Rad prihvaćen', when: now() }); persist(); renderPanel(true); },
    diff: () => openDlg({ type: 'diff' }), log: () => openDlg({ type: 'log' }), holes: () => openDlg({ type: 'holes' }),
    dlgClose: () => closeDlg(), jumpClose: el => { closeDlg(); jump(+el.dataset.pos); },
    jump: el => jump(+el.dataset.pos),
    finding: el => { if (el.dataset.pos) jump(+el.dataset.pos); else if (el.dataset.tab) showTab(el.dataset.tab); },
    rule: el => { U.ruleOpen[el.dataset.k] = !U.ruleOpen[el.dataset.k]; renderPanel(true); },
    tab: el => { S.tab = el.dataset.v; renderPanel(true); persist(); },
    mode: el => { S.mode = el.dataset.v; U.draft = null; closePop(); setMode(); persist(); renderAll(true); },
    rail: () => { $('#app').classList.remove('panel-open'); $('#app').classList.toggle('rail-open'); },
    panel: () => { $('#app').classList.remove('rail-open'); $('#app').classList.toggle('panel-open'); },
    closeDrawers: () => closeDrawers(),
    focus: () => { const on = $('#app').classList.toggle('focus'); if (on) toast('Mirni način. Esc ili Ctrl+. za izlaz.'); },
    status: el => { const h = el.dataset.hid; S.statuses[h] = ((S.statuses[h] || 0) + 1) % 3; persist(); X.render.rail(); },
    move: el => moveSection(el.dataset.hid, +el.dataset.dir),
    trig: el => trigApply(+el.dataset.i),
    'menu-view': el => {
      const opt = (g, v, l) => `<button class="mi" data-act="setView" data-g="${g}" data-v="${v}"><span>${l}</span><small>${S[g] === v ? '✓' : ''}</small></button>`;
      openPop(`<div class="mh">List</div>${opt('sheet', 'light', 'Bijeli list')}${opt('sheet', 'dark', 'Tamni list')}<div class="mh">Ljuska</div>${opt('theme', 'dark', 'Tamna')}${opt('theme', 'light', 'Svijetla')}<div class="mh">Stil citiranja</div>${opt('citeStyle', 'fpzg', 'FPZG')}${opt('citeStyle', 'apa', 'APA')}${opt('citeStyle', 'chicago', 'Chicago')}<div class="mh">Pomoć u tekstu</div>${opt('hints', true, 'Uključena')}${opt('hints', false, 'Isključena')}`, el.getBoundingClientRect(), 'menu');
    },
    setView: el => { const g = el.dataset.g; S[g] = g === 'hints' ? el.dataset.v === 'true' : el.dataset.v; closePop(); repaintCites(); refresh(); persist(); renderAll(true); },
    citeNext: el => { const id = el.dataset.id, list = D.citePos[id] || []; if (!list.length) return; const i = (citeCursor[id] = ((citeCursor[id] ?? -1) + 1) % list.length); jump(list[i], false); },
    srcNew: () => { U.litForm = { id: '', kind: 'knjiga', authors: '', full: '', year: '', title: '', pub: '' }; U.litImport = false; renderPanel(true); },
    srcEdit: el => { const s = srcById(el.dataset.id); U.litForm = { id: s.id, kind: s.kind, authors: s.authors, full: s.full, year: s.year, title: s.title, pub: s.tail.replace(/^\.\s*/, '').replace(/\.$/, '') }; renderPanel(true); $('#pbody').scrollTop = 0; },
    srcCancel: () => { U.litForm = null; renderPanel(true); },
    srcSave: () => {
      const f = U.litForm; if (!f.authors.trim() || !f.title.trim()) return toast('Upišite barem autora i naslov.');
      const data = { kind: f.kind, authors: f.authors.trim(), full: f.full.trim() || f.authors.trim(), year: f.year.trim(), title: f.title.trim(), tail: f.pub.trim() ? `. ${f.pub.trim().replace(/\.$/, '')}.` : '' };
      if (f.id) Object.assign(srcById(f.id), data); else S.sources.push({ id: uid('s'), ...data });
      const pend = U.pendingPlain; U.pendingPlain = null; U.litForm = null; repaintCites(); refresh(); persist();
      if (pend != null && !f.id) { const p = D.plain[pend], s = S.sources[S.sources.length - 1]; if (p) linkPlain(p, s.id); }
      renderAll(true);
    },
    srcDel: el => { const id = el.dataset.id, n = D.cited[id] || 0; if (n && U.delAsk !== id) { U.delAsk = id; return toast(`Izvor je citiran ${n}×. Kliknite Ukloni još jednom za potvrdu.`); } U.delAsk = null; if (n) { const tr = editor.state.tr; (D.citePos[id] || []).slice().sort((a, b) => b - a).forEach(p => tr.replaceWith(p, p + 1, editor.schema.text('[izvor]'))); editor.view.dispatch(tr); toast('Izvor je obrisan. Navodi su postali rupe [izvor].'); } S.sources = S.sources.filter(s => s.id !== id); repaintCites(); refresh(); persist(); renderAll(true); },
    impOpen: () => { U.litImport = true; U.litForm = null; renderPanel(true); }, impCancel: () => { U.litImport = false; renderPanel(true); },
    impRun: () => { const got = parseRefs($('#impTxt').value); if (!got.length) return toast('Nije prepoznat nijedan BibTeX ili RIS zapis.'); const fresh2 = got.filter(g => !S.sources.some(s => s.authors === g.authors && s.year === g.year && s.title === g.title)); S.sources.push(...fresh2); U.litImport = false; repaintCites(); refresh(); persist(); renderAll(true); toast(`Uvezeno: ${fresh2.length}${got.length - fresh2.length ? `, preskočeno duplikata: ${got.length - fresh2.length}` : ''}.`); },
    plainLink: el => { const p = D.plain[+el.dataset.i]; if (p) linkPlain(p, el.dataset.id); },
    plainAdd: el => { const p = D.plain[+el.dataset.i]; U.pendingPlain = +el.dataset.i; U.litForm = { id: '', kind: 'knjiga', authors: p.author, full: '', year: p.year, title: '', pub: '' }; renderPanel(true); $('#pbody').scrollTop = 0; },
    aiPurp: el => { const v = el.dataset.v, a = S.ai.purposes, i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); persist(); renderPanel(true); },
    submit: () => openDlg({ type: 'submit', step: 0 }), subNext: () => { U.dlg.step = 1; renderDlg(); }, subBack: () => { U.dlg.step = 0; renderDlg(); }, subDo: () => doSubmit(),
    receipt: () => openDlg({ type: 'receipt' }),
    unsubmit: () => { S.submitted = null; S.agree = false; S.stages[S.stages.length - 1].st = 'no'; setMode(); persist(); renderAll(true); },
    copy: async () => { try { await navigator.clipboard.writeText(plainText()); toast('Tekst rada je kopiran.'); } catch (e) { toast('Kopiranje nije dopušteno u ovom prikazu.'); } },
    reset: () => { if (U.resetAsk) { store.clear(); location.reload(); } else { U.resetAsk = true; toast('Kliknite još jednom: sve promjene u prototipu bit će obrisane.'); setTimeout(() => { U.resetAsk = false; }, 4000); } },
    citePage: () => { const pos = +$('#pop').dataset.pos, v = $('#citePg').value.trim(); const n = editor.state.doc.nodeAt(pos); if (n) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, null, { ...n.attrs, page: v })); closePop(); },
    citeDel: () => { const pos = +$('#pop').dataset.pos; editor.view.dispatch(editor.state.tr.delete(pos, pos + 1)); closePop(); },
    citeSrc: el => { closePop(); U.litQ = ''; showTab('lit'); },
    holeNext: () => { const pos = +$('#pop').dataset.pos, nx = D.holes.find(h => h.pos > pos) || D.holes[0]; closePop(); if (nx) jump(nx.pos); },
    hintCite: el => { closePop(); editor.chain().focus().setTextSelection(+el.dataset.pos).run(); openCiteMenu(); },
    hintHole: el => { closePop(); editor.chain().focus().insertContentAt(+el.dataset.pos, ' [izvor]').run(); },
  };
  function linkPlain(p, id) {
    editor.chain().focus().insertContentAt({ from: p.from, to: p.to }, [{ type: 'citation', attrs: { sourceId: id, page: p.page || '' } }]).run();
    toast('Navod je povezan s izvorom.');
  }

  /* ---------- Događaji ---------- */
  document.addEventListener('mousedown', e => { if (e.target.closest('.tools .tb, #pop .mi')) e.preventDefault(); });
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!e.target.closest('#pop') && !(el && /^(cite|menu-.*|hMenu|insXref|bars)$/.test(el.dataset.act)) && popKind && popKind !== 'trig') closePop();
    if (e.target.id === 'dlg') return closeDlg();
    if (el && ACT[el.dataset.act]) { if (el.disabled) return; ACT[el.dataset.act](el, e); return; }
    edClick(e);
  });
  function edClick(e) {
    if (!$('#ed').contains(e.target)) return;
    for (const f of X.hooks.click) if (f(e)) return;
    const ro = !editor.isEditable, t = e.target, r = el => el.getBoundingClientRect();
    const cm = t.closest('.cmt'); if (cm && cm.dataset.c) { U.active = cm.dataset.c; refresh(); showTab('cmt'); setTimeout(() => $(`[data-cid="${U.active}"]`)?.scrollIntoView({ block: 'nearest' }), 30); return; }
    const c = t.closest('.cite');
    if (c) {
      let pos = editor.view.posAtDOM(c, 0); if (editor.state.doc.nodeAt(pos)?.type.name !== 'citation') pos -= 1;
      const n = editor.state.doc.nodeAt(pos); if (!n || n.type.name !== 'citation') return; const s = srcById(n.attrs.sourceId);
      openPop(`<div class="pad"><p><b>${s ? esc(s.full) + ' (' + yearLabel(s) + ')' : 'Izvor nije u popisu'}</b></p><p class="muted">${s ? esc(s.title) : 'Izvor je uklonjen iz Literature.'}</p>${ro ? '' : `<label class="f">Stranica</label><div class="row"><input class="in" id="citePg" style="flex:1" value="${esc(n.attrs.page)}" placeholder="npr. 14 ili 14-16"><button class="btn pri sm" data-act="citePage">Spremi</button></div><div class="row" style="margin-top:8px"><button class="lnk" data-act="citeSrc">Otvori Literaturu</button><button class="lnk" data-act="citeDel">Ukloni navod</button></div>`}</div>`, r(c), 'menu');
      $('#pop').dataset.pos = pos; return;
    }
    if (ro) return;
    const h = t.closest('.hole'); if (h) { const pos = editor.view.posAtDOM(h, 0); openPop(`<div class="pad"><p><b>Rupa u tekstu</b></p><p class="muted">Zamijenite oznaku tekstom ili navodom. Rupe blokiraju predaju.</p><button class="lnk" data-act="holeNext">Sljedeća rupa ›</button></div>`, r(h), 'menu'); $('#pop').dataset.pos = pos; return; }
    const pc = t.closest('.plain-cite'); if (pc) { openPop(`<div class="pad"><p><b>Navod upisan kao tekst</b></p><p class="muted">Nije povezan s izvorom u popisu.</p><button class="lnk" data-act="tab" data-v="lit">Poveži u Literaturi</button></div>`, r(pc), 'menu'); return; }
    const hc = t.closest('.hint-claim, .hint-long'); if (hc && getSelection().isCollapsed) { const k = hc.classList.contains('hint-claim') ? 'claim' : 'sent', R = RULES[k], rr = r(hc), end = editor.view.posAtDOM(hc, hc.childNodes.length);
      openPop(`<div class="pad"><p><b>${esc(R.t)}</b></p><p>${esc(R.why)}</p><p class="muted">${esc(R.ex)}</p>${k === 'claim' ? `<div class="row"><button class="btn sm" data-act="hintCite" data-pos="${end}">Umetni navod</button><button class="lnk" data-act="hintHole" data-pos="${end}">Označi [izvor]</button></div>` : ''}</div>`, { left: e.clientX, right: e.clientX, top: rr.top, bottom: e.clientY + 10 }, 'menu'); }
  }
  document.addEventListener('input', e => {
    const b = e.target.dataset && e.target.dataset.bind; if (!b) return;
    const [o, k] = bindTarget(b); o[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.dataset.count) $('#' + e.target.dataset.count).textContent = wc(e.target.value);
    if (b.startsWith('S.')) persist();
    if (e.target.dataset.rerender === 'dlg') renderDlg();
    else if (e.target.type === 'checkbox') renderPanel(true);
    else if (e.target.dataset.live) { const pos = e.target.selectionStart; renderPanel(true); const n = $(`[data-bind="${b}"]`); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  });
  $('#blockStyle').addEventListener('change', e => { const v = e.target.value, c = editor.chain().focus(); (v === 'p' ? c.setParagraph() : c.setHeading({ level: +v[1] })).run(); });
  document.addEventListener('keydown', e => {
    for (const f of X.hooks.key) if (f(e)) return;
    if (e.key === 'Escape') { if (U.dlg) return closeDlg(); if (popKind && popKind !== 'trig') return closePop(); if (U.draft && document.activeElement?.id === 'cmText') return ACT.cmCancel(); if ($('#app').classList.contains('focus')) return $('#app').classList.remove('focus'); closeDrawers(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); ACT.focus(); }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); startComment(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement?.id === 'cmText') { e.preventDefault(); postComment(); }
    if (e.key === 'Enter' && document.activeElement?.id === 'citePg') { e.preventDefault(); ACT.citePage(); }
  });

  /* ---------- Pokretanje ---------- */
  Object.assign(X, { ACT, store, fresh, esc, wc, uid, now, plural, $, toast, openPop, closePop, openDlg, closeDlg, renderDlg, jump, refresh, persist, renderAll, renderPanel, showTab, setMode, leafText, srcById, yearLabel, citeText, citeInner, bibEntry, insertCitation, blocksText, plainText, runChecks, diffHtml, startComment, closeDrawers, aiText, mkSource, parseRefs, repaintCites, Decoration, Node, Mark, Extension, Plugin, PluginKey,
    panels: { lit: panelLit, nacrt: panelNacrt, upute: panelUpute, cmt: panelCmt, rad: panelRad }, render: { rail: renderRail, status: renderStatus, chrome: renderChrome, bib: renderBib } });
  Object.defineProperties(X, { D: { get: () => D }, editor: { get: () => editor } });
  X.boot = function () {
  const saved = store.load();
  if (saved && saved.S && saved.doc) Object.assign(S, saved.S);
  X.hooks.defaults.forEach(f => f(S));
  if (S.task) Object.assign(TASK, S.task);
  $('.crumb').innerHTML = esc(TASK.course + ' / ' + TASK.title) + ' <i>prototip</i>';
  editor = new Editor({
    element: $('#ed'),
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, strike: false, horizontalRule: false, link: false, underline: false }), Citation, Ductura, ...X.hooks.ext],
    content: saved && saved.doc ? saved.doc : SAMPLE,
    editable: S.mode === 'write' && !S.submitted,
    editorProps: { attributes: { spellcheck: 'false', 'aria-label': 'Tekst rada' }, handlePaste: (v, e) => (X.hooks.paste ? X.hooks.paste(v, e) : false) },
    onTransaction({ transaction }) { if (transaction.docChanged) persist(); const s = editor.state.selection; U.selWords = s.empty ? 0 : wc(editor.state.doc.textBetween(s.from, s.to, ' ')); trigCheck(); X.hooks.tx.forEach(f => f(transaction)); schedule(); },
    onBlur() { setTimeout(() => { if (!$('#pop').contains(document.activeElement)) trigClose(); }, 150); },
  });
  const seeds = !saved || !saved.doc ? [{ quote: 'redovito zajedničko čitanje proširuje rječnik djeteta', text: 'Dodajte uz ovu tvrdnju stranicu u navodu i razradite je jednom rečenicom.', rule: 'page', when: '16. 11. 2026., 18:20' }, { quote: 'često se opisuje kao', text: 'Kraće i izravnije.', sugg: { old: 'često se opisuje kao', neu: 'opisuje se kao' }, when: '16. 11. 2026., 18:24' }] : (S.seeds || []);
  delete S.seeds;
  if (seeds.length) {
    const find = q => { let hit = null; editor.state.doc.descendants((n, pos) => { if (hit || !n.isTextblock) return !hit; let t = ''; n.forEach(ch => { t += ch.isText ? ch.text : '\ufffc'; }); const i = t.indexOf(q); if (i >= 0) hit = { from: pos + 1 + i, to: pos + 1 + i + q.length }; return false; }); return hit; };
    seeds.forEach(o => { const h = find(o.quote); if (!h) return; S.cmSeq++; S.comments.push({ id: 'c' + S.cmSeq, n: S.cmSeq, from: h.from, to: h.to, role: 'teacher', who: 'Nastavnik A', resolved: false, replies: [], rule: '', sugg: null, when: '16. 11. 2026., 18:20', ...o }); });
  }
  if (!S.review.snapshot) S.review.snapshot = blocksText();
  refresh(); renderAll(true);
  window.__ductura = { editor, get S() { return S; }, get D() { return D; } };
  if (X.afterBoot) X.afterBoot(!saved || !saved.doc);
  };
})();
