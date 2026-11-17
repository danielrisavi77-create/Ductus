/* Ductura Editor, prototip: profil pravila fakulteta (vrijednosti iz Lektina paketa, Sveučilište u Zagrebu).
 * Profil daje popis "Zahtjevi rada" u lijevom panelu. Četiri skupine:
 *   auto   = provjerava Ductura u tekstu,   manual = student sam označava,
 *   export = rješava izvoz,                 info   = rokovi i napomene.
 * U aplikaciji profil dolazi iz prijave (AAI) i zadatka; u prototipu se bira ručno.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, TASK, esc, wc, plural, $, toast, persist } = X;
  const D = () => X.D, fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const KIND = { graduate: 'Diplomski rad', final: 'Završni rad', doctoral: 'Doktorski rad', specialist: 'Specijalistički rad', seminar: 'Seminarski rad', project: 'Projektni rad', article: 'Članak' };
  const CITE = { fpzg: ['fpzg', 'FPZG autor-godina'], apa7: ['apa', 'APA 7'], harvard: ['apa', 'Harvard (autor-godina)'], 'chicago-author': ['chicago', 'Chicago autor-godina'], vancouver: [null, 'Vancouver (brojčani)'], 'chicago-notes': [null, 'Chicago s bilješkama'], 'pravo-fusnote': [null, 'pravne fusnote'], 'pravo-social-author': ['apa', 'autor-godina (društvene znanosti)'], custom: [null, 'vlastiti stil fakulteta'] };
  const R = X.rules = { data: null, err: false };
  const prof = () => (R.data && R.data.profiles.find(p => p.id === S.profileId)) || null;
  R.profile = prof;
  X.hooks.defaults.push(s => { if (s.profileId == null) s.profileId = s.task && s.task.profile ? s.task.profile : 'fpzg-opci-akademski-rad'; if (s.ruleTicks == null) s.ruleTicks = {}; });

  function apply(p, fromUser) {
    TASK.profile = p.id; TASK.plabel = p.label; TASK.kind = KIND[(p.workTypes || [])[0]] || TASK.kind;
    if (p.wordMin) { TASK.min = p.wordMin; TASK.max = p.wordMax || Math.round(p.wordMin * 1.2); TASK.limitSrc = 'profil'; }
    else if (p.pageMin) { TASK.min = p.pageMin * 350; TASK.max = (p.pageMax || Math.round(p.pageMin * 1.5)) * 350; TASK.limitSrc = 'stranice'; }
    else { TASK.limitSrc = 'zadatak'; if (fromUser && !S.baseTask) { /* granice ostaju iz zadatka */ } }
    TASK.minRefs = p.minReferences || 0;
    const bk = norm((p.manualChecks || []).concat(p.facts || []).join(' ')).match(/najmanje (tri|3|dvije|2|pet|5) knjig/); TASK.minBooks = bk ? ({ tri: 3, dvije: 2, pet: 5 }[bk[1]] || +bk[1]) : 0;
    const c = CITE[p.citation]; if (fromUser && c && c[0]) S.citeStyle = c[0];
    S.task = Object.assign({}, TASK);
  }
  R.load = function () {
    return fetch('rules/unizg.json').then(r => r.json()).then(j => { R.data = j; const p = prof(); if (p) apply(p, false); X.repaintCites(); X.refresh(); X.renderAll(true); }).catch(() => { R.err = true; X.render.rail(); });
  };

  /* Stavke profila */
  R.items = function () {
    const p = prof(); if (!p) return [];
    const d = D(), out = [], seen = {}, add = (g, key, o) => { if (seen[key]) return; seen[key] = 1; out.push(Object.assign({ g, key }, o)); };
    const h2 = d.heads.filter(h => h.level === 2), has = re => h2.find(h => re.test(norm(h.title))), cited = S.sources.filter(s => d.cited[s.id]);
    const txt = norm((p.manualChecks || []).concat(p.facts || [], p.sections || []).join(' | ')), pages = Math.max(1, Math.ceil(d.words / 350));
    // opseg
    if (p.wordMin) add('auto', 'opseg', { st: d.words >= TASK.min && d.words <= TASK.max ? 'ok' : 'todo', t: `Opseg: ${fmt(p.wordMin)}${p.wordMax ? ' do ' + fmt(p.wordMax) : ' ili više'} riječi`, d: `Sada ${fmt(d.words)} riječi${d.words > TASK.max ? ', ' + fmt(d.words - TASK.max) + ' iznad gornje granice' : d.words < TASK.min ? ', nedostaje ' + fmt(TASK.min - d.words) : ''}.` });
    else if (p.pageMin) { const mx = p.pageMax || null; add('auto', 'opseg', { st: pages >= p.pageMin && (!mx || pages <= mx) ? 'ok' : 'todo', t: `Opseg: ${p.pageMin}${mx ? ' do ' + mx : ' ili više'} stranica`, d: `Sada oko ${pages} str. (procjena iz ${fmt(d.words)} riječi; točan broj daje izvoz).` }); }
    else add('info', 'opseg', { t: 'Opseg zadaje nastavnik u zadatku', d: `U ovom zadatku: ${fmt(TASK.min)} do ${fmt(TASK.max)} riječi. Sada ${fmt(d.words)}.` });
    if (p.minReferences) add('auto', 'refs', { st: cited.length >= p.minReferences ? 'ok' : 'todo', t: `Najmanje ${p.minReferences} izvora`, d: `Citirano ${cited.length}.`, tab: 'lit' });
    if (TASK.minBooks) { const b = cited.filter(s => s.kind === 'knjiga').length; add('auto', 'books', { st: b >= TASK.minBooks ? 'ok' : 'todo', t: `Najmanje ${TASK.minBooks} ${plural(TASK.minBooks, 'knjiga', 'knjige', 'knjiga')} među izvorima`, d: `Citirano knjiga: ${b}.`, tab: 'lit' }); }
    // dijelovi rada
    const kwN = S.kw.split(/[,;]/).map(x => x.trim()).filter(Boolean).length, kwR = /3.{1,3}5 kljucnih/.test(txt);
    (p.sections || []).forEach(sec => {
      const n = norm(sec);
      if (/naslovn|korice/.test(n)) return add('export', 'naslovnica', { t: 'Naslovnica', d: 'Slaže se pri izvozu iz podataka o radu.' });
      if (/sadrzaj/.test(n)) return add('export', 'sadrzaj', { t: 'Sadržaj', d: 'Slaže se sam iz naslova.' });
      if (/izjava/.test(n)) return add('export', 'izjava', { t: sec[0].toUpperCase() + sec.slice(1), d: 'Potvrđuje se pri predaji i ulazi u rad.' });
      if (/popis (slika|tablica|ilustracija|priloga|kratica)/.test(n)) return add('export', 'popisi', { t: 'Popisi tablica i slika', d: 'Slažu se sami iz prikaza u tekstu.' });
      let m = false;
      if (/^uvod/.test(n)) { m = true; const h = has(/^uvod/); add('auto', 'uvod', { st: h && h.words ? 'ok' : 'todo', t: 'Uvod', d: h ? (h.words ? `${fmt(h.words)} riječi.` : 'Naslov postoji, teksta još nema.') : 'Poglavlje još ne postoji.', pos: h ? h.pos : null }); }
      if (/zakljuc/.test(n)) { m = true; const h = has(/zakljuc/); add('auto', 'zakljucak', { st: h && h.words ? 'ok' : 'todo', t: 'Zaključak', d: h ? (h.words ? `${fmt(h.words)} riječi.` : 'Naslov postoji, teksta još nema.') : 'Poglavlje još ne postoji.', pos: h ? h.pos : null }); }
      if (/razrad|sredisnj|tekst rada|rasprav|poglavlja/.test(n) && !/^uvod/.test(n)) { m = true; const mid = h2.filter(h => !/^uvod|zakljuc/.test(norm(h.title)) && h.words); add('auto', 'razrada', { st: mid.length ? 'ok' : 'todo', t: 'Središnji dio', d: mid.length ? `${mid.length} ${plural(mid.length, 'poglavlje', 'poglavlja', 'poglavlja')} s tekstom.` : 'Još nema poglavlja između uvoda i zaključka.' }); }
      if (/literatur|bibliograf|izvor/.test(n)) { m = true; add('auto', 'literatura', { st: cited.length ? 'ok' : 'todo', t: 'Popis literature', d: cited.length ? `Slaže se sam iz ${cited.length} citiranih izvora.` : 'Slaže se sam; u tekstu još nema navoda.', tab: 'lit' }); }
      if (/sazet/.test(n)) { m = true; add('auto', 'sazetak', { st: S.abs.trim() ? 'ok' : 'todo', t: 'Sažetak na hrvatskom', d: S.abs.trim() ? `${wc(S.abs)} riječi.` : 'Još nije upisan (kartica Rad).', tab: 'rad' }); }
      if (/abstract|summary/.test(n)) { m = true; add('auto', 'summary', { st: S.sum.trim() ? 'ok' : 'todo', t: 'Sažetak na engleskom', d: S.sum.trim() ? `${wc(S.sum)} riječi.` : 'Još nije upisan (kartica Rad).', tab: 'rad' }); }
      if (/kljucn/.test(n)) { m = true; add('auto', 'kw', { st: kwN && (!kwR || (kwN >= 3 && kwN <= 5)) ? 'ok' : 'todo', t: 'Ključne riječi' + (kwR ? ' (3 do 5)' : ''), d: kwN ? `Upisano ${kwN}.` : 'Još nisu upisane (kartica Rad).', tab: 'rad' }); }
      if (/keyword/.test(n)) { m = true; add('auto', 'kwen', { st: S.kwEn.trim() ? 'ok' : 'todo', t: 'Keywords', d: S.kwEn.trim() ? 'Upisano.' : 'Još nisu upisane (kartica Rad).', tab: 'rad' }); }
      if (!m) add('manual', 's:' + n, { t: sec[0].toUpperCase() + sec.slice(1), d: 'Dio rada koji editor ne provjerava. Označite kad ga imate.' });
    });
    // ručne provjere iz profila
    (p.manualChecks || []).forEach(mc => {
      const n = norm(mc);
      if (/(slik|tablic|grafikon)/.test(n) && /(naslov|izvor)/.test(n)) { const pk = d.prikazi || [], bad = pk.filter(x => !x.title || !x.source); return add('auto', 'prikazi', { st: bad.length ? 'todo' : 'ok', t: 'Tablice i slike imaju naslov i izvor', d: pk.length ? (bad.length ? `Bez naslova ili izvora: ${bad.length}.` : `Svih ${pk.length} u redu.`) : 'U radu nema prikaza.', pos: bad.length ? bad[0].pos : null }); }
      if (/sazetak.*jednom odlomku/.test(n)) { const one = !/\n\s*\S/.test(S.abs.trim()), noc = !/\(\p{Lu}[^)]*\d{4}/u.test(S.abs); return add('auto', 'saz1', { st: S.abs.trim() && one && noc ? 'ok' : 'todo', t: 'Sažetak u jednom odlomku, bez navoda', d: !S.abs.trim() ? 'Sažetak još nije upisan.' : !one ? 'Sažetak ima više odlomaka.' : !noc ? 'U sažetku je navod.' : 'U redu.', tab: 'rad' }); }
      if (/knjig/.test(n) && /najmanje/.test(n)) return;
      if (/naslovn|korice|rimsk|arapsk|brojanje stranica|brojevi stranica|numerir|razine|sadrzaj treba|tiskanim slovima/.test(n)) return add('export', 'x:' + n.slice(0, 40), { t: mc, d: '' });
      if (/mentor|imaju prednost|ima prednost|kalendar|prije predaje potvrditi|rok/.test(n)) return add('info', 'i:' + n.slice(0, 40), { t: mc, d: '' });
      add('manual', 'm:' + n.slice(0, 60), { t: mc, d: '' });
    });
    if (p.font || p.spacing) add('export', 'tipografija', { t: [p.font, p.size ? p.size + ' pt' : '', p.spacing ? 'prored ' + String(p.spacing).replace('.', ',') : ''].filter(Boolean).join(', '), d: 'Postavlja izvoz.' });
    const c = CITE[p.citation]; if (c) add(c[0] ? 'export' : 'info', 'stil', { t: 'Stil citiranja: ' + c[1], d: c[0] ? 'Navodi i popis literature oblikuju se sami.' : 'Prototip ovaj stil još ne prikazuje; navodi su u obliku autor-godina.' });
    (p.submissionFacts || []).forEach((f, i) => add('info', 'sub' + i, { t: f, d: '' }));
    (p.facts || []).filter(f => f.length > 40).forEach((f, i) => add('info', 'f' + i, { t: f, d: '' }));
    // Ductura, neovisno o fakultetu
    add('duct', 'rupe', { st: d.holes.length ? 'todo' : 'ok', t: 'Rupe u tekstu', d: d.holes.length ? `${d.holes.length} ${plural(d.holes.length, 'mjesto', 'mjesta', 'mjesta')} s oznakom [?] ili [izvor]. Blokira predaju.` : 'Nema ih.', pos: d.holes.length ? d.holes[0].pos : null });
    const pl = d.plain.length + d.badCites.length; add('duct', 'plain', { st: pl ? 'todo' : 'ok', t: 'Navodi povezani s izvorima', d: pl ? `${pl} ${plural(pl, 'navod nije povezan', 'navoda nisu povezana', 'navoda nije povezano')} s popisom.` : 'Svi su povezani.', tab: 'lit' });
    const oc = S.comments.filter(x => !x.resolved).length; add('duct', 'cmt', { st: oc ? 'todo' : 'ok', t: 'Komentari mentora', d: oc ? `Otvoreno: ${oc}.` : 'Nema otvorenih.', tab: 'cmt' });
    X.advice.whole().forEach((w, i) => add('nit', 'nit' + i, { t: w.t, d: w.d, pos: w.pos }));
    const ticks = S.ruleTicks[p.id] || {}; out.forEach(o => { if (o.g === 'manual') o.st = ticks[o.key] ? 'ok' : 'todo'; });
    return out;
  };
  R.count = () => { const it = R.items(); return { todo: it.filter(o => o.st === 'todo' && o.g !== 'manual').length, self: it.filter(o => o.g === 'manual' && o.st === 'todo').length, ok: it.filter(o => o.st === 'ok').length }; };
  R.card = function (open) {
    const p = prof(); if (!p) return `<div class="rq-card"><span class="rq-l">${R.err ? 'Pravila se nisu mogla učitati.' : 'Učitavam pravila…'}</span></div>`;
    const n = R.count();
    return `<button class="rq-card" data-act="rqOpen" aria-expanded="${!!open}"><span class="rq-l">Zahtjevi rada</span><span class="rq-p">${esc(p.label)}</span><span class="rq-n">${n.todo ? `<b class="todo">${n.todo} za riješiti</b>` : '<b class="ok">sve provjereno u redu</b>'}${n.self ? ` · ${n.self} označavate sami` : ''} · ${n.ok} u redu</span></button>`;
  };
  const ICON = { ok: '<span class="s ok">✓</span>', todo: '<span class="s warn">!</span>' };
  R.list = function () {
    const p = prof(); if (!p) return ''; const it = R.items(), ro = S.mode === 'teacher' || !!S.submitted, sl = (R.data.meta.statusLabels || {})[p.status] || p.status;
    const row = o => { const inner = `${o.g === 'manual' ? `<input type="checkbox" data-rq="${esc(o.key)}"${o.st === 'ok' ? ' checked' : ''}${ro ? ' disabled' : ''}>` : (ICON[o.st] || '<span class="s dot"></span>')}<span><b>${esc(o.t)}</b>${o.d ? `<span class="d">${esc(o.d)}</span>` : ''}</span>`; return o.g === 'manual' ? `<label class="fx rq">${inner}</label>` : (o.pos != null || o.tab) ? `<button class="fx rq" data-act="finding" data-pos="${o.pos ?? ''}" data-tab="${o.pos != null ? '' : o.tab || ''}">${inner}</button>` : `<div class="fx rq">${inner}</div>`; };
    const grp = (g, title, note, fold) => { const a = it.filter(o => o.g === g); if (!a.length) return ''; const okk = g === 'auto' || g === 'duct' ? a.filter(o => o.st === 'ok') : [], rest = a.filter(o => !okk.includes(o)); const body = (rest.length ? rest.map(row).join('') : '<p class="muted">Sve je u redu.</p>') + (okk.length ? `<details class="rq-ok"${U.rqOpen && U.rqOpen['ok' + g] ? ' open' : ''} data-g="ok${g}"><summary>U redu (${okk.length})</summary>${okk.map(row).join('')}</details>` : ''); return fold ? `<details class="rq-g"${U.rqOpen && U.rqOpen[g] ? ' open' : ''} data-g="${g}"><summary>${title} (${a.length})</summary>${note ? `<p class="muted">${note}</p>` : ''}${body}</details>` : `<div class="rq-g"><h2>${title}</h2>${note ? `<p class="muted">${note}</p>` : ''}${body}</div>`; };
    return `<div class="rq"><div class="rq-meta"><span class="tag ${p.status === 'verified' ? 'ok' : ''}">${esc(sl)}</span>${p.verifiedAt ? `<span>provjereno ${esc(p.verifiedAt.split('-').reverse().join('. '))}.</span>` : ''}<button class="rtxt" data-act="rqPick">Promijeni profil</button></div>` +
      grp('auto', 'Fakultet traži, provjerava Ductura', '') + grp('manual', 'Fakultet traži, označavate sami', 'Editor ovo ne može provjeriti.') + grp('duct', 'Prije predaje', 'Vrijedi za svaki rad u Ducturi.') + grp('nit', 'Dosljednost rada, iz Vašeg teksta', 'Zapažanja, ne pravila. Pojavljuju se kad rasprava i zaključak imaju dovoljno teksta.') +
      grp('export', 'Rješava izvoz', 'Ovo ne morate raditi sami.', true) + grp('info', 'Rokovi i napomene', '', true) +
      `<details class="rq-g"><summary>Izvori pravila (${(p.sources || []).length})</summary>${(p.sources || []).map(s => `<a class="rq-src" href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join('')}<p class="muted">Sažetak pravila preuzet iz Lekte. Mjerodavni su službeni dokumenti fakulteta.</p></details></div>`;
  };
  const REC = { uvod: ['Kontekst i dosadašnja istraživanja', 'Praznina i istraživačko pitanje', 'Važnost i doprinos', 'Metodologija', 'Nacrt strukture rada', 'Tezna rečenica'], zaklju: ['Sinteza novim riječima', 'Teza u drugoj formulaciji', 'Rezultati prema ciljevima', 'Ograničenja i otvorena pitanja'], ostalo: ['Na početku: što poglavlje pokazuje i kako se veže na prethodno', 'Svaki odlomak: tvrdnja, dokaz s navodom, objašnjenje', 'Na kraju: što iz poglavlja slijedi za pitanje rada'] };
  R.rec = title => { const n = norm(title); return /^uvod/.test(n) ? REC.uvod : /zakljuc/.test(n) ? REC.zaklju : REC.ostalo; };

  X.hooks.dlg.rqpick = d => {
    if (!R.data) return '<h3>Profil pravila</h3><p class="muted">Pravila se još učitavaju.</p><div class="foot"><button class="btn" data-act="dlgClose">Zatvori</button></div>';
    const q = norm(d.q || ''), units = R.data.units.filter(u => !q || norm(u.name).includes(q) || u.id.includes(q)), cur = prof(), unit = d.unit || (cur && cur.unitId), sl = R.data.meta.statusLabels || {};
    return `<h3>Profil pravila</h3><p class="muted">U aplikaciji profil dolazi iz prijave (AAI) i zadatka koji postavi nastavnik. U prototipu ga birate sami. ${R.data.units.length} sastavnica Sveučilišta u Zagrebu, ${R.data.profiles.length} profila.</p><input class="in" data-bind="dlg.q" data-rerender="dlg" value="${esc(d.q || '')}" placeholder="Traži fakultet" id="rqQ">
      <div class="rq-pick"><div class="rq-units">${units.map(u => `<button class="rrow${u.id === unit ? ' act' : ''}" data-act="rqUnit" data-id="${u.id}"><span class="rt">${esc(u.name)}</span></button>`).join('') || '<p class="muted">Nema takve sastavnice.</p>'}</div>
      <div class="rq-profs">${unit ? R.data.profiles.filter(p => p.unitId === unit).map(p => `<button class="rcl" data-act="rqSet" data-id="${p.id}" aria-pressed="${p.id === S.profileId}"><b>${esc(p.label)}</b><span>${esc(sl[p.status] || p.status)}${p.wordMin ? ' · ' + fmt(p.wordMin) + (p.wordMax ? ' do ' + fmt(p.wordMax) : '+') + ' riječi' : p.pageMin ? ' · ' + p.pageMin + (p.pageMax ? ' do ' + p.pageMax : '+') + ' str.' : ''}${p.citation && CITE[p.citation] ? ' · ' + CITE[p.citation][1] : ''}</span></button>`).join('') : '<p class="muted">Odaberite fakultet.</p>'}</div></div>
      <div class="foot"><button class="btn pri" data-act="dlgClose">Gotovo</button></div>`;
  };
  Object.assign(ACT, {
    rqPick: () => X.openDlg({ type: 'rqpick', q: '', unit: null, wide: true }),
    rqUnit: el => { U.dlg.unit = el.dataset.id; X.renderDlg(); },
    rqSet: el => { S.profileId = el.dataset.id; const p = prof(); if (p) apply(p, true); persist(); X.repaintCites(); X.refresh(); X.renderAll(true); X.renderDlg(); toast('Profil je promijenjen: ' + (p ? p.label : '')); },
  });
  document.addEventListener('change', e => { const t = e.target; if (t.dataset.rq) { const p = prof(); if (!p) return; (S.ruleTicks[p.id] = S.ruleTicks[p.id] || {})[t.dataset.rq] = t.checked; persist(); X.render.rail(); } });
  document.addEventListener('toggle', e => { const t = e.target; if (t.classList && (t.classList.contains('rq-g') || t.classList.contains('rq-ok')) && t.dataset.g) { (U.rqOpen = U.rqOpen || {})[t.dataset.g] = t.open; } }, true);
  document.addEventListener('input', e => { if (e.target.id === 'rqQ') setTimeout(() => { const n = $('#rqQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0); });
  const ab = X.afterBoot; X.afterBoot = f => { ab(f); R.load(); };
})();
