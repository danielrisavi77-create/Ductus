/* Ductura Editor, prototip: alati desnog panela (v0.9).
 * Izvori: mjesta navoda, oslonac na jedan izvor, stanje izvora, nepotpuni i dvostruki izvori.
 * Komentari: Riješi redom, prije i poslije. Pregled: šavovi, ponavljanja, dosljednost zapisa, poslušaj.
 * Mentor i predaja: proba predaje, kostur za obranu, zapisnik konzultacija. Podnožje: današnja sesija.
 * Sve su obične provjere teksta u pregledniku, bez AI-ja.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, TASK, esc, plural, $, persist, toast } = X, { headEnd, ask } = X.fx, RP = X.rp;
  const ed = () => X.editor, D = () => X.D, fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  X.hooks.defaults.push(s => { const def = (k, v) => { if (s[k] == null) s[k] = v; }; def('srcState', {}); def('kons', []); def('sessLog', []); def('defense', null); });
  const rerender = () => { persist(); X.renderPanel(true); };
  const chapNum = p => { let n = ''; D().heads.forEach(h => { if (h.level > 1 && h.pos <= p) n = h.num; }); return n.replace(/\.$/, ''); };
  const paras = (a, b) => { const out = []; ed().state.doc.forEach((n, off) => { if (off >= a && off < b && n.type.name === 'paragraph' && n.textContent.trim()) out.push({ pos: off, text: n.textBetween(0, n.content.size, ' ', X.leafText).trim() }); }); return out; };
  const sents = t => t.split(/(?<=[.!?…])\s+(?=[\p{Lu}„"(])/u).filter(Boolean);
  const texts = (a, b) => { const out = [], doc = ed().state.doc; doc.nodesBetween(Math.max(0, a), Math.min(doc.content.size, b), (n, pos) => { if (n.isText) out.push({ pos, text: n.text }); }); return out; };
  function sentAt(p) {
    const doc = ed().state.doc, $p = doc.resolve(Math.min(p, doc.content.size)); if ($p.depth < 1) return '';
    const node = $p.node(1), start = $p.before(1) + 1, before = doc.textBetween(start, p, ' ', X.leafText), after = doc.textBetween(p, start + node.content.size, ' ', X.leafText);
    const a = before.lastIndexOf('. '), b = after.search(/[.!?…](\s|$)/), s = (before.slice(a < 0 ? 0 : a + 2) + after.slice(0, b < 0 ? after.length : b + 1)).trim();
    return s.length > 210 ? s.slice(0, 207) + '…' : s;
  }

  /* ================= IZVORI ================= */
  const ST = [['get', 'Treba nabaviti'], ['have', 'Imam'], ['read', 'Pročitano']];
  const missing = s => { const m = []; if (!s.year) m.push('godina'); if (!(s.title || '').trim()) m.push('naslov'); if (!(s.tail || '').trim()) m.push(s.kind === 'članak' ? 'časopis i stranice' : s.kind === 'mrežni izvor' ? 'adresa i datum pristupa' : 'mjesto i nakladnik'); if (/Nepoznat/.test(s.authors)) m.push('autor'); return m; };
  const norm = t => (t || '').toLowerCase().replace(/[^\p{L}\d]+/gu, ' ').trim().slice(0, 40);
  RP.srcFilter = s => !U.srcFilter || (U.srcFilter === 'get' ? S.srcState[s.id] === 'get' : S.srcState[s.id] !== 'read');
  RP.HK.srcOpenMore.push((s, ro) => { const st = S.srcState[s.id] || ''; return `<div class="rpsub">Stanje izvora</div><div class="seg rpst">${ST.map(([k, l]) => `<button data-act="srcState" data-id="${esc(s.id)}" data-v="${k}" aria-pressed="${st === k}"${ro ? ' disabled' : ''}>${l}</button>`).join('')}</div>`; });
  RP.HK.srcOpen.push((s, ro) => {
    const pos = D().citePos[s.id] || [];
    return (pos.length ? `<div class="rpplaces"><div class="rpsub">Gdje je citirano (${pos.length})</div>${pos.slice(0, 3).map(p => `<button class="rpplace" data-act="jump" data-pos="${p}"><b>${chapNum(p) || '·'}</b><span>${esc(sentAt(p))}</span></button>`).join('')}${pos.length > 3 ? `<button class="lnk" data-act="citeNext" data-id="${esc(s.id)}">Još ${pos.length - 3}, idi redom ›</button>` : ''}</div>` : '');
  });
  RP.HK.srcTop.push(c => {
    const d = c.d; let html = '';
    const nGet = S.sources.filter(s => S.srcState[s.id] === 'get').length, any = Object.values(S.srcState).some(Boolean), nUn = S.sources.filter(s => S.srcState[s.id] !== 'read').length;
    if (any) html += `<div class="rptools">${nGet ? `<button class="chip" data-act="srcFilter" data-v="get" aria-pressed="${U.srcFilter === 'get'}">Treba nabaviti ${nGet}</button>` : ''}<button class="chip" data-act="srcFilter" data-v="unread" aria-pressed="${U.srcFilter === 'unread'}">Nepročitano ${nUn}</button></div>`;
    if (c.on) {
      const cnt = S.sources.map(s => ({ s, n: (d.citePos[s.id] || []).filter(c.inCh).length })).filter(x => x.n).sort((a, b) => b.n - a.n), tot = cnt.reduce((a, x) => a + x.n, 0);
      if (tot >= 5 && cnt[0].n * 2 >= tot) html += `<div class="card rpnote"><b>Poglavlje se oslanja na jedan izvor</b><p>${cnt[0].n} od ${tot} navoda u ovom poglavlju je iz izvora ${esc(cnt[0].s.authors)} (${X.yearLabel(cnt[0].s)}). Provjerite treba li uz njega još koji izvor.</p><button class="lnk" data-act="citeNext" data-id="${esc(cnt[0].s.id)}">Pokaži navode ›</button></div>`;
    }
    return html;
  });
  RP.HK.srcMore.push(c => { let html = '';
    const inc = S.sources.map(s => ({ s, m: missing(s) })).filter(x => x.m.length), seen = {}, dup = [];
    S.sources.forEach(s => { const k = norm(s.title); if (!k) return; if (seen[k]) dup.push([seen[k], s]); else seen[k] = s; });
    if (inc.length || dup.length) html += `<details class="rpd" data-det="rp-inc"${(U.det || {})['rp-inc'] ? ' open' : ''}><summary>Za dopuniti (${inc.length + dup.length})</summary>` +
      inc.map(({ s, m }) => `<div class="fx rph"><span style="flex:1"><b>${esc(s.authors)} (${X.yearLabel(s)})</b><span class="d">nedostaje: ${m.join(', ')}</span></span>${c.ro ? '' : `<button class="btn sm" data-act="srcEdit" data-id="${esc(s.id)}">Dopuni</button>`}</div>`).join('') +
      dup.map(([a, b]) => `<div class="fx rph"><span style="flex:1"><b>Mogući dvostruki unos</b><span class="d">${esc(a.authors)} (${X.yearLabel(a)}) i ${esc(b.authors)} (${X.yearLabel(b)}): isti naslov</span></span>${c.ro ? '' : `<button class="btn sm" data-act="srcOpen" data-id="${esc(b.id)}">Otvori</button>`}</div>`).join('') + `</details>`;
    return html;
  });

  /* ================= KOMENTARI ================= */
  const openC = () => S.comments.filter(c => !c.resolved && !c.lost).sort((a, b) => a.from - b.from);
  RP.HK.cmtTop.push(c => { const n = openC().length; return !c.ro && n ? `<button class="btn sm rpwalkb" data-act="walkStart">Riješi redom (${n})</button>` : ''; });
  RP.HK.cmtCard.push(cm => {
    let h = cm.fix ? `<div class="rpfix"><b>Što je promijenjeno</b> ${esc(cm.fix)}</div>` : '';
    if (!cm.lost) { const cur = ed().state.doc.textBetween(cm.from, cm.to, ' ', X.leafText); if (cur !== cm.quote) h += `<details class="rpba"><summary>Prije i poslije</summary><div class="rpsub">Kad je komentar napisan</div><div class="q">${esc(cm.quote)}</div><div class="rpsub">Sada</div><div class="q">${esc(cur) || '<i>tekst je obrisan</i>'}</div></details>`; }
    return h;
  });
  RP.walk = () => {
    const w = U.walk, n = w.ids.length;
    if (w.i >= n) {
      const txt = w.ids.map(id => S.comments.find(c => c.id === id)).filter(Boolean).map(c => `#${c.n} ${c.resolved ? (c.fix || 'riješeno') : 'nije riješeno'}`).join('\n');
      return `<div class="rpc-h">Gotovo</div><p class="muted">Ovo je popis što ste napravili po svakom komentaru. Možete ga poslati mentoru uz doradu.</p><textarea class="ta" rows="${Math.min(10, n + 2)}" id="walkOut" readonly>${esc(txt)}</textarea><div class="row" style="margin-top:8px"><button class="btn pri sm" data-act="sendReview">Pošalji doradu na pregled</button><button class="btn sm" data-act="walkCopy">Kopiraj</button><button class="lnk" data-act="walkEnd">Zatvori</button></div>`;
    }
    const c = S.comments.find(x => x.id === w.ids[w.i]);
    return `<div class="rpwalk"><div class="meta"><b>Komentar ${w.i + 1} od ${n}</b><span class="grow"></span><button class="lnk" data-act="walkEnd">Završi</button></div><div class="card on"><div class="meta"><b>#${c.n}</b><span>${esc(c.who)}</span><span>${esc(c.when)}</span></div><button class="q" style="display:block;width:100%;text-align:left" data-act="jump" data-pos="${c.from}">${esc(c.quote)}</button><div>${esc(c.text)}</div>` +
      (c.sugg && !c.sugg.state ? `<div class="sugg"><del>${esc(c.sugg.old)}</del> → <ins>${esc(c.sugg.neu)}</ins><div class="row" style="margin-top:6px;font-family:var(--ff-ui)"><button class="btn sm" data-act="suggOk" data-id="${c.id}">Prihvati</button><button class="btn sm" data-act="suggNo" data-id="${c.id}">Odbij</button></div></div>` : '') +
      `</div><label class="f">Što ste promijenili (ide mentoru uz doradu)</label><textarea class="ta" id="walkFix" rows="3" placeholder="npr. dodana stranica u navod">${esc(w.txt || '')}</textarea><div class="row" style="margin-top:8px"><button class="btn pri sm" data-act="walkDone">Riješeno, dalje</button><button class="btn sm" data-act="walkSkip">Preskoči</button></div><p class="muted" style="margin-top:10px">Popravite tekst u radu, pa ovdje zapišite što ste napravili. Komentar ostaje vidljiv kao riješen.</p></div>`;
  };
  const walkGo = () => { const w = U.walk, c = w && S.comments.find(x => x.id === w.ids[w.i]); if (c) { U.active = c.id; w.txt = ''; X.refresh(); X.jump(c.from, false); } X.renderPanel(true); };

  /* ================= PREGLED ================= */
  const scope = c => [c.on ? c.a : 0, c.on ? c.b : ed().state.doc.content.size];
  RP.PRE.sav = { label: 'Šavovi', fn: c => {
    const h2 = c.d.heads.filter(h => h.level === 2), pairs = [];
    h2.forEach((h, i) => { const nx = h2[i + 1]; if (nx && (!c.on || h === c.ch || nx === c.ch)) pairs.push([h, nx]); });
    const end = h => { const p = paras(h.pos, headEnd(h)); if (!p.length) return null; const l = p[p.length - 1], s = sents(l.text); return { pos: l.pos, t: s[s.length - 1] }; };
    const beg = h => { const p = paras(h.pos, headEnd(h)); if (!p.length) return null; return { pos: p[0].pos, t: sents(p[0].text)[0] }; };
    const cut = t => (t.length > 260 ? t.slice(0, 257) + '…' : t);
    return `<p class="muted">Kraj jednog i početak sljedećeg poglavlja. Čita li se drugo kao nastavak prvoga? Ako ne, dodajte rečenicu koja ih povezuje.</p>` + (pairs.map(([a, b]) => { const e = end(a), s = beg(b); return `<div class="card rpseam"><div class="rpsub">Kraj: ${esc(a.num + ' ' + a.title)}</div>${e ? `<button class="ro" data-act="jump" data-pos="${e.pos}">${esc(cut(e.t))}</button>` : '<p class="muted">još nema teksta</p>'}<div class="rpsub">Početak: ${esc(b.num + ' ' + b.title)}</div>${s ? `<button class="ro" data-act="jump" data-pos="${s.pos}">${esc(cut(s.t))}</button>` : '<p class="muted">još nema teksta</p>'}</div>`; }).join('') || '<p class="muted">Rad još nema dva poglavlja.</p>');
  } };
  const STOP = new Set('između također kojima odnosno međutim prema tijekom nakon kroz koji koja koje kojih kojem kako može mogu bila bilo bili biti nije samo više svoj svoje ovog toga jedan jedna godine godina nego ali već kada kao zbog ovaj ovom time tako stoga čime čiji čija njegov njihov prije poslije unutar tome ovdje jest jesu bismo budući pritom dakle iako'.split(' '));
  RP.PRE.pon = { label: 'Ponavljanja', fn: c => {
    const [a, b] = scope(c), st = {}, wd = {};
    paras(a, b).forEach(p => sents(p.text).forEach(s => { const m = s.match(/^[„"(]?(\p{L}{3,})/u); if (m) { const k = m[1]; (st[k] = st[k] || { n: 0, pos: p.pos }).n++; } }));
    texts(a, b).forEach(t => { const re = /\p{L}{5,}/gu; let m; while ((m = re.exec(t.text))) { const w = m[0].toLowerCase(); if (STOP.has(w)) continue; const k = w.slice(0, 6), o = wd[k] = wd[k] || { n: 0, pos: t.pos + m.index, w }; o.n++; } });
    const top = (o, min, max) => Object.entries(o).filter(([, v]) => v.n >= min).sort((x, y) => y[1].n - x[1].n).slice(0, max);
    const s1 = top(st, 3, 8), w1 = top(wd, 6, 12);
    return `<p class="muted">Za pogledati, nije greška. Isti početak rečenice ili ista riječ mnogo puta zaredom umara čitatelja.</p><div class="ptitle">Počeci rečenica</div>` + (s1.map(([k, v]) => `<button class="fx rph" data-act="jump" data-pos="${v.pos}"><span><b>${esc(k)}…</b><span class="d">${v.n} ${plural(v.n, 'rečenica počinje', 'rečenice počinju', 'rečenica počinje')} ovako</span></span></button>`).join('') || '<p class="muted">Nijedan početak se ne ponavlja tri ili više puta.</p>') +
      `<div class="ptitle">Najčešće riječi</div><div class="rptools">${w1.map(([, v]) => `<button class="chip" data-act="rpFind" data-w="${esc(v.w.slice(0, 6))}" title="Pokaži u tekstu">${esc(v.w)} · ${v.n}×</button>`).join('') || '<span class="muted">Premalo teksta.</span>'}</div><p class="muted" style="margin-top:8px">Pojmovi rada se smiju ponavljati. Pogledajte riječi koje nisu pojmovi.</p>`;
  } };
  const DOS = [
    ['Razdoblja', /\b\d{4}(\.?)(\s?)([-–—])(\s?)(\d{4}|\d{2})(\.?)(?!\d)/g, m => `1941${m[1]}${m[2]}${m[3]}${m[4]}${m[5].length === 2 ? '47' : '1947'}${m[6]}`],
    ['Tisućice', /\b\d{1,3}([. ])\d{3}\b(?![.,]?\d)|\b[1-9]\d{4,}\b/g, m => (m[1] === '.' ? '10.000' : m[1] === ' ' ? '10 000' : '10000')],
    ['Postotak', /\d(\s?)(%|posto)/g, m => (m[2] === 'posto' ? '5 posto' : `5${m[1]}%`)],
    ['Desetljeća', /\b(\d{4}|\d{2})-(ih|e|tih)\b/g, m => `${m[1].length === 4 ? '1980' : '80'}-${m[2]}`],
    ['Navodnici', /[„“"«»]/g, m => ({ '„': '„ ”', '“': '“ ”', '"': '" "', '«': '« »', '»': '» «' }[m[0]])]
  ];
  RP.PRE.dos = { label: 'Dosljednost', fn: c => {
    const [a, b] = scope(c), tx = texts(a, b); let html = '', ok = [];
    DOS.forEach(([name, re, key]) => {
      const v = {}; tx.forEach(t => { re.lastIndex = 0; let m; while ((m = re.exec(t.text))) { const k = key(m), o = v[k] = v[k] || { n: 0, pos: t.pos + m.index }; o.n++; } });
      const e = Object.entries(v).sort((x, y) => y[1].n - x[1].n);
      if (e.length > 1) html += `<div class="card"><h4>${name}</h4><div class="muted">zapisano na ${e.length} ${plural(e.length, 'način', 'načina', 'načina')}</div>${e.map(([k, o]) => `<button class="fx rph" data-act="jump" data-pos="${o.pos}"><span style="flex:1"><b>${esc(k)}</b></span><span class="muted">${o.n}×</span></button>`).join('')}</div>`; else ok.push(name.toLowerCase());
    });
    return `<p class="muted">Isto zapisano na više načina. Odaberite jedan zapis i držite ga se. Navodi izvora nisu uključeni.</p>` + (html || '<p>U ovom dijelu rada sve je zapisano na isti način.</p>') + (html && ok.length ? `<p class="muted">Dosljedno: ${ok.join(', ')}.</p>` : '');
  } };
  let tts = null; const initTts = n => { if (!(window.claude && window.claude.use)) { if (n < 20) setTimeout(() => initTts(n + 1), 300); return; } window.claude.use('tts').then(t => { tts = t; }).catch(() => {}); }; initTts(0);

  /* ================= MENTOR I PREDAJA ================= */
  RP.HK.radTop.push(c => `<div class="rpacts"><button class="btn sm" data-act="proba">Proba predaje</button><button class="btn sm" data-act="obrana">Kostur za obranu</button></div>` +
    `<details class="rpd" data-det="rp-kons"${(U.det || {})['rp-kons'] ? ' open' : ''} style="margin-top:6px"><summary>Zapisnik konzultacija (${S.kons.length})</summary>${S.kons.map(k => `<div class="card"><div class="meta"><b>${esc(k.when)}</b><span class="grow"></span>${c.ro ? '' : `<button class="lnk" data-act="konsDel" data-id="${k.id}">Obriši</button>`}</div><div style="white-space:pre-wrap">${esc(k.text)}</div></div>`).join('') || '<p class="muted">Zapišite što ste dogovorili dok je svježe. Zapisnik vidite samo Vi.</p>'}${c.ro ? '' : `<div class="row"><button class="btn sm" data-act="konsAdd">+ Bilješka s konzultacija</button><button class="btn sm" data-act="konsTask">+ Dogovor${c.ch ? ' uz ' + esc(c.ch.num.replace(/\.$/, '')) + '. poglavlje' : ''}</button></div>`}</details>`);
  X.hooks.dlg.proba = () => {
    const d = D(), f = X.runChecks(), blk = f.filter(x => x.sev === 'block'), wr = f.filter(x => x.sev === 'warn'), rc = X.rules && X.rules.data ? X.rules.count() : null, oc = S.comments.filter(c => !c.resolved).length, aw = X.wc(S.abs || ''), sw = X.wc(S.sum || '');
    const row = (ok, t, dsc, act) => `<div class="fx"><span class="s ${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'}</span><span style="flex:1"><b>${t}</b><span class="d">${dsc}</span></span>${act || ''}</div>`;
    const inR = d.words >= TASK.min && d.words <= TASK.max;
    return `<h3>Proba predaje</h3><p class="muted">Ništa se ne predaje. Ovo je popis onoga što bi mentor i referada dobili da rad predate sada.</p>
      <div class="ptitle">Blokira predaju (${blk.length})</div>${blk.map(x => `<button class="fx" data-act="finding" data-pos="${x.pos ?? ''}" data-tab="${x.tab || ''}"><span class="s block">!</span><span><b>${esc(x.t)}</b><span class="d">${esc(x.d)}</span></span></button>`).join('') || '<p class="muted">Ništa ne blokira predaju.</p>'}
      <div class="ptitle">Dijelovi rada</div>
      ${row(inR, `Opseg: ${fmt(d.words)} riječi`, `traži se ${fmt(TASK.min)} do ${fmt(TASK.max)}${inR ? '' : d.words > TASK.max ? ', višak ' + fmt(d.words - TASK.max) : ', nedostaje ' + fmt(TASK.min - d.words)}`)}
      ${rc ? row(!rc.todo, 'Zahtjevi fakulteta', `${rc.todo} za riješiti · ${rc.self} provjeravate sami · ${rc.ok} u redu`, '<button class="btn sm" data-act="probaReq">Otvori</button>') : ''}
      ${row(aw >= 150 && aw <= 300, 'Sažetak', aw ? aw + ' riječi (prijedlog 150 do 300)' : 'nije napisan', '<button class="btn sm" data-act="goRad">Otvori</button>')}
      ${row(sw > 0, 'Summary', sw ? sw + ' riječi' : 'nije napisan')}
      ${row(!!(S.kw || '').trim(), 'Ključne riječi', (S.kw || '').trim() ? esc(S.kw) : 'nisu upisane')}
      ${row(!!X.aiText(), 'Izjava o korištenju AI-ja', X.aiText() ? 'ispunjena' : 'nije ispunjena')}
      ${row(!oc, 'Komentari mentora', oc ? oc + ' ' + plural(oc, 'otvoren', 'otvorena', 'otvorenih') : 'svi riješeni')}
      ${row(!d.holes.length, 'Mjesta ostavljena za kasnije', d.holes.length ? d.holes.length + ' u tekstu' : 'nema')}
      <div class="ptitle">Za pogledati (${wr.length})</div>${wr.slice(0, 8).map(x => `<button class="fx" data-act="finding" data-pos="${x.pos ?? ''}" data-tab="${x.tab || ''}"><span class="s warn">!</span><span><b>${esc(x.t)}</b><span class="d">${esc(x.d)}</span></span></button>`).join('') || '<p class="muted">Nema napomena.</p>'}
      <div class="foot"><button class="btn" data-act="print" style="margin-right:auto">Kako će izgledati ispis</button><button class="btn" data-act="paket">Predajni paket</button><button class="btn pri" data-act="dlgClose">Zatvori</button></div>`;
  };
  function defenseText() {
    const d = D(), h2 = d.heads.filter(h => h.level === 2), title = (d.heads.find(h => h.level === 1) || {}).title || 'Naslov rada', out = [], first = h => { const p = paras(h.pos, headEnd(h)); return p.length ? sents(p[0].text)[0] : '(još nema teksta)'; };
    out.push(`1. Naslov i tema\n   ${title}`); out.push(`2. Pitanje rada\n   ${S.thesis || '(upišite pitanje ili tezu rada)'}`);
    h2.forEach(h => { const z = /zaklju/i.test(h.title), p = paras(h.pos, headEnd(h)); out.push(`${out.length + 1}. ${h.title}\n   ${z && p.length ? sents(p[0].text).slice(0, 2).join(' ') : first(h)}`); });
    const hy = X.advice && X.advice.whole ? (ed().state.doc.textBetween(0, ed().state.doc.content.size, ' ').match(/\bH\d\b/g) || []) : [];
    if (hy.length) out.push(`${out.length + 1}. Hipoteze\n   ${[...new Set(hy)].sort().join(', ')}: za svaku recite je li potvrđena i čime.`);
    out.push(`${out.length + 1}. Ograničenja rada i što bi se dalje moglo istražiti\n   (upišite)`); out.push(`${out.length + 1}. Zahvala i pitanja`);
    return out.join('\n\n');
  }
  X.hooks.dlg.obrana = () => { if (S.defense == null) S.defense = defenseText(); return `<h3>Kostur za obranu</h3><p class="muted">Složeno iz naslova, pitanja rada i prvih rečenica poglavlja. To je polazište: uredite ga svojim riječima. Ductura ovdje ne piše ništa novo.</p><textarea class="ta" rows="16" data-bind="S.defense">${esc(S.defense)}</textarea><div class="foot"><button class="lnk" data-act="obranaRedo" style="margin-right:auto">Složi ponovno iz rada</button><button class="btn" data-act="obranaCopy">Kopiraj</button><button class="btn pri" data-act="dlgClose">Gotovo</button></div>`; };

  /* ================= DANAŠNJA SESIJA ================= */
  const mins = s => Math.max(0, Math.round((Date.now() - s.t0) / 60000));
  RP.HK.foot.push(c => {
    if (S.mode === 'teacher' || S.submitted) return '';
    const s = S.sess; if (!s) return `<button class="lnk" data-act="sessNew">Započni sesiju pisanja</button><span class="muted">cilj za danas</span>`;
    const dw = c.d.words - s.w0, m = mins(s);
    return `<span class="psess"><b>Sesija</b> ${dw >= 0 ? '+' : ''}${fmt(dw)}${s.goalW ? ' / ' + s.goalW : ''} riječi · ${m}${s.goalM ? ' / ' + s.goalM : ''} min</span><span class="grow"></span><button class="btn sm" data-act="sessEnd">Završi</button>`;
  });
  X.hooks.dlg.sess = dl => {
    const pick = (key, opts, cur) => `<div class="seg rcseg">${opts.map(([v, l]) => `<button data-act="sessPick" data-k="${key}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
    if (dl.sum) { const r = dl.sum; return `<h3>Sesija je gotova</h3><p><b>${r.words >= 0 ? 'Napisano' : 'Skraćeno za'} ${fmt(Math.abs(r.words))} ${plural(Math.abs(r.words), 'riječ', 'riječi', 'riječi')}</b> u ${r.min} min.${r.goalW ? (r.words >= r.goalW ? ' Cilj od ' + r.goalW + ' riječi je dosegnut.' : ' Do cilja je ostalo ' + (r.goalW - r.words) + ' riječi.') : ''}</p><div class="ptitle">Po poglavljima</div>${r.ch.map(x => `<div class="fx"><span style="flex:1"><b>${esc(x.t)}</b></span><span class="muted">${x.d > 0 ? '+' : ''}${fmt(x.d)}</span></div>`).join('') || '<p class="muted">Tekst poglavlja nije mijenjan.</p>'}<div class="ptitle">Prethodne sesije</div>${S.sessLog.slice(-5).reverse().map(x => `<div class="fx"><span style="flex:1">${esc(x.when)}</span><span class="muted">${x.words >= 0 ? '+' : ''}${fmt(x.words)} riječi · ${x.min} min</span></div>`).join('')}<p class="muted">Sesije vidite samo Vi.</p><div class="foot"><button class="btn pri" data-act="dlgClose">Zatvori</button></div>`; }
    const g = U.sessGoal = U.sessGoal || { w: 300, m: 45 };
    return `<h3>Sesija pisanja</h3><p class="muted">Postavite mali cilj za ovo sjedenje. Na kraju vidite što ste napravili. Sesije vidite samo Vi.</p><div class="ptitle">Riječi</div>${pick('w', [[150, '150'], [300, '300'], [500, '500'], [0, 'bez cilja']], g.w)}<div class="ptitle">Vrijeme</div>${pick('m', [[25, '25 min'], [45, '45 min'], [90, '90 min'], [0, 'bez cilja']], g.m)}<div class="foot"><button class="btn" data-act="dlgClose">Odustani</button><button class="btn pri" data-act="sessStart">Započni</button></div>`;
  };
  setInterval(() => { if (S.sess && $('#pfoot') && !U.dlg) { const f = $('#pfoot .psess'); if (f) X.renderPanel(); } }, 30000);

  const copy = t => { try { navigator.clipboard.writeText(t).then(() => toast('Kopirano.'), () => toast('Kopiranje nije uspjelo.')); } catch (e) { toast('Kopiranje nije uspjelo.'); } };
  Object.assign(ACT, {
    srcState: el => { const id = el.dataset.id, v = el.dataset.v; S.srcState[id] = S.srcState[id] === v ? '' : v; rerender(); },
    srcFilter: el => { U.srcFilter = U.srcFilter === el.dataset.v ? null : el.dataset.v; X.renderPanel(true); },
    walkStart: () => { const ids = openC().map(c => c.id); if (!ids.length) return; U.walk = { ids, i: 0 }; walkGo(); },
    walkDone: () => { const w = U.walk, c = S.comments.find(x => x.id === w.ids[w.i]), t = ($('#walkFix') || {}).value || ''; c.resolved = true; if (t.trim()) c.fix = t.trim(); w.i++; X.refresh(); persist(); walkGo(); },
    walkSkip: () => { U.walk.i++; walkGo(); },
    walkEnd: () => { U.walk = null; X.renderPanel(true); },
    walkCopy: () => copy(($('#walkOut') || {}).value || ''),
    rpFind: el => { const w = el.dataset.w, tx = texts(0, ed().state.doc.content.size), from = ed().state.selection.from; let hit = null, first = null; tx.forEach(t => { const re = new RegExp(w, 'giu'); let m; while ((m = re.exec(t.text))) { const p = t.pos + m.index; if (first == null) first = p; if (hit == null && p > from) hit = p; } }); const p = hit != null ? hit : first; if (p != null) X.jump(p, false); },
    rpListen: async () => {
      if (U.rpReading) { U.rpReading = false; if (tts) tts.stop(); return X.renderPanel(true); }
      if (!tts) return toast('Čitanje naglas radi u objavljenom prototipu, uz dopuštenje za zvuk.');
      const c = RP.ctx(), sel = ed().state.selection.from, list = c.on ? paras(c.a, c.b) : paras(0, ed().state.doc.content.size).filter(p => p.pos + 2 >= sel).slice(0, 12);
      if (!list.length) return toast('Ovdje nema teksta za čitanje.');
      U.rpReading = true; X.renderPanel(true);
      try { for (const p of list) { if (!U.rpReading) break; X.jump(p.pos, false); await tts.speak(p.text.slice(0, 2000), { language: 'hr' }); } } catch (e) { if (e && e.code && !/stopped|viewer/.test(e.code)) toast('Čitanje naglas trenutačno nije dostupno.'); }
      U.rpReading = false; X.renderPanel(true);
    },
    proba: () => X.openDlg({ type: 'proba' }),
    probaReq: () => { X.closeDlg(); if (innerWidth <= 1250) $('#app').classList.add('rail-open'); if (ACT.rqOpen && !U.rqShow) ACT.rqOpen(); },
    obrana: () => X.openDlg({ type: 'obrana' }),
    obranaRedo: () => { S.defense = defenseText(); persist(); X.renderDlg(); },
    obranaCopy: () => copy(S.defense || ''),
    konsAdd: () => ask({ title: 'Bilješka s konzultacija', label: 'Što ste dogovorili', multi: true, ok: 'Spremi' }, v => { if (!v.trim()) return; S.kons.unshift({ id: X.uid('k'), when: X.now().split(',')[0], text: v.trim() }); (U.det = U.det || {})['rp-kons'] = true; rerender(); }),
    konsDel: el => { S.kons = S.kons.filter(k => k.id !== el.dataset.id); rerender(); },
    konsTask: () => { const c = RP.ctx(); ask({ title: 'Dogovor s konzultacija', label: c.ch ? `Zadatak uz poglavlje ${c.ch.num} ${c.ch.title}` : 'Zadatak', ok: 'Dodaj' }, v => { if (!v.trim()) return; S.tasks.push({ t: v.trim() + (c.ch ? ` (${c.ch.num.replace(/\.$/, '')}.)` : ''), done: false }); if (c.ch) (S.todos[c.ch.hid] = S.todos[c.ch.hid] || []).push({ id: X.uid('t'), t: v.trim(), done: false }); persist(); X.renderAll(true); toast(c.ch ? 'Dodano u dogovore i u zadatke poglavlja.' : 'Dodano u dogovore.'); }); },
    sessNew: () => X.openDlg({ type: 'sess' }),
    sessPick: el => { U.sessGoal[el.dataset.k] = +el.dataset.v; X.renderDlg(); },
    sessStart: () => { const d = D(), ch0 = {}; d.heads.filter(h => h.level === 2).forEach(h => { ch0[h.hid] = h.words; }); S.sess = { t0: Date.now(), goalW: U.sessGoal.w, goalM: U.sessGoal.m, w0: d.words, ch0 }; X.closeDlg(); rerender(); },
    sessEnd: () => { const s = S.sess, d = D(); if (!s) return; const ch = d.heads.filter(h => h.level === 2).map(h => ({ t: h.num + ' ' + h.title, d: h.words - (s.ch0[h.hid] ?? 0) })).filter(x => x.d), sum = { words: d.words - s.w0, min: mins(s), goalW: s.goalW, ch }; S.sessLog.push({ when: X.now(), words: sum.words, min: sum.min }); S.sess = null; rerender(); X.openDlg({ type: 'sess', sum }); }
  });
})();
