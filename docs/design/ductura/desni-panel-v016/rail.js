/* Ductura Editor, prototip: tri inačice lijevog panela (A sažeti popis, B kartice, C dvije razine).
 * Inačica se bira na vrhu panela i čuva u S.rail; "Sada" je panel iz v0.2 za usporedbu.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, TASK, esc, plural, $, openPop, closePop, persist } = X, { flagsOf, headEnd, partsOf, STAT, mi } = X.fx;
  const ed = () => X.editor, D = () => X.D, railOld = X.render.rail;
  const DEF = { layout: 'a', mobile: 'c', words: false, bar: true, status: true, flags: true, dense: false, subs: 'manual', sections: ['pri', 'odl', 'nap', 'rok', 'nit'], hide: {}, width: 'm' };
  const cfg = () => { if (!S.railCfg) S.railCfg = Object.assign({}, DEF, /^[abc]$/.test(S.rail || '') ? { layout: S.rail } : {}, { sections: DEF.sections.slice(), hide: {} }); DEF.sections.forEach(k => { if (!S.railCfg.sections.includes(k)) S.railCfg.sections.push(k); }); return S.railCfg; };
  const layoutNow = () => (innerWidth <= 640 && cfg().mobile !== 'same' ? cfg().mobile : cfg().layout);
  const isCol = (h, c) => (cfg().subs === 'active' ? c.actCh !== h : !!S.collapsed[h.hid]);
  const secs = () => cfg().sections.filter(k => !cfg().hide[k]);
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const GL = ['○', '◐', '●'];
  function ctx() {
    const d = D(), sel = ed().state.selection.from, ro = S.mode === 'teacher' || !!S.submitted || !!U.otherTab; let act = null; d.heads.forEach(h => { if (h.pos <= sel) act = h; });
    const chOf = h => (h && h.level === 3 ? [...d.heads].reverse().find(x => x.level === 2 && x.pos < h.pos) : h && h.level === 2 ? h : null);
    const h2 = d.heads.filter(h => h.level === 2), maxW = Math.max(1, ...h2.map(h => h.words));
    return { d, ro, act, actCh: chOf(act), chOf, h2, maxW, kids: h => d.heads.filter(x => x.level === 3 && x.pos > h.pos && x.pos < headEnd(h)) };
  }
  const flagLine = (f, h) => { if (!cfg().flags) return ''; const n = h ? X.advice.count(h.hid) : 0; return [f.fix.length ? f.fix.length + ' za popraviti' : '', f.miss.length ? 'nedostaje ' + f.miss.length : '', n ? n + ' za pogledati' : '', ...(h && X.flagExtra ? X.flagExtra(h) : [])].filter(Boolean).join(' · '); };
  const pct = (h, c) => Math.min(100, Math.round(S.targets[h.hid] ? h.words / S.targets[h.hid] * 100 : h.words / c.maxW * 100));
  const bar = (h, c, force) => !force && !cfg().bar ? '' : `<div class="rbar" title="${fmt(h.words)}${S.targets[h.hid] ? ' od ' + fmt(S.targets[h.hid]) : ''} riječi"><i style="width:${pct(h, c)}%"></i></div>`;
  function chOpts(h) {
    const st = S.statuses[h.hid] || 0, t = S.targets[h.hid], x = ` data-hid="${h.hid}"`;
    return `<div class="seg rseg">${STAT.map((s, i) => `<button data-act="statusSet"${x} data-v="${i}" aria-pressed="${st === i}">${s}</button>`).join('')}</div><div class="row ropts"><button class="chip" data-act="hTarget"${x}>${t ? 'cilj ' + fmt(t) : '+ cilj riječi'}</button><button class="chip" data-act="hDue"${x}>${S.dues[h.hid] ? 'rok ' + esc(S.dues[h.hid]) : '+ rok'}</button><span class="grow"></span><button class="mini" data-act="move"${x} data-dir="-1" aria-label="Premjesti poglavlje gore" title="Premjesti gore">↑</button><button class="mini" data-act="move"${x} data-dir="1" aria-label="Premjesti poglavlje dolje" title="Premjesti dolje">↓</button></div>`;
  }
  function chInfo(h, ro) {
    const f = flagsOf(h), t0 = S.targets[h.hid], good = []; if (h.words && h.cites) good.push(h.cites + ' ' + plural(h.cites, 'navod', 'navoda', 'navoda')); if (t0 && h.words >= t0) good.push('cilj riječi dosegnut'); if (h.words && !f.fix.length) good.push('nema otvorenih napomena');
    return `<div class="rinfo"><div class="rwords">${fmt(h.words)}${S.targets[h.hid] ? ' od ' + fmt(S.targets[h.hid]) : ''} riječi · ${h.cites} ${plural(h.cites, 'navod', 'navoda', 'navoda')}</div>` +
      (f.fix.length ? `<div class="fl"><b>Popravi</b>${f.fix.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '') + (f.miss.length ? `<div class="fl"><b>Još nedostaje</b>${f.miss.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '') +
      (S.purposes[h.hid] ? `<div class="fl"><b>Svrha</b><span>${esc(S.purposes[h.hid])}</span></div>` : '') + (S.hnotes[h.hid] ? `<div class="fl"><b>Bilješka</b><span>${esc(S.hnotes[h.hid])}</span></div>` : '') +
      (good.length ? `<div class="fl ok"><b>U redu</b><span>${esc(good.join(' · '))}</span></div>` : '') +
      X.advice.html(h, ro) + (X.chExtra ? X.chExtra(h, ro) : '') + `</div>`;
  }
  const menuItems = h => { const x = ` data-hid="${h.hid}"`; return `${h.level === 2 ? mi('hSub', 'Dodaj podnaslov', '', x) : ''}${mi('hRename', 'Preimenuj', '', x)}${mi('hLevel', h.level === 3 ? 'Podigni razinu (poglavlje)' : 'Spusti razinu (podnaslov)', '', x)}${mi('hPurpose', 'Svrha poglavlja', '', x)}${mi('hNote', 'Bilješka uz poglavlje', '', x)}${mi('hAsk', 'Pitaj mentora', '', x)}${mi('hOnly', 'Prikaži samo ovo poglavlje', '', x)}${mi('hDel', 'Obriši poglavlje', '', x)}`; };
  function placeSheet() { const p = $('#pop'), r = U.sheet.rect, w = p.offsetWidth, hh = p.offsetHeight; if (innerWidth > 700) { p.style.left = Math.min(r.right + 8, innerWidth - w - 8) + 'px'; p.style.top = Math.max(8, Math.min(r.top - 24, innerHeight - hh - 8)) + 'px'; } }
  const sheet = (h, ro) => `<div class="pad rsheet"><p><b>${h.num} ${esc(h.title)}</b></p>${ro ? '' : chOpts(h)}${chInfo(h, ro)}</div>${ro ? '' : menuItems(h)}`;
  const headBar = (c, all) => `<div class="rhead"><h2>Struktura</h2><span class="grow"></span>${all && cfg().subs !== 'active' ? `<button class="rtxt" data-act="railFold">${c.h2.every(h => S.collapsed[h.hid]) ? 'Rasklopi sve' : 'Sklopi sve'}</button>` : ''}<button class="mini${U.outline ? ' on' : ''}" data-act="outlineOnly" title="Samo naslovi i svrhe poglavlja" aria-label="Samo naslovi">≡</button><button class="mini" data-act="copyToc" title="Kopiraj sadržaj rada" aria-label="Kopiraj sadržaj rada">⧉</button></div>${X.railTools ? X.railTools(c) : ''}`;
  const thesis = c => `<button class="thesis" data-act="thesisEdit" title="Jedna rečenica: što rad tvrdi ili pita?"${c.ro ? ' disabled' : ''}><span class="clamp2">${S.thesis ? esc(S.thesis) : '+ Teza ili istraživačko pitanje'}</span></button>`;
  const titleRow = c => c.d.heads.filter(h => h.level === 1).map(h => `<button class="rtitle" data-act="jump" data-pos="${h.pos}">${esc(h.title || 'Bez naslova')}</button>`).join('');
  const noHeads = c => (c.h2.length ? '' : `<p class="muted" style="margin:6px">Rad još nema naslova.</p>${c.ro ? '' : '<button class="btn sm pri" style="margin:0 6px" data-act="wizOpen">Započni rad u tri koraka</button>'}`);
  // zajednički sadržaji
  function secPrikazi(c) {
    const pk = c.d.prikazi || [], fn = c.d.fns || [];
    return (pk.length ? pk.map(p => `<button class="rrow" data-act="jump" data-pos="${p.pos}"><span class="rt">${p.kind === 'tablica' ? 'Tablica' : 'Slika'} ${p.n}. ${esc(p.title || 'bez naslova')}</span></button>`).join('') : '<p class="muted rpad">Rad još nema tablica ni slika.</p>') +
      `<h2 class="rsub">Fusnote</h2>` + (fn.length ? fn.map((f, i) => `<button class="rrow" data-act="jump" data-pos="${f.pos}"><span class="rnum">${i + 1}</span><span class="rt">${esc(f.text || 'prazna fusnota')}</span></button>`).join('') : '<p class="muted rpad">Još nema fusnota.</p>');
  }
  const secStash = c => (S.stash.length ? S.stash.map(x => `<div class="stash"><div>${esc(x.text.length > 160 ? x.text.slice(0, 157) + '…' : x.text)}</div><div class="meta"><span>iz: ${esc(x.from)}</span>${c.ro ? '' : `<button class="lnk" data-act="unstash" data-id="${x.id}">vrati</button><button class="lnk" data-act="stashDel" data-id="${x.id}">obriši</button>`}</div></div>`).join('') : '<p class="muted rpad">Označite tekst i odaberite „Odloži” u izborniku Više.</p>');
  function secNapredak(c, chapters) {
    const d = c.d, p = Math.min(100, Math.round(d.words / TASK.min * 100)), days = Math.ceil((new Date(2026, 10, 30) - new Date()) / 864e5), cited = S.sources.filter(s => d.cited[s.id]).length, ses = d.words - (U.startWords == null ? d.words : U.startWords), sumT = Object.values(S.targets).reduce((a, b) => a + (+b || 0), 0);
    return `<div class="prog"><div><span>Opseg</span><b>${fmt(d.words)} / ${fmt(TASK.min)} do ${fmt(TASK.max)}</b></div><div class="bar"><i style="width:${p}%"></i></div><div><span>Stranice</span><b>≈ ${Math.max(1, Math.ceil(d.words / 350))}</b></div><div><span>Izvori</span><b>${cited} citirano od ${S.sources.length}</b></div><div><span>Rok predaje</span><b>${TASK.due}${days >= 0 ? ' · ' + days + ' ' + plural(days, 'dan', 'dana', 'dana') : ''}</b></div><div><span>Ove sesije</span><b>${ses >= 0 ? '+' : ''}${fmt(ses)} riječi</b></div>${sumT ? `<div><span>Zbroj ciljeva poglavlja</span><b>${fmt(sumT)}</b></div>` : ''}</div>` +
      (chapters && X.balance ? X.balance(c) : chapters ? `<h2 class="rsub">Po poglavljima</h2>` + c.h2.map(h => `<button class="rprog" data-act="jump" data-pos="${h.pos}"><span class="rpt"><span>${h.num} ${esc(h.title)}</span><i class="sd s${S.statuses[h.hid] || 0}" title="${STAT[S.statuses[h.hid] || 0]}"></i></span>${bar(h, c, true)}<span class="rpm">${fmt(h.words)}${S.targets[h.hid] ? ' / ' + fmt(S.targets[h.hid]) : ''} riječi${S.dues[h.hid] ? ' · rok ' + esc(S.dues[h.hid]) : ''}</span></button>`).join('') : '');
  }
  const foot = c => { const days = Math.ceil((new Date(2026, 10, 30) - new Date()) / 864e5); return `${fmt(c.d.words)} / ${fmt(TASK.min)} riječi${days >= 0 ? ' · još ' + days + ' ' + plural(days, 'dan', 'dana', 'dana') : ''}`; };

  /* A: sažeti popis */
  function railA(c) {
    let html = X.rules.card(U.rqShow) + (U.rqShow ? X.rules.list() : '') + headBar(c, true) + thesis(c) + titleRow(c), hidden = null;
    c.d.heads.forEach(h => {
      if (h.level === 1) return; if (X.railHide && X.railHide(h, c)) return; if (h.level === 2) hidden = !U.railQ && isCol(h, c) ? h.hid : null; else if (hidden) return;
      const on = c.act === h || (h.level === 2 && isCol(h, c) && c.actCh === h), f = flagsOf(h), fl = flagLine(f, h), st = S.statuses[h.hid] || 0, kids = h.level === 2 && c.kids(h).length && cfg().subs !== 'active';
      html += `<div class="ra l${h.level}${on ? ' act' : ''}">${kids ? `<button class="car" data-act="collapse" data-hid="${h.hid}" aria-label="Sklopi ili rasklopi potpoglavlja">${S.collapsed[h.hid] ? '▸' : '▾'}</button>` : '<span class="car"></span>'}<button class="ram" data-act="jump" data-pos="${h.pos}"><span class="rnum">${h.num}</span><span class="rt">${esc(h.title || 'Bez naslova')}${fl ? `<small class="${f.fix.length ? 'fix' : ''}">${fl}</small>` : ''}</span>${cfg().words ? `<span class="rw">${fmt(h.words)}</span>` : ''}</button>${cfg().status ? `<span class="rst" title="Stanje: ${STAT[st]}"><i class="sd s${st}"></i></span>` : ''}<button class="rmore" data-act="hSheet" data-hid="${h.hid}" aria-label="Opcije poglavlja ${esc(h.title)}">⋯</button></div>${h.level === 2 ? bar(h, c) : ''}`;
    });
    html += noHeads(c);
    const acc = (k, label, body) => `<button class="racc" data-act="railAcc" data-k="${k}" aria-expanded="${!!(U.acc || {})[k]}"><span>${label}</span><span>${(U.acc || {})[k] ? '▾' : '▸'}</span></button>${(U.acc || {})[k] ? `<div class="raccb">${body()}</div>` : ''}`;
    const SEC = { pri: [`Prikazi i fusnote (${(c.d.prikazi || []).length + (c.d.fns || []).length})`, () => secPrikazi(c)], odl: [`Odloženo (${S.stash.length})`, () => secStash(c)], nap: ['Napredak', () => secNapredak(c, true)] }; Object.entries(X.railSecs || {}).forEach(([k, v]) => { SEC[k] = [v.label(c), () => v.body(c)]; });
    html += `<div class="raccs">` + secs().map(k => acc(k, SEC[k][0], SEC[k][1])).join('') + `</div>` + (secs().includes('nap') ? `<button class="rfoot" data-act="railAcc" data-k="nap">${foot(c)}</button>` : '');
    return html;
  }
  /* B: kartice na vrhu */
  function railB(c) {
    const TL = { pri: 'Prikazi', odl: 'Odloženo' + (S.stash.length ? ' ' + S.stash.length : ''), nap: 'Napredak', ...Object.fromEntries(Object.entries(X.railSecs || {}).map(([k, v]) => [k, v.short || v.label(c)])) }, tabs = [['str', 'Struktura'], ['req', 'Zahtjevi'], ...secs().map(k => [k, TL[k]])], t = tabs.some(x => x[0] === U.railTab) ? U.railTab : 'str';
    let html = `<div class="rtabs">${tabs.map(([k, l]) => `<button data-act="railTab" data-v="${k}" aria-selected="${t === k}">${l}</button>`).join('')}</div>`;
    if (t === 'req') return html + X.rules.card(true) + X.rules.list();
    if (X.railSecs && X.railSecs[t]) return html + `<h2 class="rsub" style="margin-top:4px">${X.railSecs[t].label(c)}</h2>` + X.railSecs[t].body(c);
    if (t === 'pri') return html + `<h2 class="rsub" style="margin-top:4px">Tablice i slike</h2>` + secPrikazi(c);
    if (t === 'odl') return html + `<h2 class="rsub" style="margin-top:4px">Odloženo</h2>` + secStash(c);
    if (t === 'nap') return html + `<h2 class="rsub" style="margin-top:4px">Napredak</h2>` + secNapredak(c, true);
    html += X.rules.card(false) + headBar(c, true) + thesis(c) + titleRow(c); let hidden = null;
    c.d.heads.forEach(h => {
      if (h.level === 1) return; if (X.railHide && X.railHide(h, c)) return; if (h.level === 2) hidden = !U.railQ && isCol(h, c) ? h.hid : null; else if (hidden) return;
      const on = c.act === h || (h.level === 2 && isCol(h, c) && c.actCh === h), f = flagsOf(h), fl = flagLine(f, h), st = S.statuses[h.hid] || 0, kids = h.level === 2 && c.kids(h).length && cfg().subs !== 'active';
      html += `<div class="ra rb l${h.level}${on ? ' act' : ''}">${kids ? `<button class="car" data-act="collapse" data-hid="${h.hid}" aria-label="Sklopi ili rasklopi potpoglavlja">${S.collapsed[h.hid] ? '▸' : '▾'}</button>` : '<span class="car"></span>'}<button class="ram" data-act="jump" data-pos="${h.pos}"><span class="rnum">${h.num}</span><span class="rt">${esc(h.title || 'Bez naslova')}${fl ? `<small class="${f.fix.length ? 'fix' : ''}">${fl}</small>` : ''}</span>${cfg().words ? `<span class="rw">${fmt(h.words)}</span>` : ''}</button>${cfg().status ? `<span class="rst" title="Stanje: ${STAT[st]}"><i class="sd s${st}"></i></span>` : ''}</div>`;
      if (on) html += `<div class="rbdet">${c.ro ? '' : chOpts(h) + `<button class="rtxt" data-act="hMenu" data-hid="${h.hid}">Više radnji ⋯</button>`}${chInfo(h, c.ro)}</div>`;
    });
    return html + noHeads(c);
  }
  /* C: dvije razine */
  function railC(c) {
    const sub = U.railSub === 'req' || secs().includes(U.railSub) ? U.railSub : null, ch = U.railCh && c.d.heads.find(h => h.hid === U.railCh), back = `<button class="rback" data-act="railBack">‹ Sva poglavlja</button>`;
    if (sub === 'req') return back + X.rules.card(true) + X.rules.list();
    if (sub && X.railSecs && X.railSecs[sub]) return back + `<h2 class="rsub">${X.railSecs[sub].label(c)}</h2>` + X.railSecs[sub].body(c);
    if (sub) return back + `<h2 class="rsub">${{ pri: 'Prikazi i fusnote', odl: 'Odloženo', nap: 'Napredak' }[sub]}</h2>` + (sub === 'pri' ? secPrikazi(c) : sub === 'odl' ? secStash(c) : secNapredak(c, true));
    if (ch) {
      const kids = c.kids(ch), other = c.actCh && c.actCh !== ch ? `<button class="rhere" data-act="railDrill" data-hid="${c.actCh.hid}">Kursor je u poglavlju ${c.actCh.num} ${esc(c.actCh.title)} ›</button>` : '';
      return back + other + `<button class="rctitle${c.act === ch ? ' act' : ''}" data-act="jump" data-pos="${ch.pos}"><span class="rnum">${ch.num}</span>${esc(ch.title || 'Bez naslova')}</button>${bar(ch, c, true)}${c.ro ? '' : chOpts(ch)}${chInfo(ch, c.ro)}` +
        `<h2 class="rsub">Potpoglavlja</h2>` + (kids.length ? kids.map(h => { const f = flagsOf(h), fl = flagLine(f, h); return `<div class="ra l3c${c.act === h ? ' act' : ''}"><button class="ram" data-act="jump" data-pos="${h.pos}"><span class="rnum">${h.num}</span><span class="rt">${esc(h.title || 'Bez naslova')}${fl ? `<small class="${f.fix.length ? 'fix' : ''}">${fl}</small>` : ''}</span>${cfg().words ? `<span class="rw">${fmt(h.words)}</span>` : ''}</button>${c.ro ? '' : `<button class="rmore" data-act="hMenu" data-hid="${h.hid}" aria-label="Radnje nad potpoglavljem">⋯</button>`}</div>`; }).join('') : '<p class="muted rpad">Poglavlje nema potpoglavlja.</p>') +
        (c.ro ? '' : `<div class="row rpad" style="margin-top:8px"><button class="btn sm" data-act="hSub" data-hid="${ch.hid}">+ Dodaj podnaslov</button><button class="rtxt" data-act="hMenu" data-hid="${ch.hid}">Više radnji ⋯</button></div>`);
    }
    let html = X.rules.card(false) + headBar(c, false) + thesis(c) + titleRow(c);
    c.h2.forEach(h => { if (X.railHide && X.railHide(h, c, true)) return; const f = flagsOf(h), fl = flagLine(f, h), st = S.statuses[h.hid] || 0, n = c.kids(h).length;
      html += `<button class="rcc${c.actCh === h ? ' act' : ''}" data-act="railDrill" data-hid="${h.hid}"><span class="rcn">${h.num}</span><span class="rcb"><span class="rct">${esc(h.title || 'Bez naslova')}</span><span class="rcm">${[cfg().words ? fmt(h.words) + (S.targets[h.hid] ? ' / ' + fmt(S.targets[h.hid]) : '') + ' riječi' : '', cfg().status ? STAT[st] : '', n ? n + ' ' + plural(n, 'potpoglavlje', 'potpoglavlja', 'potpoglavlja') : ''].filter(Boolean).join(' · ')}</span>${fl ? `<span class="rcf${f.fix.length ? ' fix' : ''}">${fl}</span>` : ''}${bar(h, c)}</span><span class="rcv">›</span></button>`; });
    html += noHeads(c) + `<div class="raccs">${secs().map(k => [k, { pri: `Prikazi i fusnote (${(c.d.prikazi || []).length + (c.d.fns || []).length})`, odl: `Odloženo (${S.stash.length})`, nap: 'Napredak · ' + foot(c), ...Object.fromEntries(Object.entries(X.railSecs || {}).map(([q, v]) => [q, v.label(c)])) }[k]]).map(([k, l]) => `<button class="racc" data-act="railSub" data-v="${k}"><span>${l}</span><span>›</span></button>`).join('')}</div>`;
    return html;
  }

  X.render.rail = function () {
    const rail = $('#rail'), keep = rail.scrollTop, k = cfg(), v = layoutNow(), c = ctx();
    const sw = `<div class="rvar"><span>${{ a: 'Popis', b: 'Kartice', c: 'Dvije razine' }[v]}</span><button class="rtxt" data-act="railCfg">Prilagodi panel</button></div>`;
    rail.innerHTML = sw + (X.railTop ? X.railTop(c, v) : '') + (v === 'b' ? railB(c) : v === 'c' ? railC(c) : railA(c));
    rail.classList.toggle('dense', !!k.dense); rail.style.setProperty('--rail-w', { s: '248px', m: '288px', l: '340px' }[k.width] || '288px');
    rail.dataset.v = v; U.railLay = v; rail.scrollTop = keep;
    const key = v + '|' + (c.act ? c.act.hid : '') + '|' + (U.railCh || '') + '|' + (U.railSub || '') + '|' + (U.railTab || '');
    if (key !== U.railKey) { U.railKey = key; const a = rail.querySelector('.act'); if (a) { const r = a.getBoundingClientRect(), R = rail.getBoundingClientRect(); if (r.top < R.top + 48 || r.bottom > R.bottom - 64) rail.scrollTop += r.top - R.top - R.height / 3; } else if (U.railJustNav) rail.scrollTop = 0; U.railJustNav = false; }
    if (!$('#pop').hidden && U.sheet && $('#pop').querySelector('.rsheet')) { const h = D().heads.find(x => x.hid === U.sheet.hid); if (h) { openPop(sheet(h, c.ro), U.sheet.rect, 'menu'); placeSheet(); } }
  };
  const LAY = [['a', 'Popis', 'Sva poglavlja i potpoglavlja u jednom popisu; opcije poglavlja na ⋯.'], ['b', 'Kartice', 'Struktura, Prikazi, Odloženo i Napredak kao kartice; opcije ispod aktivnog poglavlja.'], ['c', 'Dvije razine', 'Prvo samo poglavlja; klik otvara poglavlje s opcijama i potpoglavljima.']];
  X.hooks.dlg.railcfg = () => {
    const k = cfg(), seg = (key, opts, cur) => `<div class="seg rcseg">${opts.map(([v, l]) => `<button data-act="rcSet" data-k="${key}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`, SN = { pri: 'Prikazi i fusnote', odl: 'Odloženo', nap: 'Napredak', rok: 'Rokovi', nit: 'Nit rada' };
    return `<h3>Prilagodi panel</h3><p class="muted">Postavke vrijede samo za Vas i pamte se. Opcije poglavlja iste su u svakom rasporedu.</p>
      <div class="ptitle">Raspored</div>${LAY.map(([v, n, dsc]) => `<button class="rcl" data-act="rcSet" data-k="layout" data-v="${v}" aria-pressed="${k.layout === v}"><b>${n}</b><span>${dsc}</span></button>`).join('')}
      <div class="ptitle">Na mobitelu</div>${seg('mobile', [['same', 'Isti raspored'], ['c', 'Dvije razine'], ['a', 'Popis']], k.mobile)}
      <div class="ptitle">U retku poglavlja</div>${[['words', 'Broj riječi'], ['bar', 'Traka napretka'], ['status', 'Točka stanja'], ['flags', 'Napomene „za popraviti”']].map(([key, l]) => `<label class="check"><input type="checkbox" data-rc="${key}"${k[key] ? ' checked' : ''}><span>${l}</span></label>`).join('')}
      <div class="ptitle">Gustoća</div>${seg('dense', [['false', 'Prozračno'], ['true', 'Zbijeno']], k.dense)}
      <div class="ptitle">Potpoglavlja</div>${seg('subs', [['open', 'Rasklopljena'], ['closed', 'Sklopljena'], ['active', 'Samo u aktivnom']], k.subsPick || 'open')}
      <div class="ptitle">Donji dijelovi</div>${k.sections.map((key, i) => `<div class="rcsec"><label class="check"><input type="checkbox" data-rcsec="${key}"${k.hide[key] ? '' : ' checked'}><span>${SN[key]}</span></label><span class="grow"></span><button class="mini" data-act="rcMove" data-k="${key}" data-dir="-1" aria-label="Pomakni gore"${i ? '' : ' disabled'}>↑</button><button class="mini" data-act="rcMove" data-k="${key}" data-dir="1" aria-label="Pomakni dolje"${i < k.sections.length - 1 ? '' : ' disabled'}>↓</button></div>`).join('')}
      <div class="ptitle">Širina na računalu</div>${seg('width', [['s', 'Uska'], ['m', 'Srednja'], ['l', 'Široka']], k.width)}
      <div class="foot"><button class="lnk" data-act="rcReset" style="margin-right:auto">Vrati zadano</button><button class="btn pri" data-act="dlgClose">Gotovo</button></div>`;
  };
  document.addEventListener('change', e => { const t = e.target; if (t.dataset.rc) { cfg()[t.dataset.rc] = t.checked; persist(); X.render.rail(); } if (t.dataset.rcsec) { cfg().hide[t.dataset.rcsec] = !t.checked; persist(); X.render.rail(); } });
  addEventListener('resize', () => { if (U.railLay !== layoutNow()) X.render.rail(); });
  X.fx.fmt = fmt; X.fx.layoutNow = layoutNow; X.fx.bar = bar;
  const coreMove = ACT.move;
  Object.assign(ACT, {
    rqOpen: () => { const v = layoutNow(); if (v === 'b') { U.railTab = U.railTab === 'req' ? 'str' : 'req'; } else if (v === 'c') { U.railSub = U.railSub === 'req' ? null : 'req'; U.railCh = null; } else U.rqShow = !U.rqShow; U.railJustNav = true; X.render.rail(); $('#rail').scrollTop = 0; },
    railVar: el => { cfg().layout = el.dataset.v; U.railCh = U.railSub = null; persist(); X.render.rail(); },
    railCfg: () => X.openDlg({ type: 'railcfg' }),
    rcSet: el => { const k = cfg(), key = el.dataset.k, v = el.dataset.v; k[key] = v === 'true' ? true : v === 'false' ? false : v; if (key === 'subs' && v !== 'active') { ctx().h2.forEach(h => { S.collapsed[h.hid] = v === 'closed'; }); k.subs = 'manual'; k.subsPick = v; } else if (key === 'subs') k.subsPick = 'active'; if (key === 'layout' || key === 'mobile') U.railCh = U.railSub = null; persist(); X.render.rail(); X.renderDlg(); },
    rcMove: el => { const a = cfg().sections, i = a.indexOf(el.dataset.k), j = i + (+el.dataset.dir); if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; persist(); X.render.rail(); X.renderDlg(); },
    rcReset: () => { S.railCfg = null; S.rail = 'a'; cfg(); persist(); X.render.rail(); X.renderDlg(); },
    railFold: () => { const c = ctx(), all = c.h2.every(h => S.collapsed[h.hid]); c.h2.forEach(h => { S.collapsed[h.hid] = !all; }); persist(); X.render.rail(); },
    railAcc: el => { U.acc = U.acc || {}; U.acc[el.dataset.k] = !U.acc[el.dataset.k]; X.render.rail(); if (U.acc[el.dataset.k]) setTimeout(() => { const b = $('#rail').querySelector(`.racc[data-k="${el.dataset.k}"]`); if (b) b.scrollIntoView({ block: 'nearest' }); }, 0); },
    railTab: el => { U.railTab = el.dataset.v; U.railJustNav = true; X.render.rail(); },
    railSub: el => { U.railSub = el.dataset.v; U.railJustNav = true; X.render.rail(); },
    railBack: () => { U.railCh = U.railSub = null; X.render.rail(); },
    railDrill: el => { const h = D().heads.find(x => x.hid === el.dataset.hid); if (!h) return; U.railCh = h.hid; U.railJustNav = true; const dom = ed().view.nodeDOM(h.pos); if (ed().isEditable) { try { ed().commands.setTextSelection(h.pos + 1); } catch (e) { /* izvan teksta */ } } if (dom && dom.scrollIntoView) dom.scrollIntoView({ block: 'start', behavior: 'smooth' }); X.render.rail(); },
    statusSet: el => { S.statuses[el.dataset.hid] = +el.dataset.v; persist(); X.render.rail(); },
    hSheet: el => { const h = D().heads.find(x => x.hid === el.dataset.hid); if (!h) return; const r = el.getBoundingClientRect(); U.sheet = { hid: h.hid, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }; openPop(sheet(h, ctx().ro), U.sheet.rect, 'menu'); placeSheet(); },
    hMenu: el => { const h = D().heads.find(x => x.hid === el.dataset.hid); if (h) openPop(menuItems(h), el.getBoundingClientRect(), 'menu'); },
    move: el => { closePop(); coreMove(el); },
  });
})();
