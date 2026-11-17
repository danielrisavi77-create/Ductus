/* Ductura Editor, prototip: Komentari, drugi krug (v0.12).
 * 1 vrsta komentara · 2 čiji je red · 3 zatvaranje u dva koraka · 4 opći komentar · 5 jedan komentar, više mjesta · 6 novo od zadnjeg otvaranja
 * 7 što se ponavlja · 8 povijest rundi · 9 ispis za konzultacije · 10 spremljeni komentari · 11 diktirani komentar · 12 privatna bilješka mentora
 * Bez AI-ja. Privatne bilješke mentora student ne vidi ni u jednom prikazu.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, RULES, esc, plural, $, persist, toast } = X, RP = X.rp, { ask } = X.fx, ed = () => X.editor, D = () => X.D;
  X.hooks.defaults.push(s => { const def = (k, v) => { if (s[k] == null) s[k] = v; }; def('gen', []); def('mnotes', []); def('cmSeen', { student: 0, teacher: 0 });
    def('tpls', [{ id: 't1', t: 'Tvrdnja traži izvor. Odakle je ovaj podatak?', kind: 'must', rule: 'claim' }, { id: 't2', t: 'Ovo je prepričavanje izvora. Što iz toga slijedi za Vaše pitanje?', kind: 'must' }, { id: 't3', t: 'Dodajte stranicu u navod.', kind: 'must', rule: 'page' }, { id: 't4', t: 'Dobro povezano s prethodnim poglavljem.', kind: 'praise' }]); });
  const T = () => S.mode === 'teacher', me = () => (T() ? 'teacher' : 'student'), who = () => (T() ? 'Nastavnik A' : 'Student A');
  const KIND = { must: 'mora se popraviti', sugg: 'prijedlog', q: 'pitanje', praise: 'pohvala' }, KO = ['must', 'sugg', 'q', 'praise'];
  const rer = () => { X.refresh(); persist(); X.renderPanel(true); };
  const roleOf = w => (/Nastavnik/.test(w || '') ? 'teacher' : 'student');
  const det = (key, title, body, open) => `<details class="rpd" data-det="${key}"${(U.det || {})[key] ?? open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  const chapOf = p => { let h0 = null; D().heads.forEach(h => { if (h.level === 2 && h.pos <= p) h0 = h; }); return h0; };

  /* zadnji odabir u tekstu (gumbi u panelu ga ne smiju izgubiti) */
  document.addEventListener('selectionchange', () => { const ds = getSelection(); if (!ds || !ds.rangeCount || ds.isCollapsed || !X.editor || !$('#ed').contains(ds.anchorNode)) return; try { const r = ds.getRangeAt(0); let a = ed().view.posAtDOM(r.startContainer, r.startOffset), b = ed().view.posAtDOM(r.endContainer, r.endOffset); if (a > b) [a, b] = [b, a]; if (b > a) U.c2Sel = { from: a, to: b, at: Date.now() }; } catch (e) { /* izvan teksta */ } });
  const sel = () => { const s = U.c2Sel; if (!s || Date.now() - s.at > 120000) return null; const doc = ed().state.doc; if (s.to > doc.content.size || !doc.resolve(s.from).sameParent(doc.resolve(s.to))) return null; return { from: s.from, to: s.to, quote: doc.textBetween(s.from, s.to, ' ', X.leafText) }; };

  /* sidra dodatnih mjesta i privatnih bilješki prate izmjene teksta */
  X.hooks.tx.push(tr => { if (!tr.docChanged) return; const one = a => { if (a.lost) return; const f = tr.mapping.map(a.from, 1), t = tr.mapping.map(a.to, -1); if (t <= f) { a.lost = true; a.from = a.to = f; } else { a.from = f; a.to = t; } }; S.comments.forEach(c => (c.also || []).forEach(one)); S.mnotes.forEach(one); });
  X.hooks.end.push(({ decos }) => {
    S.comments.forEach(c => { if (c.resolved && U.active !== c.id) return; (c.also || []).forEach(a => { if (!a.lost) decos.push(X.Decoration.inline(a.from, a.to, { class: 'cmt' + (U.active === c.id ? ' on' : ''), 'data-c': c.id })); }); });
    if (T()) S.mnotes.forEach(m => { if (!m.lost) decos.push(X.Decoration.inline(m.from, m.to, { class: 'mnote', title: 'Privatna bilješka: ' + m.text })); });
  });

  /* novi komentari i odgovori dobivaju vrijeme, rundu i odabranu vrstu, kojim god putem nastali */
  let booted = false;
  function adopt() {
    const now = booted ? Date.now() : 0; let ch = false;
    S.comments.forEach(c => {
      if (c.ts == null) { c.ts = now; c.round = c.round || (S.review ? S.review.round : 1); ch = true; if (now && U.c2Pend && c.role === 'teacher') { if (U.c2Pend.kind) c.kind = U.c2Pend.kind; if (U.c2Pend.tpl) c.tpl = U.c2Pend.tpl; if (c.kind === 'praise') { c.praise = true; c.resolved = true; c.conf = true; } if (U.c2Pend.save && c.text.trim() && !S.tpls.some(t => t.t === c.text.trim())) S.tpls.push({ id: X.uid('tp'), t: c.text.trim(), kind: c.kind || 'must', rule: c.rule || '' }); U.c2Pend = null; } if (now && c.role !== 'teacher' && c.kind == null) c.kind = 'q'; }
      c.replies.forEach(r => { if (r.ts == null) { r.ts = now; ch = true; } });
    });
    booted = true; return ch;
  }
  /* potvrdu mentora traži samo komentar vrste "mora se popraviti"; ostali se zatvaraju kad ih student označi riješenima */
  const needsConf = c => c.role === 'teacher' && c.kind === 'must';
  const turn = c => { if (c.praise) return null; if (c.resolved) return needsConf(c) && c.conf == null ? 'mentor' : null; const l = c.replies[c.replies.length - 1]; return (l ? roleOf(l.who) : c.role) === 'teacher' ? 'student' : 'mentor'; };
  const mine = t => t === (T() ? 'mentor' : 'student');
  const isNew = c => { const seen = S.cmSeen[me()] || 0; return (c.role !== me() && c.ts > seen) || c.replies.some(r => roleOf(r.who) !== me() && r.ts > seen); };
  X.hooks.paint.push(() => { if (U.c2In && (S.tab !== 'cmt' || U.c2In !== me())) { S.cmSeen[U.c2In] = Date.now(); U.c2In = null; persist(); } });

  /* ---------- vrh pogleda ---------- */
  RP.HK.cmtTop.push(c => {
    if (adopt()) persist(); U.c2In = me();
    const t = T(), all = S.comments.filter(x => !x.lost), tu = all.map(turn), nMine = tu.filter(mine).length, nOther = tu.filter(x => x && !mine(x)).length, nNew = all.filter(isNew).length;
    const chip = (act, v, label, cur) => `<button class="chip" data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${label}</button>`;
    const showF = all.length >= 4 || U.c2Turn || U.c2Filter || nNew;
    let h = !showF ? '' : `<div class="rptools c2f">${chip('c2Turn', 'mine', `Na Vama ${nMine}`, U.c2Turn)}${chip('c2Turn', 'other', `Čeka ${t ? 'studenta' : 'mentora'} ${nOther}`, U.c2Turn)}${nNew ? chip('c2Turn', 'new', `Novo ${nNew}`, U.c2Turn) : ''}${KO.filter(k => all.some(x => x.kind === k)).map(k => chip('c2Kind', k, `${KIND[k]} ${all.filter(x => x.kind === k).length}`, U.c2Filter)).join('')}</div>`;
    /* 7. što se ponavlja */
    const grp = {}; all.filter(x => x.role === 'teacher' && !x.praise).forEach(x => { const k = x.rule ? 'r:' + x.rule : x.tpl ? 't:' + x.tpl : null; if (k) (grp[k] = grp[k] || []).push(x); });
    Object.entries(grp).filter(([, l]) => l.length >= 3).forEach(([k, l]) => { const r = k[0] === 'r' ? RULES[k.slice(2)] : null, tp = k[0] === 't' ? S.tpls.find(x => x.id === k.slice(2)) : null, name = r ? r.t : tp ? tp.t : 'ista primjedba', open = l.filter(x => !x.resolved).length; h += `<div class="card rpnote"><b>Ponavlja se: ${esc(name)}</b><p>${l.length} ${plural(l.length, 'mjesto', 'mjesta', 'mjesta')}${open ? `, otvoreno ${open}` : ', sva riješena'}.${r ? ' ' + esc(r.why) : ''}</p><button class="lnk" data-act="c2Rep" data-k="${esc(k)}">Pokaži redom ›</button></div>`; });
    h += `<div class="row c2bar">${t && !S.submitted ? '<button class="btn sm" data-act="c2GenNew">+ Opći komentar</button><button class="btn sm" data-act="c2Priv">+ Privatna bilješka</button>' : ''}<details class="c2more"${U.c2More ? ' open' : ''}><summary>Više</summary><div class="c2morel"><button class="lnk" data-act="c2Rounds">Povijest rundi</button><button class="lnk" data-act="c2Print">Ispis za konzultacije</button><button class="lnk" data-act="diff">${t ? 'Promjene od zadnje runde' : 'Što sam promijenio/la'}</button><button class="lnk" data-act="log">Dnevnik</button>${t ? '<button class="lnk" data-act="c2Tpls">Spremljeni komentari</button>' : ''}</div></details></div>`;
    /* 4. opći komentari */
    const gen = S.gen.filter(g => !c.on || !g.hid || g.hid === c.ch.hid);
    if (gen.length) h += `<div class="ptitle">Opći komentari (${gen.length})</div>` + gen.map(g => { const hd = g.hid ? D().heads.find(x => x.hid === g.hid) : null; return `<div class="card c2gen"><div class="meta"><span class="tag">${hd ? esc(hd.num + ' ' + hd.title) : 'cijeli rad'}</span><span>${esc(g.who)}</span><span>${esc(g.when)}</span>${g.kind ? `<span class="tag c2k-${g.kind}">${KIND[g.kind]}</span>` : ''}${g.resolved ? '<span class="tag ok">riješeno</span>' : ''}</div><div style="white-space:pre-wrap">${esc(g.text)}</div>${g.replies.map(r => `<div class="reply"><div class="meta"><span>${esc(r.who)}</span><span>${esc(r.when)}</span></div>${esc(r.text)}</div>`).join('')}<div class="row" style="margin-top:8px"><button class="lnk" data-act="c2GenReply" data-id="${g.id}">Odgovori</button>${g.kind === 'praise' ? '' : `<button class="lnk" data-act="c2GenRes" data-id="${g.id}">${g.resolved ? 'Otvori ponovno' : 'Označi riješeno'}</button>`}${t ? `<button class="lnk" data-act="c2GenDel" data-id="${g.id}">Ukloni</button>` : ''}</div></div>`; }).join('');
    /* 12. privatne bilješke mentora */
    if (t) { const mn = S.mnotes.filter(m => !c.on || c.inCh(m.from)); if (mn.length) h += det('rp-mnotes', `Moje privatne bilješke (${mn.length})`, `<p class="muted">Vidite ih samo Vi. Student ih ne vidi ni u jednom prikazu.</p>` + mn.map(m => `<div class="card c2priv"><button class="q" style="display:block;width:100%;text-align:left" data-act="jump" data-pos="${m.from}">${m.lost ? '<i>tekst je obrisan</i>' : esc(m.quote)}</button><div>${esc(m.text)}</div><div class="row" style="margin-top:6px"><span class="muted">${esc(m.when)}</span><button class="lnk" data-act="c2PrivDel" data-id="${m.id}">Ukloni</button></div></div>`).join(''), true); }
    return h;
  });

  /* ---------- kartice i obrazac novog komentara ---------- */
  RP.HK.cmtDom.push((root, c) => {
    const t = T(), ro = !!S.submitted;
    /* stanje runde je u kartici Mentor; ovdje ostaje jedan redak */
    const st0 = root.firstElementChild; if (st0 && st0.classList.contains('card') && !st0.dataset.cid && !st0.querySelector('#cmText') && !U.reqForm) { const r = S.review, lbl = { revise: 'čeka doradu', review: 'kod mentora', accepted: 'prihvaćeno', draft: 'još nije slano mentoru' }[r.status]; st0.outerHTML = `<div class="c2st"><span class="tag ${r.status === 'accepted' ? 'ok' : r.status === 'revise' ? 'warn' : ''}">${lbl}</span><span>runda ${r.round}${r.status === 'revise' && r.req && r.req.due && r.req.due !== 'bez roka' ? ' · rok ' + esc(r.req.due) : ''}</span><span class="grow"></span><button class="lnk" data-act="rpTab" data-v="rad">Stanje rada ›</button></div>`; }
    root.querySelectorAll('[data-cid]').forEach(el => {
      const cm = S.comments.find(x => x.id === el.dataset.cid); if (!cm) return; const tn = turn(cm), meta = el.querySelector('.meta');
      if ((U.c2Filter && cm.kind !== U.c2Filter) || (U.c2Turn === 'mine' && !mine(tn)) || (U.c2Turn === 'other' && (!tn || mine(tn))) || (U.c2Turn === 'new' && !isNew(cm))) { if (cm.id !== U.active && cm.id !== U.replyFor) return el.remove(); }
      const okTag = meta && meta.querySelector('.tag.ok'); if (okTag) { if (cm.praise) okTag.remove(); else if (needsConf(cm)) okTag.textContent = cm.conf ? 'riješeno, potvrdio mentor' : okTag.textContent + ', čeka potvrdu mentora'; }
      if (meta) meta.insertAdjacentHTML('beforeend', (cm.kind ? `<span class="tag c2k-${cm.kind}">${KIND[cm.kind]}</span>` : '') + (tn ? `<span class="tag c2turn${mine(tn) ? ' me' : ''}">${mine(tn) ? 'na Vama' : 'čeka ' + (tn === 'mentor' ? 'mentora' : 'studenta')}</span>` : '') + (isNew(cm) ? '<span class="tag c2new">novo</span>' : ''));
      let h = '';
      if ((cm.also || []).length) h += `<div class="c2also"><span class="rpsub">Isto i ovdje (${cm.also.length})</span>${cm.also.map((a, i) => `<button class="q" data-act="${a.lost ? '' : 'jump'}" data-pos="${a.from}">${a.lost ? '<i>tekst je obrisan</i>' : esc(a.quote)}</button>${t && !ro ? `<button class="lnk" data-act="c2AlsoDel" data-id="${cm.id}" data-i="${i}">ukloni mjesto</button>` : ''}`).join('')}</div>`;
      if (!ro && U.replyFor !== cm.id) {
        if (t && !cm.resolved && cm.role === 'teacher') h += `<div class="row c2row"><button class="lnk" data-act="c2Also" data-id="${cm.id}">+ Isto i ovdje (označeni tekst)</button></div>`;
        if (t && cm.resolved && needsConf(cm) && cm.conf == null) h += `<div class="row c2row"><button class="btn sm" data-act="c2Conf" data-id="${cm.id}">Potvrdi rješenje</button><button class="btn sm" data-act="c2Back" data-id="${cm.id}">Vrati studentu</button></div>`;
        if (!t && !cm.resolved && cm.role === 'teacher' && !cm.praise) h += `<div class="row c2row"><button class="chip" data-act="c2Quick" data-id="${cm.id}" data-v="Trebam pojašnjenje: ">Trebam pojašnjenje</button><button class="chip" data-act="c2Quick" data-id="${cm.id}" data-v="Ne slažem se, jer ">Ne slažem se</button></div>`;
      }
      if (cm.praise) { el.classList.add('c2praise'); el.querySelectorAll('[data-act=cmResolve]').forEach(b => b.remove()); }
      if (h) el.insertAdjacentHTML('beforeend', h);
      if (U.replyFor === cm.id && U.c2Pre) { const ta = el.querySelector('#rpText'); if (ta) ta.textContent = U.c2Pre; }
    });
    /* obrazac novog komentara */
    const ta = root.querySelector('#cmText'); if (!ta) return; const p = U.c2Pend = U.c2Pend || {}, mic = X.caps && X.caps.dictation;
    if (t) {
      ta.insertAdjacentHTML('beforebegin', `<div class="rpsub">Vrsta</div><div class="seg c2kind">${KO.map(k => `<button data-act="c2Pick" data-v="${k}" aria-pressed="${(p.kind || 'must') === k}">${KIND[k]}</button>`).join('')}</div><div class="rpsub">Spremljeni komentari</div><div class="rptools c2tp">${S.tpls.map(x => `<button class="chip" data-act="c2Use" data-id="${x.id}" title="${esc(x.t)}">${esc(x.t.length > 34 ? x.t.slice(0, 32) + '…' : x.t)}</button>`).join('')}</div>`);
      if (!p.kind) p.kind = 'must';
    }
    ta.insertAdjacentHTML('afterend', `<div class="row c2dict"><button class="btn sm" data-act="c2Dict">${U.dict && U.dictTo ? '■ Zaustavi diktiranje' : 'Diktiraj'}</button>${mic ? '' : '<span class="muted">radi u objavljenom prototipu</span>'}${t ? `<label class="check" style="margin:0 0 0 auto"><input type="checkbox" data-c2save="1"${p.save ? ' checked' : ''}><span>spremi kao čest komentar</span></label>` : ''}</div>`);
  });

  /* ---------- dijalozi ---------- */
  const stat = c => (c.praise ? 'pohvala' : c.resolved ? (!needsConf(c) || c.conf ? 'riješeno' : 'riješeno, čeka potvrdu') : 'otvoreno');
  X.hooks.dlg.c2rounds = () => {
    adopt(); const R = S.review ? S.review.round : 1, rows = [];
    for (let r = R; r >= 1; r--) { const l = S.comments.filter(c => (c.round || 1) === r), log = ((S.review || {}).log || []).filter(x => new RegExp(`runda ${r}\\b`).test(x.what)); rows.push(`<div class="ptitle">Runda ${r}${r === R ? ' (sadašnja)' : ''}</div><p class="muted">${l.length} ${plural(l.length, 'komentar', 'komentara', 'komentara')} · riješeno ${l.filter(c => c.resolved && !c.praise).length} · potvrdio mentor ${l.filter(c => c.conf && !c.praise).length} · otvoreno ${l.filter(c => !c.resolved).length}${log.length ? ' · ' + esc(log[log.length - 1].what) + ', ' + esc(log[log.length - 1].when) : ''}</p>` + l.sort((a, b) => a.n - b.n).map(c => `<button class="fx" data-act="c2Go" data-id="${c.id}"><span class="s ${c.resolved ? 'ok' : 'warn'}">${c.resolved ? '✓' : '!'}</span><span><b>#${c.n} ${esc(c.text.length > 90 ? c.text.slice(0, 88) + '…' : c.text)}</b><span class="d">${stat(c)}${c.fix ? ' · ' + esc(c.fix) : ''}</span></span></button>`).join('')); }
    return `<h3>Povijest rundi</h3><p class="muted">Što je u kojoj rundi pregleda traženo i što je s tim napravljeno.</p>${rows.join('') || '<p class="muted">Još nema komentara.</p>'}<div class="foot"><button class="lnk" data-act="log" style="margin-right:auto">Dnevnik</button><button class="btn pri" data-act="dlgClose">Zatvori</button></div>`;
  };
  const printList = () => S.comments.filter(c => !c.resolved && !c.lost).sort((a, b) => a.from - b.from);
  const printText = () => { const g = S.gen.filter(x => !x.resolved && x.kind !== 'praise'); return 'Otvoreni komentari za konzultacije\n\n' + g.map(x => `OPĆI (${x.hid ? ((D().heads.find(h => h.hid === x.hid) || {}).num || '') + ' poglavlje' : 'cijeli rad'}): ${x.text}`).join('\n') + (g.length ? '\n\n' : '') + printList().map(c => { const h = chapOf(c.from); return `#${c.n} ${h ? h.num + ' ' + h.title : ''}${c.kind ? ' [' + KIND[c.kind] + ']' : ''}\n„${c.quote}”\n${c.text}${c.replies.length ? '\n  ' + c.replies.map(r => r.who + ': ' + r.text).join('\n  ') : ''}`; }).join('\n\n'); };
  X.hooks.dlg.c2print = () => { const l = printList(), g = S.gen.filter(x => !x.resolved && x.kind !== 'praise'); return `<h3>Ispis za konzultacije</h3><p class="muted">${l.length + g.length} otvorenih komentara, redom kroz rad.</p><div class="c2print" id="c2PrintBody">${g.map(x => `<div class="c2p"><b>Opći komentar · ${x.hid ? esc(((D().heads.find(h => h.hid === x.hid) || {}).num || '') + ' poglavlje') : 'cijeli rad'}</b><p>${esc(x.text)}</p></div>`).join('')}${l.map(c => { const h = chapOf(c.from); return `<div class="c2p"><b>#${c.n}${h ? ' · ' + esc(h.num + ' ' + h.title) : ''}${c.kind ? ' · ' + KIND[c.kind] : ''}</b><blockquote>${esc(c.quote)}</blockquote><p>${esc(c.text)}</p>${c.replies.map(r => `<p class="muted">${esc(r.who)}: ${esc(r.text)}</p>`).join('')}</div>`; }).join('') || (g.length ? '' : '<p class="muted">Nema otvorenih komentara.</p>')}</div><div class="foot"><button class="btn" data-act="c2PrintCopy" style="margin-right:auto">Kopiraj</button><button class="btn" data-act="c2PrintDo">Ispiši</button><button class="btn pri" data-act="dlgClose">Zatvori</button></div>`; };
  X.hooks.dlg.c2tpls = () => `<h3>Spremljeni komentari</h3><p class="muted">Česte primjedbe koje ubacujete jednim klikom. U Ducturi vrijede za sve Vaše studente.</p>${S.tpls.map(x => `<div class="fx"><span style="flex:1"><b>${esc(x.t)}</b><span class="d">${KIND[x.kind] || ''}${x.rule && RULES[x.rule] ? ' · pravilo: ' + esc(RULES[x.rule].t) : ''}</span></span><button class="lnk" data-act="c2TplDel" data-id="${x.id}">Ukloni</button></div>`).join('') || '<p class="muted">Još nema spremljenih komentara.</p>'}<div class="foot"><button class="btn" data-act="c2TplNew" style="margin-right:auto">+ Novi</button><button class="btn pri" data-act="dlgClose">Gotovo</button></div>`;

  const cById = id => S.comments.find(x => x.id === id), gById = id => S.gen.find(x => x.id === id);
  const resolve0 = ACT.cmResolve;
  Object.assign(ACT, {
    cmResolve: el => { const c = cById(el.dataset.id), was = c && c.resolved; resolve0(el); if (!c) return; if (was) { c.conf = null; } else { const fin = () => { if (c.resolved) { c.conf = T() ? true : null; persist(); X.renderPanel(true); } }; fin(); if (!c.resolved) U.c2After = fin; } },
    c2Turn: el => { U.c2Turn = U.c2Turn === el.dataset.v ? null : el.dataset.v; X.renderPanel(true); },
    c2Kind: el => { U.c2Filter = U.c2Filter === el.dataset.v ? null : el.dataset.v; X.renderPanel(true); },
    c2Pick: el => { (U.c2Pend = U.c2Pend || {}).kind = el.dataset.v; X.renderPanel(true); },
    c2Use: el => { const x = S.tpls.find(t => t.id === el.dataset.id); if (!x || !U.draft) return; U.draft.text = x.t; if (x.rule) U.draft.rule = x.rule; U.c2Pend = Object.assign(U.c2Pend || {}, { kind: x.kind || 'must', tpl: x.id }); X.renderPanel(true); setTimeout(() => $('#cmText')?.focus(), 30); },
    c2Dict: () => { const d = X.caps && X.caps.dictation; if (!d) return toast('Diktiranje radi u objavljenom prototipu, uz dopuštenje za mikrofon.'); if (U.dict) { d.stop().catch(() => {}); return; } U.dictTo = text => { if (!U.draft) return; U.draft.text = (U.draft.text ? U.draft.text.replace(/\s*$/, ' ') : '') + text; const ta = $('#cmText'); if (ta) ta.value = U.draft.text; }; d.start().catch(e => { U.dictTo = null; toast(e && e.code === 'not_granted' ? 'Diktiranje nije dopušteno.' : 'Diktiranje se ne može pokrenuti.'); }); },
    c2Quick: el => { U.replyFor = el.dataset.id; U.c2Pre = el.dataset.v; X.renderPanel(true); setTimeout(() => { const ta = $('#rpText'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } U.c2Pre = null; }, 40); },
    c2Conf: el => { const c = cById(el.dataset.id); c.conf = true; c.confWhen = X.now(); rer(); },
    c2Back: el => { const c = cById(el.dataset.id); ask({ title: 'Vrati studentu', label: 'Što još treba napraviti', multi: true, ok: 'Vrati' }, v => { c.resolved = false; c.conf = null; delete c.why; if (v.trim()) c.replies.push({ who: 'Nastavnik A', when: X.now(), text: v.trim(), ts: Date.now() }); rer(); }); },
    c2Also: el => { const c = cById(el.dataset.id), s = sel(); if (!s) return toast('Najprije označite tekst u radu, unutar jednog odlomka.'); (c.also = c.also || []).push(s); U.active = c.id; rer(); toast('Mjesto je dodano uz komentar.'); },
    c2AlsoDel: el => { cById(el.dataset.id).also.splice(+el.dataset.i, 1); rer(); },
    c2Rep: el => { const k = el.dataset.k, l = S.comments.filter(x => !x.lost && (k[0] === 'r' ? x.rule === k.slice(2) : x.tpl === k.slice(2))).sort((a, b) => a.from - b.from), i = l.findIndex(x => x.id === U.active), c = l[(i + 1) % l.length]; if (!c) return; U.active = c.id; X.refresh(); X.jump(c.from, false); X.renderPanel(true); },
    c2Rounds: () => X.openDlg({ type: 'c2rounds' }),
    c2Go: el => { const c = cById(el.dataset.id); X.closeDlg(); U.active = c.id; U.c2Turn = U.c2Filter = null; RP.cfg().scope = 'all'; X.refresh(); if (!c.lost) X.jump(c.from, false); X.showTab('cmt'); },
    c2Print: () => X.openDlg({ type: 'c2print' }),
    c2PrintCopy: () => { try { navigator.clipboard.writeText(printText()).then(() => toast('Kopirano.')); } catch (e) { toast('Kopiranje nije uspjelo.'); } },
    c2PrintDo: () => { document.body.classList.add('pc2'); const off = () => { document.body.classList.remove('pc2'); removeEventListener('afterprint', off); }; addEventListener('afterprint', off); try { window.print(); } catch (e) { off(); toast('Ispis nije dostupan u ovom prikazu. Koristite Kopiraj.'); } setTimeout(off, 60000); },
    c2Tpls: () => X.openDlg({ type: 'c2tpls' }),
    c2TplDel: el => { S.tpls = S.tpls.filter(x => x.id !== el.dataset.id); persist(); X.renderDlg(); },
    c2TplNew: () => ask({ title: 'Novi spremljeni komentar', label: 'Tekst komentara', multi: true, ok: 'Spremi' }, v => { if (v.trim()) S.tpls.push({ id: X.uid('tp'), t: v.trim(), kind: 'must' }); persist(); X.openDlg({ type: 'c2tpls' }); }),
    c2GenNew: () => { const c = RP.ctx(); ask({ title: 'Opći komentar', label: c.ch ? `Uz poglavlje ${c.ch.num} ${c.ch.title}` : 'Uz cijeli rad', desc: c.ch ? 'Za komentar uz cijeli rad postavite kursor u naslov rada.' : '', multi: true, ok: 'Objavi' }, v => { if (!v.trim()) return; S.gen.unshift({ id: X.uid('g'), hid: c.ch ? c.ch.hid : null, role: 'teacher', who: 'Nastavnik A', when: X.now(), ts: Date.now(), text: v.trim(), kind: 'must', resolved: false, replies: [] }); rer(); }); },
    c2GenReply: el => { const g = gById(el.dataset.id); ask({ title: 'Odgovor', label: 'Vaš odgovor', multi: true, ok: 'Pošalji' }, v => { if (v.trim()) g.replies.push({ who: who(), when: X.now(), text: v.trim(), ts: Date.now() }); rer(); }); },
    c2GenRes: el => { const g = gById(el.dataset.id); g.resolved = !g.resolved; rer(); },
    c2GenDel: el => { S.gen = S.gen.filter(x => x.id !== el.dataset.id); rer(); },
    c2Priv: () => { const s = sel(); if (!s) return toast('Najprije označite tekst u radu, unutar jednog odlomka.'); ask({ title: 'Privatna bilješka', label: 'Vidite je samo Vi', desc: '„' + (s.quote.length > 120 ? s.quote.slice(0, 118) + '…' : s.quote) + '”', multi: true, ok: 'Spremi' }, v => { if (!v.trim()) return; S.mnotes.push({ id: X.uid('mn'), from: s.from, to: s.to, quote: s.quote, text: v.trim(), when: X.now() }); (U.det = U.det || {})['rp-mnotes'] = true; rer(); }); },
    c2PrivDel: el => { S.mnotes = S.mnotes.filter(m => m.id !== el.dataset.id); rer(); }
  });
  /* "Označi riješeno" ponekad traži obrazloženje u dijalogu; potvrda se postavlja kad dijalog završi */
  const ask0 = ACT.askOk; if (ask0) ACT.askOk = el => { ask0(el); if (U.c2After) { const f = U.c2After; U.c2After = null; f(); } };
  document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.c2save) (U.c2Pend = U.c2Pend || {}).save = t.checked; });
  document.addEventListener('toggle', e => { const t = e.target; if (t.classList && t.classList.contains('c2more')) U.c2More = t.open; }, true);
  document.addEventListener('click', e => { if (!U.c2More) return; const t = e.target; if (t.closest && t.closest('.c2more') && !t.closest('.c2morel .lnk')) return; U.c2More = false; const d = $('.c2more'); if (d) setTimeout(() => { d.open = false; }, 0); }, true);
  X.c2 = { turn, KIND };
})();
