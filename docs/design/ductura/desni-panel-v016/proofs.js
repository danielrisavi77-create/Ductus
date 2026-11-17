/* Ductura Editor, prototip: potvrde iz izvora (v0.10).
 * Student uz izvor ili navod prilaže isječak izvora: slika mobitelom, zalijepljena slika ili screenshot, ili izrez iz PDF-a.
 * PDF se obrađuje samo u pregledniku i nikamo se ne šalje; sprema se samo izrezani isječak (smanjena JPEG slika).
 * Za doslovni navod isječak se u PDF-u nalazi sam (tekstni sloj stranice); inače student povuče okvir.
 * Naziv je "priložena potvrda": Ductura ne tvrdi da izvor kaže ono što student piše. To prosuđuje mentor.
 */
(function () {
  'use strict';
  const X = window.DU, { S, U, ACT, esc, plural, $, persist, toast } = X, RP = X.rp, ed = () => X.editor;
  X.hooks.defaults.push(s => { if (s.proofs == null) s.proofs = {}; });

  /* slike se čuvaju izvan stanja rada (IndexedDB), da ne napune pohranu teksta */
  const IMG = {}; let db = null;
  try { const r = indexedDB.open('ductura-proto', 1); r.onupgradeneeded = () => r.result.createObjectStore('proofs'); r.onsuccess = () => { db = r.result; try { const rq = db.transaction('proofs').objectStore('proofs').openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { IMG[c.key] = c.value; c.continue(); } else if (X.editor) X.renderPanel(); }; } catch (e) { /* bez pohrane */ } }; } catch (e) { /* bez pohrane */ }
  const put = (id, data) => { IMG[id] = data; try { if (db) db.transaction('proofs', 'readwrite').objectStore('proofs').put(data, id); } catch (e) { /* samo u memoriji */ } };
  const del = id => { delete IMG[id]; try { if (db) db.transaction('proofs', 'readwrite').objectStore('proofs').delete(id); } catch (e) { /* nema */ } };

  const of = src => S.proofs[src] || [];
  const all = () => Object.entries(S.proofs).flatMap(([src, l]) => l.map(p => Object.assign({ src }, p)));
  const pg = p => String(p || '').trim();
  const forCite = (src, page) => of(src).filter(p => !pg(page) || !pg(p.page) || pg(p.page) === pg(page));
  const ro = () => S.mode === 'teacher' || !!S.submitted;
  const KIND = { foto: 'slika mobitelom', slika: 'slika ili screenshot', pdf: 'izrez iz PDF-a' };
  const thumbs = list => list.map(p => `<button class="pfthumb" data-act="proofView" data-src="${esc(p.src)}" data-id="${p.id}" title="Otvori potvrdu">${IMG[p.id] ? `<img src="${IMG[p.id]}" alt="">` : '<span class="pfmiss">slika nije na ovom uređaju</span>'}<span>${pg(p.page) ? 'str. ' + esc(p.page) : 'bez stranice'}</span></button>`).join('');
  const addBtns = (src, page, quote) => { const a = ` data-src="${esc(src)}" data-page="${esc(page || '')}" data-quote="${esc(quote || '')}"`; return `<div class="row pfadd"><button class="btn sm" data-act="proofCam"${a}>Slikaj</button><button class="btn sm" data-act="proofImg"${a}>Slika</button><button class="btn sm" data-act="proofPdf"${a}>PDF</button></div>`; };

  RP.HK.srcOpen.push(s => { const l = of(s.id).map(p => Object.assign({ src: s.id }, p)); return `<div class="pfbox"><div class="rpsub">Potvrde iz izvora (${l.length})</div>${l.length ? `<div class="pfthumbs">${thumbs(l)}</div>` : ''}${ro() ? (l.length ? '' : '<p class="muted">Student nije priložio potvrdu.</p>') : addBtns(s.id, '', '') + (l.length ? '' : '<p class="muted">Sliku možete i zalijepiti (Ctrl+V). Sprema se samo isječak.</p>')}</div>`; });
  RP.HK.srcMore.push(c => { const d = c.d, n = all().length; if (!n && c.ro) return ''; let cites = 0, with_ = 0; S.sources.forEach(s => (d.citePos[s.id] || []).forEach(p => { if (!c.has(p)) return; cites++; const nd = ed().state.doc.nodeAt(p); if (nd && forCite(s.id, nd.attrs.page).length) with_++; })); return cites ? `<div class="pfsum">Navodi s priloženom potvrdom: <b>${with_} od ${cites}</b></div>` : ''; });

  /* oznaka uz navod u tekstu i dodatak u prozorčiću navoda */
  X.hooks.paint.push(() => { document.querySelectorAll('#ed .cite').forEach(el => { const on = forCite(el.dataset.src, el.dataset.page).length > 0; if (el.classList.contains('has-proof') !== on) el.classList.toggle('has-proof', on); }); });
  X.hooks.click.push(e => {
    const c = e.target.closest && e.target.closest('#ed .cite'); if (!c) return false;
    setTimeout(() => {
      const pad = $('#pop .pad'); if (!pad || pad.querySelector('.pfbox')) return;
      let pos = ed().view.posAtDOM(c, 0); if ((ed().state.doc.nodeAt(pos) || {}).type?.name !== 'citation') pos -= 1; const n = ed().state.doc.nodeAt(pos); if (!n || n.type.name !== 'citation') return;
      const src = n.attrs.sourceId, page = n.attrs.page || '', $p = ed().state.doc.resolve(pos), before = $p.depth ? ed().state.doc.textBetween($p.start(1), pos, ' ', X.leafText) : '', m = before.match(/„([^”]{12,})”[^„]*$/), l = forCite(src, page).map(p => Object.assign({ src }, p));
      pad.insertAdjacentHTML('beforeend', `<div class="pfbox"><div class="rpsub">Potvrda iz izvora (${l.length})</div>${l.length ? `<div class="pfthumbs">${thumbs(l)}</div>` : ''}${ro() ? (l.length ? '' : '<p class="muted">Uz ovaj navod nema priložene potvrde.</p>') : addBtns(src, page, m ? m[1] : '')}</div>`);
    }, 0);
    return false;
  });

  /* ---------- učitavanje slike ili PDF-a ---------- */
  const mkInput = (id, accept, capture) => { const i = document.createElement('input'); i.type = 'file'; i.id = id; i.accept = accept; if (capture) i.setAttribute('capture', 'environment'); i.hidden = true; document.body.appendChild(i); i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) take(f, id === 'pfCam' ? 'foto' : 'slika'); }); return i; };
  const inCam = mkInput('pfCam', 'image/*', true), inImg = mkInput('pfImg', 'image/*'), inPdf = mkInput('pfPdf', 'application/pdf');
  const req = el => { U.pfReq = { src: el.dataset.src, page: el.dataset.page || '', quote: el.dataset.quote || '' }; X.closePop(); };
  function take(file, kind) {
    const r = U.pfReq; if (!r || !r.src) return;
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) return openPdf(file, r);
    if (!/^image\//.test(file.type)) return toast('Odaberite sliku ili PDF.');
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const k = Math.min(1, 2200 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); U.pf = Object.assign({ kind, full: cv, rect: null }, r); X.openDlg({ type: 'proof' }); setTimeout(show, 30); };
    im.onerror = () => { URL.revokeObjectURL(url); toast('Slika se ne može otvoriti.'); }; im.src = url;
  }
  let pdfLib = null;
  const loadPdf = () => pdfLib || (pdfLib = new Promise((res, rej) => { if (window.PDFJS) return res(window.PDFJS); const s = document.createElement('script'); s.src = 'vendor/pdf.js'; s.onload = () => (window.PDFJS ? res(window.PDFJS) : rej(new Error('pdf'))); s.onerror = () => { pdfLib = null; rej(new Error('pdf')); }; document.head.appendChild(s); }));
  async function openPdf(file, r) {
    toast('Otvaram PDF…');
    try {
      const lib = await loadPdf(), doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      U.pf = Object.assign({ kind: 'pdf', pdf: doc, name: file.name, pages: doc.numPages, pno: 1, full: null, rect: null }, r);
      X.openDlg({ type: 'proof' });
      let start = Math.min(doc.numPages, Math.max(1, parseInt(r.page, 10) || 1)), found = false;
      if (r.quote) { const hit = await searchAll(r.quote); if (hit) { start = hit; found = true; } }
      await goPage(start); if (r.quote && !found) msg('Navod nije pronađen u tekstu PDF-a. Otvorite stranicu i povucite okvir.');
    } catch (e) { toast('PDF se ne može otvoriti.'); }
  }
  const nrm = t => t.toLowerCase().replace(/[„”“"»«'’]/g, '').replace(/\s+/g, ' ').trim();
  function index(tc) { const items = tc.items.filter(i => i.str); let str = ''; const own = []; items.forEach((it, i) => { for (const ch0 of it.str.toLowerCase().replace(/[„”“"»«'’]/g, '')) { const ch = /\s/.test(ch0) ? ' ' : ch0; if (ch === ' ' && (str.endsWith(' ') || !str)) continue; str += ch; own.push(i); } if (str && !str.endsWith(' ')) { if (str.endsWith('-') && it.hasEOL) { str = str.slice(0, -1); own.pop(); } else { str += ' '; own.push(i); } } }); return { items, str, own }; }
  function locate(ix, quote) { const n = nrm(quote); if (n.length < 8) return null; let a = ix.str.indexOf(n), b; if (a >= 0) b = a + n.length; else { const head = n.slice(0, 40), tail = n.slice(-40); a = ix.str.indexOf(head); if (a < 0) return null; const t = ix.str.indexOf(tail, a); b = t >= 0 ? t + tail.length : a + head.length; } return [a, b]; }
  async function searchAll(quote) { const p = U.pf; for (let i = 1; i <= Math.min(p.pages, 600); i++) { const page = await p.pdf.getPage(i), ix = index(await page.getTextContent()); if (locate(ix, quote)) return i; if (U.pf !== p) return null; } return null; }
  async function goPage(n) {
    const p = U.pf; if (!p || !p.pdf) return; p.pno = Math.min(p.pages, Math.max(1, n)); msg('');
    const page = await p.pdf.getPage(p.pno), vp = page.getViewport({ scale: 2 }), cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; if (U.pf !== p) return;
    p.full = cv; p.rect = null; p.vp = vp; p.ix = index(await page.getTextContent()); p.scan = p.ix.str.trim().length < 20;
    const q = ($('#pfQuote') || {}).value || p.quote; if (q && !p.scan) autoRect(q, true);
    show(); if (p.scan) msg('Ova stranica je sken bez teksta, pa se navod ne može naći sam. Povucite okvir oko dijela koji trebate.');
  }
  function autoRect(q, quiet) {
    const p = U.pf, hit = locate(p.ix, q); if (!hit) { if (!quiet) msg('Taj tekst nije na ovoj stranici. Pokušajte „Nađi u PDF-u” ili povucite okvir.'); return false; }
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; new Set(p.ix.own.slice(hit[0], hit[1])).forEach(i => { const it = p.ix.items[i], e = it.transform[4], f = it.transform[5], r = p.vp.convertToViewportRectangle([e, f, e + it.width, f + (it.height || 10)]); x1 = Math.min(x1, r[0], r[2]); x2 = Math.max(x2, r[0], r[2]); y1 = Math.min(y1, r[1], r[3]); y2 = Math.max(y2, r[1], r[3]); });
    const pad = 16; p.rect = { x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad), w: Math.min(p.full.width, x2 + pad) - Math.max(0, x1 - pad), h: Math.min(p.full.height, y2 + pad) - Math.max(0, y1 - pad) }; p.auto = true; return true;
  }
  const msg = t => { const m = $('#pfMsg'); if (m) { m.textContent = t; m.hidden = !t; } };

  /* ---------- dijalog: izrez ---------- */
  X.hooks.dlg.proof = () => {
    const p = U.pf || {}, s = X.srcById(p.src);
    return `<h3>Potvrda iz izvora</h3><p class="muted">${s ? esc(s.authors) + ' (' + X.yearLabel(s) + '). ' : ''}Povucite okvir oko dijela koji potvrđuje navod. Sprema se samo taj isječak${p.kind === 'pdf' ? '; PDF ostaje na Vašem uređaju' : ''}.</p>` +
      (p.kind === 'pdf' ? `<div class="pfpdf"><div class="row"><button class="btn sm" data-act="pfPrev" aria-label="Prethodna stranica">‹</button><label class="pfpn">Stranica PDF-a <input class="in" id="pfPno" inputmode="numeric" value="${p.pno || 1}"> od ${p.pages || '…'}</label><button class="btn sm" data-act="pfNext" aria-label="Sljedeća stranica">›</button></div><div class="row"><input class="in" id="pfQuote" style="flex:1;min-width:120px" placeholder="Doslovni tekst navoda" value="${esc(p.quote || '')}"><button class="btn sm" data-act="pfFind">Nađi u PDF-u</button></div></div>` : '') +
      `<p class="pfmsg" id="pfMsg" hidden></p><div class="pfwrap" id="pfWrap"><canvas id="pfC"></canvas><div class="pfsel" id="pfSel" hidden></div></div>
      <div class="row pfmeta"><label class="pfpn">Stranica u izvoru <input class="in" id="pfPage" value="${esc(p.page || '')}" placeholder="npr. 14"></label><input class="in" id="pfNote" style="flex:1;min-width:120px" placeholder="Bilješka (nije obvezno)"></div>
      <div class="foot"><button class="lnk" data-act="pfWhole" style="margin-right:auto">Cijela slika</button><button class="btn" data-act="pfCancel">Odustani</button><button class="btn pri" data-act="pfSave">Spremi isječak</button></div>`;
  };
  function show() {
    const p = U.pf, cv = $('#pfC'); if (!p || !cv || !p.full) return;
    cv.width = p.full.width; cv.height = p.full.height; cv.getContext('2d').drawImage(p.full, 0, 0);
    const pn = $('#pfPno'); if (pn && document.activeElement !== pn) pn.value = p.pno; paintSel();
    if (p.auto && p.rect) { msg('Navod je pronađen i označen. Okvir možete povući ponovno.'); p.auto = false; }
  }
  function paintSel() { const p = U.pf, s = $('#pfSel'); if (!s || !p) return; if (!p.rect || p.rect.w < 6 || p.rect.h < 6) { s.hidden = true; return; } s.hidden = false; s.style.left = p.rect.x / p.full.width * 100 + '%'; s.style.top = p.rect.y / p.full.height * 100 + '%'; s.style.width = p.rect.w / p.full.width * 100 + '%'; s.style.height = p.rect.h / p.full.height * 100 + '%'; }
  let drag = null;
  const at = e => { const cv = $('#pfC'), b = cv.getBoundingClientRect(), k = U.pf.full.width / b.width; return { x: Math.max(0, Math.min(U.pf.full.width, (e.clientX - b.left) * k)), y: Math.max(0, Math.min(U.pf.full.height, (e.clientY - b.top) * k)) }; };
  document.addEventListener('pointerdown', e => { if (!U.pf || !e.target.closest || !e.target.closest('#pfWrap')) return; e.preventDefault(); drag = at(e); U.pf.rect = { x: drag.x, y: drag.y, w: 0, h: 0 }; try { $('#pfWrap').setPointerCapture(e.pointerId); } catch (er) { /* nije nužno */ } });
  document.addEventListener('pointermove', e => { if (!drag || !U.pf) return; const q = at(e); U.pf.rect = { x: Math.min(drag.x, q.x), y: Math.min(drag.y, q.y), w: Math.abs(q.x - drag.x), h: Math.abs(q.y - drag.y) }; paintSel(); });
  document.addEventListener('pointerup', () => { if (!drag) return; drag = null; if (U.pf && U.pf.rect && (U.pf.rect.w < 12 || U.pf.rect.h < 12)) { U.pf.rect = null; paintSel(); } });
  document.addEventListener('paste', e => {
    if (ro()) return; const f = [...((e.clipboardData || {}).files || [])].find(x => /^image\//.test(x.type)); if (!f) return;
    if (e.target.closest && e.target.closest('#ed')) return; if (U.dlg && U.dlg.type !== 'proof') return; const src = (U.dlg && U.pf && U.pf.src) || U.srcOpen; if (!src) return;
    e.preventDefault(); U.pfReq = { src, page: (U.pf && U.pf.page) || '', quote: '' }; take(f, 'slika');
  });
  const end = () => { const p = U.pf; U.pf = null; if (p && p.pdf) { try { p.pdf.destroy(); } catch (e) { /* već zatvoren */ } } };

  X.hooks.dlg.proofv = d => {
    const p = of(d.src).find(x => x.id === d.id), s = X.srcById(d.src); if (!p) return '<h3>Potvrda</h3><p class="muted">Potvrda je uklonjena.</p><div class="foot"><button class="btn pri" data-act="dlgClose">Zatvori</button></div>';
    const cites = (X.D.citePos[d.src] || []).filter(pos => { const n = ed().state.doc.nodeAt(pos); return n && (!pg(p.page) || !pg(n.attrs.page) || pg(n.attrs.page) === pg(p.page)); });
    return `<h3>Priložena potvrda</h3><p><b>${s ? esc(s.full) + ' (' + X.yearLabel(s) + ')' : 'Izvor nije u popisu'}</b>${s ? '<br><span class="muted">' + esc(s.title) + '</span>' : ''}</p><div class="meta pfvm"><span>${pg(p.page) ? 'str. ' + esc(p.page) : 'bez stranice'}</span><span>${KIND[p.kind] || ''}</span><span>priloženo ${esc(p.when)}</span></div>${p.note ? `<p>${esc(p.note)}</p>` : ''}
      ${IMG[p.id] ? `<div class="pfview"><img src="${IMG[p.id]}" alt="Isječak izvora"></div>` : '<p class="muted">Slika nije spremljena na ovom uređaju. U Ducturi se isječak čuva na poslužitelju.</p>'}
      <p class="muted">Potvrdu je priložio student. Ductura ne provjerava odgovara li isječak navodu; to prosuđuje čitatelj.</p>${cites.length ? `<div class="row">${cites.slice(0, 6).map((pos, i) => `<button class="lnk" data-act="proofGo" data-pos="${pos}">Navod ${i + 1} u tekstu ›</button>`).join('')}</div>` : ''}
      <div class="foot">${ro() ? '' : `<button class="lnk" data-act="proofDel" data-src="${esc(d.src)}" data-id="${p.id}" style="margin-right:auto">Ukloni potvrdu</button>`}<button class="btn pri" data-act="dlgClose">Zatvori</button></div>`;
  };

  Object.assign(ACT, {
    proofCam: el => { req(el); inCam.click(); },
    proofImg: el => { req(el); inImg.click(); },
    proofPdf: el => { req(el); inPdf.click(); },
    pfPrev: () => goPage((U.pf.pno || 1) - 1), pfNext: () => goPage((U.pf.pno || 1) + 1),
    pfFind: async () => { const p = U.pf, q = ($('#pfQuote') || {}).value || ''; if (nrm(q).length < 8) return msg('Upišite barem nekoliko riječi doslovnog navoda.'); p.quote = q; if (!p.scan && autoRect(q, true)) return show(); msg('Tražim u PDF-u…'); const hit = await searchAll(q); if (U.pf !== p) return; if (hit) await goPage(hit); else msg('Navod nije pronađen u tekstu PDF-a. Ako je PDF sken, otvorite stranicu i povucite okvir.'); },
    pfWhole: () => { if (U.pf) { U.pf.rect = null; paintSel(); } },
    pfCancel: () => { end(); X.closeDlg(); },
    pfSave: () => {
      const p = U.pf; if (!p || !p.full) return; const r = p.rect && p.rect.w > 12 ? p.rect : { x: 0, y: 0, w: p.full.width, h: p.full.height };
      let w = Math.min(1000, Math.round(r.w)), data = ''; const mk = (ww, q) => { const cv = document.createElement('canvas'); cv.width = ww; cv.height = Math.max(1, Math.round(r.h * ww / r.w)); const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(p.full, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height); return cv.toDataURL('image/jpeg', q); };
      data = mk(w, 0.72); if (data.length > 280000) data = mk(Math.min(w, 800), 0.55);
      const id = X.uid('pf'), page = (($('#pfPage') || {}).value || '').trim(), note = (($('#pfNote') || {}).value || '').trim();
      put(id, data); (S.proofs[p.src] = S.proofs[p.src] || []).push({ id, page, note, kind: p.kind, when: X.now(), kb: Math.round(data.length * 0.75 / 1024) });
      end(); X.closeDlg(); persist(); X.renderAll(true); toast('Potvrda je priložena uz izvor.');
    },
    proofView: el => { X.closePop(); X.openDlg({ type: 'proofv', src: el.dataset.src, id: el.dataset.id }); },
    proofGo: el => { X.closeDlg(); X.jump(+el.dataset.pos, false); },
    proofDel: el => { S.proofs[el.dataset.src] = of(el.dataset.src).filter(p => p.id !== el.dataset.id); del(el.dataset.id); X.closeDlg(); persist(); X.renderAll(true); }
  });
  document.addEventListener('change', e => { if (e.target.id === 'pfPno' && U.pf) goPage(parseInt(e.target.value, 10) || 1); });
  X.proofs = { all, forCite };
})();
