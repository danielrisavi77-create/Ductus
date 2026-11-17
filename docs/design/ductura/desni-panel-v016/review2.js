/* Ductura Editor, prototip: Pregled, drugi krug (v0.13).
 * Popravci: početni zaslon s nalazima, Provjere po vrsti uz "nije greška", Nacrt s brojem riječi i navoda (u right.js).
 * Novi alati: brojke bez izvora, doslovni navodi, upućivanja, struktura naslova, sitnice s "Popravi sve".
 * Za mentora: sažetak rada na jednoj stranici, promjene po poglavljima, iz napomene u komentar.
 * Sve su obične provjere teksta u pregledniku, bez AI-ja. Sve je "za pogledati", ništa ne blokira predaju.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, RULES, TASK, esc, plural, $, persist, toast } = X, RP = X.rp, PRE = RP.PRE, { headEnd } = X.fx, ed = () => X.editor, D = () => X.D;
  X.hooks.defaults.push(s => { if (s.hintOff == null) s.hintOff = {}; });
  const T = () => S.mode === 'teacher', fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const scope = c => [c.on ? c.a : 0, c.on ? c.b : ed().state.doc.content.size];
  const paras = (a, b) => { const out = []; ed().state.doc.forEach((n, off) => { if (off >= a && off < b && (n.type.name === 'paragraph' || n.type.name === 'blockquote') && n.textContent.trim()) out.push({ pos: off, node: n, bq: n.type.name === 'blockquote', text: n.textBetween(0, n.content.size, ' ', X.leafText).trim() }); }); return out; };
  const sents = t => t.split(/(?<=[.!?…])\s+(?=[\p{Lu}„"(])/u).filter(Boolean);
  const texts = (a, b) => { const out = [], doc = ed().state.doc; doc.nodesBetween(Math.max(0, a), Math.min(doc.content.size, b), (n, pos) => { if (n.isText) out.push({ pos, text: n.text, node: n }); }); return out; };
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const row = (pos, b, d, extra) => `<div class="fx rph r2row"><button class="r2go" data-act="jump" data-pos="${pos}"><b>${b}</b><span class="d">${d}</span></button>${extra || ''}</div>`;
  const chapOf = p => { let h0 = null; D().heads.forEach(h => { if (h.level === 2 && h.pos <= p) h0 = h; }); return h0; };

  /* ================= 4. brojke bez izvora ================= */
  const NUM = /\d+(?:[.,]\d+)?\s?(?:%|posto|eura?|EUR|€|kn|kuna|milijun\p{L}*|milijard\p{L}*|tisuć\p{L}*)|\b\d{1,3}(?:[. ]\d{3})+\b|\b(?!1[0-9]{3}\b|20[0-9]{2}\b)\d{3,}\b|\b\d+\s(?:stanovnik\p{L}*|radnik\p{L}*|zaposlen\p{L}*|ljudi|osob\p{L}*|ispitanik\p{L}*|studenat\p{L}*)/u, CITE = /\([^()]*\b\d{4}[a-z]?(?::\s?[\d\s,\-–]+)?\)/;
  const numbers = c => { const [a, b] = scope(c), out = []; paras(a, b).forEach(p => { if (p.bq) return; const ss = sents(p.text); ss.forEach((s, i) => { const m = s.match(NUM); if (m && !CITE.test(s) && !(ss[i + 1] && /^(Isto|Ibid)/.test(ss[i + 1]))) out.push({ pos: p.pos, s, m: m[0] }); }); }); return out; };
  PRE.num = { label: 'Brojke bez izvora', n: c => numbers(c).length, fn: c => { const l = numbers(c); return `<p class="muted">Rečenice s brojkom, postotkom ili iznosom u kojima nema navoda. Ako je podatak Vaš (iz vlastitog istraživanja ili tablice), to je u redu.</p>` + (l.slice(0, 60).map(x => row(x.pos, esc(x.m), esc(cut(x.s, 170)))).join('') || '<p>Svaka rečenica s brojkom ima navod.</p>'); } };

  /* ================= 5. doslovni navodi ================= */
  const quotes = c => { const [a, b] = scope(c), out = []; let total = 0; paras(a, b).forEach(p => { total += X.wc(p.text); if (p.bq) return out.push({ pos: p.pos, t: p.text, w: X.wc(p.text), bq: true }); const re = /[„“"]([^„”“"]{3,})[”“"]/g; let m; while ((m = re.exec(p.text))) out.push({ pos: p.pos, t: m[1], w: X.wc(m[1]) }); }); return { list: out.sort((x, y) => y.w - x.w), total, w: out.reduce((s, x) => s + x.w, 0) }; };
  PRE.quo = { label: 'Doslovni navodi', n: c => quotes(c).list.filter(x => x.w > 40 && !x.bq).length, note: c => { const q = quotes(c); return `${fmt(q.w)} od ${fmt(q.total)} riječi`; }, fn: c => { const q = quotes(c), long = q.list.filter(x => x.w > 40 && !x.bq); return `<div class="card rpnote"><b>${fmt(q.w)} od ${fmt(q.total)} riječi su doslovni navodi</b><p>${q.list.length} ${plural(q.list.length, 'navod', 'navoda', 'navoda')} u navodnicima ili u zasebnom bloku. Rad se čita kao Vaš kad većinu izvora prepričate svojim riječima.</p></div>` + (long.length ? `<div class="ptitle">Dulji od 40 riječi, a nisu u zasebnom bloku (${long.length})</div>` + long.map(x => row(x.pos, x.w + ' riječi', esc(cut(x.t, 150)))).join('') : '') + `<div class="ptitle">Najdulji navodi</div>` + (q.list.slice(0, 8).map(x => row(x.pos, x.w + ' ' + plural(x.w, 'riječ', 'riječi', 'riječi') + (x.bq ? ' · zaseban blok' : ''), esc(cut(x.t, 150)))).join('') || '<p class="muted">Nema doslovnih navoda.</p>'); } };

  /* ================= 6. upućivanja ================= */
  const ORD = { prvom: 1, drugom: 2, trećem: 3, četvrtom: 4, petom: 5, šestom: 6, sedmom: 7, osmom: 8, devetom: 9, desetom: 10 };
  function refs(c) {
    const [a, b] = scope(c), d = D(), pk = d.prikazi || [], h2 = d.heads.filter(h => h.level === 2), nums = new Set(d.heads.filter(h => h.level > 1).map(h => h.num.replace(/\.$/, ''))), bad = []; let ok = 0;
    texts(a, b).forEach(t => {
      let m; const r1 = /\b(tablic[aeiu]|tablicom|slik[aeiu]|slikom|grafikon\p{L}*)\s+(\d+)\b/giu;
      while ((m = r1.exec(t.text))) { const kind = /^tabl/i.test(m[1]) ? 'tablica' : 'slika', n = +m[2]; if (pk.some(p => p.kind === kind && p.n === n)) ok++; else bad.push({ pos: t.pos + m.index, b: m[0], d: `u radu nema ${kind === 'tablica' ? 'tablice' : 'slike'} s brojem ${n}` }); }
      const r2 = /\bpoglavlj\p{L}*\s+(\d+(?:\.\d+)*)\b/giu; while ((m = r2.exec(t.text))) { if (nums.has(m[1])) ok++; else bad.push({ pos: t.pos + m.index, b: m[0], d: `u radu nema poglavlja ${m[1]}` }); }
      const r3 = /\bu\s+(prvom|drugom|trećem|četvrtom|petom|šestom|sedmom|osmom|devetom|desetom)\s+(?:se\s+)?(?:dijelu|poglavlju)\b/giu; while ((m = r3.exec(t.text))) { const n = ORD[m[1].toLowerCase()]; if (n <= h2.length) ok++; else bad.push({ pos: t.pos + m.index, b: m[0], d: `rad ima ${h2.length} ${plural(h2.length, 'poglavlje', 'poglavlja', 'poglavlja')}` }); }
      const ch = chapOf(t.pos), r4 = /\bu\s+(sljedećem|idućem|prethodnom|prošlom)\s+poglavlju\b/giu; while ((m = r4.exec(t.text))) { const nx = /^(sljed|iduć)/i.test(m[1]), i = h2.indexOf(ch); if (ch && ((nx && i === h2.length - 1) || (!nx && i === 0))) bad.push({ pos: t.pos + m.index, b: m[0], d: nx ? 'ovo je zadnje poglavlje' : 'ovo je prvo poglavlje' }); else ok++; }
    });
    return { bad, ok };
  }
  PRE.ref = { label: 'Upućivanja', n: c => refs(c).bad.length, fn: c => { const r = refs(c); return `<p class="muted">Mjesta u tekstu koja upućuju na tablicu, sliku ili poglavlje. Nakon premještanja dijelova rada brojevi često više ne odgovaraju.</p>` + (r.bad.map(x => row(x.pos, esc(x.b), esc(x.d))).join('') || '<p>Sva upućivanja vode na nešto što postoji.</p>') + (r.ok ? `<p class="muted">U redu: ${r.ok}.</p>` : ''); } };

  /* ================= 7. struktura naslova ================= */
  function struct(c) {
    const d = D(), out = [], hs = d.heads.filter(h => h.level > 1 && (!c.on || (h.pos >= c.a && h.pos < c.b)));
    hs.forEach(h => { const nm = `${h.num} ${h.title}`;
      if (h.level === 2) { const kids = d.heads.filter(x => x.level === 3 && x.pos > h.pos && x.pos < headEnd(h)); if (kids.length === 1) out.push({ pos: kids[0].pos, b: nm, d: 'ima samo jedno potpoglavlje; dijeli se na dva ili više, ili se ne dijeli' }); if (!h.words) out.push({ pos: h.pos, b: nm, d: 'poglavlje još nema teksta' }); if (/zaklju/i.test(h.title) && h.cites) out.push({ pos: h.pos, b: nm, d: `zaključak ima ${h.cites} ${plural(h.cites, 'navod', 'navoda', 'navoda')}; u zaključku se obično ne uvode novi izvori` }); }
      else if (!h.words) out.push({ pos: h.pos, b: nm, d: 'potpoglavlje još nema teksta' });
      if (h.title.length > 90) out.push({ pos: h.pos, b: nm, d: `naslov ima ${h.title.length} znakova; teško stane u sadržaj` }); if (/[.:]$/.test(h.title.trim())) out.push({ pos: h.pos, b: nm, d: 'naslov završava točkom ili dvotočkom' });
    });
    return out;
  }
  PRE.str = { label: 'Struktura naslova', n: c => struct(c).length, fn: c => { const l = struct(c); return `<p class="muted">Naslovi i raspored poglavlja, za pogledati.</p>` + (l.map(x => row(x.pos, esc(cut(x.b, 70)), esc(x.d))).join('') || '<p>U strukturi naslova nema ničega za pogledati.</p>'); } };

  /* ================= 8. sitnice ================= */
  const FIX = [
    ['sp2', 'Dvostruki razmak', / {2,}/g, () => ' '],
    ['spp', 'Razmak ispred interpunkcije', / +([,;:!?]|\.(?!\.))/g, m => m[1]],
    ['com', 'Zarez bez razmaka', /,(?=\p{L})/gu, () => ', '],
    ['quo', 'Ravni navodnici', /"([^"\n]{1,400})"/g, m => `„${m[1]}”`],
    ['dbl', 'Dvostruka interpunkcija', /([,;:])\1+|(?<!\.)\.\.(?!\.)/g, m => (m[1] || '.')]
  ];
  const fixes = (c, only) => { const [a, b] = scope(c), out = []; texts(a, b).forEach(t => { if (t.node.marks.some(k => k.type.name === 'paste' || k.type.name === 'imported')) return; FIX.forEach(([k, , re, rp]) => { if (only && only !== k) return; re.lastIndex = 0; let m; while ((m = re.exec(t.text))) { out.push({ k, from: t.pos + m.index, to: t.pos + m.index + m[0].length, rep: rp(m), marks: t.node.marks }); if (!m[0].length) re.lastIndex++; } }); }); return out; };
  PRE.fix = { label: 'Sitnice', n: c => fixes(c).length, fn: c => { const l = fixes(c), ro = c.ro; return `<p class="muted">Mehaničke sitnice koje ne mijenjaju sadržaj. Popravak je jedan korak koji možete poništiti (Ctrl+Z).</p>` + (l.length ? `${ro ? '' : `<div class="row" style="margin:8px 0"><button class="btn pri sm" data-act="r2Fix" data-k="">Popravi sve (${l.length})</button></div>`}` + FIX.map(([k, name]) => { const n = l.filter(x => x.k === k); return n.length ? `<div class="fx rph r2row"><button class="r2go" data-act="jump" data-pos="${n[0].from}"><b>${name}</b><span class="d">${n.length} ${plural(n.length, 'mjesto', 'mjesta', 'mjesta')}</span></button>${ro ? '' : `<button class="btn sm" data-act="r2Fix" data-k="${k}">Popravi</button>`}</div>` : ''; }).join('') : '<p>Nema sitnica za popraviti.</p>'); } };

  /* ================= 10. promjene po poglavljima ================= */
  function changes() {
    const snap = S.review && S.review.snapshot; if (!snap || !snap.length) return null; const old = new Set(snap), cur = new Set(), per = []; let h0 = null;
    ed().state.doc.forEach((n, off) => { const t = n.textBetween(0, n.content.size, ' ', X.leafText).trim(); if (!t) return; const key = (n.type.name === 'heading' ? '# ' : '') + t; cur.add(key); if (n.type.name === 'heading' && n.attrs.level === 2) { h0 = { t: t, pos: off, n: 0, w: 0, first: null }; per.push(h0); } if (!old.has(key) && h0 && n.type.name !== 'heading') { h0.n++; h0.w += X.wc(t); if (h0.first == null) h0.first = off; } });
    return { per, gone: snap.filter(k => !cur.has(k)).length, round: S.review.round };
  }
  PRE.chg = { label: 'Promjene od zadnjeg slanja', n: () => { const r = changes(); return r ? r.per.filter(x => x.n).length : 0; }, all: true, fn: () => { const r = changes(); if (!r) return '<p class="muted">Rad još nije slan mentoru, pa nema s čim usporediti. Nakon prvog slanja ovdje se vidi što je mijenjano.</p>'; const ch = r.per.filter(x => x.n); return `<p class="muted">Što je mijenjano otkad je rad zadnji put poslan mentoru (runda ${r.round}). Odlomak se broji ako je nov ili izmijenjen.</p>` + (ch.map(x => row(x.first, esc(cut(x.t, 60)), `${x.n} ${plural(x.n, 'odlomak', 'odlomka', 'odlomaka')} nov ili izmijenjen · ${fmt(x.w)} riječi u njima`)).join('') || '<p>Od zadnjeg slanja ništa nije mijenjano.</p>') + (r.gone ? `<p class="muted">Obrisano ili izmijenjeno starih odlomaka: ${r.gone}.</p>` : '') + `<div class="row" style="margin-top:8px"><button class="btn sm" data-act="diff">Usporedba teksta</button></div>`; } };

  /* brojači za alate iz tools.js (broje se iz onoga što prikazuju) */
  const cntOf = (k, re) => c => ((PRE[k].fn(c) || '').match(re) || []).length;
  if (PRE.dos) PRE.dos.n = cntOf('dos', /class="card"/g); if (PRE.pon) PRE.pon.n = cntOf('pon', /class="fx rph"/g);

  /* ================= 2. provjere po vrsti ================= */
  const KEYS = { claim: 'Tvrdnja bez izvora', long: 'Duga rečenica', colloq: 'Razgovorni izraz', absolute: 'Apsolutna tvrdnja', first: 'Prvo lice', passive: 'Pasiv u nizu', term: 'Pojam', abbr: 'Kratica', trans: 'Prijelaz', short: 'Kratak odlomak', hole: 'Rupa [?]' };
  const TOCM = { claim: ['Tvrdnja traži izvor. Odakle je ovaj podatak?', 'claim'], long: ['Rečenica je preduga; podijelite je na dvije.', 'sent'], colloq: ['Razgovorni izraz; zamijenite ga neutralnim.', ''], absolute: ['Preoštra tvrdnja; ublažite je ili potkrijepite.', ''], first: ['Upute traže treće lice.', ''], term: ['Pojam nije definiran ili se koristi pod drugim nazivom.', ''], abbr: ['Kratica nema puni naziv kod prve upotrebe.', ''], trans: ['Odlomak nije povezan s prethodnim.', ''], passive: ['Previše pasiva zaredom.', ''] };
  const hkey = h => h.key + '|' + h.t.slice(0, 40);
  const offH = h => S.hintOff[hkey(h)] || S.hintOff['kind:' + h.key];
  const hints = c => RP.hintsIn(c).filter(h => !offH(h));
  RP.preChk = c => {
    const allH = RP.hintsIn(c), l = allH.filter(h => !offH(h)), off = allH.filter(h => S.hintOff[hkey(h)] && !S.hintOff['kind:' + h.key]).length, t = T(), grp = {}; l.forEach(h => (grp[h.key] = grp[h.key] || []).push(h));
    const offKinds = Object.keys(KEYS).filter(k => S.hintOff['kind:' + k]);
    let h = `<p class="muted">${l.length ? `${l.length} ${plural(l.length, 'mjesto', 'mjesta', 'mjesta')} za pogledati${c.on ? ' u ovom poglavlju' : ''}. Ništa od ovoga ne blokira predaju.` : 'Nema napomena u tekstu.'}</p>`;
    h += Object.entries(grp).sort((x, y) => y[1].length - x[1].length).map(([k, list]) => `<details class="rpd" data-det="r2-${k}"${(U.det || {})['r2-' + k] ? ' open' : ''}><summary>${KEYS[k] || list[0].k} (${list.length})</summary>${list.slice(0, 40).map(x => row(x.pos, '', esc(cut(x.t, 110)), t ? (TOCM[k] && !S.submitted ? `<button class="btn sm" data-act="r2Cm" data-pos="${x.pos}" data-to="${x.to || ''}" data-k="${k}">U komentar</button>` : '') : c.ro ? '' : `<button class="lnk" data-act="r2Off" data-key="${esc(hkey(x))}">nije greška</button>`)).join('')}${list.length > 40 ? `<p class="muted">Prikazano prvih 40.</p>` : ''}${!t && !c.ro && k !== 'hole' ? `<button class="lnk rpmore" data-act="r2Kind" data-k="${k}">Ne javljaj ovu vrstu</button>` : ''}</details>`).join('');
    if (off || offKinds.length) h += `<p class="muted r2off">${off ? `Označeno kao „nije greška”: ${off}. <button class="lnk" data-act="r2OffClear">Vrati</button> ` : ''}${offKinds.length ? `Isključene vrste: ${offKinds.map(k => `<button class="lnk" data-act="r2Kind" data-k="${k}">${KEYS[k]}</button>`).join(', ')}.` : ''}</p>`;
    return h + (c.on ? `<button class="lnk rpmore" data-act="rpScope" data-v="all">Cijeli rad i provjere predaje</button>` : RP.fold(X.panels.upute(), 'rp-chk-', []));
  };

  /* ================= 1. početni zaslon ================= */
  RP.preHome = c => {
    const item = (k, label, n, note) => `<button class="r2tool" data-act="rpPre" data-v="${k}"><span class="s ${n ? 'warn' : n === 0 ? 'ok' : 'dot'}">${n ? '!' : n === 0 ? '✓' : ''}</span><span class="r2tl"><b>${label}</b>${note ? `<small>${note}</small>` : ''}</span><i>${n ? n : n === 0 ? 'u redu' : ''}</i></button>`;
    const tools = [['chk', 'Provjere u tekstu', hints(c).length, 'duge rečenice, tvrdnje bez izvora, razgovorni izrazi'], ...Object.entries(PRE).filter(([k]) => k !== 'sav' && k !== 'chg').map(([k, o]) => [k, o.label, o.n ? o.n(c) : null, o.note ? o.note(c) : ''])].sort((x, y) => (y[2] || 0) - (x[2] || 0));
    const ch = changes();
    return RP.scopeBar(c) + `<div class="ptitle">Ima posla</div>${tools.filter(x => x[2]).map(x => item(...x)).join('') || '<p class="muted">Alati ovdje nisu našli ništa za pogledati.</p>'}${tools.filter(x => !x[2]).length ? `<details class="rpd" data-det="r2-ok"${(U.det || {})['r2-ok'] ? ' open' : ''}><summary>U redu (${tools.filter(x => !x[2]).length})</summary>${tools.filter(x => !x[2]).map(x => item(...x)).join('')}</details>` : ''}` +
      `<div class="ptitle">Za čitanje</div>${item('ro', 'Nacrt', null, 'prva rečenica svakog odlomka, s brojem riječi i navoda')}${item('sav', 'Šavovi', null, 'kraj jednog i početak sljedećeg poglavlja')}${item('poj', 'Pojmovnik', null, 'pojmovi i kratice rada')}${item('chg', 'Promjene od zadnjeg slanja', ch ? ch.per.filter(x => x.n).length || 0 : null, ch ? '' : 'rad još nije slan mentoru')}` +
      `<div class="row" style="margin-top:12px"><button class="btn sm" data-act="r2Digest">Sažetak rada na jednoj stranici</button></div>`;
  };

  /* ================= 9. sažetak rada ================= */
  function digest() {
    const d = D(), h2 = d.heads.filter(h => h.level === 2), title = (d.heads.find(h => h.level === 1) || {}).title || 'Bez naslova', z = h2.find(h => /zaklju/i.test(h.title)), hy = [...new Set((ed().state.doc.textBetween(0, ed().state.doc.content.size, ' ').match(/\bH\d\b/g) || []))].sort();
    const zs = z ? paras(z.pos, headEnd(z)).slice(0, 1).map(p => sents(p.text).slice(0, 2).join(' ')).join('') : '', ch = changes(), oc = S.comments.filter(c => !c.resolved), turn = X.c2 ? X.c2.turn : () => null, rc = X.rules && X.rules.data ? X.rules.count() : null, pr = X.proofs ? X.proofs.all().length : 0, ST = X.fx.STAT;
    return { title, q: S.thesis || '', h2: h2.map(h => ({ t: `${h.num} ${h.title}`, w: h.words, c: h.cites, st: ST[S.statuses[h.hid] || 0] })), hy, zs, words: d.words, oc: oc.length, om: oc.filter(c => turn(c) === 'mentor').length, os: oc.filter(c => turn(c) === 'student').length, ch, rc, src: S.sources.length, cited: S.sources.filter(s => d.cited[s.id]).length, pr };
  }
  const digestText = () => { const g = digest(); return `${g.title}\n\nPitanje rada: ${g.q || 'nije upisano'}\nOpseg: ${fmt(g.words)} riječi (traži se ${fmt(TASK.min)} do ${fmt(TASK.max)})\n\nStruktura:\n${g.h2.map(h => `  ${h.t}: ${fmt(h.w)} riječi, ${h.c} navoda, ${h.st}`).join('\n')}\n\nHipoteze: ${g.hy.join(', ') || 'nisu označene'}\nZaključak počinje: ${g.zs || 'još nije napisan'}\n\nKomentari: otvoreno ${g.oc} (na mentoru ${g.om}, na studentu ${g.os})\nLiteratura: ${g.src} izvora, citirano ${g.cited}, potvrda ${g.pr}\n${g.ch ? 'Od zadnjeg slanja mijenjano: ' + (g.ch.per.filter(x => x.n).map(x => x.t).join('; ') || 'ništa') : 'Rad još nije slan mentoru.'}`; };
  X.hooks.dlg.r2digest = () => { const g = digest(), line = (a, b) => `<div class="fx"><span style="flex:1"><b>${a}</b><span class="d">${b}</span></span></div>`;
    return `<h3>Sažetak rada</h3><p class="r2dt">${esc(g.title)}</p>${line('Pitanje rada', g.q ? esc(g.q) : 'nije upisano')}${line('Opseg', `${fmt(g.words)} riječi · traži se ${fmt(TASK.min)} do ${fmt(TASK.max)}`)}
      <div class="ptitle">Struktura</div><div class="s2tab r2tab">${g.h2.map(h => `<div class="s2tr"><span><b>${esc(h.t)}</b></span><span>${esc(h.st)}</span><span>${fmt(h.w)}</span><span>${h.c}</span></div>`).join('')}<div class="s2tr s2th" style="position:static"><span>poglavlje</span><span>stanje</span><span>riječi</span><span>navodi</span></div></div>
      ${line('Hipoteze', g.hy.length ? g.hy.join(', ') : 'nisu označene u tekstu')}${line('Zaključak počinje', g.zs ? esc(cut(g.zs, 320)) : 'još nije napisan')}
      ${line('Komentari', `otvoreno ${g.oc} · na mentoru ${g.om} · na studentu ${g.os}`)}${g.rc ? line('Zahtjevi fakulteta', `${g.rc.todo} za riješiti · ${g.rc.ok} u redu`) : ''}${line('Literatura', `${g.src} ${plural(g.src, 'izvor', 'izvora', 'izvora')} · citirano ${g.cited} · priloženih potvrda ${g.pr}`)}
      ${line('Od zadnjeg slanja mentoru', g.ch ? (g.ch.per.filter(x => x.n).map(x => esc(cut(x.t, 40)) + ' (' + x.n + ')').join(' · ') || 'ništa nije mijenjano') : 'rad još nije slan')}
      <p class="muted">Sažetak se slaže iz rada onakav kakav je sada. Student i mentor vide isti.</p><div class="foot"><button class="btn" data-act="r2DigestCopy" style="margin-right:auto">Kopiraj</button><button class="btn pri" data-act="dlgClose">Zatvori</button></div>`; };

  Object.assign(ACT, {
    r2Fix: el => { let n = 0; for (let pass = 0; pass < 4; pass++) { const l = fixes(RP.ctx(), el.dataset.k || null).sort((a, b) => b.from - a.from); if (!l.length) break; let tr = ed().state.tr, last = Infinity; l.forEach(x => { if (x.to > last) return; tr = x.rep ? tr.replaceWith(x.from, x.to, ed().schema.text(x.rep, x.marks)) : tr.delete(x.from, x.to); last = x.from; n++; }); ed().view.dispatch(tr); } X.renderPanel(true); if (n) toast(`Popravljeno: ${n}. Poništavanje: Ctrl+Z.`); },
    r2Off: el => { S.hintOff[el.dataset.key] = true; persist(); X.renderPanel(true); },
    r2OffClear: () => { Object.keys(S.hintOff).forEach(k => { if (!/^kind:/.test(k)) delete S.hintOff[k]; }); persist(); X.renderPanel(true); },
    r2Kind: el => { const k = el.dataset.k, on = !S.hintOff['kind:' + k]; if (on) S.hintOff['kind:' + k] = true; else delete S.hintOff['kind:' + k]; if (S.warn && k in S.warn && on && S.warn[k]) { S.warn[k] = false; S.level = 'vlastito'; } X.refresh(); persist(); X.renderAll(true); toast(on ? 'Ova vrsta se više ne javlja. Vratiti je možete na dnu popisa.' : 'Vrsta je ponovno uključena u popis.'); },
    r2Cm: el => { const pos = +el.dataset.pos, k = el.dataset.k, doc = ed().state.doc, $p = doc.resolve(pos), end = $p.end($p.depth), to = Math.min(end, +el.dataset.to || pos + 80); if (to <= pos) return; const tm = TOCM[k]; S.cmSeq = (S.cmSeq || 0) + 1; S.comments.push({ id: X.uid('c'), n: S.cmSeq, from: pos, to, quote: doc.textBetween(pos, to, ' ', X.leafText), text: tm[0], rule: tm[1], sugg: null, role: 'teacher', who: 'Nastavnik A', when: X.now(), resolved: false, replies: [], kind: 'must' }); U.active = S.comments[S.comments.length - 1].id; X.refresh(); persist(); X.renderPanel(true); toast('Napomena je pretvorena u komentar. Tekst možete urediti u Komentarima.'); },
    r2Digest: () => X.openDlg({ type: 'r2digest' }),
    r2DigestCopy: () => { try { navigator.clipboard.writeText(digestText()).then(() => toast('Kopirano.')); } catch (e) { toast('Kopiranje nije uspjelo.'); } }
  });
})();
