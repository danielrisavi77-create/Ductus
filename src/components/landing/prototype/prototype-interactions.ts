import type { landingPrototypeCopy } from "@/lib/i18n/landingPrototypeCopy";
import lektaCatalog from "./lekta-catalog.json";
import lektaCitations from "./lekta-citations.json";

type LandingElements = {
  "navigation": HTMLElementTagNameMap["nav"];
  "sadrzaj": HTMLElementTagNameMap["main"];
  "vrh": HTMLElementTagNameMap["section"];
  "hero-title": HTMLElementTagNameMap["h1"];
  "primjer": HTMLElementTagNameMap["div"];
  "student-view": HTMLElementTagNameMap["button"];
  "mentor-view": HTMLElementTagNameMap["button"];
  "paper-status": HTMLElementTagNameMap["p"];
  "paper-caption": HTMLElementTagNameMap["p"];
  "sample-label": HTMLElementTagNameMap["label"];
  "sample-text": HTMLElementTagNameMap["textarea"];
  "sample-read": HTMLElementTagNameMap["div"];
  "mentor-live": HTMLElementTagNameMap["section"];
  "mirror-text": HTMLElementTagNameMap["p"];
  "mirror-comment": HTMLElementTagNameMap["p"];
  "paper-words": HTMLElementTagNameMap["p"];
  "student-note": HTMLElementTagNameMap["div"];
  "comment-result": HTMLElementTagNameMap["div"];
  "comment-value": HTMLElementTagNameMap["span"];
  "comment-anchor-preview": HTMLElementTagNameMap["small"];
  "flow-revision-hint": HTMLElementTagNameMap["p"];
  "flow-review": HTMLElementTagNameMap["details"];
  "flow-before": HTMLElementTagNameMap["dd"];
  "flow-after": HTMLElementTagNameMap["dd"];
  "flow-to-mentor": HTMLElementTagNameMap["button"];
  "flow-replay": HTMLElementTagNameMap["button"];
  "mentor-note": HTMLElementTagNameMap["div"];
  "comment-form": HTMLElementTagNameMap["form"];
  "comment-anchor": HTMLElementTagNameMap["select"];
  "comment-text": HTMLElementTagNameMap["textarea"];
  "flow-to-student": HTMLElementTagNameMap["button"];
  "demo-status": HTMLElementTagNameMap["p"];
  "ideja": HTMLElementTagNameMap["section"];
  "mogucnosti": HTMLElementTagNameMap["section"];
  "atlas-title": HTMLElementTagNameMap["h2"];
  "tab-pisanje": HTMLElementTagNameMap["button"];
  "tab-izvori": HTMLElementTagNameMap["button"];
  "tab-mentorstvo": HTMLElementTagNameMap["button"];
  "tab-proces": HTMLElementTagNameMap["button"];
  "tab-predaja": HTMLElementTagNameMap["button"];
  "tab-asistent": HTMLElementTagNameMap["button"];
  "tab-ustanova": HTMLElementTagNameMap["button"];
  "panel-pisanje": HTMLElementTagNameMap["section"];
  "method-explanation": HTMLElementTagNameMap["div"];
  "decision-text": HTMLElementTagNameMap["textarea"];
  "decision-add": HTMLElementTagNameMap["button"];
  "decision-feedback": HTMLElementTagNameMap["p"];
  "decision-to-timeline": HTMLElementTagNameMap["button"];
  "plan-feedback": HTMLElementTagNameMap["p"];
  "offline-draft": HTMLElementTagNameMap["textarea"];
  "offline-toggle": HTMLElementTagNameMap["button"];
  "offline-state": HTMLElementTagNameMap["span"];
  "panel-izvori": HTMLElementTagNameMap["section"];
  "source-title": HTMLElementTagNameMap["p"];
  "source-quote": HTMLElementTagNameMap["blockquote"];
  "source-relation": HTMLElementTagNameMap["p"];
  "source-role": HTMLElementTagNameMap["select"];
  "source-to-qa": HTMLElementTagNameMap["button"];
  "story-label": HTMLElementTagNameMap["p"];
  "story-text": HTMLElementTagNameMap["p"];
  "story-revision-label": HTMLElementTagNameMap["label"];
  "story-revision": HTMLElementTagNameMap["textarea"];
  "panel-mentorstvo": HTMLElementTagNameMap["section"];
  "revision-text": HTMLElementTagNameMap["div"];
  "mentor-reply": HTMLElementTagNameMap["textarea"];
  "mentor-reply-show": HTMLElementTagNameMap["button"];
  "mentor-reply-result": HTMLElementTagNameMap["p"];
  "followup-choice": HTMLElementTagNameMap["select"];
  "followup-show": HTMLElementTagNameMap["button"];
  "followup-output": HTMLElementTagNameMap["p"];
  "panel-proces": HTMLElementTagNameMap["section"];
  "vision-replay-text": HTMLElementTagNameMap["p"];
  "vision-replay-caption": HTMLElementTagNameMap["p"];
  "vision-replay-play": HTMLElementTagNameMap["button"];
  "vision-replay-range": HTMLElementTagNameMap["input"];
  "decision-timeline": HTMLElementTagNameMap["p"];
  "own-history-index": HTMLElementTagNameMap["span"];
  "own-history-range": HTMLElementTagNameMap["input"];
  "own-history-text": HTMLElementTagNameMap["div"];
  "panel-predaja": HTMLElementTagNameMap["section"];
  "defense-question": HTMLElementTagNameMap["div"];
  "defense-next": HTMLElementTagNameMap["button"];
  "defense-answer": HTMLElementTagNameMap["textarea"];
  "defense-save": HTMLElementTagNameMap["button"];
  "defense-output": HTMLElementTagNameMap["p"];
  "preflight-title": HTMLElementTagNameMap["input"];
  "preflight-body": HTMLElementTagNameMap["textarea"];
  "preflight-source": HTMLElementTagNameMap["input"];
  "preflight-title-state": HTMLElementTagNameMap["li"];
  "preflight-body-state": HTMLElementTagNameMap["li"];
  "preflight-source-state": HTMLElementTagNameMap["li"];
  "panel-asistent": HTMLElementTagNameMap["section"];
  "qa-source": HTMLElementTagNameMap["select"];
  "qa-show": HTMLElementTagNameMap["button"];
  "qa-answer": HTMLElementTagNameMap["div"];
  "qa-answer-text": HTMLElementTagNameMap["p"];
  "qa-open": HTMLElementTagNameMap["button"];
  "qa-quote": HTMLElementTagNameMap["blockquote"];
  "panel-ustanova": HTMLElementTagNameMap["section"];
  "policy-citation": HTMLElementTagNameMap["p"];
  "policy-desc": HTMLElementTagNameMap["span"];
  "faculty-search": HTMLElementTagNameMap["input"];
  "faculty-search-count": HTMLElementTagNameMap["p"];
  "faculty-unit": HTMLElementTagNameMap["select"];
  "faculty-program": HTMLElementTagNameMap["select"];
  "faculty-work": HTMLElementTagNameMap["select"];
  "faculty-focus": HTMLElementTagNameMap["select"];
  "faculty-length": HTMLElementTagNameMap["select"];
  "faculty-example-title": HTMLElementTagNameMap["h4"];
  "faculty-example-desc": HTMLElementTagNameMap["p"];
  "faculty-example-program": HTMLElementTagNameMap["p"];
  "faculty-example-limits": HTMLElementTagNameMap["p"];
  "faculty-citations": HTMLElementTagNameMap["div"];
  "role-label": HTMLElementTagNameMap["p"];
  "role-detail": HTMLElementTagNameMap["p"];
  "studenti": HTMLElementTagNameMap["section"];
  "explore-writing": HTMLElementTagNameMap["a"];
  "fakulteti": HTMLElementTagNameMap["section"];
  "faculty-explore": HTMLElementTagNameMap["button"];
  "open-faculty": HTMLElementTagNameMap["button"];
  "povjerenje": HTMLElementTagNameMap["section"];
  "sve-mogucnosti": HTMLElementTagNameMap["section"];
  "catalogue-title": HTMLElementTagNameMap["h2"];
  "razvoj": HTMLElementTagNameMap["section"];
  "kontakt": HTMLElementTagNameMap["section"];
  "contact-title": HTMLElementTagNameMap["h2"];
  "request-form": HTMLElementTagNameMap["form"];
  "request-institution": HTMLElementTagNameMap["input"];
  "request-role": HTMLElementTagNameMap["select"];
  "request-topic": HTMLElementTagNameMap["textarea"];
  "request-result": HTMLElementTagNameMap["div"];
  "request-output": HTMLElementTagNameMap["textarea"];
  "request-copy": HTMLElementTagNameMap["button"];
  "request-feedback": HTMLElementTagNameMap["p"];
  "faq-title": HTMLElementTagNameMap["h2"];
  "faculty-dialog": HTMLElementTagNameMap["dialog"];
  "dialog-title": HTMLElementTagNameMap["h2"];
  "dialog-contact": HTMLElementTagNameMap["a"];
  "close-dialog": HTMLElementTagNameMap["button"];
};

export function initPrototype(root: HTMLElement, landingCopy: typeof landingPrototypeCopy) {
 const controller = new AbortController();
 const abortSignal = controller.signal;
 const activeIntervals = new Set<number>();
 const startInterval = (callback: () => void, delay: number) => { const id = window.setInterval(callback, delay); activeIntervals.add(id); return id; };
 function findInRoot<K extends keyof LandingElements>(id: K): LandingElements[K];
 function findInRoot(id: string): HTMLElement;
 function findInRoot(id: string): HTMLElement {
   const element = root.querySelector<HTMLElement>('[id="' + CSS.escape(id) + '"]');
   if (!element) throw new Error(`Missing landing element: ${id}`);
   return element;
 }
(() => {
    const text = findInRoot('sample-text'), read = findInRoot('sample-read');
    const student = findInRoot('student-view'), mentor = findInRoot('mentor-view');
    const studentNote = findInRoot('student-note'), mentorNote = findInRoot('mentor-note');
    const status = findInRoot('demo-status'), count = findInRoot('paper-words');
    const paperStatus = findInRoot('paper-status'), caption = findInRoot('paper-caption'), label = findInRoot('sample-label');
    const form = findInRoot('comment-form'), comment = findInRoot('comment-text');
    const result = findInRoot('comment-result'), value = findInRoot('comment-value');
    function refresh() { const content = text.value; read.textContent = content || landingCopy.text_jos_nema_teksta; const n = content.trim() ? content.trim().split(/\s+/).length : 0; count.textContent = n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? landingCopy.text_rijec : landingCopy.text_rijeci) + landingCopy.text_u_radu; }
    function setView(which: string) { const isStudent = which === 'student'; refresh(); student.setAttribute('aria-pressed', String(isStudent)); mentor.setAttribute('aria-pressed', String(!isStudent)); text.hidden = !isStudent; read.hidden = isStudent; label.hidden = !isStudent; studentNote.hidden = !isStudent; mentorNote.hidden = isStudent; paperStatus.textContent = isStudent ? landingCopy.text_studentski_pogled_nacrt : landingCopy.text_nastavnicki_pogled_nacrt; caption.textContent = isStudent ? landingCopy.text_promijenite_tekst_i_pogledajte_ga_ocima_nastavnika : landingCopy.text_isti_primjer_teksta_sada_iz_perspektive_nastavnika; status.textContent = isStudent ? landingCopy.text_otvoren_je_studentski_pogled : landingCopy.text_otvoren_je_nastavnicki_pogled; }
    student.addEventListener('click', () => setView('student'), { signal: abortSignal });
    mentor.addEventListener('click', () => setView('mentor'), { signal: abortSignal });
    text.addEventListener('input', refresh, { signal: abortSignal });
    form.addEventListener('submit', event => { event.preventDefault(); const v = comment.value.trim(); if (!v) {
        status.textContent = landingCopy.text_najprije_upisite_komentar_u_primjer;
        comment.focus();
        return;
    } value.textContent = v; result.hidden = false; status.textContent = landingCopy.text_komentar_je_dodan_u_primjer_otvorite_studentski_pogled; }, { signal: abortSignal });
    const menu = root.querySelector<HTMLButtonElement>('.menu')!, nav = findInRoot('navigation');
    menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') === 'true'; menu.setAttribute('aria-expanded', String(!open)); nav.classList.toggle('is-open', !open); }, { signal: abortSignal });
    nav.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('a')) {
        menu.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
    } }, { signal: abortSignal });
    const dialog = findInRoot('faculty-dialog'), open = findInRoot('open-faculty'), close = findInRoot('close-dialog');
    open.addEventListener('click', () => dialog.showModal(), { signal: abortSignal });
    close.addEventListener('click', () => dialog.close(), { signal: abortSignal });
    refresh();
})();
(() => {
    const byId = findInRoot;
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('.atlas-tab'));
    const panels = tabs.map(tab => byId(tab.getAttribute('aria-controls')!));
    const replayButton = byId('vision-replay-play');
    const replayRange = byId('vision-replay-range');
    const frames = [
        [landingCopy.text_svaka_ideja_pocinje_pitanjem, landingCopy.text_prva_recenica],
        [landingCopy.text_svaka_ideja_pocinje_pitanjem_razgovor_otvara_prostor_za, landingCopy.text_novi_odlomak],
        [landingCopy.text_svaka_ideja_pocinje_pitanjem_razgovor_otvara_prostor_za_2, landingCopy.text_dodan_privremeni_tekst],
        [landingCopy.text_svaka_ideja_pocinje_pitanjem_razgovor_otvara_prostor_za, landingCopy.text_privremeni_tekst_je_uklonjen],
        [landingCopy.text_svaka_ideja_pocinje_pitanjem_razgovor_otvara_prostor_za_3, landingCopy.text_doradena_recenica]
    ];
    let timer: number | null = null;
    function showFrame() { const i = Number(replayRange.value); byId('vision-replay-text').textContent = frames[i][0]; byId('vision-replay-caption').textContent = frames[i][1]; replayRange.setAttribute('aria-valuetext', frames[i][1]); }
    function stopReplay() { if (timer !== null) {
        clearInterval(timer);
        timer = null;
    } replayButton.textContent = landingCopy.text_pokreni; }
    function choose(tab: HTMLElement, moveFocus: boolean) { stopReplay(); tabs.forEach((item, i) => { const on = item === tab; item.setAttribute('aria-selected', String(on)); item.tabIndex = on ? 0 : -1; panels[i].hidden = !on; }); if (moveFocus)
        tab.focus(); }
    tabs.forEach((tab, index) => { tab.addEventListener('click', () => choose(tab, false), { signal: abortSignal }); tab.addEventListener('keydown', event => { let next = index; if (event.key === landingCopy.text_arrowright)
        next = (index + 1) % tabs.length;
    else if (event.key === landingCopy.text_arrowleft)
        next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === landingCopy.text_home)
        next = 0;
    else if (event.key === landingCopy.text_end)
        next = tabs.length - 1;
    else
        return; event.preventDefault(); choose(tabs[next], true); }, { signal: abortSignal }); });
    replayRange.addEventListener('input', () => { stopReplay(); showFrame(); }, { signal: abortSignal });
    replayButton.addEventListener('click', () => { if (timer !== null) {
        stopReplay();
        return;
    } if (Number(replayRange.value) === frames.length - 1)
        replayRange.value = '0'; showFrame(); replayButton.textContent = landingCopy.text_zaustavi; timer = startInterval(() => { const i = Number(replayRange.value) + 1; replayRange.value = String(i); showFrame(); if (i === frames.length - 1)
        stopReplay(); }, 800); }, { signal: abortSignal });
    const methods: Record<string, {title: string; description: string; question: string}> = { intervju: { title: landingCopy.text_razgovor_o_iskustvima, description: landingCopy.text_intervjui_mogu_otvoriti_prostor_za_detaljnije_razumijev, question: landingCopy.text_za_razmisljanje_koga_ukljuciti_i_kako_analizirati_odgov }, anketa: { title: landingCopy.text_usporedba_odgovora, description: landingCopy.text_anketa_moze_pomoci_prikupiti_usporedive_odgovore_veceg, question: landingCopy.text_za_razmisljanje_kako_sastaviti_pitanja_i_koga_obuhvatit } };
    let selectedMethod = 'intervju';
    const methodButtons = Array.from(root.querySelectorAll<HTMLElement>('[data-method]'));
    methodButtons.forEach(button => button.addEventListener('click', () => { selectedMethod = button.dataset.method ?? 'intervju'; const data = methods[selectedMethod]; methodButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button))); const box = byId('method-explanation'); box.querySelector('strong')!.textContent = data.title; box.querySelector('p')!.textContent = data.description; box.querySelector('span')!.textContent = data.question; revisions.before = selectedMethod === 'anketa' ? landingCopy.text_u_istrazivanju_se_koristi_anketa : landingCopy.text_u_istrazivanju_se_koriste_intervjui; revisions.after = selectedMethod === 'anketa' ? landingCopy.text_anketu_sam_odabrao_la_kako_bih_usporedio_la_odgovore_su : landingCopy.text_intervjue_sam_odabrao_la_kako_bih_detaljnije_razumio_la; const active = root.querySelector<HTMLElement>('[data-revision][aria-pressed=true]')!; byId('revision-text').textContent = revisions[active.dataset.revision ?? 'before']; }, { signal: abortSignal }));
    byId('decision-add').addEventListener('click', () => { const value = byId('decision-text').value.trim(); if (!value) {
        byId('decision-feedback').textContent = landingCopy.text_najprije_unesite_kratku_biljesku;
        byId('decision-text').focus();
        return;
    } const label = selectedMethod === 'intervju' ? landingCopy.text_intervjui : landingCopy.text_anketa; byId('decision-timeline').textContent = label + ' · ' + value; byId('decision-feedback').textContent = landingCopy.text_biljeska_je_dodana_u_primjer_vremenske_crte_ostaje_samo; byId('decision-to-timeline').hidden = false; }, { signal: abortSignal });
    byId('decision-to-timeline').addEventListener('click', () => choose(byId('tab-proces'), true), { signal: abortSignal });
    const sources: Record<string, {title: string; quote: string; relation: string; answer: string}> = { a: { title: landingCopy.text_izvor_a_stranica_12, quote: landingCopy.text_dijalog_pomaze_objasniti_kako_je_odluka_nastala, relation: landingCopy.text_potpora_tvrdnji, answer: landingCopy.text_prema_izmisljenom_izvoru_a_razgovor_moze_pomoci_objasni }, b: { title: landingCopy.text_izvor_b_stranica_8, quote: landingCopy.text_u_ovom_primjeru_sudjelovanje_samo_po_sebi_ne_uklanja_ne, relation: landingCopy.text_drugi_pogled, answer: landingCopy.text_prema_izmisljenom_izvoru_b_neslaganja_mogu_postojati_i }, c: { title: landingCopy.text_izvor_c_stranica_3, quote: landingCopy.text_u_ovom_primjeru_vazno_je_kako_je_proces_sudjelovanja_ob, relation: landingCopy.text_kontekst, answer: landingCopy.text_prema_izmisljenom_izvoru_c_vazan_je_nacin_na_koji_je_pr } };
    const sourceButtons = Array.from(root.querySelectorAll<HTMLElement>('[data-evidence]'));
    let selectedSource = 'a';
    const roles: Record<string, string> = { a: sources.a.relation, b: sources.b.relation, c: sources.c.relation };
    function showSource() { const data = sources[selectedSource]; sourceButtons.forEach(item => { const role = roles[item.dataset.evidence ?? '']; item.setAttribute('aria-pressed', String(item.dataset.evidence === selectedSource)); item.querySelector('span')!.textContent = role === landingCopy.text_potpora_tvrdnji ? landingCopy.text_potpora : role; }); byId('source-title').textContent = data.title; byId('source-quote').textContent = data.quote; byId('source-role').value = roles[selectedSource]; byId('source-relation').textContent = landingCopy.text_studentova_oznaka + roles[selectedSource] + '.'; }
    sourceButtons.forEach(button => button.addEventListener('click', () => { selectedSource = button.dataset.evidence ?? 'a'; showSource(); }, { signal: abortSignal }));
    byId('source-role').addEventListener('change', event => { roles[selectedSource] = (event.currentTarget as HTMLSelectElement).value; showSource(); }, { signal: abortSignal });
    byId('source-to-qa').addEventListener('click', () => { byId('qa-source').value = selectedSource; byId('qa-answer').hidden = true; choose(byId('tab-asistent'), true); }, { signal: abortSignal });
    const revisions: Record<string, string> = { before: landingCopy.text_u_istrazivanju_se_koriste_intervjui, after: landingCopy.text_intervjue_sam_odabrao_la_kako_bih_detaljnije_razumio_la };
    const revisionButtons = Array.from(root.querySelectorAll<HTMLElement>('[data-revision]'));
    revisionButtons.forEach(button => button.addEventListener('click', () => { revisionButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button))); byId('revision-text').textContent = revisions[button.dataset.revision ?? '']; }, { signal: abortSignal }));
    byId('mentor-reply-show').addEventListener('click', () => { const value = byId('mentor-reply').value.trim(); byId('mentor-reply-result').textContent = value ? landingCopy.text_studentov_odgovor_u_primjeru + value : landingCopy.text_najprije_unesite_odgovor; if (!value)
        byId('mentor-reply').focus(); }, { signal: abortSignal });
    const followups: Record<string, string> = { argument: landingCopy.text_nastavite_rad_razradite_svoj_argument_i_odgovorite_na_k };
    byId('followup-show').addEventListener('click', () => { const choice = byId('followup-choice').value; byId('followup-output').textContent = choice === 'metoda' ? landingCopy.text_nastavite_rad_obrazlozite_zasto_ste_odabrali + (selectedMethod === 'anketa' ? 'anketu' : 'intervjue') + landingCopy.text_i_navedite_ogranicenja_tog_pristupa : followups[choice]; }, { signal: abortSignal });
    const defenseQuestions = [landingCopy.text_zasto_ste_odabrali_upravo_ovu_metodu_istrazivanja, landingCopy.text_koje_je_glavno_ogranicenje_vaseg_istrazivanja, landingCopy.text_koji_dio_izvora_najvise_podupire_vas_argument];
    let defenseIndex = 0;
    byId('defense-next').addEventListener('click', () => { defenseIndex = (defenseIndex + 1) % defenseQuestions.length; byId('defense-question').textContent = defenseQuestions[defenseIndex]; }, { signal: abortSignal });
    byId('defense-save').addEventListener('click', () => { const value = byId('defense-answer').value.trim(); byId('defense-output').textContent = value ? landingCopy.text_odgovor_u_primjeru + value : landingCopy.text_najprije_unesite_odgovor; if (!value)
        byId('defense-answer').focus(); }, { signal: abortSignal });
    byId('qa-show').addEventListener('click', () => { const data = sources[byId('qa-source').value]; byId('qa-answer-text').textContent = data.answer; byId('qa-answer').hidden = false; byId('qa-quote').textContent = data.quote + ' — ' + data.title; byId('qa-quote').hidden = true; byId('qa-open').textContent = landingCopy.text_pogledajte_odlomak_izvora; byId('qa-open').setAttribute('aria-expanded', 'false'); }, { signal: abortSignal });
    byId('qa-source').addEventListener('change', () => { byId('qa-answer').hidden = true; }, { signal: abortSignal });
    byId('qa-open').addEventListener('click', () => { const quote = byId('qa-quote'); quote.hidden = !quote.hidden; byId('qa-open').setAttribute('aria-expanded', String(!quote.hidden)); byId('qa-open').textContent = quote.hidden ? landingCopy.text_pogledajte_odlomak_izvora : landingCopy.text_sakrijte_odlomak_izvora; }, { signal: abortSignal });
    const policies: Record<string, {citation: string; description: string}> = { author: { citation: landingCopy.text_autor_godina, description: landingCopy.text_sustav_autor_godina_uz_smjernice_dodijeljene_zadatku }, number: { citation: '[1]', description: landingCopy.text_brojcani_sustav_uz_smjernice_dodijeljene_zadatku } };
    const policyButtons = Array.from(root.querySelectorAll<HTMLElement>('[data-policy]'));
    policyButtons.forEach(button => button.addEventListener('click', () => { const data = policies[button.dataset.policy ?? '']; policyButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button))); byId('policy-citation').textContent = data.citation; byId('policy-desc').textContent = data.description; }, { signal: abortSignal }));
})();
/* Javno dostupne projekcije Lekte: data/catalog/zagreb-catalog.json i data/tools/citation-specs/verified-index.json; snimka 28.10.2026. */
const DUCTURA_LEKTA_CATALOG = lektaCatalog;
const DUCTURA_LEKTA_CITATIONS = lektaCitations;
(() => {
    const byId = findInRoot;
    const text = byId('sample-text'), mirror = byId('mirror-text'), mentorLive = byId('mentor-live');
    const anchor = byId('comment-anchor'), historyRange = byId('own-history-range'), historyText = byId('own-history-text'), historyIndex = byId('own-history-index');
    const history: string[] = [];
    function showHistory() { const index = Number(historyRange.value) || 0; historyText.textContent = history[index] || landingCopy.text_u_ovom_koraku_nema_teksta; historyIndex.textContent = (index + 1) + ' / ' + history.length; historyRange.setAttribute('aria-valuetext', landingCopy.text_korak + (index + 1) + landingCopy.text_od + history.length); }
    function capture() { const value = text.value; if (history[history.length - 1] !== value) {
        history.push(value);
        if (history.length > 120)
            history.shift();
    } historyRange.max = String(history.length - 1); historyRange.value = historyRange.max; showHistory(); }
    function fragments() { const selected = anchor.value; anchor.replaceChildren(); const pieces = (text.value.match(/[^.!?]+[.!?]*/g) || []).map(x => x.trim()).filter(Boolean).slice(0, 12); if (!pieces.length) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = landingCopy.text_jos_nema_teksta_2;
        anchor.append(o);
        return;
    } for (const part of pieces) {
        const o = document.createElement('option');
        o.value = part;
        o.textContent = part.length > 95 ? part.slice(0, 92) + '…' : part;
        anchor.append(o);
    } if (pieces.includes(selected))
        anchor.value = selected; }
    function syncText() { mirror.textContent = text.value || landingCopy.text_jos_nema_teksta; fragments(); capture(); }
    text.addEventListener('input', syncText, { signal: abortSignal });
    historyRange.addEventListener('input', showHistory, { signal: abortSignal });
    syncText();
    byId('mentor-view').addEventListener('click', () => { mentorLive.hidden = true; }, { signal: abortSignal });
    byId('student-view').addEventListener('click', () => { mentorLive.hidden = false; }, { signal: abortSignal });
    byId('comment-form').addEventListener('submit', event => { event.preventDefault(); const value = byId('comment-text').value.trim(); if (!value)
        return; const selected = anchor.value; byId('comment-anchor-preview').textContent = selected ? landingCopy.text_uz_odlomak + selected + '”' : ''; byId('mirror-comment').textContent = landingCopy.text_komentar + value; byId('mirror-comment').hidden = false; }, { signal: abortSignal });
    const noteValues: Record<string, string> = { question: landingCopy.text_kako_nastaju_odluke, source: landingCopy.text_razgovor_i_sudjelovanje, reflection: landingCopy.text_razliciti_pogledi };
    const noteButtons = Array.from(root.querySelectorAll<HTMLElement>('[data-note]'));
    const zones = Array.from(root.querySelectorAll<HTMLElement>('[data-zone]'));
    const allocations: Record<string, string> = {};
    let selectedNote: string | null = null;
    function noteSelection(id: string) { selectedNote = id; noteButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.note === id))); byId('plan-feedback').textContent = landingCopy.text_sada_odaberite_mjesto_u_planu; }
    function placeNote(zone: HTMLElement, id: string) { if (!Object.prototype.hasOwnProperty.call(noteValues, id))
        return; for (const key of Object.keys(allocations))
        if (allocations[key] === id)
            delete allocations[key]; allocations[zone.dataset.zone ?? ''] = id; zones.forEach(item => { item.querySelector('small')!.textContent = allocations[item.dataset.zone ?? ''] ? noteValues[allocations[item.dataset.zone ?? '']] : landingCopy.text_odaberite_biljesku; }); noteButtons.forEach(button => button.setAttribute('aria-pressed', 'false')); selectedNote = null; byId('plan-feedback').textContent = landingCopy.text_biljeska_je_dodana_u_dio + zone.querySelector('b')!.textContent + '”.'; }
    noteButtons.forEach(button => { button.addEventListener('click', () => noteSelection(button.dataset.note ?? ''), { signal: abortSignal }); button.addEventListener('dragstart', event => { event.dataTransfer?.setData('text/plain', button.dataset.note ?? ''); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }, { signal: abortSignal }); });
    zones.forEach(zone => { zone.addEventListener('click', () => { if (selectedNote)
        placeNote(zone, selectedNote);
    else
        byId('plan-feedback').textContent = landingCopy.text_najprije_odaberite_biljesku; }, { signal: abortSignal }); zone.addEventListener('dragover', event => event.preventDefault(), { signal: abortSignal }); zone.addEventListener('drop', event => { event.preventDefault(); placeNote(zone, event.dataTransfer?.getData('text/plain') ?? ''); }, { signal: abortSignal }); });
    let isOffline = false;
    byId('offline-toggle').addEventListener('click', () => { isOffline = !isOffline; byId('offline-toggle').setAttribute('aria-pressed', String(isOffline)); byId('offline-toggle').textContent = isOffline ? landingCopy.text_simuliraj_povratak_veze : landingCopy.text_simuliraj_prekid_veze; byId('offline-state').textContent = isOffline ? landingCopy.text_primjer_veza_simulirano_prekinuta : landingCopy.text_primjer_veza_simulirano_dostupna_tekst_je_ostao_na_stra; }, { signal: abortSignal });
    const storyButtons = Array.from(root.querySelectorAll<HTMLElement>('[data-story]'));
    function showStory(step: string) { const labels: Record<string, string> = { claim: landingCopy.text_recenica_u_radu, source: landingCopy.text_izmisljeni_izvor, comment: landingCopy.text_komentar_uz_rad, revision: landingCopy.text_primjer_dorade, review: landingCopy.text_pregled_teksta }; let value = ''; if (step === 'claim')
        value = landingCopy.text_razgovor_moze_pridonijeti_razumijevanju_odluka; if (step === 'source')
        value = byId('source-quote').textContent + ' — ' + byId('source-title').textContent; if (step === 'comment')
        value = landingCopy.text_pokazite_koji_dio_izvora_podupire_ovu_tvrdnju; if (step === 'revision')
        value = byId('story-revision').value || landingCopy.text_upisite_doradu_u_primjeru; if (step === 'review')
        value = byId('story-revision').value || landingCopy.text_u_primjeru_jos_nema_dorade; byId('story-revision').hidden = step !== 'revision'; byId('story-revision-label').hidden = step !== 'revision'; byId('story-label').textContent = labels[step]; byId('story-text').textContent = value; storyButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.story === step))); }
    storyButtons.forEach(button => button.addEventListener('click', () => showStory(button.dataset.story ?? ''), { signal: abortSignal }));
    byId('story-revision').addEventListener('input', () => showStory('revision'), { signal: abortSignal });
    function preflight() { const hasTitle = !!byId('preflight-title').value.trim(), hasText = !!byId('preflight-body').value.trim(), hasSource = byId('preflight-source').checked; for (const [id, on, yes, no] of ([['preflight-title-state', hasTitle, landingCopy.text_naslov_je_unesen, landingCopy.text_naslov_nije_unesen], ['preflight-body-state', hasText, landingCopy.text_tekst_je_unesen, landingCopy.text_tekst_nije_unesen], ['preflight-source-state', hasSource, landingCopy.text_izvor_je_oznacen, landingCopy.text_izvor_nije_oznacen]] as [string, boolean, string, string][])) {
        const el = byId(id);
        el.dataset.complete = String(on);
        el.textContent = (on ? '✓ ' : '○ ') + (on ? yes : no);
    } }
    ['preflight-title', 'preflight-body', 'preflight-source'].forEach(id => byId(id).addEventListener('input', preflight, { signal: abortSignal }));
    const search = byId('faculty-search'), unitSelect = byId('faculty-unit'), program = byId('faculty-program'), work = byId('faculty-work'), focus = byId('faculty-focus'), length = byId('faculty-length');
    const entries = new Map();
    for (const group of DUCTURA_LEKTA_CATALOG)
        for (const unit of group.units)
            entries.set(group.id + '::' + unit.id, { group, unit });
    const normal = (s: string) => s.toLocaleLowerCase('hr').normalize(landingCopy.text_nfd).replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    function fillFaculties() { const old = unitSelect.value, words = normal(search.value.trim()).split(/\s+/).filter(Boolean), aliases: Record<string, string[]> = { rijeka: ['rijeka', 'rijeci'], rijeci: ['rijeka', 'rijeci'], zadar: ['zadar', 'zadru'], zadru: ['zadar', 'zadru'], pula: ['pula', 'puli'], puli: ['pula', 'puli'] }; unitSelect.replaceChildren(); const blank = document.createElement('option'); blank.value = ''; blank.textContent = landingCopy.text_odaberite_ustanovu; unitSelect.append(blank); let total = 0; for (const group of DUCTURA_LEKTA_CATALOG) {
        const matches = group.units.filter(u => { const haystack = normal([group.name, u.name, ...u.programs].join(' ')); return words.every(word => (aliases[word] || [word]).some(term => haystack.includes(term))); });
        if (!matches.length)
            continue;
        const options = document.createElement('optgroup');
        options.label = group.name;
        for (const u of matches) {
            const o = document.createElement('option');
            o.value = group.id + '::' + u.id;
            o.textContent = u.name;
            options.append(o);
            total++;
        }
        unitSelect.append(options);
    } if (entries.has(old) && [...unitSelect.options].some(o => o.value === old))
        unitSelect.value = old; if (!total)
        blank.textContent = landingCopy.text_nema_rezultata_u_snimci_kataloga; byId('faculty-search-count').textContent = total ? (total + ' ' + (total === 1 ? landingCopy.text_pronaden_unos : landingCopy.text_pronadenih_unosa) + landingCopy.text_u_snimci_lektina_kataloga) : landingCopy.text_nema_podudaranja_u_snimci_kataloga; updateFaculty(); }
    function updateFacultyPrograms() { const item = entries.get(unitSelect.value); program.replaceChildren(); if (!item) {
        const o = document.createElement('option');
        o.textContent = landingCopy.text_najprije_odaberite_ustanovu;
        program.append(o);
        program.disabled = true;
        updateFaculty();
        return;
    } const first = document.createElement('option'); first.value = ''; first.textContent = landingCopy.text_odaberite_program_neobavezno; program.append(first); for (const name of item.unit.programs) {
        const o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        program.append(o);
    } program.disabled = item.unit.programs.length === 0; updateFaculty(); }
    function updateFaculty() { const item = entries.get(unitSelect.value), title = byId('faculty-example-title'), desc = byId('faculty-example-desc'), extra = byId('faculty-example-program'), limits = byId('faculty-example-limits'), box = byId('faculty-citations'); box.replaceChildren(); const header = document.createElement('b'); header.textContent = landingCopy.text_lektini_zapisi_o_citiranju; box.append(header); if (!item) {
        title.textContent = landingCopy.text_odaberite_ustanovu;
        desc.textContent = landingCopy.text_odaberite_ustanovu_i_oblik_rada;
        extra.textContent = '';
        limits.textContent = '';
        const p = document.createElement('p');
        p.textContent = landingCopy.text_odaberite_ustanovu_za_pregled_dostupnih_zapisa;
        box.append(p);
        return;
    } const labels: Record<string, string> = { seminarski: landingCopy.text_seminarski_rad, esej: landingCopy.text_esej, zavrsni: landingCopy.text_zavrsni_rad, diplomski: landingCopy.text_diplomski_rad }; title.textContent = labels[work.value] + landingCopy.text_primjer; const tasks: Record<string, string> = { analiza: landingCopy.text_postavite_pitanje_analizirajte_jedan_argument_i_navedit, slucaj: landingCopy.text_odaberite_primjer_slucaja_objasnite_kontekst_i_povezite, pregled: landingCopy.text_usporedite_dva_pristupa_iz_literature_i_navedite_izvore }; desc.textContent = landingCopy.text_primjer_za + item.unit.name + '. ' + tasks[focus.value]; extra.textContent = program.value ? landingCopy.text_odabrani_program_iz_kataloga + program.value : ''; limits.textContent = landingCopy.text_opseg_rada + length.value + '.'; const records = DUCTURA_LEKTA_CITATIONS.filter(x => x.facultyId === item.unit.id); const p = document.createElement('p'); if (!records.length) {
        p.textContent = landingCopy.text_u_koristenoj_snimci_indeksa_nema_potvrdenog_zapisa_o_ci;
        box.append(p);
        return;
    } p.textContent = landingCopy.text_zapisi_iz_lekte_uz_datum_provjere_za_pojedini_rad_provj; box.append(p); const ul = document.createElement('ul'); for (const record of records) {
        const li = document.createElement('li');
        li.textContent = record.label + ' — ' + record.sourceLabel + landingCopy.text_provjereno + record.verifiedAt + ').';
        ul.append(li);
    } box.append(ul); }
    search.addEventListener('input', () => { fillFaculties(); updateFacultyPrograms(); }, { signal: abortSignal });
    unitSelect.addEventListener('change', updateFacultyPrograms, { signal: abortSignal });
    program.addEventListener('change', updateFaculty, { signal: abortSignal });
    work.addEventListener('change', updateFaculty, { signal: abortSignal });
    focus.addEventListener('change', updateFaculty, { signal: abortSignal });
    length.addEventListener('change', updateFaculty, { signal: abortSignal });
    fillFaculties();
    updateFacultyPrograms();
    const roles: Record<string, {title: string; description: string}> = { student: { title: landingCopy.text_student, description: landingCopy.text_vidi_svoj_rad_i_isti_predvideni_prikaz_nastanka_rada_ko }, teacher: { title: landingCopy.text_nastavnik_mentor, description: landingCopy.text_vidi_dodijeljeni_rad_moze_ostaviti_komentar_te_ima_pred }, admin: { title: landingCopy.text_administrator, description: landingCopy.text_upravlja_institucionalnim_postavkama_prema_ovlastima_sa } };
    const roleButtons = Array.from(root.querySelectorAll<HTMLElement>('[data-role]'));
    roleButtons.forEach(button => button.addEventListener('click', () => { const role = roles[button.dataset.role ?? '']; roleButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button))); byId('role-label').textContent = role.title; byId('role-detail').textContent = role.description; }, { signal: abortSignal }));
})();
(() => {
    const faculty = findInRoot('faculty-explore');
    const writing = findInRoot('explore-writing');
    faculty.addEventListener('click', () => {
        findInRoot('tab-ustanova').click();
        const section = root.querySelector<HTMLDetailsElement>(landingCopy.text_panel_ustanova_studio_disclosure)!;
        section.open = true;
        section.scrollIntoView({ block: 'start', behavior: 'auto' });
        findInRoot('faculty-search').focus({ preventScroll: true });
    }, { signal: abortSignal });
    writing.addEventListener('click', () => findInRoot('tab-pisanje').click(), { signal: abortSignal });
})();
(() => {
    const byId = findInRoot;
    const student = byId('student-view'), mentor = byId('mentor-view');
    const draft = byId('sample-text'), form = byId('comment-form');
    const steps = Array.from(root.querySelectorAll<HTMLElement>('[data-journey-step]'));
    const nextMentor = byId('flow-to-mentor'), nextStudent = byId('flow-to-student');
    const replay = byId('flow-replay'), comparison = byId('flow-review');
    let before: string | null = null;
    function setStep(n: number) { steps.forEach(el => { if (Number(el.dataset.journeyStep) === n)
        el.setAttribute('aria-current', 'step');
    else
        el.removeAttribute('aria-current'); }); }
    function updateComparison() { if (before === null)
        return; byId('flow-before').textContent = before || landingCopy.text_prazan_nacrt; byId('flow-after').textContent = draft.value || landingCopy.text_prazan_nacrt; const changed = draft.value !== before; comparison.hidden = !changed; replay.hidden = !changed; byId('flow-revision-hint').hidden = changed; }
    mentor.addEventListener('click', () => setStep(2), { signal: abortSignal });
    student.addEventListener('click', () => setStep(before === null ? 1 : 3), { signal: abortSignal });
    nextMentor.addEventListener('click', () => { mentor.click(); byId('comment-text').focus(); }, { signal: abortSignal });
    nextStudent.addEventListener('click', () => { student.click(); draft.focus(); }, { signal: abortSignal });
    form.addEventListener('submit', () => { if (!byId('comment-text').value.trim())
        return; before = draft.value; nextStudent.hidden = false; byId('flow-revision-hint').hidden = false; updateComparison(); }, { signal: abortSignal });
    draft.addEventListener('input', updateComparison, { signal: abortSignal });
    replay.addEventListener('click', () => { byId('tab-proces').click(); const section = root.querySelector<HTMLDetailsElement>(landingCopy.text_panel_proces_studio_disclosure)!; section.open = true; section.scrollIntoView({ block: 'start', behavior: 'auto' }); byId('own-history-range').focus({ preventScroll: true }); }, { signal: abortSignal });
    byId('dialog-contact').addEventListener('click', () => byId('faculty-dialog').close(), { signal: abortSignal });
    const request = byId('request-form'), result = byId('request-result'), output = byId('request-output'), feedback = byId('request-feedback');
    request.addEventListener('submit', event => { event.preventDefault(); const institution = byId('request-institution').value.trim(), role = byId('request-role').value, topic = byId('request-topic').value.trim(); const parts = [landingCopy.text_postovani, '', landingCopy.text_zanimaju_nas_mogucnosti_ducture_za_visoko_obrazovanje]; if (institution)
        parts.push(landingCopy.text_ustanova + institution + '.'); if (role)
        parts.push(landingCopy.text_uloga + role + '.'); if (topic)
        parts.push(landingCopy.text_tema + topic); parts.push('', landingCopy.text_molimo_informacije_o_proizvodu_i_mogucnostima_razgovora, '', landingCopy.text_srdacan_pozdrav); output.value = parts.join('\n'); result.hidden = false; feedback.textContent = landingCopy.text_upit_je_pripremljen_jos_nije_poslan; result.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }, { signal: abortSignal });
    byId('request-copy').addEventListener('click', async () => { try {
        if (!navigator.clipboard || !window.isSecureContext)
            throw new Error(landingCopy.text_clipboard_unavailable);
        await navigator.clipboard.writeText(output.value);
        feedback.textContent = landingCopy.text_tekst_je_u_meduspremniku_upit_nije_poslan;
    }
    catch {
        output.focus();
        output.select();
        feedback.textContent = landingCopy.text_tekst_je_oznacen_kopirajte_ga_naredbom_svojeg_uredaja;
    } }, { signal: abortSignal });
})();

 return () => { controller.abort(); for (const id of activeIntervals) window.clearInterval(id); };
}
