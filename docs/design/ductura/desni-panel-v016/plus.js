/* Ductura Editor, prototip: dodaci lijevom panelu.
 * 1 sljedeći korak, 2 što je mentor vidio, 3 raspodjela opsega i ravnoteža, 4 vlastiti zadaci i građa,
 * 5 gdje sam stao, 6 plan poglavlja, 7 rokovi, 8 brzi skok, 9 izvori poglavlja, 10 nit rada, 11 početak u tri koraka.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, TASK, esc, wc, uid, plural, $, toast, persist, jump, srcById, yearLabel } = X, { flagsOf, headEnd, ask, STAT, fmt } = X.fx;
  const ed = () => X.editor, D = () => X.D, A = X.advice, norm = A.norm;
  const today = () => { const d = new Date(); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
  const secText = h => ed().state.doc.textBetween(h.end, headEnd(h), ' ');
  const hash = s => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return String(x); };
  const chapOf = pos => { let ch = null; D().heads.forEach(h => { if (h.level > 1 && h.pos <= pos) ch = h; }); return ch; };
  const h2Of = pos => { let ch = null; D().heads.forEach(h => { if (h.level === 2 && h.pos <= pos) ch = h; }); return ch; };
  const parseDate = t => { const m = String(t || '').match(/(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?/); return m ? new Date(+(m[3] || 2026), +m[2] - 1, +m[1]) : null; };
  const daysTo = d => Math.ceil((d - new Date(new Date().toDateString())) / 864e5);
  X.hooks.defaults.push(s => { ['todos', 'plan', 'touched', 'prevTouched', 'roles'].forEach(k => { if (s[k] == null) s[k] = {}; }); if (s.mentor == null) s.mentor = { seen: {} }; });

  /* 5: gdje sam stao */
  X.hooks.tx.push(tr => { if (!tr.docChanged || !ed().isEditable) return; const pos = ed().state.selection.from, ch = chapOf(pos); S.lastPos = pos; if (ch) { S.touched[ch.hid] = 1; const p = h2Of(pos); if (p) S.touched[p.hid] = 1; } });
  const recent = h => !!(S.touched[h.hid] || S.prevTouched[h.hid]);

  /* 2: mentor */
  const seenOf = h => { const s = S.mentor.seen[h.hid]; return s ? Object.assign({ changed: s.hash !== hash(secText(h)) }, s) : null; };
  X.flagExtra = h => { const out = [], td = (S.todos[h.hid] || []).filter(t => !t.done).length, sn = seenOf(h); if (sn && sn.changed) out.push('mijenjano nakon pregleda'); if (td) out.push(td + ' ' + plural(td, 'moj zadatak', 'moja zadatka', 'mojih zadataka')); return out; };

  /* 1: sljedeći korak */
  function steps(c) {
    const d = c.d, out = [], add = (t, go, sub) => out.push({ t, go, sub }), r = S.review, goPos = p => () => jump(p), tab = t => () => X.showTab(t);
    if (S.submitted) { add('Rad je predan. Potvrda i putovnica su u kartici Rad.', tab('rad')); return out; }
    if (S.mode === 'teacher') return out;
    const openT = S.comments.filter(x => !x.resolved && !x.lost && x.role === 'teacher').sort((a, b) => a.from - b.from);
    if (r.status === 'revise') { const ch = openT.length ? chapOf(openT[0].from) : null, due = r.req && r.req.due ? ` do ${r.req.due}` : ''; add(openT.length ? `Mentor čeka doradu${due}: ${openT.length} ${plural(openT.length, 'otvoren komentar', 'otvorena komentara', 'otvorenih komentara')}${ch ? ', prvi u ' + ch.num + ' ' + ch.title : ''}.` : `Mentor čeka doradu${due}. Komentari su riješeni; pošaljite doradu na pregled.`, openT.length ? () => { U.active = openT[0].id; X.refresh(); jump(openT[0].from, false); X.showTab('cmt'); } : tab('cmt')); }
    S.stages.forEach(s => { if (s.st === 'back') add(`Etapa „${s.n}” je vraćena s napomenom${s.note ? ': ' + s.note : '.'}`, tab('rad')); });
    if (d.holes.length) { const ch = chapOf(d.holes[0].pos); add(`${d.holes.length} ${plural(d.holes.length, 'rupa', 'rupe', 'rupa')} u tekstu${ch ? ', prva u ' + ch.num + ' ' + ch.title : ''}. Rupe blokiraju predaju.`, goPos(d.holes[0].pos)); }
    const lim = TASK.limitSrc !== 'zadatak' || true;
    if (lim && c.h2.length && d.words > TASK.max) { const big = [...c.h2].sort((a, b) => (b.words - (S.targets[b.hid] || 0)) - (a.words - (S.targets[a.hid] || 0)))[0]; add(`Rad je ${fmt(d.words - TASK.max)} riječi iznad granice. ${S.targets[big.hid] ? 'Najviše iznad svog cilja' : 'Najdulje'} je poglavlje ${big.num} ${big.title}.`, () => { (U.acc = U.acc || {}).nap = true; U.railTab = 'nap'; U.railSub = 'nap'; U.railCh = null; X.render.rail(); }); }
    const empty = c.h2.find(h => !h.words); if (empty) add(`Poglavlje ${empty.num} ${empty.title} je prazno.`, goPos(empty.pos));
    if (c.h2.length && d.words < TASK.min && !empty) { const low = [...c.h2].filter(h => S.targets[h.hid]).sort((a, b) => (a.words / S.targets[a.hid]) - (b.words / S.targets[b.hid]))[0]; add(`Do donje granice nedostaje ${fmt(TASK.min - d.words)} riječi.${low && low.words < S.targets[low.hid] ? ' Najdalje od svog cilja je ' + low.num + ' ' + low.title + '.' : ''}`, low ? goPos(low.pos) : () => {}); }
    const pl = d.plain.length + d.badCites.length; if (pl) add(`${pl} ${plural(pl, 'navod nije povezan', 'navoda nisu povezana', 'navoda nije povezano')} s popisom literature.`, tab('lit'));
    const rq = X.rules.profile() ? X.rules.items().filter(o => o.st === 'todo' && o.g === 'auto' && o.key !== 'opseg') : []; if (rq.length) add(`Zahtjevi fakulteta: ${rq[0].t}. ${rq[0].d}`, () => (rq[0].pos != null ? jump(rq[0].pos) : X.showTab(rq[0].tab || 'rad')));
    d.heads.filter(h => h.level > 1).forEach(h => { const t = (S.todos[h.hid] || []).find(x => !x.done); if (t && out.length < 9) add(`Vaš zadatak u ${h.num} ${h.title}: ${t.t}`, goPos(h.pos)); });
    const obs = d.heads.filter(h => h.level > 1 && A.count(h.hid)); if (obs.length) add(`Za pogledati u ${obs[0].num} ${obs[0].title}: ${A.of(obs[0].hid).obs[0]}`, goPos(obs[0].pos));
    if (r.status === 'revise' && !openT.length && out.length > 1) out.push(out.shift());
    if (!out.length) add(c.h2.length ? 'Nema ničeg hitnog. Sve provjere su u redu.' : 'Rad još nema poglavlja. Započnite u tri koraka.', c.h2.length ? () => {} : () => ACT.wizOpen());
    return out;
  }
  X.railTop = (c, v) => {
    if ((v === 'c' && (U.railCh || U.railSub)) || (v === 'b' && U.railTab && U.railTab !== 'str')) return '';
    const st = steps(c); U.nx = st; let h = '';
    if (st.length) h += `<div class="nx"><span class="rq-l">Sljedeći korak</span><button class="nx-t" data-act="nxGo" data-i="0">${esc(st[0].t)}</button>${st.length > 1 ? `<button class="rtxt" data-act="nxMore" aria-expanded="${!!U.nxOpen}">${U.nxOpen ? 'Sakrij ostalo' : 'Što još (' + (st.length - 1) + ')'}</button>` : ''}${U.nxOpen ? st.slice(1).map((s, i) => `<button class="nx-o" data-act="nxGo" data-i="${i + 1}">${esc(s.t)}</button>`).join('') : ''}</div>`;
    const rs = U.resumePos != null ? chapOf(Math.min(U.resumePos, ed().state.doc.content.size)) : null;
    if (S.mode === 'write' && (rs || S.noteSelf)) h += `<div class="resume">${rs ? `<button class="rtxt" data-act="resume">Nastavi gdje ste stali: ${rs.num} ${esc(rs.title)}</button>` : ''}${S.noteSelf ? `<div class="selfn"><b>Poruka sebi</b> ${esc(S.noteSelf.text)} <button class="rtxt" data-act="noteGo">Idi tamo</button><button class="rtxt" data-act="noteDel">Obriši</button></div>` : ''}</div>`;
    return h;
  };

  /* 8: brzi skok */
  X.railTools = c => {
    const d = c.d, chips = [['hole', 'Rupa', d.holes.length], ['cmt', 'Komentar', S.comments.filter(x => !x.resolved && !x.lost).length], ['plain', 'Navod bez izvora', d.plain.length], ['prikaz', 'Tablica ili slika', (d.prikazi || []).length], ['obs', 'Za pogledati', d.heads.filter(h => h.level > 1 && A.count(h.hid)).length]].filter(x => x[2]);
    return `<div class="rtools"><input class="in" id="railQ" placeholder="Traži naslov" value="${esc(U.railQ || '')}" aria-label="Traži naslov u strukturi">${chips.length ? `<div class="rchips">${chips.map(([k, l, n]) => `<button class="chip" data-act="railNext" data-k="${k}" title="Skoči na sljedeće">${l} ${n} ›</button>`).join('')}</div>` : ''}</div>`;
  };
  X.railHide = (h, c, card) => { const q = norm(U.railQ || ''); if (!q) return false; const hit = x => norm(x.num + ' ' + x.title).includes(q); if (hit(h)) return false; if (h.level === 2) return !c.kids(h).some(hit); return true; };

  /* 3: raspodjela i ravnoteža */
  function distribute() {
    const h2 = D().heads.filter(h => h.level === 2); if (!h2.length) return 0; const total = Math.round((TASK.min + TASK.max) / 2), W = { uvod: 0.09, zakljucak: 0.07, teorija: 0.2, metodologija: 0.1, rasprava: 0.14 };
    const roles = h2.map(h => A.of(h.hid).role), fixed = [...new Set(roles.filter(r => W[r]))].reduce((a, r) => a + W[r], 0), free = roles.filter(r => !W[r]).length, rest = free ? Math.max(0.2, 1 - fixed) : 0, scale = free ? (1 - rest) / (fixed || 1) : 1 / (fixed || 1);
    h2.forEach((h, i) => { const r = roles[i], share = W[r] ? W[r] * (free ? Math.min(1, scale) : scale) / roles.filter(x => x === r).length : rest / free; S.targets[h.hid] = Math.max(100, Math.round(total * share / 50) * 50); });
    return total;
  }
  X.balance = c => {
    const d = c.d, mx = Math.max(1, ...c.h2.map(h => Math.max(h.words, S.targets[h.hid] || 0))), over = d.words - TASK.max, under = TASK.min - d.words;
    return `<h2 class="rsub">Ravnoteža poglavlja</h2><p class="muted rpad">${over > 0 ? `Rad je ${fmt(over)} riječi iznad granice.` : under > 0 ? `Do donje granice nedostaje ${fmt(under)} riječi.` : 'Opseg je u granicama.'} Crtica pokazuje cilj poglavlja.</p>` +
      c.h2.map(h => { const t = S.targets[h.hid] || 0, ov = t && h.words > t * 1.1; return `<button class="rprog" data-act="jump" data-pos="${h.pos}"><span class="rpt"><span>${h.num} ${esc(h.title)}</span></span><span class="bal"><i class="${ov ? 'over' : ''}" style="width:${Math.round(h.words / mx * 100)}%"></i>${t ? `<b style="left:${Math.round(t / mx * 100)}%"></b>` : ''}</span><span class="rpm">${fmt(h.words)}${t ? ' / ' + fmt(t) : ''} riječi${ov ? ' · ' + fmt(h.words - t) + ' iznad cilja' : t && h.words < t ? ' · nedostaje ' + fmt(t - h.words) : ''} · ${STAT[S.statuses[h.hid] || 0]}</span></button>`; }).join('') +
      (c.ro || !c.h2.length ? '' : `<div class="row rpad" style="margin-top:8px"><button class="btn sm" data-act="distribute">Predloži raspodjelu opsega</button></div><p class="muted rpad">Prijedlog Ducture prema ulogama poglavlja (uvod oko desetine, zaključak manje). Ciljeve možete mijenjati.</p>`);
  };

  /* 4, 6, 9 i 2: dodaci uz poglavlje */
  const det = (key, title, body, open) => `<details class="rec" data-det="${key}"${(U.det || {})[key] ?? open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  X.chExtra = (h, ro) => {
    const d = D(), end = headEnd(h), inR = p => p >= h.pos && p < end, T = S.mode === 'teacher', sn = seenOf(h), txt = norm(secText(h)); let out = '';
    out += `<div class="fl ment"><b>Mentor</b><span>${sn ? `Pregledao ${esc(String(sn.when).replace(/\.$/, ''))}${sn.stage ? ', etapa ' + esc(sn.stage) : ''}.${sn.changed ? ' Poglavlje je mijenjano nakon pregleda.' : ' Od tada nije mijenjano.'}` : 'Još nije pregledao ovo poglavlje.'}</span>${T && !S.submitted ? `<button class="btn sm" data-act="mentorSeen" data-hid="${h.hid}">Označi kao pregledano</button>` : ''}</div>`;
    const plan = S.plan[h.hid] || [];
    out += det('plan' + h.hid, `Plan poglavlja${plan.length ? ' (' + plan.length + ')' : ''}`, (plan.length ? `<ul class="plan">${plan.map(p => { const st = (norm(p).match(/[a-z]{5,}/g) || []).map(w => w.slice(0, 6)), hit = h.words >= A.MIN && st.length ? st.filter(w => txt.includes(w)).length / st.length >= 0.5 : null; return `<li>${esc(p)}${hit == null ? '' : `<small class="${hit ? 'in' : ''}">${hit ? 'ima u tekstu' : 'još nije u tekstu'}</small>`}</li>`; }).join('')}</ul>` : '<p class="muted">Nekoliko natuknica što će biti u poglavlju. Upisuju se prije teksta i zamjenjuju opći popis.</p>') + (ro ? '' : `<button class="rtxt" data-act="planEdit" data-hid="${h.hid}">${plan.length ? 'Uredi plan' : '+ Upiši plan'}</button>`), !h.words && plan.length > 0);
    const td = S.todos[h.hid] || [];
    out += det('todo' + h.hid, `Moji zadaci${td.length ? ' (' + td.filter(t => !t.done).length + ')' : ''}`, td.map(t => `<label class="check"><input type="checkbox" data-todo="${h.hid}|${t.id}"${t.done ? ' checked' : ''}${ro ? ' disabled' : ''}><span${t.done ? ' style="text-decoration:line-through;color:var(--ink-3)"' : ''}>${esc(t.t)}</span>${ro ? '' : `<button class="rtxt" data-act="todoDel" data-hid="${h.hid}" data-id="${t.id}" aria-label="Obriši zadatak">×</button>`}</label>`).join('') + (ro ? (td.length ? '' : '<p class="muted">Nema zadataka.</p>') : `<button class="rtxt" data-act="todoAdd" data-hid="${h.hid}">+ Moj zadatak</button>`), td.some(t => !t.done));
    const ids = S.sources.filter(s => (d.citePos[s.id] || []).some(inR)), notes = []; ids.forEach(s => (S.rnotes[s.id] || []).forEach(n => { if (!txt.includes(norm(n.text).slice(0, 30))) notes.push({ s, n }); }));
    const st = S.stash.filter(x => norm(x.from) === norm(h.title));
    if (notes.length || st.length) out += det('grada' + h.hid, `Građa koja čeka (${notes.length + st.length})`, notes.map(x => `<div class="rnote"><div class="muted">${esc(x.s.authors)} (${yearLabel(x.s)}), str. ${esc(x.n.page)}</div><div>${esc(x.n.text.length > 140 ? x.n.text.slice(0, 137) + '…' : x.n.text)}</div>${ro ? '' : `<button class="rtxt" data-act="noteQuote" data-id="${esc(x.s.id)}" data-n="${x.n.id}">Umetni kao citat</button>`}</div>`).join('') + st.map(x => `<div class="rnote"><div class="muted">odloženi tekst</div><div>${esc(x.text.length > 140 ? x.text.slice(0, 137) + '…' : x.text)}</div>${ro ? '' : `<button class="rtxt" data-act="unstash" data-id="${x.id}">Vrati na mjesto kursora</button>`}</div>`).join(''));
    out += det('izv' + h.hid, `Izvori u poglavlju (${ids.length})`, ids.length ? `<p>${esc(ids.map(s => `${s.authors} (${yearLabel(s)})`).join(', '))}</p>` : '<p class="muted">U poglavlju još nema navoda.</p>');
    return out;
  };

  /* 7 i 10: rokovi i nit rada */
  X.railSecs = {
    rok: { short: 'Rokovi', label: () => 'Rokovi', body: c => {
      const it = [], add = (date, t, sub) => it.push({ d: parseDate(date), date, t, sub });
      add(TASK.due, 'Rok predaje rada', TASK.course + ' / ' + TASK.title); if (S.review.status === 'revise' && S.review.req) add(S.review.req.due, 'Rok dorade', 'traži mentor');
      c.d.heads.forEach(h => { if (S.dues[h.hid]) add(S.dues[h.hid], `Vaš rok za ${h.num} ${h.title}`, 'postavili ste sami'); });
      it.sort((a, b) => (a.d ? a.d.getTime() : 9e15) - (b.d ? b.d.getTime() : 9e15));
      const p = X.rules.profile(), facts = p ? (p.submissionFacts || []) : [];
      return it.map(x => { const n = x.d ? daysTo(x.d) : null; return `<div class="fx rq"><span class="s ${n != null && n < 0 ? 'warn' : 'dot'}">${n != null && n < 0 ? '!' : ''}</span><span><b>${esc(x.t)}</b><span class="d">${esc(x.date)}${n == null ? '' : n < 0 ? ' · prošao' : n === 0 ? ' · danas' : ' · za ' + n + ' ' + plural(n, 'dan', 'dana', 'dana')}${x.sub ? ' · ' + esc(x.sub) : ''}</span></span></div>`; }).join('') + (facts.length ? `<h2 class="rsub">Fakultet</h2>${facts.map(f => `<div class="fx rq"><span class="s dot"></span><span>${esc(f)}</span></div>`).join('')}` : '');
    } },
    nit: { short: 'Nit', label: () => 'Nit rada', body: () => { const w = A.whole(); return `<p class="muted rpad">${S.thesis ? esc(S.thesis) : 'Pitanje rada još nije zapisano.'}</p><div class="rpad">${A.threadHtml()}</div>` + (w.length ? w.map(x => (x.pos != null ? `<button class="fx rq" data-act="jump" data-pos="${x.pos}">` : '<div class="fx rq">') + `<span class="s warn">!</span><span><b>${esc(x.t)}</b>${x.d ? `<span class="d">${esc(x.d)}</span>` : ''}</span>` + (x.pos != null ? '</button>' : '</div>')).join('') : ''); } },
  };

  /* 11: početak u tri koraka */
  const SKEL = { emp: ['Empirijski rad s hipotezama', ['Uvod', 'Teorijski okvir', 'Metodologija', 'Rezultati', 'Rasprava', 'Zaključak']], slucaj: ['Studija slučaja', ['Uvod', 'Teorijsko-konceptualni okvir', 'Dizajn istraživanja i metodologija', 'Analiza slučaja', 'Rasprava', 'Zaključak']], pregled: ['Pregledni rad', ['Uvod', 'Pregled literature', 'Usporedba pristupa', 'Zaključak']], esej: ['Esej ili kraći seminar', ['Uvod', 'Razrada', 'Zaključak']] };
  X.hooks.dlg.wiz = d => {
    const p = X.rules.profile(), stepsBar = `<div class="steps">${['Vrsta rada', 'Pitanje', 'Kostur'].map((s, i) => `<span class="${d.step === i ? 'cur' : ''}">${i + 1} ${s}</span>`).join('')}</div>`;
    if (d.step === 0) return `<h3>Započnite rad</h3>${stepsBar}<p class="muted">Profil pravila: ${p ? esc(p.label) : 'nije odabran'}. Mijenja se u Zahtjevima rada.</p><label class="f">Naslov rada</label><input class="in" data-bind="dlg.title" value="${esc(d.title)}" placeholder="Radni naslov, može se mijenjati"><div class="ptitle">Kakav rad pišete</div>${Object.entries(SKEL).map(([k, v]) => `<button class="rcl" data-act="wizKind" data-v="${k}" aria-pressed="${d.kind === k}"><b>${v[0]}</b><span>${v[1].join(' · ')}</span></button>`).join('')}<div class="foot"><button class="btn" data-act="dlgClose">Odustani</button><button class="btn pri" data-act="wizNext">Dalje</button></div>`;
    if (d.step === 1) return `<h3>Pitanje rada</h3>${stepsBar}<p class="muted">Jedna rečenica: što rad pita ili tvrdi. Po njemu editor kasnije prati nit rada. Možete ga promijeniti kad god želite.</p><textarea class="ta" rows="3" data-bind="dlg.q" placeholder="npr. Kako je čitanje naglas povezano s razvojem rječnika u prvim razredima?">${esc(d.q)}</textarea>${d.kind === 'emp' ? '<p class="muted">Ako imate hipoteze, u tekstu ih označite kao H1, H2… pa ih editor prati kroz poglavlja.</p>' : ''}<div class="foot"><button class="btn" data-act="wizBack">Natrag</button><button class="btn pri" data-act="wizNext">Dalje</button></div>`;
    return `<h3>Kostur rada</h3>${stepsBar}<p class="muted">Jedno poglavlje u svakom retku. Redoslijed i nazive možete mijenjati i kasnije. Editor će predložiti raspodjelu opsega (${fmt(TASK.min)} do ${fmt(TASK.max)} riječi) po poglavljima.</p><textarea class="ta" rows="7" data-bind="dlg.chapters">${esc(d.chapters)}</textarea><div class="foot"><button class="btn" data-act="wizBack">Natrag</button><button class="btn pri" data-act="wizMake">Stvori kostur</button></div>`;
  };

  Object.assign(ACT, {
    nxGo: el => { const s = (U.nx || [])[+el.dataset.i]; if (s && s.go) s.go(); },
    nxMore: () => { U.nxOpen = !U.nxOpen; X.render.rail(); },
    resume: () => { const p = Math.min(U.resumePos, ed().state.doc.content.size); U.resumePos = null; jump(Math.max(0, p - 1)); try { ed().commands.setTextSelection(p); } catch (e) { /* izvan teksta */ } },
    railNext: el => { const d = D(), k = el.dataset.k, list = k === 'hole' ? d.holes.map(x => x.pos) : k === 'cmt' ? S.comments.filter(x => !x.resolved && !x.lost).map(x => x.from).sort((a, b) => a - b) : k === 'plain' ? d.plain.map(x => x.from) : k === 'prikaz' ? (d.prikazi || []).map(x => x.pos) : d.heads.filter(h => h.level > 1 && A.count(h.hid)).map(h => h.pos); if (!list.length) return; U.nextI = U.nextI || {}; U.nextI[k] = ((U.nextI[k] == null ? -1 : U.nextI[k]) + 1) % list.length; jump(list[U.nextI[k]], k !== 'cmt'); },
    distribute: () => { if (Object.keys(S.targets).length && U.distAsk !== 1) { U.distAsk = 1; setTimeout(() => { U.distAsk = 0; }, 4000); return toast('Kliknite još jednom: postojeći ciljevi poglavlja bit će zamijenjeni.'); } U.distAsk = 0; const t = distribute(); persist(); X.render.rail(); toast(`Ciljevi su raspodijeljeni na oko ${fmt(t)} riječi.`); },
    mentorSeen: el => { const h = D().heads.find(x => x.hid === el.dataset.hid); if (!h) return; const mark = x => { S.mentor.seen[x.hid] = { when: today(), hash: hash(secText(x)) }; }; mark(h); if (h.level === 2) D().heads.filter(k => k.level === 3 && k.pos > h.pos && k.pos < headEnd(h)).forEach(mark); persist(); X.render.rail(); toast('Poglavlje je označeno kao pregledano.'); },
    planEdit: el => { const hid = el.dataset.hid; X.closePop(); ask({ title: 'Plan poglavlja', label: 'Jedna natuknica u svakom retku', multi: true, value: (S.plan[hid] || []).join('\n'), desc: 'Što će biti u poglavlju. Kad poglavlje ima dovoljno teksta, editor uz svaku natuknicu pokaže nalazi li se u tekstu.' }, v => { S.plan[hid] = v.split('\n').map(x => x.replace(/^[-•·\s]+/, '').trim()).filter(Boolean); persist(); X.render.rail(); }); },
    todoAdd: el => { const hid = el.dataset.hid; X.closePop(); ask({ title: 'Moj zadatak', label: 'Što još treba napraviti u ovom poglavlju', ph: 'npr. dodati primjer štrajka 2018.', ok: 'Dodaj' }, v => { if (!v.trim()) return; (S.todos[hid] = S.todos[hid] || []).push({ id: uid('t'), t: v.trim(), done: false }); (U.det = U.det || {})['todo' + hid] = true; persist(); X.render.rail(); }); },
    todoDel: (el, e) => { if (e) e.preventDefault(); S.todos[el.dataset.hid] = (S.todos[el.dataset.hid] || []).filter(t => t.id !== el.dataset.id); persist(); X.render.rail(); },
    wizOpen: () => { if (D().heads.some(h => h.level === 2)) return toast('Rad već ima poglavlja. Za novi rad odaberite „Novi prazan rad” u kartici Rad.'); const t = (D().heads.find(h => h.level === 1) || {}).title || ''; X.openDlg({ type: 'wiz', step: 0, kind: 'slucaj', title: t, q: S.thesis || '', chapters: SKEL.slucaj[1].join('\n') }); },
    wizKind: el => { U.dlg.kind = el.dataset.v; U.dlg.chapters = SKEL[el.dataset.v][1].join('\n'); X.renderDlg(); },
    wizNext: () => { U.dlg.step++; X.renderDlg(); }, wizBack: () => { U.dlg.step--; X.renderDlg(); },
    wizMake: () => { const d = U.dlg, list = d.chapters.split('\n').map(x => x.replace(/^\d+[.)]?\s*/, '').trim()).filter(Boolean); if (!list.length) return toast('Upišite barem jedno poglavlje.'); const e = ed(), h1 = D().heads.find(h => h.level === 1), tx = t => (t ? [{ type: 'text', text: t }] : []); let ch = e.chain(); if (d.title.trim()) { if (h1) ch = ch.command(({ tr }) => { tr.insertText(d.title.trim(), h1.pos + 1, h1.end - 1); return true; }); else ch = ch.insertContentAt(0, { type: 'heading', attrs: { level: 1 }, content: tx(d.title.trim()) }); } ch.run(); const body = []; list.forEach(t => body.push({ type: 'heading', attrs: { level: 2 }, content: tx(t) }, { type: 'paragraph' })); e.chain().insertContentAt(e.state.doc.content.size, body).run(); S.thesis = d.q.trim(); S.targets = {}; distribute(); persist(); X.closeDlg(); X.renderAll(true); const first = D().heads.find(h => h.level === 2); if (first) jump(first.pos); toast('Kostur je stvoren. U svakom praznom poglavlju piše što ovdje ide.'); },
    newWork: () => { if (U.newAsk !== 1) { U.newAsk = 1; setTimeout(() => { U.newAsk = 0; }, 4000); return toast('Kliknite još jednom: sadašnji tekst u prototipu bit će obrisan.'); } const n = X.fresh(); X.hooks.defaults.forEach(f => f(n)); Object.assign(n, { theme: S.theme, sheet: S.sheet, citeStyle: S.citeStyle, warn: S.warn, level: S.level, onb: 1, railCfg: S.railCfg, profileId: S.profileId, task: S.task, thesis: '', stash: [], rnotes: {}, glossary: [], tasks: [], sources: [], seeds: [], newWork: 1 }); n.review = { status: 'draft', round: 0, req: null, log: [], snapshot: [] }; n.stages.forEach(s => { s.st = 'no'; delete s.d; }); X.store.save({ doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }, { type: 'paragraph' }] }, S: n }); location.reload(); },
  });
  document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.todo) { const [hid, id] = t.dataset.todo.split('|'), x = (S.todos[hid] || []).find(q => q.id === id); if (x) { x.done = t.checked; persist(); X.render.rail(); } } });
  document.addEventListener('toggle', e => { const t = e.target; if (t.dataset && t.dataset.det) (U.det = U.det || {})[t.dataset.det] = t.open; }, true);
  document.addEventListener('input', e => { if (e.target.id !== 'railQ') return; U.railQ = e.target.value; const p = e.target.selectionStart; X.render.rail(); const n = $('#railQ'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
  const ab = X.afterBoot; X.afterBoot = f => {
    S.prevTouched = S.touched || {}; S.touched = {}; U.resumePos = S.lastPos != null && S.lastPos > 2 ? S.lastPos : null;
    ab(f);
    if (S.seedMentor) { const h2 = D().heads.filter(h => h.level === 2); S.seedMentor.forEach(([i, when, stale]) => { const h = h2[i]; if (!h) return; const mark = x => { S.mentor.seen[x.hid] = { when, hash: stale ? 'x' : hash(secText(x)) }; }; mark(h); D().heads.filter(k => k.level === 3 && k.pos > h.pos && k.pos < headEnd(h)).forEach(mark); }); delete S.seedMentor; persist(); X.render.rail(); }
    if (S.newWork) { delete S.newWork; persist(); ACT.wizOpen(); }
  };
})();
