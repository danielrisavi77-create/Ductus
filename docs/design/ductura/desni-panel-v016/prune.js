/* Ductura Editor, prototip: prorjeđivanje desne trake (v0.16).
 * Raspored "Uz tekst" dobiva redak obavijesti: ono što traži pozornost, a ne vidi se u popisima poglavlja.
 */
(function () {
  'use strict';
  const X = window.DU, { S, esc, plural } = X, RP = X.rp, D = () => X.D;
  RP.ctxAlerts = c => {
    const t = S.mode === 'teacher', out = [], add = (v, text) => out.push(`<button class="ctxa" data-act="rpView" data-v="${v}"><span>${text}</span><i>›</i></button>`);
    const r = S.review || {}; if (!t && r.status === 'revise' && r.req && r.req.due && r.req.due !== 'bez roka') add('rad', `Dorada do ${esc(r.req.due)}`); if (t && r.status === 'review') add('rad', 'Rad čeka Vaš pregled');
    const rq = (S.proofReq || []).filter(x => !x.done).length; if (rq) add('src', t ? `${rq} ${plural(rq, 'zatražena potvrda čeka', 'zatražene potvrde čekaju', 'zatraženih potvrda čeka')} studenta` : `Mentor traži potvrdu uz ${rq} ${plural(rq, 'navod', 'navoda', 'navoda')}`);
    const rc = (S.recs || []).filter(x => x.st === 'new').length; if (rc && !t) add('src', `Mentor preporučuje ${rc} ${plural(rc, 'izvor', 'izvora', 'izvora')}`);
    const nb = RP.radBadge ? RP.radBadge() : 0; if (nb) add('rad', `${nb} ${plural(nb, 'nova poruka ili zahtjev', 'nove poruke ili zahtjeva', 'novih poruka ili zahtjeva')} ${t ? 'od studenta' : 'od mentora'}`);
    const gen = (S.gen || []).filter(g => !g.resolved && g.kind !== 'praise' && (!g.hid || (c.ch && g.hid === c.ch.hid))).length; if (gen) add('cmt', `${gen} ${plural(gen, 'opći komentar', 'opća komentara', 'općih komentara')}`);
    const am = (D().aiMatch || []).filter(m => c.has(m.from)).length; if (am) add('ai', `${am} ${plural(am, 'mjesto se podudara', 'mjesta se podudaraju', 'mjesta se podudara')} s odgovorom pomoćnika`);
    return out.length ? `<div class="ctxal">${out.join('')}</div>` : '';
  };
})();
