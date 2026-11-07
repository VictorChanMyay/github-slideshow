'use strict';
/* Outpatient screens: queue, visit (triage, consultation, diagnoses, signing), patient clinical panels, printable summary.
   Shares globals (h, t, api, state, modal, ageText, sexLabel, render) with app.js. */

const FLAG_FIELDS = ['temp', 'sys', 'dia', 'pulse', 'rr', 'spo2', 'weight', 'height', 'muac'];
const draft = { enc: null, vit: null, notes: null };
let queueTimer = null;
const can = (p) => state.user && state.user.perms.includes(p);

/* ---- access to restricted records: ask for a reason, then retry ---- */
function unlock(pid) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'err' }); const ta = h('textarea', { rows: 3, 'aria-label': t('restricted.reason') });
    let done = false;
    const d = modal([h('h3', {}, t('restricted.title')), h('p', {}, t('restricted.text')), h('label', {}, t('restricted.reason')), ta, err,
      h('div', { class: 'row' },
        h('button', { class: 'pri', onclick: async () => {
          if (ta.value.trim().length < 5) { err.textContent = t('restricted.short'); return; }
          const r = await api('GET', `/api/patients/${pid}?reason=${encodeURIComponent(ta.value.trim())}`);
          if (r.status === 403) { err.textContent = t('restricted.denied'); return; }
          if (!r.ok) { err.textContent = t('common.error'); return; }
          done = true; d.close(); resolve(true);
        } }, t('restricted.open')),
        h('button', { onclick: () => d.close() }, t('common.cancel')))]);
    d.addEventListener('close', () => { if (!done) resolve(false); });
  });
}
async function withAccess(pid, fn) {
  let r = await fn();
  if (r.status === 428 && await unlock(pid)) r = await fn();
  return r;
}
function oops(r) { alert((r && r.data && r.data.error) || t('common.error')); }

/* ---- navigation helpers ---- */
async function openPatient(pid) {
  const r = await withAccess(pid, () => api('GET', '/api/patients/' + pid));
  if (r.status === 403) { alert(t('restricted.denied')); return; }
  if (!r.ok) { if (r.status !== 428) oops(r); return; }
  state.patient = r.data.patient; state.clinical = r.data.allergies ? { allergies: r.data.allergies, problems: r.data.problems, encounters: r.data.encounters } : null; // clerks get no clinical data
  state.appts = null; state.refs = null;
  if (can('appt.read')) { await loadContMeta(); const ap = await api('GET', `/api/patients/${pid}/appointments`); if (ap.ok) state.appts = ap.data.appointments; }
  if (can('ref.read')) { const rf = await withAccess(pid, () => api('GET', `/api/patients/${pid}/referrals`)); if (rf.ok) state.refs = rf.data.referrals; }
  state.programs = null;
  if (can('prog.read')) { await loadProgMeta(); const pr = await withAccess(pid, () => api('GET', `/api/patients/${pid}/programs`)); if (pr.ok) state.programs = pr.data.enrolments; }
  state.child = null;
  if (can('child.read')) { await loadChildMeta(); const cr = await withAccess(pid, () => api('GET', `/api/patients/${pid}/child`)); if (cr.ok && cr.data.is_child) state.child = cr.data; }
  state.mch = null;
  if (can('mch.read')) await loadMchMeta();
  if (can('mch.read') && r.data.patient.sex !== 'M' && (Date.now() - new Date(r.data.patient.dob + 'T00:00:00Z')) / 31557600000 >= 10) { const m = await withAccess(pid, () => api('GET', `/api/patients/${pid}/mch`)); if (m.ok) state.mch = m.data; }
  state.view = 'detail'; render();
}
async function openEncounter(id, pid) {
  const r = await withAccess(pid, () => api('GET', '/api/encounters/' + id));
  if (r.status === 403) { alert(t('restricted.denied')); return; }
  if (!r.ok) { if (r.status !== 428) oops(r); return; }
  draft.enc = id; draft.vit = null; draft.notes = null;
  state.enc = r.data; state.view = 'encounter'; render();
}
async function doCheckin(pid, priority) {
  const cc = h('input', { 'aria-label': t('enc.complaint'), placeholder: t('enc.complaint') });
  const typ = h('select', {}, ['outpatient', 'antenatal', 'follow_up', 'emergency'].map((x) => h('option', { value: x }, t('enc.type.' + x))));
  const urgent = h('input', { type: 'checkbox' });
  const d = modal([h('h3', {}, t('queue.checkin')), h('label', {}, t('enc.type')), typ, h('label', {}, t('enc.complaint')), cc,
    h('label', { class: 'check' }, urgent, t('queue.urgent')),
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      const r = await withAccess(pid, () => api('POST', `/api/patients/${pid}/checkin`, { type: typ.value, chief_complaint: cc.value, priority: urgent.checked ? 'urgent' : 'normal' }));
      d.close();
      if (r.status === 409 && r.data.encounter_id) { alert(t('queue.already')); return; }
      if (!r.ok) { if (r.status !== 428) oops(r); return; }
      state.view = 'queue'; render();
    } }, t('queue.checkin')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

/* ---- queue ---- */
async function queueView() {
  const box = h('div', { class: 'panel tablewrap' });
  async function load() {
    const r = await api('GET', '/api/queue');
    box.replaceChildren();
    const rows = r.data.queue || [];
    if (!rows.length) { box.append(h('p', { class: 'note' }, t('queue.empty'))); return; }
    box.append(h('table', {}, h('tr', {}, ['queue.no', 'patient.name_en', 'patient.age', 'enc.type', 'enc.complaint', 'enc.status'].map((k) => h('th', {}, t(k)))),
      rows.map((q) => h('tr', { class: 'click', onclick: () => can('encounter.read') && openEncounter(q.id, q.patient.id) },
        h('td', {}, '#' + q.queue_no, q.priority === 'urgent' ? h('span', { class: 'tag warn' }, ' ' + t('queue.urgent')) : null),
        h('td', {}, q.patient.name_en || q.patient.mrn, ' ', q.patient.restricted ? h('span', { class: 'tag warn' }, t('patient.restricted')) : null),
        h('td', {}, ageText(q.patient.dob) + ' · ' + sexLabel(q.patient.sex)), h('td', {}, t('enc.type.' + q.type)), h('td', {}, q.chief_complaint || ''),
        h('td', {}, h('span', { class: 'tag ' + (q.status === 'signed' ? 'ok' : '') }, t('enc.status.' + q.status)), q.alert ? h('span', { class: 'tag ' + (q.alert === 'critical' ? 'crit' : 'warn') }, ' ⚠ ' + t('flag.level.' + q.alert)) : null)))));
  }
  await load();
  clearInterval(queueTimer); queueTimer = setInterval(() => { if (state.view === 'queue') load(); else clearInterval(queueTimer); }, 30000);
  return h('div', {}, h('div', { class: 'row' }, h('button', { onclick: load }, t('queue.refresh')), h('span', { class: 'note' }, t('queue.auto'))), box);
}

/* ---- patient detail: allergies, problems, visits ---- */
function clinicalPanels(p) {
  const c = state.clinical; if (!c) return null;
  const sev = (s) => h('span', { class: 'tag ' + (s === 'severe' ? 'warn' : '') }, t('severity.' + s));
  const allergyBox = h('div', { class: 'panel' }, h('h4', {}, t('allergy.title')),
    c.allergies.length ? c.allergies.map((a) => h('div', { class: 'row' }, h('b', {}, a.allergen), a.reaction ? ' · ' + a.reaction : '', sev(a.severity),
      can('allergy.write') ? h('button', { class: 'sm', onclick: () => deactivateAllergy(p, a) }, t('common.remove')) : null)) : h('div', { class: 'note' }, t('allergy.none')),
    can('allergy.write') ? h('button', { class: 'sm', onclick: () => addAllergy(p) }, '+ ' + t('allergy.add')) : null);
  const problemBox = h('div', { class: 'panel' }, h('h4', {}, t('problem.title')),
    c.problems.length ? c.problems.map((x) => h('div', { class: 'row' }, h('span', { class: x.status === 'resolved' ? 'note' : '' }, x.text, x.icd_code ? ` (${x.icd_code})` : '', x.status === 'resolved' ? ' · ' + t('problem.resolved') : ''),
      x.status === 'active' && can('problem.write') ? h('button', { class: 'sm', onclick: async () => { const r = await api('POST', `/api/patients/${p.id}/problems/${x.id}/resolve`, {}); if (r.ok) openPatient(p.id); else oops(r); } }, t('problem.resolve')) : null)) : h('div', { class: 'note' }, t('common.none')),
    can('problem.write') ? h('button', { class: 'sm', onclick: () => addProblem(p) }, '+ ' + t('problem.add')) : null);
  const visits = h('div', { class: 'panel tablewrap' }, h('h4', {}, t('visits.title')),
    c.encounters.length ? h('table', {}, h('tr', {}, ['visit.date', 'enc.type', 'enc.status', 'dx.title'].map((k) => h('th', {}, t(k)))),
      c.encounters.map((e) => h('tr', { class: 'click', onclick: () => can('encounter.read') && openEncounter(e.id, p.id) }, h('td', {}, e.visit_date), h('td', {}, t('enc.type.' + e.type)), h('td', {}, t('enc.status.' + e.status)), h('td', {}, e.dx || '')))) : h('div', { class: 'note' }, t('common.none')));
  return [allergyBox, problemBox, visits];
}
function addAllergy(p) {
  const a = h('input', { 'aria-label': t('allergy.allergen') }), r = h('input', { 'aria-label': t('allergy.reaction') });
  const s = h('select', {}, ['unknown', 'mild', 'moderate', 'severe'].map((x) => h('option', { value: x }, t('severity.' + x)))); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('allergy.add')), h('label', {}, t('allergy.allergen')), a, h('label', {}, t('allergy.reaction')), r, h('label', {}, t('allergy.severity')), s, err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const x = await api('POST', `/api/patients/${p.id}/allergies`, { allergen: a.value, reaction: r.value, severity: s.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); openPatient(p.id); } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function deactivateAllergy(p, a) {
  const r = h('input', { 'aria-label': t('allergy.why') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('allergy.remove') + ': ' + a.allergen), h('label', {}, t('allergy.why')), r, err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const x = await api('POST', `/api/patients/${p.id}/allergies/${a.id}/deactivate`, { reason: r.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); openPatient(p.id); } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function icdPicker(onPick) {
  const q = h('input', { placeholder: t('dx.search'), 'aria-label': t('dx.search') }); const out = h('div'); let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (q.value.trim().length < 2) { out.replaceChildren(); return; }
    const r = await api('GET', '/api/icd10?q=' + encodeURIComponent(q.value));
    out.replaceChildren(...(r.data.codes || []).map((c) => h('div', { class: 'pick', tabindex: '0', role: 'button', onclick: () => onPick(c), onkeydown: (e) => { if (e.key === 'Enter') onPick(c); } }, `${c.code} · ${c.name}`)));
  }, 250); });
  return h('div', {}, q, out);
}
function addProblem(p) {
  const txt = h('input', { 'aria-label': t('problem.text') }); let code = null; const chosen = h('div', { class: 'note' }); const err = h('div', { class: 'err' });
  const pick = icdPicker((c) => { code = c.code; chosen.textContent = `${c.code} · ${c.name}`; if (!txt.value) txt.value = c.name; });
  const d = modal([h('h3', {}, t('problem.add')), h('label', {}, t('problem.text')), txt, h('label', {}, t('dx.optional')), pick, chosen, err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const x = await api('POST', `/api/patients/${p.id}/problems`, { text: txt.value, icd_code: code }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); openPatient(p.id); } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

/* ---- visit (encounter) ---- */
const flagText = (f) => t('flag.' + f.code);
function flagChips(flags) { return flags.length ? flags.map((f) => h('span', { class: 'tag ' + (f.level === 'critical' ? 'crit' : 'warn') }, '⚠ ' + flagText(f))) : h('span', { class: 'tag ok' }, t('flag.none')); }

function encounterView() {
  const E = state.enc, e = E.encounter, p = E.patient;
  const locked = e.status === 'signed' || e.status === 'cancelled';
  const root = h('div');
  const reload = async (r) => { if (!r.ok) { oops(r); return null; } state.enc = r.data; return r.data; };
  const redraw = () => render();

  root.append(h('div', { class: 'row' }, h('button', { onclick: () => { state.view = 'queue'; render(); } }, '← ' + t('nav.queue')),
    h('button', { onclick: () => openPatient(p.id) }, t('patients.title'))));
  root.append(h('div', { class: 'panel' }, h('h3', {}, p.name_en, ' ', h('span', { class: 'tag' }, p.mrn), ' ', h('span', { class: 'tag ' + (e.status === 'signed' ? 'ok' : '') }, t('enc.status.' + e.status))),
    h('div', {}, `${sexLabel(p.sex)} · ${ageText(p.dob)} · #${e.queue_no} · ${t('enc.type.' + e.type)} · ${e.visit_date}`),
    E.allergies.length ? h('div', { class: 'banner' }, '⚠ ' + t('allergy.title') + ': ', E.allergies.map((a) => `${a.allergen}${a.reaction ? ' (' + a.reaction + ')' : ''} [${t('severity.' + a.severity)}]`).join(', ')) : h('div', { class: 'note' }, t('allergy.none')),
    locked ? h('div', { class: 'banner info' }, e.status === 'signed' ? `${t('enc.locked')} ${e.signed_name || ''} ${e.signed_at || ''}` : `${t('enc.cancelled')}: ${e.cancel_reason || ''}`) : null));

  /* triage */
  const vals = draft.vit || (E.vitals || {}); const vin = {};
  const field = (k, label, step) => { vin[k] = h('input', { type: 'number', step: step || 'any', inputmode: 'decimal', id: 'v_' + k, value: vals[k] ?? '', disabled: locked || !can('triage.write'),
    oninput: () => { draft.vit = Object.fromEntries(FLAG_FIELDS.map((f) => [f, vin[f].value])); } }); return h('label', { for: 'v_' + k }, t('vital.' + k), vin[k]); };
  const vitErr = h('div', { class: 'err' });
  root.append(h('div', { class: 'panel' }, h('h4', {}, t('triage.title')),
    h('div', { class: 'grid vit' }, field('temp'), field('sys'), field('dia'), field('pulse'), field('rr'), field('spo2'), field('weight'), field('height'), field('muac')),
    vitErr,
    E.vitals ? h('div', { class: 'row' }, flagChips(E.vitals.flags), E.vitals.bmi != null ? h('span', { class: 'note' }, 'BMI ' + E.vitals.bmi) : null, h('span', { class: 'note' }, E.vitals.recorded_at + ' · ' + (e.triage_name || ''))) : h('div', { class: 'note' }, t('triage.none')),
    !locked && can('triage.write') ? h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      vitErr.textContent = '';
      const body = Object.fromEntries(FLAG_FIELDS.map((f) => [f, vin[f].value]));
      const r = await api('PUT', `/api/encounters/${e.id}/vitals`, body);
      if (r.status === 400 && r.data.errors) { vitErr.textContent = Object.entries(r.data.errors).map(([k, v]) => `${t('vital.' + k)}: ${t('verr.' + v)}`).join(' · '); return; }
      if (await reload(r)) { draft.vit = null; redraw(); }
    } }, t('triage.save'))) : null,
    can('growth.write') && p.age_months < 19 * 12 && E.vitals && (E.vitals.weight != null || E.vitals.height != null || E.vitals.muac != null) && !locked ? h('div', { class: 'row' }, h('button', { class: 'sm', onclick: () => growthDialog({ id: p.id, name_en: p.name_en }, { encounter_id: e.id, weight_kg: E.vitals.weight, length_cm: E.vitals.height, muac_cm: E.vitals.muac }) }, t('child.save_visit'))) : null,
    h('p', { class: 'note' }, t('triage.draftnote'))));

  /* consultation */
  const n = draft.notes || { ...E.notes, chief_complaint: e.chief_complaint || '' }; const nin = {};
  const area = (k, rows) => { nin[k] = h('textarea', { rows: rows || 3, id: 'n_' + k, disabled: locked || !can('consult.write'), oninput: () => { draft.notes = Object.fromEntries(['chief_complaint', 'subjective', 'objective', 'assessment', 'plan'].map((x) => [x, nin[x].value])); } }); nin[k].value = n[k] || ''; return h('label', { for: 'n_' + k }, t('soap.' + k), nin[k]); };
  nin.chief_complaint = h('input', { id: 'n_cc', value: n.chief_complaint || '', disabled: locked || !can('consult.write'), oninput: () => { draft.notes = Object.fromEntries(['chief_complaint', 'subjective', 'objective', 'assessment', 'plan'].map((x) => [x, nin[x].value])); } });
  root.append(h('div', { class: 'panel' }, h('h4', {}, t('consult.title')), h('label', { for: 'n_cc' }, t('enc.complaint'), nin.chief_complaint),
    area('subjective'), area('objective'), area('assessment'), area('plan'),
    !locked && can('consult.write') ? h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      const r = await api('PUT', `/api/encounters/${e.id}/notes`, Object.fromEntries(['chief_complaint', 'subjective', 'objective', 'assessment', 'plan'].map((x) => [x, nin[x].value])));
      if (await reload(r)) { draft.notes = null; redraw(); }
    } }, t('consult.save'))) : null));

  /* diagnoses */
  const kind = h('select', {}, ['primary', 'secondary'].map((x) => h('option', { value: x }, t('dx.kind.' + x))));
  const cert = h('select', {}, ['confirmed', 'suspected'].map((x) => h('option', { value: x }, t('dx.cert.' + x))));
  root.append(h('div', { class: 'panel' }, h('h4', {}, t('dx.title')),
    E.diagnoses.length ? E.diagnoses.map((d) => h('div', { class: 'row' }, h('span', { class: 'tag ' + (d.kind === 'primary' ? 'ok' : '') }, t('dx.kind.' + d.kind)), h('b', {}, d.code), d.name, h('span', { class: 'note' }, t('dx.cert.' + d.certainty)),
      !locked && can('consult.write') ? h('button', { class: 'sm', onclick: async () => { if (await reload(await api('DELETE', `/api/encounters/${e.id}/diagnoses/${d.id}`))) redraw(); } }, t('common.remove')) : null)) : h('div', { class: 'note' }, t('dx.none')),
    !locked && can('consult.write') ? h('div', {}, h('div', { class: 'row' }, kind, cert),
      icdPicker(async (c) => { if (await reload(await api('POST', `/api/encounters/${e.id}/diagnoses`, { code: c.code, kind: kind.value, certainty: cert.value }))) redraw(); }), h('p', { class: 'note' }, t('dx.draftnote'))) : null));

  root.append(...ordersPanels(E, e, locked, reload, redraw));

  const extra = [];
  if (can('ref.write') && e.status !== 'cancelled') extra.push(h('button', { onclick: () => referralDialog({ id: p.id, name_en: p.name_en }, e.id) }, t('ref.new')));
  if (can('appt.write') && e.status !== 'cancelled') extra.push(h('button', { onclick: async () => { await loadContMeta(); apptDialog({ id: p.id, name_en: p.name_en }, e.id, () => alert(t('appt.booked'))); } }, t('appt.book_followup')));
  if (e.status === 'signed' && can('encounter.read')) extra.push(h('button', { onclick: () => openVisitSummary(e.id, p.id) }, t('vs.print')));
  if (extra.length) root.append(h('div', { class: 'row' }, extra));

  /* sign / cancel / addenda */
  if (!locked) {
    root.append(h('div', { class: 'row' },
      can('consult.sign') ? h('button', { class: 'pri', onclick: () => {
        const err = h('div', { class: 'err' });
        const d = modal([h('h3', {}, t('sign.title')), h('p', {}, t('sign.text')), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
          const r = await api('POST', `/api/encounters/${e.id}/sign`, {});
          if (!r.ok) { err.textContent = r.data.error === 'A primary diagnosis is required before signing' ? t('sign.needdx') : (r.data.error || t('common.error')); return; }
          state.enc = r.data; d.close(); redraw();
        } }, t('sign.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
      } }, t('sign.title')) : null,
      can('encounter.checkin') || can('consult.write') ? h('button', { onclick: () => {
        const r = h('input', { 'aria-label': t('enc.cancel_reason') }); const err = h('div', { class: 'err' });
        const d = modal([h('h3', {}, t('enc.cancel')), h('label', {}, t('enc.cancel_reason')), r, err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
          const x = await api('POST', `/api/encounters/${e.id}/cancel`, { reason: r.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); state.view = 'queue'; render();
        } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
      } }, t('enc.cancel')) : null));
  }
  if (e.status === 'signed') {
    const add = h('textarea', { rows: 2, 'aria-label': t('addendum.title') });
    root.append(h('div', { class: 'panel' }, h('h4', {}, t('addendum.title')),
      E.addenda.length ? E.addenda.map((a) => h('div', {}, h('div', { class: 'note' }, `${a.at} · ${a.by_name || ''}`), h('div', {}, a.text))) : h('div', { class: 'note' }, t('common.none')),
      can('consult.sign') ? h('div', {}, add, h('div', { class: 'row' }, h('button', { onclick: async () => { if (!add.value.trim()) return; if (await reload(await api('POST', `/api/encounters/${e.id}/addendum`, { text: add.value }))) redraw(); } }, t('addendum.add')))) : null));
  }
  return root;
}

/* ---- printable summary ---- */
async function summaryView() {
  const pid = state.patient.id;
  const r = await withAccess(pid, () => api('GET', `/api/patients/${pid}/summary`));
  if (!r.ok) { state.view = 'detail'; return h('div', { class: 'err' }, (r.data && r.data.error) || t('common.error')); }
  const { patient: p, allergies, problems, encounters } = r.data;
  return h('div', { class: 'summary' }, h('div', { class: 'row noprint' }, h('button', { onclick: () => { state.view = 'detail'; render(); } }, '← ' + t('common.back')), h('button', { class: 'pri', onclick: () => window.print() }, t('summary.print'))),
    h('div', { class: 'printhead' }, h('img', { src: 'assets/mtc-logo.png', alt: '', class: 'printlogo' }), h('div', {}, h('h2', {}, t('summary.title')), h('div', { class: 'note' }, new Date().toISOString().slice(0, 10)))),
    h('h3', {}, p.name_en, ' · ', p.mrn), h('div', {}, `${sexLabel(p.sex)} · ${p.dob}${p.dob_estimated ? ' (' + t('age.estimated') + ')' : ''} · ${ageText(p.dob)}`),
    h('h4', {}, t('allergy.title')), allergies.length ? allergies.map((a) => h('div', {}, `${a.allergen}${a.reaction ? ' – ' + a.reaction : ''} [${t('severity.' + a.severity)}]`)) : h('div', {}, t('allergy.none')),
    h('h4', {}, t('problem.title')), problems.filter((x) => x.status === 'active').length ? problems.filter((x) => x.status === 'active').map((x) => h('div', {}, x.text + (x.icd_code ? ` (${x.icd_code})` : ''))) : h('div', {}, t('common.none')),
    h('h4', {}, t('visits.title')), encounters.filter((x) => x.status === 'signed').length ? h('table', {}, h('tr', {}, ['visit.date', 'enc.type', 'dx.title'].map((k) => h('th', {}, t(k)))), encounters.filter((x) => x.status === 'signed').map((x) => h('tr', {}, h('td', {}, x.visit_date), h('td', {}, t('enc.type.' + x.type)), h('td', {}, x.dx || '')))) : h('div', {}, t('common.none')),
    h('p', { class: 'note' }, t('summary.footer')));
}
