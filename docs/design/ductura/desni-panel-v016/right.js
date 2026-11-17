/* Ductura Editor, prototip: desni panel u tri rasporeda.
 * A "Kartice" (četiri kartice u jednom redu), B "Uz tekst" (bez kartica, prati kursor), C "Ikone uz rub" (uska traka, panel se otvara po potrebi).
 * Sadržaj je isti u sva tri; svaki popis ima opseg "ovo poglavlje / cijeli rad". Postavke: S.rpCfg.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, esc, plural, $, persist } = X, { headEnd } = X.fx;
  const ed = () => X.editor, D = () => X.D;
  const DEF = { layout: 'a', mobile: 'same', scope: 'ch', order: ['src', 'cmt', 'pre', 'rad', 'ai'], hide: {}, width: 'm', dense: false };
  const fresh = () => Object.assign({}, DEF, { order: DEF.order.slice(), hide: {} });
  const cfg = () => { const k = S.rpCfg || (S.rpCfg = fresh()); if (!k.order) k.order = DEF.order.slice(); if (!k.hide) k.hide = {}; if (!k.width) k.width = 'm'; DEF.order.forEach(g => { if (!k.order.includes(g)) k.order.push(g); }); return k; };
  const lay = () => (innerWidth <= 640 && cfg().mobile !== 'same' ? cfg().mobile : cfg().layout);
  const drawer = () => innerWidth <= 1050;
  const G = [['src', 'Izvori', ['lit']], ['cmt', 'Komentari', ['cmt']], ['pre', 'Pregled', ['nacrt', 'upute']], ['rad', 'Mentor i predaja', ['rad']], ['ai', 'Asistent', ['ai']]];
  const HK = { srcOpen: [], srcOpenMore: [], srcMore: [], srcTop: [], cmtTop: [], cmtCard: [], cmtDom: [], radTop: [], foot: [] }, H = (k, ...a) => HK[k].map(f => f(...a) || '').join(''), PRE = {};
  const SHORT = { src: 'Izvori', cmt: 'Komentari', pre: 'Pregled', rad: 'Mentor', ai: 'Asistent' };
  const GV = () => cfg().order.filter(g => !cfg().hide[g]).map(g => G.find(x => x[0] === g));
  const WID = { s: 300, m: 340, l: 400 };
  const groupOf = t => (G.find(g => g[2].includes(t)) || G[0])[0];
  const IC = {
    src: '<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9"/>',
    cmt: '<path d="M4 5h16v11H10l-4 4v-4H4z"/>',
    pre: '<path d="M5 6h14M5 12h14M5 18h9"/>',
    rad: '<path d="M4 12l16-7-6 16-3-6z"/>',
    ai: '<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z"/><path d="M18.5 15.5v3M17 17h3"/>',
    cfg: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
  const KIND = { absolute: 'Apsolutna tvrdnja', passive: 'Pasiv', colloq: 'Razgovorni izraz', term: 'Pojam', first: 'Prvo lice', abbr: 'Kratica', trans: 'Prijelaz', short: 'Kratak odlomak' };

  function ctx() {
    const d = D(), sel = ed().state.selection.from, ro = S.mode === 'teacher' || !!S.submitted || !!U.otherTab; let act = null, ch = null;
    d.heads.forEach(h => { if (h.level > 1 && h.pos <= sel) { act = h; if (h.level === 2) ch = h; } });
    const on = cfg().scope === 'ch' && !!ch, a = ch ? ch.pos : 0, b = ch ? headEnd(ch) : Infinity;
    return { d, ro, act, ch, on, a, b, inCh: p => p >= a && p < b, has: p => !on || (p >= a && p < b) };
  }
  const openCm = () => S.comments.filter(c => !c.resolved);
  const counts = c => ({ cmt: openCm().length, cmtHere: c.ch ? openCm().filter(x => !x.lost && c.inCh(x.from)).length : 0 });

  X.rp = { ctx, cfg, HK, PRE, svg, G };
  /* ---------- zajednički dijelovi ---------- */
  const scopeBar = c => `<div class="rpscope"><div class="seg">${[['ch', 'Ovo poglavlje'], ['all', 'Cijeli rad']].map(([v, l]) => `<button data-act="rpScope" data-v="${v}" aria-pressed="${cfg().scope === v}">${l}</button>`).join('')}</div>${cfg().scope === 'ch' ? `<div class="rpwhere">${c.ch ? esc(c.ch.num + ' ' + c.ch.title) : 'Kursor nije u poglavlju, pa je prikazan cijeli rad.'}</div>` : ''}</div>`;

  function srcRow(s, ro, nHere) {
    const n = D().cited[s.id] || 0, open = U.srcOpen === s.id, id = esc(s.id);
    return `<div class="rps${open ? ' on' : ''}"><div class="rps-r"><button class="rps-m" data-act="srcOpen" data-id="${id}" aria-expanded="${open}"><b>${esc(s.authors)} (${X.yearLabel(s)})</b><span>${esc(s.title)}</span></button><span class="rps-n" title="${nHere != null ? 'navoda u ovom poglavlju' : 'navoda u radu'}">${(nHere != null ? nHere : n) ? (nHere != null ? nHere : n) + '×' : ''}</span>${ro ? '' : `<button class="btn sm" data-act="citeIns" data-id="${id}">Citiraj</button>`}</div>` +
      (open ? `<div class="rps-x"><div class="meta"><span class="tag">${esc(s.kind)}</span>${n ? `<button class="lnk" data-act="citeNext" data-id="${id}">u radu ${n}× ›</button>` : '<span>nije citirano</span>'}${ro ? '' : `<button class="lnk" data-act="srcEdit" data-id="${id}">Uredi</button><button class="lnk" data-act="srcDel" data-id="${id}">Ukloni</button>`}</div>${H('srcOpen', s, ro)}<details class="rpd rpx" data-det="rp-srcx"${(U.det || {})['rp-srcx'] ? ' open' : ''}><summary>Više</summary>${H('srcOpenMore', s, ro)}${X.hooks.litCard ? X.hooks.litCard(s, ro) : ''}</details></div>` : '') + `</div>`;
  }
  function vSrc(c) {
    if (U.litForm || U.litImport) return X.panels.lit();
    const d = c.d, ro = c.ro, q = (U.litQ || '').toLowerCase(), SRC = X.rp.srcFilter ? S.sources.filter(X.rp.srcFilter) : S.sources, rows = (list, here) => list.map(s => srcRow(s, ro, here ? (d.citePos[s.id] || []).filter(c.inCh).length : null)).join('');
    let html = `<div class="row"><input class="in" style="flex:1;min-width:110px" placeholder="Traži među ${S.sources.length} izvora" data-bind="litQ" data-live="1" value="${esc(U.litQ || '')}">${ro ? '' : '<button class="btn sm" data-act="quick">+ Izvor</button><button class="btn sm" data-act="impOpen">Uvezi</button>'}</div>`;
    if (q) { const hit = S.sources.filter(s => (s.full + ' ' + s.authors + ' ' + s.title + ' ' + s.year).toLowerCase().includes(q)); return html + `<div class="ptitle">Pronađeno (${hit.length})</div>` + (rows(hit) || '<p class="muted">Nema izvora s tim nazivom. Dodajte ga gumbom + Izvor.</p>'); }
    html += scopeBar(c) + H('srcTop', c);
    const plain = d.plain.map((p, i) => ({ p, i })).filter(x => c.has(x.p.from));
    if (plain.length) html += `<div class="ptitle">Navodi bez izvora (${plain.length})</div>` + plain.map(({ p, i }) => { const m = S.sources.find(s => s.authors.toLowerCase() === p.author.toLowerCase() && String(s.year) === p.year); return `<div class="card"><div class="q">${esc(p.text)}</div><div class="row"><button class="lnk" data-act="jump" data-pos="${p.from}">Pokaži</button>${ro ? '' : m ? `<button class="btn sm" data-act="plainLink" data-i="${i}" data-id="${esc(m.id)}">Poveži s izvorom</button>` : `<button class="btn sm" data-act="plainAdd" data-i="${i}">Dodaj izvor</button>`}</div></div>`; }).join('');
    if (c.on) {
      const here = SRC.filter(s => (d.citePos[s.id] || []).some(c.inCh)), rest = SRC.filter(s => !here.includes(s));
      html += `<div class="ptitle">U ovom poglavlju (${here.length})</div>` + (rows(here, true) || `<p class="muted">U ovom poglavlju još nema navoda. Upišite @ u tekstu ili odaberite Citiraj uz izvor.</p>`) +
        `<details class="rpd" data-det="rp-rest"${(U.det || {})['rp-rest'] ? ' open' : ''}><summary>Ostali izvori (${rest.length})</summary>${rows(rest)}</details>`;
    } else {
      const ci = SRC.filter(s => d.cited[s.id]), un = SRC.filter(s => !d.cited[s.id]);
      html += `<div class="ptitle">Citirano (${ci.length})</div>` + (rows(ci) || '<p class="muted">Još nema navoda u tekstu.</p>') + `<div class="ptitle">Nije citirano (${un.length})</div>` + (rows(un) || '<p class="muted">Svi izvori su citirani.</p>');
    }
    const more = H('srcMore', c);
    return html + (more ? `<details class="rpd" data-det="rp-srcmore"${(U.det || {})['rp-srcmore'] ? ' open' : ''}><summary>Stanje literature</summary>${more}</details>` : '');
  }
  function vCmt(c) {
    if (X.rp.walk && U.walk) return X.rp.walk(c);
    const t = document.createElement('div'); t.innerHTML = X.panels.cmt(); let out = 0;
    t.querySelectorAll('[data-cid]').forEach(el => { const cm = S.comments.find(x => x.id === el.dataset.cid); if (cm) el.insertAdjacentHTML('beforeend', H('cmtCard', cm)); });
    if (c.on) t.querySelectorAll('[data-cid]').forEach(el => { const cm = S.comments.find(x => x.id === el.dataset.cid); if (cm && cm.id !== U.active && cm.id !== U.replyFor && (cm.lost || !c.inCh(cm.from))) { el.remove(); out++; } });
    HK.cmtDom.forEach(f => f(t, c));
    const first = t.firstElementChild, bar = scopeBar(c);
    if (c.on && !t.querySelector('[data-cid]') && !U.draft) t.insertAdjacentHTML('beforeend', '<p class="muted">U ovom poglavlju nema komentara.</p>');
    if (out) t.insertAdjacentHTML('beforeend', `<button class="lnk rpmore" data-act="rpScope" data-v="all">Još ${out} ${plural(out, 'komentar', 'komentara', 'komentara')} u drugim poglavljima</button>`);
    if (first) first.insertAdjacentHTML('afterend', H('cmtTop', c) + bar); else t.insertAdjacentHTML('afterbegin', bar);
    return t.innerHTML;
  }
  function firstLines(c) {
    let html = '', any = false;
    ed().state.doc.forEach((n, off) => {
      if (!c.has(off)) return;
      if (n.type.name === 'heading' && n.attrs.level > 1) html += `<div class="rpnh">${esc(n.textContent)}</div>`;
      else if (n.type.name === 'paragraph' && n.textContent.trim()) { const t = n.textBetween(0, n.content.size, ' ', X.leafText).trim(), fm = t.match(/^.*?[.!?…](?=\s|$)/), f = fm ? fm[0] : t, w = X.wc(f), pw = X.wc(n.textContent); let ci = 0; n.descendants(x => { if (x.type.name === 'citation') ci++; }); const one = !/[.!?…]\s+\S/.test(t), fl = [ci ? '' : pw > 60 ? 'bez navoda' : '', one && pw > 12 ? 'jedna rečenica' : '', pw > 250 ? 'dug odlomak' : ''].filter(Boolean); any = true; html += `<button class="ro" data-act="jump" data-pos="${off}">${esc(f.length > 200 ? f.slice(0, 197) + '…' : f)}${w > 35 ? ` <span class="tag warn">${w} riječi</span>` : ''}<span class="rpm">${pw} ${plural(pw, 'riječ', 'riječi', 'riječi')} · ${ci} ${plural(ci, 'navod', 'navoda', 'navoda')}${fl.map(x => ` · <i>${x}</i>`).join('')}</span></button>`; }
    });
    return any ? html : '<p class="muted">Ovdje još nema odlomaka.</p>';
  }
  function hintsIn(c) {
    const d = c.d, doc = ed().state.doc, size = doc.content.size, list = [];
    (d.hints || []).forEach(h => { if (c.has(h.pos)) list.push({ pos: h.pos, to: h.to, key: h.kind, k: KIND[h.kind] || 'Napomena', t: h.word || doc.textBetween(h.pos, Math.min(size, h.to || h.pos + 40), ' ').slice(0, 60) }); });
    (d.longs || []).forEach(p => { if (c.has(p)) list.push({ pos: p, key: 'long', k: 'Duga rečenica', t: doc.textBetween(p, Math.min(size, p + 60), ' ') + '…' }); });
    (d.claims || []).forEach(p => { if (c.has(p)) list.push({ pos: p, key: 'claim', k: 'Tvrdnja bez izvora', t: doc.textBetween(p, Math.min(size, p + 60), ' ') + '…' }); });
    (d.holes || []).forEach(h => { const p = h.pos != null ? h.pos : h.from; if (p != null && c.has(p)) list.push({ pos: p, key: 'hole', k: 'Rupa [?]', t: h.ctx || 'ostavljeno za kasnije' }); });
    return list.sort((x, y) => x.pos - y.pos);
  }
  const hintRows = (list, max) => list.slice(0, max).map(h => `<button class="fx rph" data-act="jump" data-pos="${h.pos}"><span><b>${esc(h.k)}</b><span class="d">${esc(h.t)}</span></span></button>`).join('');
  const preNow = () => (S.tab === 'upute' ? 'chk' : S.rpPreX && PRE[S.rpPreX] ? S.rpPreX : S.nacrt === 'poj' ? 'poj' : 'ro');
  function vPre(c) {
    if (!U.rpPreOpen && X.rp.preHome) return X.rp.preHome(c);
    const v = preNow(); let html = `<div class="row rpai-top"><button class="rpback" data-act="rpPreHome">‹ Pregled</button><b>${{ ro: 'Nacrt', poj: 'Pojmovnik', chk: 'Provjere' }[v] || PRE[v].label}</b></div>`;
    if (PRE[v]) return html + scopeBar(c) + PRE[v].fn(c);
    if (v === 'ro') return html + scopeBar(c) + `<div class="row" style="margin-top:8px"><button class="btn sm" data-act="rpListen">${U.rpReading ? '■ Zaustavi čitanje' : 'Poslušaj'}</button><span class="muted">${c.on ? 'čita ovo poglavlje naglas' : 'čita od kursora naglas'}</span></div><p class="muted">Prva rečenica svakog odlomka. Ako se ovako čita kao argument, odlomci su dobro složeni.</p>` + firstLines(c);
    if (v === 'poj') { const t = document.createElement('div'); t.innerHTML = X.panels.nacrt(); const s = t.querySelector('.seg'); if (s) s.remove(); return html + t.innerHTML; }
    html += scopeBar(c);
    if (X.rp.preChk) return html + X.rp.preChk(c);
    if (c.on) { const l = hintsIn(c); return html + `<p class="muted">${l.length ? `${l.length} ${plural(l.length, 'mjesto', 'mjesta', 'mjesta')} u tekstu za pogledati. Ništa od ovoga ne blokira predaju.` : 'U ovom poglavlju nema napomena u tekstu.'}</p>` + hintRows(l, 60) + `<button class="lnk rpmore" data-act="rpScope" data-v="all">Provjere cijelog rada i pravila</button>`; }
    return html + fold(X.panels.upute(), 'rp-chk-', [1]);
  }
  function fold(html, prefix, openIdx) {
    const t = document.createElement('div'); t.innerHTML = html; const out = document.createElement('div'); let cur = null, i = 0;
    [...t.childNodes].forEach(n => {
      if (n.nodeType === 1 && n.classList.contains('ptitle')) { const k = prefix + i; cur = document.createElement('details'); cur.className = 'rpd'; cur.dataset.det = k; if ((U.det || {})[k] ?? openIdx.includes(i)) cur.setAttribute('open', ''); const s = document.createElement('summary'); s.innerHTML = n.innerHTML; cur.appendChild(s); out.appendChild(cur); i++; }
      else (cur || out).appendChild(n);
    });
    return out.innerHTML;
  }
  const vRad = c => (X.rp.vRadX ? X.rp.vRadX(c) : H('radTop', c) + fold(X.panels.rad(), 'rp-rad-', [0, 1, 5]));
  const view = (g, c) => (g === 'src' ? vSrc(c) : g === 'cmt' ? vCmt(c) : g === 'pre' ? vPre(c) : g === 'ai' ? (X.rp.vAi ? X.rp.vAi(c) : X.panels.ai()) : vRad(c));
  const badge = (g, n) => (g === 'cmt' && n.cmt ? `<span class="cnt">${n.cmt}</span>` : g === 'rad' && X.rp.radBadge && X.rp.radBadge() ? `<span class="cnt">${X.rp.radBadge()}</span>` : '');
  const cfgBtn = `<button class="rpcfg" data-act="rpCfg" aria-label="Prilagodi desni panel" title="Prilagodi desni panel">${svg('cfg')}</button>`;
  const closeBtn = `<button class="pclose" data-act="closeDrawers" aria-label="Zatvori panel" title="Zatvori panel">✕</button>`;

  /* ---------- B: uz tekst ---------- */
  function vContext(c) {
    const d = c.d, ro = c.ro, n = counts(c), cc = Object.assign({}, c, { on: !!c.ch, has: p => !c.ch || c.inCh(p) });
    const cm = openCm().filter(x => !x.lost && cc.has(x.from)).sort((x, y) => x.from - y.from);
    const here = S.sources.filter(s => (d.citePos[s.id] || []).some(cc.has)), hints = hintsIn(cc), top = here.map(s => ({ s, n: (d.citePos[s.id] || []).filter(cc.has).length })).sort((x, y) => y.n - x.n).slice(0, 5);
    let html = `<div class="rpb-h"><span>${c.ch ? 'Pišete u poglavlju' : 'Cijeli rad'}</span><b>${c.ch ? esc(c.ch.num + ' ' + c.ch.title) : 'Kursor nije u poglavlju'}</b>${c.act && c.act !== c.ch ? `<small>${esc(c.act.num + ' ' + c.act.title)}</small>` : ''}</div>`;
    if (X.rp.ctxAlerts) html += X.rp.ctxAlerts(cc);
    html += `<div class="ptitle">Komentari ovdje (${cm.length})</div>` + (cm.map(x => `<button class="card rpc" data-act="rpCm" data-id="${x.id}"><span class="meta"><b>#${x.n}</b><span>${esc(x.who)}</span></span><span class="rpc-t">${esc(x.text)}</span></button>`).join('') || '<p class="muted">Nema otvorenih komentara.</p>');
    html += `<div class="ptitle">Izvori ovdje (${here.length})</div>` + (top.map(x => srcRow(x.s, ro, x.n)).join('') || '<p class="muted">Još nema navoda. Upišite @ u tekstu.</p>') + `<button class="lnk rpmore" data-act="rpView" data-v="src">${here.length > 5 ? `Svih ${here.length} izvora ovog poglavlja i traženje` : 'Svi izvori i traženje'}</button>`;
    html += `<div class="ptitle">Za pogledati u tekstu (${hints.length})</div>` + (hintRows(hints, 4) || '<p class="muted">Nema napomena.</p>') + (hints.length > 4 ? `<button class="lnk rpmore" data-act="rpView" data-v="chk">Sve napomene (${hints.length})</button>` : '');
    html += `<details class="rpd" data-det="rp-ctx-ro"${(U.det || {})['rp-ctx-ro'] ? ' open' : ''}><summary>Nacrt poglavlja</summary>${firstLines(cc)}</details>`;
    html += `<div class="ptitle">Cijeli rad</div><div class="rpnav">${GV().map(([g, l]) => `<button data-act="rpView" data-v="${g}">${svg(g)}<span>${l}</span>${g === 'cmt' ? `<i>${n.cmt} ${plural(n.cmt, 'otvoren', 'otvorena', 'otvorenih')}</i>` : g === 'src' ? `<i>${S.sources.length}</i>` : ''}</button>`).join('')}</div>`;
    return html;
  }

  /* ---------- crtanje ---------- */
  X.rpRender = function () {
    const c = ctx(), L = lay(), n = counts(c), g = groupOf(S.tab), pb = $('#pbody'), keep = pb.scrollTop, key = L + '|' + (L === 'b' ? U.rpView || '' : g);
    if (U.rpLastTab == null) U.rpLastTab = S.tab; else if (U.rpLastTab !== S.tab) { U.rpLastTab = S.tab; U.rpView = g; S.rpClosed = false; if (g === 'pre') U.rpPreOpen = true; }
    $('#panel').dataset.rp = L; $('#panel').style.setProperty('--panel-w', WID[cfg().width] + 'px'); $('#panel').classList.toggle('rp-dense', !!cfg().dense); $('#app').classList.toggle('rp-closed', L === 'c' && !!S.rpClosed && !drawer());
    if (L === 'a') {
      $('#tabs').innerHTML = closeBtn + GV().map(([k, l]) => `<button role="tab" aria-selected="${g === k}" data-act="rpTab" data-v="${k}" title="${l}">${SHORT[k]}${badge(k, n)}</button>`).join('') + '<span class="grow"></span>' + cfgBtn;
      pb.innerHTML = (cfg().hide[g] ? `<div class="rpc-h">${G.find(x => x[0] === g)[1]}</div>` : '') + view(g, c);
    } else if (L === 'b') {
      const v = U.rpView;
      $('#tabs').innerHTML = closeBtn + (v ? `<button class="rpback" data-act="rpView" data-v="">‹ Uz tekst</button><b class="rptt">${G.find(x => x[0] === v)[1]}</b>` : `<b class="rptt">Uz tekst</b>`) + '<span class="grow"></span>' + cfgBtn;
      pb.innerHTML = v ? view(v, c) : vContext(c);
    } else {
      const shut = !!S.rpClosed && !drawer();
      $('#tabs').innerHTML = GV().map(([k]) => `<button role="tab" aria-selected="${!shut && g === k}" data-act="rpIcon" data-v="${k}" title="${G.find(x => x[0] === k)[1]}">${svg(k)}<span>${SHORT[k]}</span>${badge(k, n)}</button>`).join('') + '<span class="grow"></span>' + cfgBtn + closeBtn;
      pb.innerHTML = shut ? '' : `<div class="rpc-h">${G.find(x => x[0] === g)[1]}</div>` + view(g, c);
    }
    pb.scrollTop = U.rpKey === key ? keep : 0; U.rpKey = key;
    let ft = $('#pfoot'); if (!ft) { ft = document.createElement('div'); ft.id = 'pfoot'; ft.className = 'pfoot'; $('#panel').appendChild(ft); } ft.innerHTML = H('foot', c); ft.hidden = !ft.innerHTML;
  };

  Object.assign(X.rp, { scopeBar, fold, hintRows, firstLines, srcRow, hintsIn, preNow });
  const LAY = [['a', 'Kartice', 'Kartice u jednom redu: Izvori, Komentari, Pregled, Mentor i predaja, Asistent.'], ['b', 'Uz tekst', 'Bez kartica. Panel prati poglavlje u kojem pišete; ostalo se otvara po potrebi.'], ['c', 'Ikone uz rub', 'Uska traka s ikonama. Panel se otvori na klik i zatvori kad ne treba, pa tekst ima više mjesta.']];
  X.hooks.dlg.rpcfg = () => {
    const k = cfg(), seg = (key, opts, cur) => `<div class="seg rcseg">${opts.map(([v, l]) => `<button data-act="rpSet" data-k="${key}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
    return `<h3>Prilagodi desni panel</h3><p class="muted">Postavke vrijede samo za Vas i pamte se. Sadržaj je isti u svakom rasporedu.</p>
      <div class="ptitle">Raspored</div>${LAY.map(([v, n, dsc]) => `<button class="rcl" data-act="rpSet" data-k="layout" data-v="${v}" aria-pressed="${k.layout === v}"><b>${n}</b><span>${dsc}</span></button>`).join('')}
      <div class="ptitle">Na mobitelu</div>${seg('mobile', [['same', 'Isti raspored'], ['a', 'Kartice'], ['b', 'Uz tekst'], ['c', 'Ikone']], k.mobile)}
      <div class="ptitle">Popisi prvo pokazuju</div>${seg('scope', [['ch', 'Ovo poglavlje'], ['all', 'Cijeli rad']], k.scope)}
      <div class="ptitle">Dijelovi panela i redoslijed</div>${k.order.map((g, i) => `<div class="rcsec"><label class="check"><input type="checkbox" data-rphide="${g}"${k.hide[g] ? '' : ' checked'}${!k.hide[g] && GV().length === 1 ? ' disabled' : ''}><span>${G.find(x => x[0] === g)[1]}</span></label><span class="grow"></span><button class="mini" data-act="rpMove" data-k="${g}" data-dir="-1" aria-label="Pomakni gore"${i ? '' : ' disabled'}>↑</button><button class="mini" data-act="rpMove" data-k="${g}" data-dir="1" aria-label="Pomakni dolje"${i < k.order.length - 1 ? '' : ' disabled'}>↓</button></div>`).join('')}
      <div class="ptitle">Gustoća</div>${seg('dense', [['false', 'Prozračno'], ['true', 'Zbijeno']], String(!!k.dense))}
      <div class="ptitle">Širina na računalu</div>${seg('width', [['s', 'Uska'], ['m', 'Srednja'], ['l', 'Široka']], k.width)}
      <div class="foot"><button class="lnk" data-act="rpReset" style="margin-right:auto">Vrati zadano</button><button class="btn pri" data-act="dlgClose">Gotovo</button></div>`;
  };
  const go = g => { const cur = groupOf(S.tab); if (cur !== g) { S.tab = G.find(x => x[0] === g)[2][0]; if (g === 'pre') U.rpPreOpen = false; } U.rpLastTab = S.tab; };
  Object.assign(ACT, {
    rpCfg: () => X.openDlg({ type: 'rpcfg' }),
    rpSet: el => { const key = el.dataset.k, v = el.dataset.v; cfg()[key] = v === 'true' ? true : v === 'false' ? false : v; if (key === 'layout' || key === 'mobile') { U.rpView = null; S.rpClosed = false; } persist(); X.renderPanel(true); X.renderDlg(); },
    rpMove: el => { const a = cfg().order, i = a.indexOf(el.dataset.k), j = i + (+el.dataset.dir); if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; persist(); X.renderPanel(true); X.renderDlg(); },
    rpReset: () => { S.rpCfg = fresh(); S.rpClosed = false; U.rpView = null; persist(); X.renderPanel(true); X.renderDlg(); },
    rpScope: el => { cfg().scope = el.dataset.v; persist(); X.renderPanel(true); },
    rpTab: el => { if (el.dataset.v === 'pre') U.rpPreOpen = false; go(el.dataset.v); persist(); X.renderPanel(true); },
    rpIcon: el => { const g = el.dataset.v, same = groupOf(S.tab) === g; if (drawer()) { go(g); } else if (same && !S.rpClosed) S.rpClosed = true; else { S.rpClosed = false; go(g); } persist(); X.renderPanel(true); },
    rpView: el => { const v = el.dataset.v; if (v === 'chk') { S.tab = 'upute'; U.rpLastTab = S.tab; U.rpView = 'pre'; U.rpPreOpen = true; cfg().scope = 'ch'; } else if (v) { go(v); U.rpView = v; } else U.rpView = null; persist(); X.renderPanel(true); },
    rpPreHome: () => { U.rpPreOpen = false; X.renderPanel(true); $('#pbody').scrollTop = 0; },
    rpPre: el => { const v = el.dataset.v; U.rpPreOpen = true; S.rpPreX = PRE[v] ? v : null; if (v === 'chk') S.tab = 'upute'; else { S.tab = 'nacrt'; if (!PRE[v]) S.nacrt = v; } U.rpLastTab = S.tab; persist(); X.renderPanel(true); },
    rpCm: el => { const cm = S.comments.find(x => x.id === el.dataset.id); if (!cm) return; U.active = cm.id; S.tab = 'cmt'; U.rpLastTab = 'cmt'; U.rpView = 'cmt'; X.refresh(); if (!cm.lost) X.jump(cm.from, false); X.renderPanel(true); }
  });
  document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.rphide) { cfg().hide[t.dataset.rphide] = !t.checked; persist(); X.renderPanel(true); X.renderDlg(); } });
  addEventListener('resize', () => { if ($('#panel').dataset.rp !== lay() || $('#app').classList.contains('rp-closed') === drawer()) X.renderPanel(true); });
})();
