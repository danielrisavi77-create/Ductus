/* Ductura Editor, prototip: zapažanja iz samog rada (bez AI-ja).
 * Editor ne zna temu; zna pitanje rada, hipoteze (oznake H1, H2…), ulogu poglavlja i što u njemu piše.
 * Kada se što pokazuje:
 *   prazno poglavlje        -> "Što ovdje ide" prema ulozi (plan),
 *   poglavlje od 150 riječi -> tiha zapažanja u panelu ("za pogledati"),
 *   oznaka "gotovo"         -> pregled poglavlja,
 *   Zahtjevi rada           -> dosljednost cijelog rada.
 * Svako zapažanje nosi izvor "Ductura, iz Vašeg teksta". Nije pravilo fakulteta.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, esc, wc, plural, persist } = X;
  const ed = () => X.editor, D = () => X.D, MIN = 150;
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const ROLES = { uvod: 'Uvod', teorija: 'Teorijski okvir', metodologija: 'Metodologija', empirija: 'Empirijsko poglavlje', rasprava: 'Rasprava', zakljucak: 'Zaključak', drugo: 'Drugo' };
  const REC = {
    uvod: ['Kontekst i dosadašnja istraživanja', 'Praznina u literaturi i pitanje rada', 'Hipoteze ili očekivanja, ako ih rad ima', 'Kratko o metodi i izvorima', 'Najava strukture rada'],
    teorija: ['Glavni pojmovi, svaki definiran s izvorom', 'Što o temi kažu dosadašnji autori i gdje se razilaze', 'Koji pristup rad preuzima i zašto', 'Iz čega proizlaze hipoteze ili očekivanja'],
    metodologija: ['Vrsta istraživanja i zašto je prikladna', 'Izvori podataka i kako su odabrani', 'Postupak analize', 'Ograničenja i doseg istraživanja'],
    empirija: ['Na početku: što poglavlje pokazuje i kako se veže na pitanje rada', 'Svaki odlomak: tvrdnja, dokaz s navodom, objašnjenje', 'Na kraju: što iz poglavlja slijedi za hipoteze'],
    rasprava: ['Nalazi povezani sa svakom hipotezom ili očekivanjem', 'Usporedba s literaturom iz teorijskog okvira', 'Što nalazi znače za pitanje rada'],
    zakljucak: ['Odgovor na pitanje rada', 'Jesu li hipoteze potvrđene', 'Ograničenja rada', 'Što ostaje otvoreno'],
    drugo: ['Na početku: što poglavlje pokazuje', 'Svaki odlomak: tvrdnja, dokaz s navodom, objašnjenje', 'Na kraju: veza sa sljedećim poglavljem'],
  };
  const guess = t => { const n = norm(t); return /^uvod/.test(n) ? 'uvod' : /zakljuc/.test(n) ? 'zakljucak' : /rasprav|diskusij/.test(n) ? 'rasprava' : /metod|dizajn istraz|nacrt istraz/.test(n) ? 'metodologija' : /teorij|konceptual|okvir|pregled literature|dosadasnj/.test(n) ? 'teorija' : 'empirija'; };
  const STOP = new Set(['nacin', 'nacinu', 'izmedu', 'danas', 'kojim', 'kojima', 'kojoj', 'tijekom', 'nakon', 'prema', 'kakav', 'kakva', 'kakvo', 'utjecu', 'utjece', 'oblikovali', 'oblikovala', 'povezano', 'povezana', 'razlikuju', 'redovito', 'godine', 'razdoblju', 'drugoga', 'svjetskog']);
  let cache = { doc: null, key: '', res: null };
  function analyze() {
    const doc = ed().state.doc, key = S.thesis + '|' + JSON.stringify(S.roles || {});
    if (cache.doc === doc && cache.key === key) return cache.res;
    const d = D(), heads = d.heads.filter(h => h.level > 1), size = doc.content.size;
    const endOf = (h, i) => { for (let j = i + 1; j < heads.length; j++) if (heads[j].level <= h.level) return heads[j].pos; return size; };
    const all = norm(doc.textBetween(0, size, ' '));
    const hyps = [...new Set((doc.textBetween(0, size, ' ').match(/\bH\d\b/g) || []))].sort();
    const qwords = [...new Set((norm(S.thesis).match(/[a-z]{6,}/g) || []).filter(w => !STOP.has(w)))].slice(0, 8), qorig = (S.thesis.match(/\p{L}{6,}/gu) || []);
    const qterms = qwords.map(w => ({ stem: w.slice(0, Math.min(w.length, 7)), word: qorig.find(o => norm(o) === w) || w })).filter(q => all.includes(q.stem));
    const res = { by: {}, hyps, qterms, thread: [], whole: [] }; let parent = null;
    heads.forEach((h, i) => {
      if (h.level === 2) parent = h;
      const end = endOf(h, i), text = norm(doc.textBetween(h.end, end, ' ')), role = h.level === 2 ? ((S.roles || {})[h.hid] || guess(h.title)) : ((S.roles || {})[h.hid] || (parent ? res.by[parent.hid].role : 'drugo'));
      const o = res.by[h.hid] = { role, obs: [], ready: h.words >= MIN, text, h, parent: h.level === 3 ? parent : null }, add = t => o.obs.push(t);
      if (!o.ready) return;
      const hasQ = qterms.filter(q => text.includes(q.stem));
      if (qterms.length >= 2 && !hasQ.length && role !== 'metodologija' && role !== 'uvod') add(`Ne spominje nijedan pojam iz pitanja rada (${qterms.slice(0, 3).map(q => q.word).join(', ')}).`);
      if ((role === 'teorija' || role === 'empirija') && h.words >= 300 && h.cites < h.words / 400) add(`Malo navoda za ovakvo poglavlje: ${h.cites} na ${h.words} riječi.`);
      if (h.level === 2 && role === 'metodologija') { const miss = [['metod', 'metodu ili pristup'], ['izvor', 'izvore podataka'], ['analiz', 'postupak analize'], ['ogranic', 'ograničenja']].filter(x => !text.includes(x[0])).map(x => x[1]); if (miss.length) add(`Ne spominje: ${miss.join(', ')}.`); }
      if (h.level === 2 && role === 'uvod') { if (!/pitanj|cilj/.test(text) && !text.includes('?')) add('Ne vidi se pitanje ili cilj rada.'); if (!/struktur|poglavlj/.test(text)) add('Ne najavljuje strukturu rada.'); if (hyps.length && !hyps.some(x => text.includes(x.toLowerCase())) && !/hipotez|ocekivanj/.test(text)) add('Rad ima hipoteze, a uvod ih ne najavljuje.'); }
      if (h.level === 2 && (role === 'rasprava' || role === 'zakljucak') && hyps.length) { const miss = hyps.filter(x => !text.includes(x.toLowerCase())); if (miss.length) add(`Ne spominje ${miss.join(', ')}.`); }
      if (h.level === 2 && role === 'zakljucak') { if (hyps.length && !/potvrden|potvrdu|odbacen|opovrgn|djelomic/.test(text)) add('Ne kaže jesu li hipoteze potvrđene.'); if (!/ogranic/.test(text)) add('Ne spominje ograničenja rada.'); }
    });
    // ravnoteža potpoglavlja
    heads.filter(h => h.level === 2).forEach(p => { const kids = heads.filter(h => h.level === 3 && res.by[h.hid].parent === p), avg = kids.length > 1 ? kids.reduce((a, b) => a + b.words, 0) / kids.length : 0; if (avg > 200) kids.forEach(k => { if (k.words >= 30 && k.words < avg * 0.45) res.by[k.hid].obs.push(`Znatno kraće od ostalih potpoglavlja (${k.words} prema prosjeku ${Math.round(avg)} riječi).`), res.by[k.hid].ready = true; }); });
    // nit rada
    const h2 = heads.filter(h => h.level === 2);
    res.thread = hyps.map(H => ({ H, where: h2.filter(h => res.by[h.hid].text.includes(H.toLowerCase())) }));
    const ras = h2.find(h => res.by[h.hid].role === 'rasprava'), zak = h2.find(h => res.by[h.hid].role === 'zakljucak');
    res.thread.forEach(t => { if (t.where.length === 1) res.whole.push({ t: `${t.H} se spominje samo u poglavlju ${t.where[0].num} ${t.where[0].title}`, d: 'Hipoteza se obično postavlja na početku i provjerava u raspravi ili zaključku.', pos: t.where[0].pos }); });
    [ras, zak].forEach(h => { if (h && res.by[h.hid].ready) res.by[h.hid].obs.filter(x => /^Ne spominje H|hipoteze potvrđene/.test(x)).forEach(x => res.whole.push({ t: `${h.title}: ${x[0].toLowerCase() + x.slice(1)}`, d: '', pos: h.pos })); });
    if (zak && res.by[zak.hid].ready && qterms.length) { const miss = qterms.filter(q => !res.by[zak.hid].text.includes(q.stem)); if (miss.length && miss.length >= qterms.length / 2) res.whole.push({ t: 'Zaključak se slabo vraća na pitanje rada', d: 'Ne spominje: ' + miss.map(q => q.word).join(', ') + '.', pos: zak.pos }); }
    if (!S.thesis.trim()) res.whole.push({ t: 'Pitanje rada nije zapisano', d: 'Bez njega editor ne može pratiti nit rada. Upišite ga na vrhu Strukture.' });
    cache = { doc, key, res }; return res;
  }
  const A = X.advice = {
    ROLES, REC, guess, norm, MIN, of: hid => analyze().by[hid] || { role: 'drugo', obs: [], ready: false },
    count: hid => { const o = analyze().by[hid]; return o && o.ready ? o.obs.length : 0; },
    whole: () => analyze().whole,
    html(h, ro) {
      const o = A.of(h.hid), empty = h.words < 30, x = ` data-hid="${h.hid}"`;
      return (h.level === 2 && !ro ? `<label class="arole"><span>Uloga poglavlja</span><select data-role="${h.hid}">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${o.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : '') +
        (o.ready && o.obs.length ? `<div class="fl adv"><b>Za pogledati, iz Vašeg teksta</b>${o.obs.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '') +
        (!o.ready && !empty ? `<div class="fl"><span class="muted">Zapažanja o sadržaju pojavljuju se kad poglavlje ima ${MIN} riječi.</span></div>` : '') +
        `<details class="rec"${empty && !(S.plan && (S.plan[h.hid] || []).length) ? ' open' : ''}><summary>${empty ? 'Što ovdje ide' : 'Što ovakvo poglavlje obično sadrži'}</summary><p class="muted">Preporuka Ducture prema ulozi poglavlja (${ROLES[o.role]}). Nije pravilo fakulteta i ne provjerava se.</p><ul>${REC[o.role].map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` +
        (ro || empty ? '' : `<button class="rtxt" data-act="chReview"${x}>Pregledaj poglavlje</button>`);
    },
    threadHtml() {
      const r = analyze(), h2 = D().heads.filter(h => h.level === 2); if (!r.hyps.length) return '<p class="muted">U radu nema oznaka hipoteza (H1, H2…). Ako ih rad ima, označite ih tako pa će ih editor pratiti kroz poglavlja.</p>';
      return `<p class="muted">Gdje se koja hipoteza spominje. Prazno mjesto nije greška, ali rasprava i zaključak obično spominju sve.</p><div class="athr"><table><tr><th></th>${h2.map(h => `<th title="${esc(h.title)}">${h.num.replace(/\.$/, '')}</th>`).join('')}</tr>${r.thread.map(t => `<tr><th>${t.H}</th>${h2.map(h => `<td>${t.where.includes(h) ? '<i class="sd s2"></i>' : ''}</td>`).join('')}</tr>`).join('')}</table></div>`;
    },
  };
  X.hooks.dlg.chreview = d => {
    const h = D().heads.find(x => x.hid === d.hid); if (!h) return ''; const o = A.of(h.hid), f = X.fx.flagsOf(h), kids = D().heads.filter(k => k.level === 3 && A.of(k.hid).parent === h);
    const sec = (title, list) => (list.length ? `<div class="ptitle">${title}</div>${list.map(t => `<div class="fx"><span class="s warn">!</span><span>${esc(t)}</span></div>`).join('')}` : '');
    const sub = kids.map(k => ({ k, obs: A.of(k.hid).ready ? A.of(k.hid).obs : [], fl: X.fx.flagsOf(k) })).filter(x => x.obs.length || x.fl.fix.length || x.fl.miss.length);
    const none = !f.fix.length && !f.miss.length && !o.obs.length && !sub.length;
    return `<h3>Pregled poglavlja</h3><p><b>${h.num} ${esc(h.title)}</b> · ${h.words} riječi · ${h.cites} ${plural(h.cites, 'navod', 'navoda', 'navoda')} · ${ROLES[o.role]}</p>${none ? '<p>Editor nema zapažanja. To ne znači da je poglavlje gotovo; sadržaj procjenjujete Vi i mentor.</p>' : ''}${sec('Popravi', f.fix)}${sec('Još nedostaje', f.miss)}${h.words < MIN ? `<p class="muted">Poglavlje ima manje od ${MIN} riječi, pa zapažanja o sadržaju još nema.</p>` : sec('Za pogledati, iz Vašeg teksta', o.obs)}${sub.length ? `<div class="ptitle">Potpoglavlja</div>${sub.map(x => `<button class="fx" data-act="jumpClose" data-pos="${x.k.pos}"><span class="s warn">!</span><span><b>${x.k.num} ${esc(x.k.title)}</b><span class="d">${esc([...x.fl.fix, ...x.fl.miss, ...x.obs].join(' '))}</span></span></button>`).join('')}` : ''}<p class="muted">Zapažanja dolaze iz Vašeg teksta: pitanja rada, hipoteza i uloge poglavlja. Nisu pravila fakulteta.</p><div class="foot"><button class="btn" data-act="dlgClose">${d.mark ? 'Vratit ću se' : 'Zatvori'}</button>${d.mark ? `<button class="btn pri" data-act="chMarkDone" data-hid="${h.hid}">Ipak označi gotovo</button>` : ''}</div>`;
  };
  const coreStatusSet = ACT.statusSet;
  Object.assign(ACT, {
    chReview: el => { X.closePop(); X.openDlg({ type: 'chreview', hid: el.dataset.hid }); },
    chMarkDone: el => { S.statuses[el.dataset.hid] = 2; persist(); X.closeDlg(); X.render.rail(); },
    statusSet: el => { const hid = el.dataset.hid, h = D().heads.find(x => x.hid === hid); if (+el.dataset.v === 2 && h) { const f = X.fx.flagsOf(h); if (f.fix.length || f.miss.length || A.count(hid)) { X.closePop(); return X.openDlg({ type: 'chreview', hid, mark: true }); } } coreStatusSet(el); },
  });
  document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.role) { (S.roles = S.roles || {})[t.dataset.role] = t.value; persist(); X.render.rail(); } });
})();
