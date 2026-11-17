/* Ductura Editor, prototip: Asistent, drugi krug (v0.15).
 * 1 poziv s mjesta u tekstu · 2 lektura izmjenu po izmjenu · 3 podudaranje s odgovorom pomoćnika (D-58) · 4 upozorenje prije slanja
 * 5 pitanja o pravilima fakulteta · 6 traženje literature vodi do pretrage · 7 iz formatiranja u literaturu · 8 prevedi sažetak u Summary
 * 9 gotovi počeci upita · 10 izjava o AI-ju iz dnevnika · 11 svrhe po zadatku · 12 pregled korištenja
 * Podudaranje (3) je obična usporedba teksta s odgovorima iz Ducture; ne odnosi se na vanjske alate i ništa ne tvrdi o autorstvu.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, esc, plural, $, persist, toast } = X, RP = X.rp, AX = X.ai, P = AX.P, ed = () => X.editor, D = () => X.D;
  X.hooks.defaults.push(s => { const a = s.ai2; if (!a) return; if (!a.on) { a.on = {}; Object.keys(P).forEach(k => { a.on[k] = P[k].l === 1 || !!a.l2; }); } if (!a.why) a.why = {}; if (a.stmtOk === undefined) a.stmtOk = null; });
  const T = () => S.mode === 'teacher', fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const det = (key, title, body, open) => `<details class="rpd" data-det="${key}"${(U.det || {})[key] ?? open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;

  /* ---------- 5. nova svrha: pravila fakulteta ---------- */
  P.prav = { l: 1, t: 'Pravila fakulteta', d: 'kako se navodi, oblikuje i predaje; odgovor samo iz pravila', in: 'Vaše pitanje', ph: 'npr. kako se navodi poglavlje u zborniku?', rule: 'Odgovori isključivo na temelju pravila fakulteta navedenih ispod. Ako odgovora u njima nema, reci da pravila to ne propisuju i uputi studenta na mentora ili referadu. Ne dodaj pravila kojih ispod nema.' };
  const ruleLines = () => { const R = X.rules, p = R && R.profile && R.profile(); if (!p) return []; const out = []; (R.items() || []).forEach(o => { if (o.t) out.push(o.t + (o.d ? ': ' + o.d : '')); }); (p.facts || []).forEach(f => out.push(f)); (p.manualChecks || []).forEach(f => out.push(f)); return [...new Set(out)]; };
  const ruleSrc = () => { const p = X.rules && X.rules.profile && X.rules.profile(); return p ? p.sources || [] : []; };
  /* ---------- 9. gotovi počeci ---------- */
  const ST = { pojam: ['Objasni kao studentu prve godine', 'Daj primjer iz Hrvatske', 'Usporedi sa srodnim pojmom'], lekt: ['Samo pravopis i interpunkcija', 'I nespretne rečenice, bez mijenjanja smisla'], lit: ['Samo izvori na hrvatskom', 'Radovi iz zadnjih deset godina'], prav: ['Navedi primjer oblika', 'Što se najčešće griješi'], brain: ['Pitaj me o protuargumentima'], prim: ['Primjeri iz Hrvatske'] };
  P.pojam.st = ST.pojam; Object.keys(ST).forEach(k => { if (P[k]) P[k].st = ST[k]; });
  AX.promptExtra = (k) => { let x = U.aiOpt ? ` Dodatna želja studenta, unutar iste svrhe: ${U.aiOpt}.` : ''; if (k === 'prav') { const l = ruleLines(); x += `\nPravila fakulteta (${X.rules && X.rules.profile && X.rules.profile() ? X.rules.profile().label : 'profil nije učitan'}):\n${l.map(t => '- ' + t).join('\n') || '(pravila nisu učitana)'}`; } return x; };
  AX.fake = c => { if (c.purpose !== 'prav') return null; const q = c.msgs[c.msgs.length - 1].text.toLowerCase().match(/\p{L}{4,}/gu) || [], hit = ruleLines().map(t => ({ t, n: q.filter(w => t.toLowerCase().includes(w.slice(0, 5))).length })).filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 4); return hit.length ? 'Iz pravila fakulteta:\n' + hit.map(x => '- ' + x.t).join('\n') : 'Pravila fakulteta to ne propisuju. Pitajte mentora ili referadu.'; };

  /* ---------- 11. svrhe po zadatku ---------- */
  AX.allowedX = k => !!S.ai2.on[k];
  AX.why = k => (!S.ai2.on[k] && S.ai2.why[k] ? `<span class="aiwhy">${esc(S.ai2.why[k])}</span>` : '');

  /* ---------- 4. upozorenje prije slanja ---------- */
  const PII = [['e-adresa', /[\w.+-]+@[\w-]+\.[\w.-]+/g], ['OIB ili dugi broj', /\b\d{11}\b/g], ['broj telefona', /(?:\+385|\b0)\s?\d{1,2}[\s/-]?\d{3}[\s-]?\d{3,4}\b/g]];
  const pii = t => PII.map(([n, re]) => ({ n, m: t.match(re) || [] })).filter(x => x.m.length);
  AX.preSend = (k, text) => { if (k === 'lekt' && U.aiSel && U.aiSel.text.trim() === text) { const d = ed().state.doc; if (!d.resolve(U.aiSel.from).sameParent(d.resolve(U.aiSel.to))) { toast('Za lekturu označite tekst unutar jednog odlomka.'); return false; } } if (U.aiPiiOk) { U.aiPiiOk = false; return true; } const h = pii(text); if (!h.length) return true; U.aiPii = h; U.aiIn = text; X.renderPanel(true); return false; };
  AX.formExtra = k => { let h = ''; const st = P[k].st || []; if (st.length) h += `<div class="rpsub" style="margin-top:8px">Može i ovako</div><div class="rptools aist">${st.map(x => `<button class="chip" data-act="aiOpt" data-v="${esc(x)}" aria-pressed="${U.aiOpt === x}">${esc(x)}</button>`).join('')}</div>`;
    if (k === 'prav') h += `<p class="muted" style="margin-top:8px">Pomoćnik odgovara samo iz ${ruleLines().length} pravila Vašeg fakulteta. Uz pitanje se šalju i ta pravila.</p>`;
    if (U.aiPii) h += `<div class="card rpnote aipii"><b>U tekstu su osobni podaci</b><p>${U.aiPii.map(x => `${x.n}: ${esc(x.m.slice(0, 3).join(', '))}`).join(' · ')}. Pružatelju ih ne treba slati.</p><div class="row"><button class="btn sm pri" data-act="aiPiiCut">Ukloni ih i pošalji</button><button class="btn sm" data-act="aiPiiGo">Pošalji svejedno</button><button class="lnk" data-act="aiPiiNo">Odustani</button></div></div>`;
    return h; };

  /* ---------- 2. lektura izmjenu po izmjenu ---------- */
  function hunks(a, b) {
    const A = a.split(/(\s+)/), B = b.split(/(\s+)/), n = A.length, m = B.length; if (n * m > 600000) return null;
    const L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1)); for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0, cur = null; const push = (t, d, ins) => { if (t === 'eq') { if (cur && !/\S/.test(d) && out.length) { cur.del += d; cur.ins += d; return; } cur = null; const l = out[out.length - 1]; if (l && l.eq != null) l.eq += d; else out.push({ eq: d }); } else { if (!cur) { cur = { del: '', ins: '' }; out.push(cur); } cur.del += d || ''; cur.ins += ins || ''; } };
    while (i < n && j < m) { if (A[i] === B[j]) { push('eq', A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push('ch', A[i++], ''); else push('ch', '', B[j++]); } while (i < n) push('ch', A[i++], ''); while (j < m) push('ch', '', B[j++]);
    /* razmak koji je ostao na kraju izmjene vraća se u nepromijenjeni dio */
    return out.filter(h => h.eq != null || h.del !== h.ins).map((h, x) => (h.eq != null ? h : Object.assign(h, { id: x })));
  }
  const hk = cv => { if (!cv.hk) { cv.hadSel = !!cv.sel; cv.hk = hunks(cv.msgs[0].text, cv.msgs[1].text) || [{ del: cv.msgs[0].text, ins: cv.msgs[1].text, id: 0 }]; cv.hs = cv.hs || {}; const sl = cv.sel, doc = ed().state.doc; if (sl && sl.to <= doc.content.size) { const raw = doc.textBetween(sl.from, sl.to, ' ', X.leafText), lead = raw.match(/^\s*/)[0].length, at = []; doc.nodesBetween(sl.from, sl.to, (n, pos) => { if (n.isText) { for (let q = Math.max(sl.from, pos); q < Math.min(sl.to, pos + n.nodeSize); q++) at.push(false); } else if (n.isLeaf && n.isInline) { const t = X.leafText(n) || ''; for (let q = 0; q < t.length; q++) at.push(true); } return true; }); let o = 0; cv.hk.forEach(h => { if (h.eq != null) { o += h.eq.length; return; } const a = lead + o, b = a + h.del.length; o += h.del.length; if (at.slice(a, b).some(Boolean)) h.atom = true; }); } } return cv.hk; };
  AX.msg = (cv, m, i) => {
    const ro = !!S.submitted || T();
    if (cv.purpose === 'lekt' && i === 1) { const l = hk(cv), ch = l.filter(h => h.eq == null && !h.atom), ok = ch.filter(h => cv.hs[h.id] === 'ok').length, no = ch.filter(h => cv.hs[h.id] === 'no').length;
      if (!ch.length) return `<div class="rpai-t">${esc(m.text)}</div><p class="muted" style="margin:6px 0 0">Pomoćnik nije našao ništa za ispraviti.</p>`;
      return `<div class="rpai-t aihk">${l.map(h => h.eq != null ? esc(h.eq) : h.atom ? `<span class="aih no" title="Ova izmjena dira navod ili fusnotu, pa je pomoćnik ne unosi">${esc(h.del)}<i>dira navod</i></span>` : `<span class="aih ${cv.hs[h.id] || ''}">${h.del.trim() ? `<del>${esc(h.del)}</del>` : ''}${h.ins.trim() ? `<ins>${esc(h.ins)}</ins>` : ''}${ro || cv.done ? '' : `<button data-act="aiHk" data-id="${h.id}" data-v="ok" aria-pressed="${cv.hs[h.id] === 'ok'}" title="Prihvati">✓</button><button data-act="aiHk" data-id="${h.id}" data-v="no" aria-pressed="${cv.hs[h.id] === 'no'}" title="Odbij">✕</button>`}</span>`).join('')}</div>` +
        (ro ? '' : cv.done ? `<p class="muted" style="margin:6px 0 0">Uneseno u rad: ${cv.done} ${plural(cv.done, 'izmjena', 'izmjene', 'izmjena')}.</p>` : `<div class="rpsub" style="margin-top:8px">${ch.length} ${plural(ch.length, 'izmjena', 'izmjene', 'izmjena')} · prihvaćeno ${ok} · odbijeno ${no}</div><div class="row" style="margin-top:6px"><button class="btn sm" data-act="aiHkAll" data-v="ok">Prihvati sve</button><button class="btn sm" data-act="aiHkAll" data-v="no">Odbij sve</button><button class="btn sm pri" data-act="aiHkGo"${ok ? '' : ' disabled'}>${cv.hadSel ? 'Unesi prihvaćeno u rad' : 'Umetni na mjesto kursora'} (${ok})</button></div>`); }
    return null;
  };
  /* ---------- 6. i 7. ---------- */
  AX.msgActs = (cv, m, i) => { const q = encodeURIComponent(cv.msgs[0].text.slice(0, 120));
    if (cv.purpose === 'lit') return `</div><div class="rpsub" style="margin-top:8px">Otvori pretragu za ovu temu</div><div class="row ailinks"><a class="btn sm" target="_blank" rel="noopener" href="https://scholar.google.com/scholar?q=${q}">Google Scholar</a><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/search?q=site%3Ahrcak.srce.hr+${q}">Hrčak</a><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/search?q=site%3Acroris.hr+${q}">CROSBI</a>`;
    if (cv.purpose === 'form') return `<button class="lnk" data-act="aiToSrc" data-i="${i}">Dodaj u Izvore</button>`;
    if (cv.purpose === 'prav' && ruleSrc().length) return `</div><div class="rpsub" style="margin-top:8px">Službeni izvori pravila</div><div class="aisrc">${ruleSrc().slice(0, 4).map(s => `<a class="rq-src" href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join('')}`;
    return ''; };

  /* ---------- 3. podudaranje s odgovorom pomoćnika (D-58) ---------- */
  const tok = t => (t.toLowerCase().match(/[\p{L}\d]+/gu) || []);
  let shKey = '', shSet = null;
  const shingles = () => { const key = S.ai2.convs.map(c => c.id + ':' + c.msgs.length).join('|'); if (key === shKey) return shSet; shKey = key; shSet = new Map(); S.ai2.convs.forEach(c => c.msgs.forEach(m => { if (m.role !== 'assistant' || m.fakeSkip) return; const w = tok(m.text); for (let i = 0; i + 8 <= w.length; i++) shSet.set(w.slice(i, i + 8).join(' '), c.id); })); return shSet; };
  X.hooks.end.push(({ doc, decos, d }) => {
    d.aiMatch = []; if (!S.ai2 || !S.ai2.cfg.match) return; /* D-268 O6: oznaka podudaranja je isključena do nakon pilota */
    const set = S.ai2.convs.length ? shingles() : null; if (!set || !set.size) return;
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true; const words = []; let quote = false;
      node.forEach((ch, off) => { if (!ch.isText) { words.push(null); return; } if (ch.marks.some(k => k.type.name === 'aitext')) { words.push(null); return; } const re = /[\p{L}\d]+|[„”“"]/gu; let m; while ((m = re.exec(ch.text))) { if (/[„”“"]/.test(m[0])) { quote = m[0] === '„' || m[0] === '“' ? true : m[0] === '”' ? false : !quote; words.push(null); continue; } words.push(quote ? null : { w: m[0].toLowerCase(), a: pos + 1 + off + m.index, b: pos + 1 + off + m.index + m[0].length }); } });
      let i = 0; while (i + 8 <= words.length) { const win = words.slice(i, i + 8); if (win.some(x => !x)) { i++; continue; } const cid = set.get(win.map(x => x.w).join(' ')); if (!cid) { i++; continue; } let j = i + 8; while (j < words.length && words[j] && set.has(words.slice(j - 7, j + 1).map(x => x.w).join(' '))) j++; const a = words[i].a, b = words[j - 1].b; d.aiMatch.push({ from: a, to: b, conv: cid, n: j - i }); decos.push(X.Decoration.inline(a, b, { class: 'aimatch', title: 'Podudara se s odgovorom AI pomoćnika. Razgovor ide uz izjavu.' })); i = j; }
      return false;
    });
    d.aiMatch.forEach(mt => { const c = S.ai2.convs.find(x => x.id === mt.conv); if (c && !c.attach) { c.attach = true; c.auto = true; } });
  });

  /* ---------- 10. izjava iz dnevnika i 12. pregled korištenja ---------- */
  function usage() { const a = S.ai2, by = {}; a.transfers.forEach(t => { const o = by[t.purpose] = by[t.purpose] || { n: 0, w: 0 }; o.n++; o.w += t.size; }); const marks = []; ed().state.doc.descendants((n, pos) => { if (n.isText) { const k = n.marks.find(x => x.type.name === 'aitext'); if (k) { const l = marks[marks.length - 1]; if (l && l.info === k.attrs.info && l.to === pos) l.to = pos + n.nodeSize; else marks.push({ from: pos, to: pos + n.nodeSize, info: k.attrs.info }); } } }); return { by, marks, match: (D().aiMatch || []), att: a.convs.filter(c => c.attach).length, asked: {} }; }
  function statement() { const a = S.ai2, u = usage(), pur = {}; a.convs.forEach(c => { pur[P[c.purpose].t] = (pur[P[c.purpose].t] || 0) + 1; }); const ext = (S.ai.tools || '').split(',').map(x => x.trim()).filter(x => x && !/Ductur/.test(x));
    if (!a.convs.length && !ext.length) return S.ai.none ? 'Izjavljujem da u izradi ovog rada nisam koristio/la alate umjetne inteligencije.' : '';
    const l = []; if (a.convs.length) l.push(`U izradi ovog rada koristio/la sam pomoćnika u Ducturi u sljedeće svrhe: ${Object.entries(pur).map(([k, n]) => `${k.toLowerCase()} (${n} ${plural(n, 'put', 'puta', 'puta')})`).join(', ')}.`);
    const tw = a.transfers.reduce((s, t) => s + t.size, 0); l.push(a.transfers.length ? `Iz pomoćnika ${a.transfers.length === 1 ? 'je u rad prenesen 1 ulomak' : 'je u rad preneseno ' + a.transfers.length + ' ' + plural(a.transfers.length, 'ulomak', 'ulomka', 'ulomaka')}, ukupno ${tw} ${plural(tw, 'riječ', 'riječi', 'riječi')}; ta su mjesta u radu označena.` : 'Iz pomoćnika u rad nije prenesen tekst.');
    if (u.att) l.push(`Uz izjavu ${u.att === 1 ? 'je priložen 1 razgovor' : 'su priložena ' + u.att + ' razgovora'} s pomoćnikom.`); if (ext.length) l.push(`Izvan Ducture korišteni su: ${ext.join(', ')}${S.ai.purposes.length ? ' (' + S.ai.purposes.join(', ') + ')' : ''}.`);
    l.push('Odgovaram za cjelokupan sadržaj rada.'); return l.join(' '); }
  const aiText0 = X.aiText; X.aiText = () => (S.ai2 && (S.ai2.convs.length || S.ai2.transfers.length) ? statement() : aiText0());
  AX.logsExtra = () => { const u = usage(), st = statement(), t = T();
    const use = Object.entries(u.by).map(([k, o]) => `<div class="fx rph"><span style="flex:1"><b>${esc(k)}</b></span><span class="muted">${o.n} ${plural(o.n, 'prijenos', 'prijenosa', 'prijenosa')} · ${o.w} ${plural(o.w, 'riječ', 'riječi', 'riječi')}</span></div>`).join('') + (u.marks.length ? `<div class="rpsub" style="margin-top:8px">Mjesta u tekstu (${u.marks.length})</div>` + u.marks.slice(0, 20).map(m => `<button class="fx rph" data-act="jump" data-pos="${m.from}"><span><b>${esc(ed().state.doc.textBetween(m.from, Math.min(m.to, m.from + 70), ' '))}${m.to - m.from > 70 ? '…' : ''}</b><span class="d">${esc(m.info)}</span></span></button>`).join('') : '') + (u.match.length ? `<div class="rpsub" style="margin-top:8px">Podudara se s odgovorom pomoćnika (${u.match.length})</div>` + u.match.map(m => `<button class="fx rph" data-act="jump" data-pos="${m.from}"><span><b>${esc(ed().state.doc.textBetween(m.from, Math.min(m.to, m.from + 70), ' '))}…</b><span class="d">${m.n} riječi zaredom · razgovor ide uz izjavu</span></span></button>`).join('') + `<p class="muted">Usporedba je s odgovorima pomoćnika u Ducturi. Ne odnosi se na vanjske alate i ne govori tko je što napisao.</p>` : '');
    return det('rp-ai-use', `Korištenje u ovom radu${u.match.length ? ' · podudaranja ' + u.match.length : ''}`, use || '<p class="muted">Pomoćnik u ovom radu još nije korišten.</p>', t || !!u.match.length) +
      det('rp-ai-st', `Izjava o korištenju AI-ja${S.ai2.stmtOk ? ' · potvrđena' : ''}`, (st ? `<div class="q">${esc(st)}</div><p class="muted">Izjava se slaže sama iz dnevnika pomoćnika i ide u Prilog rada. Vanjske alate upisujete pod Mentor, Izjave.</p>${t || S.submitted ? '' : `<label class="check"><input type="checkbox" data-aistmt="1"${S.ai2.stmtOk ? ' checked' : ''}><span>Pročitao/la sam izjavu i potvrđujem da je točna</span></label>`}` : '<p class="muted">Izjava još nema što navesti. Ako ne koristite AI, to označite pod Mentor, Izjave.</p>'), false); };

  /* ---------- pogled nastavnika (11 i 12) ---------- */
  AX.teacher = logs => { const a = S.ai2, ro = !!S.submitted;
    return `<div class="card"><h4>Svrhe za ovaj zadatak</h4><p class="muted" style="margin:4px 0 6px">Uključite ono što zadatak dopušta. Uz isključenu svrhu možete napisati zašto; student to vidi.</p>${[1, 2].map(l => `<div class="rpsub">${l === 1 ? 'Razina 1, po pravilima fakulteta' : 'Razina 2, samo ako je Vi uključite'}</div>` + Object.entries(P).filter(([, p]) => p.l === l).map(([k, p]) => `<div class="aipur"><label class="check"><input type="checkbox" data-aion="${k}"${a.on[k] ? ' checked' : ''}${ro ? ' disabled' : ''}><span>${p.t}</span></label>${a.on[k] ? '' : `<button class="lnk" data-act="aiWhy" data-k="${k}">${a.why[k] ? esc(a.why[k]) : '+ obrazloženje'}</button>`}</div>`).join('')).join('')}</div>` +
      `<div class="card"><h4>Tko osigurava AI</h4><p class="muted" style="margin:4px 0 6px">U Ducturi ovo postavlja administrator fakulteta, ne nastavnik. Ovdje je radi prototipa.</p>${[['fak', 'Fakultet ima svoj ugovor s pružateljem'], ['duc', 'Ductura AI dodatak s kvotom po studentu'], ['own', 'Student smije spojiti vlastiti ključ'], ['sub', 'Student smije koristiti vlastitu pretplatu, gdje pružatelj to dopušta'], ['subOk', 'Prototip: Ductura je primljena u program pružatelja (ChatGPT)'], ['match', 'Prototip: oznaka podudaranja s odgovorom pomoćnika (u repou isključena do nakon pilota, D-268)']].map(([key, l]) => `<label class="check"><input type="checkbox" data-aicfg="${key}"${a.cfg[key] ? ' checked' : ''}><span>${l}</span></label>`).join('')}<div class="rpsub">Kvota za Ductura AI, upita po studentu mjesečno</div><div class="seg">${[50, 100, 200].map(q => `<button data-act="aiQuota" data-v="${q}" aria-pressed="${a.cfg.quota === q}">${q}</button>`).join('')}</div></div>` +
      `<p class="muted">Vidite prijenose u rad i razgovore koje je student priložio izjavi. Ostale razgovore ne vidite. Nema postotaka ni ocjene korištenja.</p>` + logs.replace(/<div class="fx rph"><button class="rps-m" data-act="aiOpen" data-id="([^"]+)">[\s\S]*?<\/div>/g, (m0, id) => ((a.convs.find(x => x.id === id) || {}).attach ? m0 : '')); };

  /* ---------- 8. prevedi sažetak u Summary ---------- */
  X.absExtra = ro => (ro ? '' : `<div class="absai"><button class="btn sm" data-act="aiSum"${AX.allowed('prij') && AX.curSrc() ? '' : ' disabled'}>${U.aiSumBusy ? 'Prevodim…' : 'Prevedi sažetak pomoćnikom'}</button>${S.sumAi ? `<span>preneseno iz AI pomoćnika · ${esc(S.sumAi.model)} · ${esc(S.sumAi.when)}; doradite prijevod</span>` : AX.allowed('prij') ? '' : '<span>zadatak ne dopušta prijevod pomoćnikom</span>'}</div>`);
  AX.onDone = cv => { if (cv.toSum) { const m = cv.msgs[cv.msgs.length - 1]; S.sum = m.text; S.sumAi = { model: m.model, when: m.when }; cv.toSum = false; U.aiSumBusy = false; AX.logMove(cv, m.text); const ae = document.activeElement; if (ae && ae.closest && ae.closest('#absBox')) ae.blur(); X.render.bib(); toast('Prijevod je upisan u Summary i zabilježen kao prijenos iz pomoćnika.'); } };

  /* ---------- 1. poziv s mjesta u tekstu ---------- */
  const bub = document.createElement('div'); bub.id = 'aiBub'; bub.hidden = true; document.body.appendChild(bub);
  let bt = null;
  const showBub = () => { const ds = getSelection(); if (!X.editor || T() || S.submitted || !ds || !ds.rangeCount || ds.isCollapsed || !$('#ed').contains(ds.anchorNode) || !AX.curSrc() || !ed().isEditable) { bub.hidden = true; return; } const txt = ds.toString().trim(); if (txt.length < 3) { bub.hidden = true; return; } const one = !/\s\S+\s\S+\s/.test(txt), ks = (one ? ['pojam', 'prij'] : ['lekt', 'prij', 'pojam']).filter(k => AX.allowed(k)); if (!ks.length) { bub.hidden = true; return; } const r = ds.getRangeAt(0).getBoundingClientRect(); bub.innerHTML = `<span>Pomoćnik</span>` + ks.map(k => `<button data-act="aiFrom" data-v="${k}">${k === 'lekt' ? 'Lektura' : k === 'prij' ? 'Prijevod' : 'Objasni pojam'}</button>`).join(''); bub.hidden = false; const w = bub.offsetWidth, below = innerWidth <= 700 || r.top < 110; bub.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px'; bub.style.top = (below ? Math.min(innerHeight - 50, r.bottom + 10) : r.top - 44) + 'px'; };
  document.addEventListener('selectionchange', () => { clearTimeout(bt); bt = setTimeout(showBub, 350); });
  document.addEventListener('scroll', () => { bub.hidden = true; }, true); addEventListener('resize', () => { bub.hidden = true; });

  Object.assign(ACT, {
    aiFrom: el => { const k = el.dataset.v, s = AX.selText(); bub.hidden = true; if (!s) return; U.aiP = k; U.aiCur = null; U.aiSel = s; U.aiIn = k === 'pojam' ? s.text.trim().slice(0, 80) : null; U.aiOpt = null; U.aiPii = null; X.showTab('ai'); setTimeout(() => { const f = $('#aiIn'); if (f) f.focus(); }, 60); },
    aiOpt: el => { U.aiOpt = U.aiOpt === el.dataset.v ? null : el.dataset.v; U.aiIn = ($('#aiIn') || {}).value; X.renderPanel(true); },
    aiPiiCut: () => { let t = U.aiIn || ''; PII.forEach(([, re]) => { t = t.replace(re, '[uklonjeno]'); }); U.aiPii = null; U.aiIn = t; U.aiSel = null; X.renderPanel(true); const f = $('#aiIn'); if (f) f.value = t; ACT.aiSend(); },
    aiPiiGo: () => { U.aiPii = null; U.aiPiiOk = true; ACT.aiSend(); },
    aiPiiNo: () => { U.aiPii = null; X.renderPanel(true); },
    aiHk: el => { const cv = AX.conv(), id = +el.dataset.id, v = el.dataset.v; cv.hs[id] = cv.hs[id] === v ? null : v; persist(); X.renderPanel(true); },
    aiHkAll: el => { const cv = AX.conv(); hk(cv).forEach(h => { if (h.eq == null && !h.atom) cv.hs[h.id] = el.dataset.v; }); persist(); X.renderPanel(true); },
    aiHkGo: () => {
      const cv = AX.conv(), l = hk(cv), m = cv.msgs[1], sl = cv.sel; if (!ed().isEditable) return toast('Tekst je zaključan.');
      const doc = ed().state.doc, raw = sl && sl.to <= doc.content.size ? doc.textBetween(sl.from, sl.to, ' ', X.leafText) : null;
      if (!sl && !cv.hadSel) { /* tekst je upisan u polje, a ne označen u radu: ispravljena inačica ide na mjesto kursora */
        const info0 = `iz AI pomoćnika · Lektura · ${m.model} · ${m.when}`, mk = ed().schema.marks.aitext.create({ info: info0 }), nodes = []; let n0 = 0, w0 = '';
        l.forEach(h => { if (h.eq != null) { if (h.eq) nodes.push(ed().schema.text(h.eq)); } else if (cv.hs[h.id] === 'ok') { n0++; w0 += ' ' + h.ins; if (h.ins) nodes.push(ed().schema.text(h.ins, [mk])); } else if (h.del) nodes.push(ed().schema.text(h.del)); });
        const st = ed().state; ed().view.dispatch(st.tr.replaceWith(st.selection.from, st.selection.to, nodes)); cv.done = n0; AX.logMove(cv, w0.trim() || '.'); persist(); X.renderAll(true); toast(`Tekst je umetnut na mjesto kursora, s ${n0} ${plural(n0, 'prihvaćenom izmjenom', 'prihvaćene izmjene', 'prihvaćenih izmjena')}.`); if (innerWidth <= 1050) X.closeDrawers(); return; }
      if (raw == null || raw.trim() !== cv.msgs[0].text) return toast('Tekst u radu se promijenio otkad ste poslali upit. Označite ga ponovno i pokrenite lekturu.');
      /* svaki znak poslanog teksta dobiva položaj u dokumentu; navod, fusnota i slični čvorovi se ne diraju */
      const map = []; doc.nodesBetween(sl.from, sl.to, (n, pos) => { if (n.isText) { for (let q = Math.max(sl.from, pos); q < Math.min(sl.to, pos + n.nodeSize); q++) map.push({ p: q }); } else if (n.isLeaf && n.isInline) { const t = X.leafText(n) || ''; for (let q = 0; q < t.length; q++) map.push({ p: pos, atom: true }); } return true; });
      const lead = raw.match(/^\s*/)[0].length, info = `iz AI pomoćnika · Lektura · ${m.model} · ${m.when}`, mark = ed().schema.marks.aitext.create({ info }), ops = []; let o = 0, skipped = 0, aiw = '';
      l.forEach(h => { if (h.eq != null) { o += h.eq.length; return; } const a = lead + o, b = a + h.del.length; o += h.del.length; if (cv.hs[h.id] !== 'ok' || h.atom) return; if (map.slice(a, b).some(x => x.atom) || a > map.length) { skipped++; return; } const from = a < map.length ? map[a].p : sl.to, to = b > a ? map[b - 1].p + 1 : from; ops.push({ from, to, ins: h.ins }); aiw += ' ' + h.ins; });
      if (!ops.length) return toast(skipped ? 'Prihvaćene izmjene diraju navod ili fusnotu, pa ih pomoćnik ne unosi. Popravite ih ručno.' : 'Nema prihvaćenih izmjena.');
      let tr = ed().state.tr; ops.sort((x, y) => y.from - x.from).forEach(x => { tr = x.ins ? tr.replaceWith(x.from, x.to, ed().schema.text(x.ins, [mark])) : tr.delete(x.from, x.to); });
      ed().view.dispatch(tr); cv.done = ops.length; cv.sel = null; AX.logMove(cv, aiw.trim() || '.'); persist(); X.renderAll(true); toast(`Uneseno: ${ops.length} ${plural(ops.length, 'izmjena', 'izmjene', 'izmjena')}${skipped ? `, preskočeno ${skipped} uz navod` : ''}. Samo izmijenjene riječi označene su kao „iz AI pomoćnika”.`); if (innerWidth <= 1050) X.closeDrawers();
    },
    aiToSrc: el => { const m = AX.conv().msgs[+el.dataset.i], line = m.text.split('\n').map(x => x.replace(/^[-•\d.\s]+/, '').trim()).find(x => /\(\d{4}/.test(x)) || m.text; const s = X.s2 && X.s2.addRef(line); if (!s) return toast('Iz odgovora se ne mogu pročitati autor, godina i naslov. Dodajte izvor ručno.'); persist(); X.renderAll(true); toast(`Dodano u Izvore: ${s.authors} (${s.year}). Provjerite podatke.`); },
    aiWhy: el => { const k = el.dataset.k; X.fx.ask({ title: 'Zašto svrha nije dopuštena', label: P[k].t, value: S.ai2.why[k] || '', ph: 'npr. u ovom se radu ocjenjuje jezik', ok: 'Spremi' }, v => { S.ai2.why[k] = v.trim(); persist(); X.renderPanel(true); }); },
    aiSum: () => { const t = (S.abs || '').trim(); if (X.wc(t) < 20) return toast('Najprije napišite sažetak na hrvatskom.'); const bl = AX.blocked(t); if (bl) return toast(bl); if (AX.curSrc() === 'duc') AX.used(); const cv = { id: X.uid('ai'), src: AX.curSrc(), purpose: 'prij', when: X.now(), lang: 'engleski', attach: false, sel: null, toSum: true, msgs: [{ role: 'user', text: t }] }; S.ai2.convs.unshift(cv); U.aiSumBusy = true; const ae = document.activeElement; if (ae && ae.closest && ae.closest('#absBox')) ae.blur(); X.render.bib(); AX.run(cv); }
  });
  document.addEventListener('change', e => { const t = e.target; if (!t.dataset) return; if (t.dataset.aion) { S.ai2.on[t.dataset.aion] = t.checked; persist(); X.renderPanel(true); } if (t.dataset.aistmt) { S.ai2.stmtOk = t.checked ? X.now() : null; persist(); X.renderPanel(true); } });
})();
