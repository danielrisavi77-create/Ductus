/* Ductura Editor, prototip: Izvori, drugi krug (v0.11).
 * Student: dohvat izvora iz DOI-ja, ISBN-a ili naslova (i crtični kod), sekundarni navod "cit. prema", slika literature,
 *   izvori planirani po poglavlju, mrežni izvori (datum pristupa, provjera poveznice), necitirani izvori, bilješka iz potvrde.
 * Nastavnik: zatraži potvrdu uz navod, pregled literature na jednoj stranici, obvezna literatura kolegija, preporuka izvora.
 * Bez AI-ja. Dohvat iz kataloga i provjera poveznica u proizvodu idu preko poslužitelja; ovdje se pokušavaju izravno iz preglednika.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, TASK, esc, plural, $, persist, toast } = X, RP = X.rp, { ask } = X.fx, ed = () => X.editor, D = () => X.D;
  X.hooks.defaults.push(s => { const def = (k, v) => { if (s[k] == null) s[k] = v; }; def('srcPlan', {}); def('srcKeep', {}); def('proofReq', []); def('recs', []); def('litSeen', null);
    def('courseLit', [{ id: 'ob1', raw: 'Autor D, Ana (2015) Priručnik za pisanje akademskih radova. Zagreb: Nakladnik A', demo: true }, { id: 'ob2', raw: 'Autor E, Ivo (2019) Uvod u metode istraživanja. Zagreb: Nakladnik B', demo: true }]); });
  const T = () => S.mode === 'teacher', ro = () => T() || !!S.submitted, rer = () => { persist(); X.renderAll(true); };
  const det = (key, title, body, open) => `<details class="rpd" data-det="${key}"${(U.det || {})[key] ?? open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  const lab = s => `${esc(s.authors)} (${X.yearLabel(s)})`;
  const today = () => X.now().split(',')[0];
  /* "Prezime, Ime; Prezime, Ime (godina) Naslov. Mjesto: Nakladnik" */
  function parseRef(raw) { const m = raw.trim().match(/^(.+?)\s*\((\d{4})[a-z]?\)\.?\s*(.+?)(?:\.\s+(.*))?$/); if (!m) return null; const people = m[1].split(/\s*;\s*|\s+i\s+(?=\p{Lu})/u).map(p => { const [l, f] = p.split(/\s*,\s*/); return { l: (l || '').trim(), f: (f || '').trim() }; }); return { people, year: m[2], title: m[3].replace(/\.$/, ''), pub: (m[4] || '').replace(/\.$/, '') }; }
  const same = (s, r) => r && s.year === r.year && s.title.toLowerCase().slice(0, 30) === r.title.toLowerCase().slice(0, 30);
  function addRef(raw, extra) { const r = parseRef(raw); if (!r) return null; const have = S.sources.find(s => same(s, r)); if (have) return have; const s = X.mkSource(/:\s*\S/.test(r.pub) ? 'knjiga' : 'članak', r.people, r.year, r.title, r.pub ? '. ' + r.pub + '.' : ''); Object.assign(s, extra || {}); S.sources.push(s); return s; }

  X.s2 = { parseRef, addRef };
  /* ================= 1. DOI, ISBN, naslov, crtični kod ================= */
  const getJson = async (url, ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 7000); try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('http'); return await r.json(); } finally { clearTimeout(t); } };
  const fromCrossref = w => { const au = (w.author || []).map(a => ({ l: a.family || a.name || '', f: a.given || '' })).filter(a => a.l), y = ((w.issued || {})['date-parts'] || [[]])[0][0] || '', book = /book|monograph/.test(w.type || '') && !/chapter/.test(w.type || ''), ct = (w['container-title'] || [])[0]; return { kind: book ? 'knjiga' : /chapter/.test(w.type || '') ? 'poglavlje u knjizi' : 'članak', people: au, year: String(y), title: (w.title || [''])[0], pub: book ? [w['publisher-location'], w.publisher].filter(Boolean).join(': ') : [ct, w.volume ? w.volume + (w.issue ? '(' + w.issue + ')' : '') : '', w.page].filter(Boolean).join(', ') + (w.DOI ? '. https://doi.org/' + w.DOI : '') }; };
  async function lookup(q) {
    q = q.trim(); const isbn = q.replace(/[-\s]/g, ''), doi = (q.match(/10\.\d{4,9}\/\S+/) || [])[0];
    if (doi) return [fromCrossref((await getJson('https://api.crossref.org/works/' + encodeURIComponent(doi))).message)];
    if (/^(97[89])?\d{9}[\dXx]$/.test(isbn)) { const j = (await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`))['ISBN:' + isbn]; if (!j) return []; return [{ kind: 'knjiga', people: (j.authors || []).map(a => { const p = a.name.trim().split(/\s+/); return { l: p.pop(), f: p.join(' ') }; }), year: ((j.publish_date || '').match(/\d{4}/) || [''])[0], title: j.title + (j.subtitle ? ': ' + j.subtitle : ''), pub: [((j.publish_places || [])[0] || {}).name, ((j.publishers || [])[0] || {}).name].filter(Boolean).join(': ') }]; }
    return ((await getJson('https://api.crossref.org/works?rows=5&query.bibliographic=' + encodeURIComponent(q))).message.items || []).map(fromCrossref);
  }
  const fill = (d, r) => { const sh = r.people.length === 1 ? r.people[0].l : r.people.length === 2 ? `${r.people[0].l} i ${r.people[1].l}` : r.people.length ? `${r.people[0].l} i dr.` : ''; Object.assign(d, { kind: r.kind, authors: sh, full: r.people.map(a => a.l + (a.f ? ', ' + a.f : '')).join('; '), year: r.year, title: r.title, pub: r.pub }); };
  const quick0 = X.hooks.dlg.quick;
  X.hooks.dlg.quick = d => {
    const extra = `<div class="row s2look"><button class="btn sm" data-act="s2Look">${U.s2Busy ? 'Tražim…' : 'Dohvati podatke'}</button><button class="btn sm" data-act="s2Scan">Skeniraj crtični kod</button></div>${U.s2Msg ? `<p class="pfmsg">${esc(U.s2Msg)}</p>` : ''}${(U.s2Hits || []).length > 1 ? `<div class="s2hits">${U.s2Hits.map((r, i) => `<button class="rcl" data-act="s2Pick" data-i="${i}"><b>${esc(r.title)}</b><span>${esc(r.people.map(a => a.l).join(', '))} · ${esc(r.year)}</span></button>`).join('')}</div>` : ''}`;
    return quick0(d).replace('U aplikaciji se podaci upisuju sami iz DOI-ja ili ISBN-a. U prototipu ih upišite ručno.', 'Upišite DOI, ISBN ili naslov i odaberite Dohvati podatke. Ako katalog ne odgovori, podatke upišite ručno.').replace('DOI, ISBN ili poveznica</label>', 'DOI, ISBN ili naslov</label>').replace(/(<input class="in" data-bind="dlg\.ident"[^>]*>)/, '$1' + extra);
  };
  const scanIn = document.createElement('input'); scanIn.type = 'file'; scanIn.accept = 'image/*'; scanIn.setAttribute('capture', 'environment'); scanIn.hidden = true; document.body.appendChild(scanIn);
  scanIn.addEventListener('change', async () => { const f = scanIn.files && scanIn.files[0]; scanIn.value = ''; if (!f || !U.dlg) return; try { const bmp = await createImageBitmap(f), hit = (await new window.BarcodeDetector({ formats: ['ean_13'] }).detect(bmp))[0]; if (!hit) { U.s2Msg = 'Na slici nije pronađen crtični kod. Slikajte poleđinu knjige izbliza.'; return X.renderDlg(); } U.dlg.ident = hit.rawValue; U.s2Msg = ''; X.renderDlg(); ACT.s2Look(); } catch (e) { U.s2Msg = 'Crtični kod se ne može pročitati. Upišite ISBN ručno.'; X.renderDlg(); } });

  /* ================= 2. sekundarni navod i 8. zatraži potvrdu (prozorčić navoda) ================= */
  const reqKey = (src, page) => src + '|' + String(page || '').trim();
  const openReq = id => (id ? S.proofReq.find(r => !r.done && r.id === id) : null);
  const reqPos = id => { let p = null; ed().state.doc.descendants((n, pos) => { if (p == null && n.type.name === 'citation' && n.attrs.rq === id) p = pos; }); return p; };
  X.hooks.click.push(e => {
    const c = e.target.closest && e.target.closest('#ed .cite'); if (!c) return false;
    setTimeout(() => {
      const pad = $('#pop .pad'); if (!pad || pad.querySelector('.s2pop')) return;
      let pos = ed().view.posAtDOM(c, 0); if ((ed().state.doc.nodeAt(pos) || {}).type?.name !== 'citation') pos -= 1; const n = ed().state.doc.nodeAt(pos); if (!n || n.type.name !== 'citation') return;
      const src = n.attrs.sourceId, page = n.attrs.page || '', rq = openReq(n.attrs.rq), has = X.proofs && X.proofs.forCite(src, page).length;
      let h = '<div class="s2pop">';
      if (!ro()) h += `<label class="f">Citirano prema (ako izvornik niste čitali)</label><div class="row"><input class="in" id="citeVia" style="flex:1" value="${esc(n.attrs.via || '')}" placeholder="npr. Bell, 1973"><button class="btn sm" data-act="s2Via" data-pos="${pos}">Spremi</button></div><p class="muted" style="margin:4px 0 0">U tekstu: (Bell, 1973, cit. prema ${esc(X.citeInner(src, page) || 'izvor')}). U popis literature ide samo izvor koji ste čitali.</p>`;
      else if (n.attrs.via) h += `<p class="muted">Sekundarni navod: izvornik je ${esc(n.attrs.via)}.</p>`;
      if (rq) h += `<p class="s2req"><b>Mentor traži potvrdu</b> za ovaj navod (${esc(rq.when)}).${T() ? ` <button class="lnk" data-act="s2ReqDel" data-id="${rq.id}">Povuci zahtjev</button>` : ''}</p>`;
      else if (T() && !S.submitted) h += `<div class="row" style="margin-top:8px"><button class="btn sm" data-act="s2Req" data-src="${esc(src)}" data-page="${esc(page)}" data-pos="${pos}">${has ? 'Zatraži još jednu potvrdu' : 'Zatraži potvrdu'}</button></div>`;
      pad.insertAdjacentHTML('beforeend', h + '</div>');
    }, 0);
    return false;
  });
  X.hooks.paint.push(() => { if (S.proofReq.some(r => !r.done) && settle()) persist(); document.querySelectorAll('#ed .cite').forEach(el => { const on = !!openReq(el.dataset.rq); if (el.classList.contains('need-proof') !== on) el.classList.toggle('need-proof', on); }); });
  /* kad stigne potvrda, zahtjev se zatvara */
  function settle() { let ch = false; S.proofReq.forEach(r => { if (r.done) return; const [src, page] = r.key.split('|'), l = S.proofs[src] || []; if (l.length > (r.n || 0) && l.slice(r.n || 0).some(p => !page || !String(p.page || '').trim() || String(p.page).trim() === page)) { r.done = X.now(); ch = true; if (S.review && S.review.log) S.review.log.push({ who: 'Student A', what: 'Priložena potvrda na zahtjev mentora', when: r.done }); } }); return ch; }

  /* ================= vrh Izvora ================= */
  const EN = /\b(the|of|and|in|for|from|with|on|to|an?)\b/i;
  const srcParts = c => {
    const d = c.d, t = T(); if (settle()) persist(); let html = t && !S.submitted ? '<div class="row s2bar"><button class="btn sm" data-act="s2Rec">+ Preporuči izvor</button><button class="btn sm" data-act="s2LitView">Pregled literature</button></div>' : '', more = t ? '' : '<div class="row s2bar"><button class="btn sm" data-act="s2LitView">Pregled literature</button></div>';
    /* 8. zatražene potvrde */
    const rq = S.proofReq.filter(r => !r.done), dn = S.proofReq.filter(r => r.done);
    if (rq.length || (t && dn.length)) html += `<div class="card rpnote"><b>${t ? 'Zatražene potvrde' : 'Mentor traži potvrdu'}</b><p>${rq.length ? `${rq.length} ${plural(rq.length, 'navod čeka', 'navoda čekaju', 'navoda čeka')} potvrdu` : 'Sve zatražene potvrde su priložene'}${dn.length ? ` · priloženo ${dn.length}` : ''}.</p>${rq.map(r => { const [src, page] = r.key.split('|'), s = X.srcById(src); return `<div class="fx rph"><span style="flex:1"><b>${s ? lab(s) : 'izvor'}${page ? ', str. ' + esc(page) : ''}</b><span class="d">zatraženo ${esc(r.when)}</span></span><button class="btn sm" data-act="s2ReqGo" data-id="${r.id}">Pokaži</button>${t ? '' : `<button class="btn sm" data-act="proofImg" data-src="${esc(src)}" data-page="${esc(page)}" data-quote="">Priloži</button>`}</div>`; }).join('')}</div>`;
    /* 11. preporuke mentora */
    const rc = S.recs.filter(r => r.st === 'new' || t);
    if (rc.length) html += det('rp-recs', `${t ? 'Preporučeni izvori' : 'Preporučio mentor'} (${rc.length})`, rc.map(r => `<div class="fx rph"><span style="flex:1"><b>${esc(r.raw)}</b><span class="d">${r.note ? esc(r.note) + ' · ' : ''}${esc(r.when)}${r.st === 'added' ? ' · student dodao u literaturu' : r.st === 'no' ? ' · student odbacio' : ''}</span></span>${t ? `<button class="lnk" data-act="s2RecDel" data-id="${r.id}">Ukloni</button>` : `<button class="btn sm" data-act="s2RecAdd" data-id="${r.id}">Dodaj</button><button class="lnk" data-act="s2RecNo" data-id="${r.id}">Odbaci</button>`}</div>`).join(''), true);
    /* 10. obvezna literatura kolegija */
    if (S.courseLit.length || t) more += det('rp-oblig', `Obvezna literatura kolegija (${S.courseLit.length})`, S.courseLit.map(o => { const r = parseRef(o.raw), s = S.sources.find(x => same(x, r)), n = s ? d.cited[s.id] || 0 : 0; return `<div class="fx rph"><span style="flex:1"><b>${esc(o.raw)}</b><span class="d">${s ? (n ? `u literaturi · citirano ${n}×` : 'u literaturi · još nije citirano') : 'nije u literaturi'}${o.demo ? ' · primjer' : ''}</span></span>${t ? `<button class="lnk" data-act="s2ObDel" data-id="${o.id}">Ukloni</button>` : s ? '' : `<button class="btn sm" data-act="s2ObAdd" data-id="${o.id}">Dodaj</button>`}</div>`; }).join('') + (t && !S.submitted ? '<button class="btn sm" data-act="s2ObNew" style="margin-top:6px">+ Obvezni izvor</button>' : '') + (S.courseLit.length ? '' : '<p class="muted">Nastavnik nije unio obveznu literaturu.</p>'), false);
    /* 4. planirano za ovo poglavlje */
    if (c.on) { const pl = S.sources.filter(s => (S.srcPlan[s.id] || []).includes(c.ch.hid) && !(d.citePos[s.id] || []).some(c.inCh)); if (pl.length) html += `<div class="ptitle">Planirano za ovo poglavlje, još nije citirano (${pl.length})</div>` + pl.map(s => RP.srcRow(s, c.ro, null)).join(''); }
    /* 3. slika literature */
    const all = S.sources, yr = new Date().getFullYear(), cnt = k => all.filter(s => s.kind === k).length, kinds = [...new Set(all.map(s => s.kind))].map(k => `${k} ${cnt(k)}`).join(' · '), old = all.filter(s => +s.year && +s.year < yr - 10).length, fr = all.filter(s => EN.test(s.title)).length, ci = all.filter(s => d.cited[s.id]), bk = ci.filter(s => s.kind === 'knjiga').length;
    const line = (ok, tt, dd) => `<div class="fx rph"><span class="s ${ok == null ? 'dot' : ok ? 'ok' : 'warn'}">${ok == null ? '' : ok ? '✓' : '!'}</span><span><b>${tt}</b><span class="d">${dd}</span></span></div>`;
    more += det('rp-pic', 'Slika literature', line(null, `${all.length} ${plural(all.length, 'izvor', 'izvora', 'izvora')} u popisu`, kinds || 'još nema izvora') + (TASK.minRefs ? line(ci.length >= TASK.minRefs, `Citirano ${ci.length}`, `fakultet traži najmanje ${TASK.minRefs}`) : '') + (TASK.minBooks ? line(bk >= TASK.minBooks, `Citiranih knjiga ${bk}`, `fakultet traži najmanje ${TASK.minBooks}`) : '') + line(null, `Starije od deset godina: ${old}`, 'nije greška; provjerite ima li novijih radova o temi') + line(null, `Na stranom jeziku: ${fr}`, 'procjena prema naslovu'), false);
    /* 5. mrežni izvori i 6. necitirani */
    const web = all.filter(s => s.kind === 'mrežni izvor' || /https?:\/\//.test(s.tail || '')).filter(s => s.kind === 'mrežni izvor' || !/doi\.org/.test(s.tail));
    if (web.length) more += det('rp-web', `Mrežni izvori (${web.length})`, web.map(s => { const url = ((s.tail || '').match(/https?:\/\/[^\s)]+/) || [''])[0].replace(/[.,]$/, ''), st = (U.s2Link || {})[s.id]; return `<div class="fx rph"><span style="flex:1"><b>${lab(s)}</b><span class="d">${url ? esc(url.slice(0, 48)) : 'nema adrese'} · pristup ${esc(s.accessed || 'nije upisan')}${st ? ' · ' + st : ''}</span></span>${c.ro || s.accessed ? '' : `<button class="btn sm" data-act="s2Acc" data-id="${esc(s.id)}">Danas</button>`}</div>`; }).join('') + `<div class="row" style="margin-top:6px"><button class="btn sm" data-act="s2Links">${U.s2LinkBusy ? 'Provjeravam…' : 'Provjeri poveznice'}</button></div><p class="muted">Iz preglednika se vidi samo javlja li se adresa. Pouzdana provjera ide preko poslužitelja.</p>`, false);
    const un = all.filter(s => !d.cited[s.id]), und = un.filter(s => !S.srcKeep[s.id]);
    if (!c.on && und.length && !t) more += `<div class="card rpnote"><b>${und.length} ${plural(und.length, 'izvor nije citiran', 'izvora nisu citirana', 'izvora nije citirano')}</b><p>Prije predaje odlučite: uklonite ga iz popisa ili ga ostavite kao konzultiranu literaturu, ako fakultet to dopušta. Otvorite izvor pod „Nije citirano”.</p></div>`;
    return { top: html, more };
  };
  RP.HK.srcTop.push(c => srcParts(c).top); RP.HK.srcMore.push(c => srcParts(c).more);

  /* ================= otvoren izvor ================= */
  RP.HK.srcOpenMore.push((s, r0) => {
    const c = RP.ctx(), d = D(), pl = S.srcPlan[s.id] || [], heads = d.heads.filter(h => h.level === 2 && pl.includes(h.hid)); let h = '';
    if (s.rec) h += `<div class="meta"><span class="tag">preporučio mentor</span></div>`;
    h += `<div class="s2plan"><div class="rpsub">Planirano za poglavlja</div><div class="rptools">${heads.map(x => `<button class="chip" data-act="s2Plan" data-id="${esc(s.id)}" data-hid="${x.hid}" aria-pressed="true"${r0 ? ' disabled' : ''} title="Makni">${esc(x.num.replace(/\.$/, ''))}. ×</button>`).join('')}${!r0 && c.ch && !pl.includes(c.ch.hid) ? `<button class="chip" data-act="s2Plan" data-id="${esc(s.id)}" data-hid="${c.ch.hid}">+ ${esc(c.ch.num.replace(/\.$/, ''))}. poglavlje</button>` : ''}${!heads.length && (r0 || !c.ch) ? '<span class="muted">nije planirano</span>' : ''}</div></div>`;
    if (!d.cited[s.id] && !r0) h += `<label class="check s2keep"><input type="checkbox" data-s2keep="${esc(s.id)}"${S.srcKeep[s.id] ? ' checked' : ''}><span>Nije citiran: ostavi u popisu kao konzultiranu literaturu</span></label>`;
    return h;
  });
  const bib0 = X.render.bib;
  X.render.bib = function () { bib0(); const k = S.sources.filter(s => S.srcKeep[s.id] && !D().cited[s.id]); if (k.length) { const b = $('#bib'), n = b.querySelector('.note'); const html = `<h2 class="s2kons">Konzultirana literatura</h2>` + k.sort((a, b2) => a.full.localeCompare(b2.full, 'hr')).map(s => `<p>${X.bibEntry(s)}</p>`).join(''); if (n) n.insertAdjacentHTML('beforebegin', html); else b.insertAdjacentHTML('beforeend', html); } };

  /* ================= 9. pregled literature ================= */
  X.hooks.dlg.litview = () => {
    const d = D(), t = T(), seen = S.litSeen, list = [...S.sources].sort((a, b) => a.full.localeCompare(b.full, 'hr')), isNew = s => seen && !seen.ids.includes(s.id), nNew = list.filter(isNew).length, pr = s => (S.proofs[s.id] || []).length;
    return `<h3>Pregled literature</h3><p class="muted">${list.length} ${plural(list.length, 'izvor', 'izvora', 'izvora')} · citirano ${list.filter(s => d.cited[s.id]).length} · s potvrdom ${list.filter(pr).length}${seen ? ` · novo od pregleda ${esc(seen.when)}: ${nNew}` : ' · mentor još nije označio pregled'}</p>
      <div class="s2tab"><div class="s2tr s2th"><span>Izvor</span><span>Vrsta</span><span>Navoda</span><span>Potvrde</span></div>${list.map(s => `<button class="s2tr" data-act="s2Open" data-id="${esc(s.id)}"><span><b>${lab(s)}</b>${isNew(s) ? ' <i class="tag">novo</i>' : ''}${s.rec ? ' <i class="tag">preporuka</i>' : ''}<small>${esc(s.title)}</small></span><span>${esc(s.kind)}</span><span>${d.cited[s.id] || (S.srcKeep[s.id] ? 'konz.' : '0')}</span><span>${pr(s) || ''}</span></button>`).join('') || '<p class="muted">Još nema izvora.</p>'}</div>
      <div class="foot">${t ? `<button class="btn" data-act="s2Seen" style="margin-right:auto">Označi literaturu pregledanom</button>` : ''}<button class="btn pri" data-act="dlgClose">Zatvori</button></div>`;
  };

  /* ================= 7. bilješka iz potvrde (dopuna dijaloga potvrde) ================= */
  if (X.hooks.dlg.proof) { const p0 = X.hooks.dlg.proof; X.hooks.dlg.proof = () => p0().replace('<div class="foot">', `<label class="f">Citat za bilješku iz čitanja (nije obvezno)</label><textarea class="ta" id="pfCite" rows="2" placeholder="Prepišite rečenicu iz isječka; kasnije je povučete u tekst s navodom i stranicom">${esc((U.pf || {}).quote || '')}</textarea><div class="foot">`); const save0 = ACT.pfSave; ACT.pfSave = () => { const p = U.pf, t = (($('#pfCite') || {}).value || '').trim(), page = (($('#pfPage') || {}).value || '').trim(); if (p && t) (S.rnotes[p.src] = S.rnotes[p.src] || []).push({ id: X.uid('n'), page, text: t }); save0(); }; }

  Object.assign(ACT, {
    s2Look: async () => { const d = U.dlg; if (!d || !(d.ident || '').trim()) { U.s2Msg = 'Upišite DOI, ISBN ili naslov.'; return X.renderDlg(); } U.s2Busy = true; U.s2Msg = ''; U.s2Hits = null; X.renderDlg(); try { const hits = await lookup(d.ident); if (U.dlg !== d) return; if (!hits.length) U.s2Msg = 'Katalog nema taj zapis. Upišite podatke ručno.'; else if (hits.length === 1) { fill(d, hits[0]); U.s2Msg = 'Podaci su dohvaćeni. Provjerite ih prije spremanja.'; } else { U.s2Hits = hits; U.s2Msg = 'Odaberite pravi zapis.'; } } catch (e) { U.s2Msg = 'Katalog se ne može dohvatiti iz ovog prikaza. Upišite podatke ručno; u Ducturi dohvat ide preko poslužitelja.'; } U.s2Busy = false; if (U.dlg === d) X.renderDlg(); },
    s2Pick: el => { fill(U.dlg, U.s2Hits[+el.dataset.i]); U.s2Hits = null; U.s2Msg = 'Podaci su upisani. Provjerite ih prije spremanja.'; X.renderDlg(); },
    s2Scan: () => { if (!('BarcodeDetector' in window)) { U.s2Msg = 'Ovaj preglednik ne čita crtične kodove. Upišite ISBN s poleđine knjige.'; return X.renderDlg(); } scanIn.click(); },
    s2Via: el => { const pos = +el.dataset.pos, n = ed().state.doc.nodeAt(pos); if (n) ed().view.dispatch(ed().state.tr.setNodeMarkup(pos, null, Object.assign({}, n.attrs, { via: $('#citeVia').value.trim() }))); X.closePop(); },
    s2ReqGo: el => { const p = reqPos(el.dataset.id); if (p != null) X.jump(p, false); else toast('Navod je u međuvremenu uklonjen iz teksta.'); },
    s2Req: el => { X.closePop(); const key = reqKey(el.dataset.src, el.dataset.page), id = X.uid('rq'), pos = +el.dataset.pos, n = ed().state.doc.nodeAt(pos); if (!n) return; ed().view.dispatch(ed().state.tr.setNodeMarkup(pos, null, Object.assign({}, n.attrs, { rq: id }))); S.proofReq.push({ id, key, when: today(), n: (S.proofs[el.dataset.src] || []).length, done: null }); if (S.review && S.review.log) S.review.log.push({ who: 'Nastavnik A', what: 'Zatražena potvrda uz navod', when: X.now() }); rer(); toast('Student će zahtjev vidjeti u Izvorima i uz navod.'); },
    s2ReqDel: el => { X.closePop(); S.proofReq = S.proofReq.filter(r => r.id !== el.dataset.id); rer(); },
    s2LitView: () => X.openDlg({ type: 'litview' }),
    s2Open: el => { X.closeDlg(); U.srcOpen = el.dataset.id; U.litQ = ''; RP.cfg().scope = 'all'; X.showTab('lit'); setTimeout(() => { const r = $('#pbody .rps.on'); if (r) r.scrollIntoView({ block: 'start' }); }, 60); },
    s2Seen: () => { S.litSeen = { when: today(), ids: S.sources.map(s => s.id) }; persist(); X.renderDlg(); toast('Zapisano. Izvori dodani nakon ovoga bit će označeni kao novi.'); },
    s2Rec: () => { const c = RP.ctx(); ask({ title: 'Preporuči izvor', label: 'Prezime, Ime (godina) Naslov. Mjesto: Nakladnik', desc: c.ch ? `Preporuka se veže uz poglavlje ${c.ch.num} ${c.ch.title}.` : '', ok: 'Pošalji studentu' }, v => { if (!parseRef(v)) return toast('Upišite barem autora, godinu u zagradi i naslov.'); S.recs.unshift({ id: X.uid('rc'), raw: v.trim(), note: c.ch ? 'za poglavlje ' + c.ch.num.replace(/\.$/, '') + '.' : '', hid: c.ch ? c.ch.hid : null, when: today(), st: 'new' }); rer(); }); },
    s2RecAdd: el => { const r = S.recs.find(x => x.id === el.dataset.id), s = addRef(r.raw, { rec: true }); if (!s) return; r.st = 'added'; if (r.hid) (S.srcPlan[s.id] = S.srcPlan[s.id] || []).push(r.hid); rer(); toast('Izvor je dodan u literaturu' + (r.hid ? ' i planiran za poglavlje.' : '.')); },
    s2RecNo: el => { S.recs.find(x => x.id === el.dataset.id).st = 'no'; rer(); },
    s2RecDel: el => { S.recs = S.recs.filter(x => x.id !== el.dataset.id); rer(); },
    s2ObAdd: el => { const o = S.courseLit.find(x => x.id === el.dataset.id); if (addRef(o.raw, { oblig: true })) { rer(); toast('Dodano u literaturu.'); } },
    s2ObNew: () => ask({ title: 'Obvezni izvor kolegija', label: 'Prezime, Ime (godina) Naslov. Mjesto: Nakladnik', ok: 'Dodaj' }, v => { if (!parseRef(v)) return toast('Upišite barem autora, godinu u zagradi i naslov.'); S.courseLit.push({ id: X.uid('ob'), raw: v.trim() }); (U.det = U.det || {})['rp-oblig'] = true; rer(); }),
    s2ObDel: el => { S.courseLit = S.courseLit.filter(x => x.id !== el.dataset.id); rer(); },
    s2Plan: el => { const id = el.dataset.id, hid = el.dataset.hid, a = S.srcPlan[id] = S.srcPlan[id] || [], i = a.indexOf(hid); if (i >= 0) a.splice(i, 1); else a.push(hid); persist(); X.renderPanel(true); },
    s2Acc: el => { const s = X.srcById(el.dataset.id); if (s) { s.accessed = today(); rer(); } },
    s2Links: async () => { U.s2LinkBusy = true; U.s2Link = {}; X.renderPanel(true); await Promise.all(S.sources.map(async s => { const url = ((s.tail || '').match(/https?:\/\/[^\s)]+/) || [''])[0].replace(/[.,]$/, ''); if (!url) return; const c = new AbortController(), t = setTimeout(() => c.abort(), 6000); try { await fetch(url, { mode: 'no-cors', signal: c.signal }); U.s2Link[s.id] = 'adresa se javlja'; } catch (e) { U.s2Link[s.id] = 'ne može se provjeriti odavde'; } clearTimeout(t); })); U.s2LinkBusy = false; X.renderPanel(true); }
  });
  document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.s2keep) { S.srcKeep[t.dataset.s2keep] = t.checked; rer(); } });
  /* 6. u Probi predaje */
  if (X.hooks.dlg.proba) { const pb0 = X.hooks.dlg.proba; X.hooks.dlg.proba = () => { const d = D(), un = S.sources.filter(s => !d.cited[s.id] && !S.srcKeep[s.id]).length, rq = S.proofReq.filter(r => !r.done).length, row = (ok, t, dd) => `<div class="fx"><span class="s ${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'}</span><span style="flex:1"><b>${t}</b><span class="d">${dd}</span></span><button class="btn sm" data-act="s2Go">Otvori</button></div>`; return pb0().replace('<div class="ptitle">Za pogledati', row(!un, 'Necitirani izvori', un ? `${un} u popisu bez navoda: uklonite ih ili označite kao konzultiranu literaturu` : 'nema') + row(!rq, 'Potvrde koje traži mentor', rq ? `${rq} još nije priloženo` : 'sve priloženo ili nije traženo') + '<div class="ptitle">Za pogledati'); }; ACT.s2Go = () => { X.closeDlg(); RP.cfg().scope = 'all'; X.showTab('lit'); }; }
})();
