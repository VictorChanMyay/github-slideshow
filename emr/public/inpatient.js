'use strict';
/* Inpatient care, procedures and blood bank screens. Shares globals with the other scripts
   (h, t, api, state, can, modal, bigModal, formKit, withAccess, openPatient, pickPatient, icdPicker, todaysVisit, letterHead, ...). */

const condClass = (c) => (c === 'critical' ? 'crit' : c === 'serious' ? 'warn' : '');
const condChip = (c) => h('span', { class: 'tag ' + condClass(c) }, t('adm.cond.' + c));
const obsChips = (flags) => (flags || []).map((f) => h('span', { class: 'tag ' + (f.level === 'critical' ? 'crit' : 'warn') }, '⚠ ' + t('flag.' + f.code)));
const dtShort = (s) => String(s || '').slice(0, 16).replace('T', ' ');
const groupLabel = (u) => u.abo + (u.rh === 'pos' ? '+' : '-');
async function loadProcTypes() { if (!state.procTypes && (can('proc.read') || can('proc.write'))) state.procTypes = (await api('GET', '/api/procedure-types')).data.types; }

/* ---------------- bed board ---------------- */
async function boardView() {
  const r = await api('GET', '/api/wards'); const B = r.data; const refresh = () => render(); const root = h('div');
  root.append(h('div', { class: 'row' }, h('span', { class: 'tag ok' }, `${t('adm.occupied')}: ${B.occupied}`), h('span', { class: 'tag' }, `${t('adm.free')}: ${B.free}`), h('span', { class: 'note' }, `${t('adm.usable')}: ${B.usable}`)));
  for (const w of B.wards) {
    root.append(h('div', { class: 'panel' }, h('h4', {}, w.name, ' ', h('span', { class: 'note' }, t('ward.kind.' + w.kind))),
      h('div', { class: 'beds' }, w.beds.map((b) => {
        const a = b.admission;
        if (b.status !== 'active') return h('div', { class: 'bed off' }, h('b', {}, b.label), h('div', { class: 'note' }, t('adm.out_of_service')), can('bed.admin') ? h('button', { class: 'sm', onclick: async () => { await api('PUT', `/api/beds/${b.id}`, { status: 'active' }); refresh(); } }, t('adm.bed_on')) : null);
        if (!a) return h('div', { class: 'bed free' }, h('b', {}, b.label), h('div', { class: 'note' }, t('adm.free')), can('adm.write') ? h('button', { class: 'sm pri', onclick: () => pickPatient((p) => admitDialog(p, b.id, w, refresh)) }, t('adm.admit')) : null,
          can('bed.admin') ? h('button', { class: 'sm', onclick: async () => { await api('PUT', `/api/beds/${b.id}`, { status: 'out_of_service' }); refresh(); } }, t('adm.bed_off')) : null);
        return h('div', { class: 'bed full ' + (a.condition === 'critical' ? 'critical' : '') }, h('b', {}, b.label), ' ', a.isolation ? h('span', { class: 'tag warn' }, '☣ ' + t('adm.isolation')) : null,
          h('div', { class: 'who' }, a.patient.name_en || a.patient.mrn, a.patient.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null), h('div', { class: 'note' }, `${a.adm_no} · ${t('adm.day')} ${a.los_days + 1}`),
          h('div', { class: 'row' }, condChip(a.condition), a.obs_overdue ? h('span', { class: 'tag crit' }, t('adm.obs_overdue')) : null),
          h('div', { class: 'row' }, h('button', { class: 'sm', onclick: () => openAdmission(a.id, a.patient.id) }, t('mch.open')), can('ward.write') ? h('button', { class: 'sm', onclick: () => obsDialog(a.id, refresh) }, t('adm.obs_short')) : null, can('ward.write') ? h('button', { class: 'sm', onclick: () => noteDialog(a.id, refresh) }, t('adm.note_short')) : null));
      }))));
  }
  if (can('bed.admin')) {
    const wn = h('input', { 'aria-label': t('ward.name') }), wk = h('select', {}, ['general', 'maternity', 'paediatric', 'isolation', 'other'].map((k) => h('option', { value: k }, t('ward.kind.' + k)))); const err = h('div', { class: 'err' });
    const wsel = h('select', { 'aria-label': t('ward.name') }, B.wards.map((w) => h('option', { value: w.id }, w.name))), bl = h('input', { 'aria-label': t('ward.bed_label') });
    root.append(h('div', { class: 'panel' }, h('h4', {}, t('ward.admin')), h('div', { class: 'row' }, wn, wk, h('button', { class: 'sm', onclick: async () => { const x = await api('POST', '/api/wards', { name: wn.value, kind: wk.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } refresh(); } }, '+ ' + t('ward.add'))),
      h('div', { class: 'row' }, wsel, bl, h('button', { class: 'sm', onclick: async () => { const x = await api('POST', `/api/wards/${wsel.value}/beds`, { label: bl.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } refresh(); } }, '+ ' + t('ward.add_bed'))), err, h('p', { class: 'note' }, t('ward.note'))));
  }
  return root;
}
async function admitDialog(p, bedId, ward, after, extra) {
  const f = formKit(); const err = h('div', { class: 'err' }); let dx = null; const chosen = h('div', { class: 'note' }); const enc = can('encounter.read') ? await todaysVisit(p.id) : null;
  const pick = icdPicker((c) => { dx = c.code; chosen.textContent = `${c.code} · ${c.name}`; });
  const d = bigModal([h('h3', {}, `${t('adm.admit')}: ${p.name_en || p.mrn}${ward ? ' → ' + ward.name : ''}`), f.text('reason', t('adm.reason')), h('div', { class: 'grid' }, f.select('condition', t('adm.condition'), ['stable', 'serious', 'critical'], 'x', { blank: false, custom: (v) => t('adm.cond.' + v) }), f.num('obs_every_hours', t('adm.obs_every'), { step: 1, min: 1, max: 24 })),
    h('div', { class: 'row' }, f.check('isolation', t('adm.needs_isolation'), false)), h('label', {}, t('adm.dx')), pick, chosen, f.text('admit_dx_text', t('adm.dx_text')), enc ? h('p', { class: 'note' }, t('adm.linked_visit')) : null, err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => submit({}) }, t('adm.admit')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
  document.getElementById('mf_obs_every_hours').value = '4';
  async function submit(more) {
    err.textContent = ''; const r = await api('POST', `/api/patients/${p.id}/admissions`, { ...f.values(), bed_id: bedId, admit_dx_code: dx, encounter_id: enc || undefined, ...more, ...(extra || {}) });
    if (r.status === 409 && r.data.isolation_ward_needed) { const why = h('input', { 'aria-label': t('adm.isolation_why') }); const d2 = modal([h('h3', {}, t('adm.isolation')), h('p', {}, t('adm.isolation_text')), h('label', {}, t('adm.isolation_why'), why), h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { d2.close(); submit({ isolation_override: why.value }); } }, t('common.confirm')), h('button', { onclick: () => d2.close() }, t('common.cancel')))]); return; }
    if (r.status === 409 && r.data.admission_id) { d.close(); openAdmission(r.data.admission_id, p.id); return; }
    if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); openAdmission(r.data.id, p.id);
    void after;
  }
}

/* ---------------- admission screen ---------------- */
async function openAdmission(id, pid) {
  const r = await withAccess(pid, () => api('GET', '/api/admissions/' + id));
  if (r.status === 403) { alert(t('adm.restricted_note')); return; } if (!r.ok) { if (r.status !== 428) oops(r); return; }
  state.admission = r.data; state.view = 'admission'; render();
}
async function admissionView() {
  const D = state.admission, a = D.admission, p = D.patient; const active = a.status === 'admitted'; const refresh = () => openAdmission(a.id, p.id); const root = h('div');
  root.append(h('div', { class: 'row' }, h('button', { onclick: () => { state.view = 'inpatients'; render(); } }, '← ' + t('nav.inpatients')), h('button', { onclick: () => openPatient(p.id) }, t('patients.title'))));
  root.append(h('div', { class: 'panel' }, h('h3', {}, p.name_en, ' ', h('span', { class: 'tag' }, a.adm_no), ' ', h('span', { class: 'tag ' + (active ? 'ok' : '') }, active ? t('adm.status.admitted') : t('adm.dtype.' + a.discharge_type))),
    h('div', { class: 'note' }, `${sexLabel(p.sex)} · ${ageText(p.dob)} · ${p.mrn}`), h('div', { class: 'grid' }, h('div', {}, h('div', { class: 'note' }, t('adm.bed')), `${a.ward} · ${a.bed}`), h('div', {}, h('div', { class: 'note' }, t('adm.admitted_on')), `${dtShort(a.admitted_at)} · ${a.admitted_by_name || ''}`),
      h('div', {}, h('div', { class: 'note' }, t('adm.los')), `${a.los_days} ${t('rx.days')}`), h('div', {}, h('div', { class: 'note' }, t('adm.condition')), condChip(a.condition), a.isolation ? h('span', { class: 'tag warn' }, ' ☣ ' + t('adm.isolation')) : null)),
    h('h4', {}, t('adm.reason')), h('div', {}, a.reason, a.admit_dx_code ? ` (${a.admit_dx_code})` : '', a.admit_dx_text ? ' · ' + a.admit_dx_text : ''), a.obs_overdue ? h('div', { class: 'banner' }, '⚠ ' + t('adm.obs_overdue')) : null,
    active ? h('div', { class: 'row' }, can('ward.write') ? h('button', { class: 'pri', onclick: () => obsDialog(a.id, refresh) }, t('adm.add_obs')) : null, can('ward.write') ? h('button', { onclick: () => noteDialog(a.id, refresh) }, t('adm.add_note')) : null,
      can('adm.write') ? h('button', { onclick: () => transferDialog(a, refresh) }, t('adm.move')) : null, can('proc.write') ? h('button', { onclick: () => procedureDialog(p, refresh) }, t('proc.record')) : null, can('blood.issue') ? h('button', { onclick: () => issueBloodDialog(p, refresh) }, t('blood.issue')) : null,
      can('adm.discharge') ? h('button', { onclick: () => dischargeDialog(a, p, refresh) }, t('adm.discharge')) : null) : h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => openDischargeSummary(a.id, p.id) }, t('adm.print_summary')))));
  root.append(h('div', { class: 'panel tablewrap' }, h('h4', {}, t('adm.obs')), D.obs.length ? h('table', {}, h('tr', {}, ['audit.time', 'vital.temp', 'adm.bp', 'vital.pulse', 'vital.rr', 'vital.spo2', 'adm.fluid_in', 'adm.urine', 'flag.title', 'audit.user'].map((k) => h('th', {}, t(k)))),
    D.obs.map((o) => h('tr', {}, h('td', {}, dtShort(o.recorded_at)), h('td', {}, fmtN(o.temp)), h('td', {}, o.sys != null ? `${o.sys}/${o.dia}` : ''), h('td', {}, fmtN(o.pulse)), h('td', {}, fmtN(o.rr)), h('td', {}, fmtN(o.spo2)), h('td', {}, fmtN(o.fluid_in_ml)), h('td', {}, fmtN(o.urine_ml)), h('td', {}, obsChips(o.flags)), h('td', {}, o.by_name || '')))) : h('div', { class: 'note' }, t('common.none'))));
  root.append(h('div', { class: 'panel' }, h('h4', {}, t('adm.notes')), D.notes.length ? D.notes.slice().reverse().map((n) => h('div', { class: 'wardnote' }, h('div', { class: 'note' }, `${dtShort(n.at)} · ${t('adm.note.' + n.kind)} · ${n.by_name || ''}`), h('div', { class: 'prewrap' }, n.text))) : h('div', { class: 'note' }, t('common.none'))));
  if (D.procedures.length || D.blood.length) root.append(h('div', { class: 'panel' }, D.procedures.length ? h('div', {}, h('h4', {}, t('proc.title')), D.procedures.map((x) => h('div', {}, `${x.performed_on} · ${x.name} · ${t('proc.outcome.' + x.outcome)}`))) : null,
    D.blood.length ? h('div', {}, h('h4', {}, t('blood.title')), D.blood.map((x) => h('div', {}, `${dtShort(x.issued_at)} · ${t('blood.comp.' + x.component)} ${x.abo}${x.rh === 'pos' ? '+' : '-'} · ${t('blood.issue_status.' + x.status)}${x.reaction && x.reaction !== 'none' ? ' · ' + t('blood.reaction.' + x.reaction) : ''}`,
      x.status === 'issued' && can('blood.transfuse') ? h('button', { class: 'sm', onclick: () => transfusionDialog(x.id, refresh) }, ' ' + t('blood.record_transfusion')) : null))) : null));
  if (D.moves.length > 1) root.append(h('div', { class: 'panel' }, h('h4', {}, t('adm.moves')), D.moves.map((m) => h('div', { class: 'note' }, `${dtShort(m.at)} · ${m.from_bed ? m.from_ward + ' ' + m.from_bed + ' → ' : ''}${m.to_ward} ${m.to_bed}${m.reason && m.reason !== 'Admission' ? ' · ' + m.reason : ''}`))));
  return root;
}
function obsDialog(admId, refresh) {
  const f = formKit(); const err = h('div', { class: 'err' });
  const d = bigModal([h('h3', {}, t('adm.add_obs')), h('div', { class: 'grid' }, f.num('temp', t('vital.temp'), { step: 0.1 }), f.num('sys', t('vital.sys')), f.num('dia', t('vital.dia')), f.num('pulse', t('vital.pulse'), { step: 1 }), f.num('rr', t('vital.rr'), { step: 1 }), f.num('spo2', t('vital.spo2'), { step: 1 }), f.num('fluid_in_ml', t('adm.fluid_in'), { step: 1 }), f.num('urine_ml', t('adm.urine'), { step: 1 })), f.text('notes', t('mch.notes')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const r = await api('POST', `/api/admissions/${admId}/obs`, f.values());
      if (!r.ok) { err.textContent = r.data.errors ? Object.entries(r.data.errors).map(([k, v]) => `${t('vital.' + k)}: ${t('verr.' + v)}`).join(' · ') : (r.data.error || t('common.error')); return; }
      d.close(); const m = modal([h('h3', {}, t('adm.obs_saved')), r.data.flags.length ? h('div', { class: r.data.flags.some((x) => x.level === 'critical') ? 'banner' : 'banner info' }, h('div', { class: 'row' }, obsChips(r.data.flags))) : h('span', { class: 'tag ok' }, t('flag.none')), h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { m.close(); refresh(); } }, t('common.confirm')))]);
    } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function noteDialog(admId, refresh) {
  const f = formKit(); const err = h('div', { class: 'err' });
  const d = bigModal([h('h3', {}, t('adm.add_note')), f.select('kind', t('adm.note_type'), ['round', 'nursing', 'event', 'correction'], 'x', { blank: false, custom: (v) => t('adm.note.' + v) }), f.area('text', t('adm.note_text')), h('p', { class: 'note' }, t('adm.note_help')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const r = await api('POST', `/api/admissions/${admId}/notes`, f.values()); if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); refresh(); } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
async function transferDialog(a, refresh) {
  const board = (await api('GET', '/api/wards')).data; const free = board.wards.flatMap((w) => w.beds.filter((b) => b.status === 'active' && !b.admission).map((b) => ({ id: b.id, text: `${w.name} · ${b.label}` })));
  const sel = h('select', {}, free.map((b) => h('option', { value: b.id }, b.text))); const why = h('input', { 'aria-label': t('adm.move_reason') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('adm.move')), h('label', {}, t('adm.bed'), sel), h('label', {}, t('adm.move_reason'), why), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    let r = await api('POST', `/api/admissions/${a.id}/transfer`, { bed_id: sel.value, reason: why.value });
    if (r.status === 409 && r.data.isolation_ward_needed) { const o = prompt(t('adm.isolation_text') + '\n' + t('adm.isolation_why')); if (o) r = await api('POST', `/api/admissions/${a.id}/transfer`, { bed_id: sel.value, reason: why.value, isolation_override: o }); }
    if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); refresh();
  } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function dischargeDialog(a, p, refresh) {
  const f = formKit(); const err = h('div', { class: 'err' }); let dx = null; const chosen = h('div', { class: 'note' }); const pick = icdPicker((c) => { dx = c.code; chosen.textContent = `${c.code} · ${c.name}`; });
  const death = h('div'); const typeSel = f.select('discharge_type', t('adm.how_ended'), ['discharged', 'referred', 'transferred', 'absconded', 'died'], 'x', { blank: false, custom: (v) => t('adm.dtype.' + v) });
  const cause = f.text('cause_of_death', t('adm.cause_of_death')); death.append(cause); death.hidden = true;
  const d = bigModal([h('h3', {}, `${t('adm.discharge')}: ${p.name_en}`), typeSel, death, f.text('discharge_condition', t('adm.cond_at_discharge')), f.area('stay_summary', t('adm.stay_summary')), h('label', {}, t('adm.dx_discharge')), pick, chosen, f.text('discharge_dx_text', t('adm.dx_text')),
    f.area('discharge_medicines', t('adm.discharge_meds')), f.area('follow_up', t('adm.follow_up')), f.date('follow_up_date', t('adm.follow_up_date')), h('p', { class: 'note' }, t('adm.discharge_help')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const r = await api('POST', `/api/admissions/${a.id}/discharge`, { ...f.values(), discharge_dx_code: dx });
      if (!r.ok) { err.textContent = r.data.blood_pending ? t('adm.blood_pending') : (r.data.error || t('common.error')); return; } d.close(); refresh();
    } }, t('adm.discharge')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
  document.getElementById('mf_discharge_type').addEventListener('change', (e) => { death.hidden = e.target.value !== 'died'; });
}
async function openDischargeSummary(id, pid) {
  const r = await withAccess(pid, () => api('GET', `/api/admissions/${id}/summary`)); if (!r.ok) { if (r.status !== 428) oops(r); return; }
  state.dischargeSummary = r.data; state.view = 'dischargeprint'; render();
}
async function dischargePrintView() {
  const s = state.dischargeSummary, a = s.admission, p = s.patient; const dxLine = (x) => (x ? `${x.code ? x.code + ' ' : ''}${x.name}` : '—');
  return h('div', { class: 'summary' }, h('div', { class: 'row noprint' }, h('button', { onclick: () => { state.view = 'admission'; render(); } }, '← ' + t('common.back')), h('button', { class: 'pri', onclick: () => window.print() }, t('adm.print_summary'))),
    letterHead(t('adm.summary_title'), `${a.adm_no} · ${dtShort(a.admitted_at)} → ${dtShort(a.discharged_at)}`), h('h3', {}, p.name_en), h('div', {}, `${p.mrn} · ${sexLabel(p.sex)} · ${p.dob} (${ageText(p.dob)})`),
    h('p', {}, `${t('adm.bed')}: ${a.ward} · ${t('adm.los')}: ${a.los_days} ${t('rx.days')} · ${t('adm.how_ended')}: ${t('adm.dtype.' + a.discharge_type)}`),
    h('h4', {}, t('adm.reason')), h('div', {}, a.reason), h('h4', {}, t('adm.dx')), h('div', {}, dxLine(s.admit_dx)), h('h4', {}, t('adm.dx_discharge')), h('div', {}, dxLine(s.discharge_dx)), h('h4', {}, t('adm.stay_summary')), h('div', { class: 'prewrap' }, a.stay_summary),
    s.procedures.length ? h('div', {}, h('h4', {}, t('proc.title')), s.procedures.map((x) => h('div', {}, `${x.performed_on} · ${x.name}`))) : null, s.transfusions.length ? h('div', {}, h('h4', {}, t('blood.title')), s.transfusions.map((x) => h('div', {}, `${x.date} · ${t('blood.comp.' + x.component)}${x.reaction && x.reaction !== 'none' ? ' · ' + t('blood.reaction.' + x.reaction) : ''}`))) : null,
    s.results.length ? h('div', {}, h('h4', {}, t('vs.results')), s.results.map((x) => h('div', {}, `${x.name}: ${x.result_value}${x.unit ? ' ' + x.unit : ''}`))) : null, h('h4', {}, t('adm.cond_at_discharge')), h('div', {}, a.discharge_condition), a.cause_of_death ? h('div', {}, `${t('adm.cause_of_death')}: ${a.cause_of_death}`) : null,
    a.discharge_medicines ? h('div', {}, h('h4', {}, t('adm.discharge_meds')), h('div', { class: 'prewrap' }, a.discharge_medicines)) : null, a.follow_up ? h('div', {}, h('h4', {}, t('adm.follow_up')), h('div', { class: 'prewrap' }, a.follow_up)) : null,
    s.next_appointment ? h('div', { class: 'banner info' }, h('b', {}, t('vs.next') + ': '), `${s.next_appointment.appt_date}${s.next_appointment.appt_time ? ' ' + s.next_appointment.appt_time : ''}`) : null,
    h('h4', {}, t('allergy.title')), s.allergies.length ? s.allergies.map((x) => h('div', {}, `${x.allergen}${x.reaction ? ' – ' + x.reaction : ''}`)) : h('div', {}, t('allergy.none')), h('p', {}, `${t('ref.signed')}: ${a.discharged_by_name || ''}`), h('div', { class: 'sigline' }, t('ref.signature')), h('p', { class: 'note' }, t('adm.summary_footer')));
}

/* ---------------- patient page panels ---------------- */
function inpatientPanels(p) {
  const out = [];
  if (state.admissions) { const cur = state.admissions.find((x) => x.status === 'admitted');
    out.push(h('div', { class: 'panel' }, h('h4', {}, t('adm.title')), cur ? h('div', { class: 'banner info' }, h('b', {}, `${t('adm.status.admitted')}: ${cur.ward} · ${cur.bed}`), ' ', h('button', { class: 'sm', onclick: () => openAdmission(cur.id, p.id) }, t('mch.open'))) : null,
      state.admissions.filter((x) => x.status !== 'admitted').map((x) => h('div', { class: 'row' }, `${x.adm_no} · ${String(x.admitted_at).slice(0, 10)} → ${String(x.discharged_at).slice(0, 10)}`, h('span', { class: 'tag' }, t('adm.dtype.' + x.discharge_type)), h('button', { class: 'sm', onclick: () => openAdmission(x.id, p.id) }, t('mch.open')))),
      !cur && !state.admissions.length ? h('div', { class: 'note' }, t('common.none')) : null,
      !cur && can('adm.write') ? h('button', { class: 'sm pri', onclick: async () => { const b = (await api('GET', '/api/wards')).data; const free = b.wards.flatMap((w) => w.beds.filter((x) => x.status === 'active' && !x.admission).map((x) => ({ id: x.id, w, label: x.label })));
        const sel = h('select', {}, free.map((x) => h('option', { value: x.id }, `${x.w.name} · ${x.label}`))); const d = modal([h('h3', {}, t('adm.admit')), h('label', {}, t('adm.bed'), sel), h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { d.close(); const x = free.find((y) => String(y.id) === sel.value); admitDialog(p, x.id, x.w, () => {}); } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]); } }, '+ ' + t('adm.admit')) : null));
  }
  if (state.procs) out.push(h('div', { class: 'panel' }, h('h4', {}, t('proc.title')), state.procs.length ? state.procs.map((x) => h('div', { class: 'row' }, `${x.performed_on} · ${x.name}`, h('span', { class: 'tag ' + (x.outcome === 'complication' ? 'warn' : '') }, t('proc.outcome.' + x.outcome)), x.surgical ? h('span', { class: 'tag' }, t('proc.surgical')) : null,
    can('proc.write') ? h('button', { class: 'sm', onclick: () => voidDialog(t('child.void'), `/api/procedures/${x.id}/void`, p) }, t('child.void')) : null)) : h('div', { class: 'note' }, t('common.none')), can('proc.write') ? h('button', { class: 'sm', onclick: () => procedureDialog(p, () => openPatient(p.id)) }, '+ ' + t('proc.record')) : null));
  if (state.blood) out.push(h('div', { class: 'panel' }, h('h4', {}, t('blood.title')), h('div', { class: 'row' }, h('b', {}, t('blood.group') + ': '), state.blood.recipient_group ? h('span', { class: 'tag ok' }, state.blood.recipient_group) : h('span', { class: 'tag warn' }, t('blood.group_unknown'))),
    state.blood.issues.length ? state.blood.issues.map((i) => h('div', { class: 'row' }, `${String(i.issued_at).slice(0, 10)} · ${t('blood.comp.' + i.component)} ${groupLabel(i)}`, h('span', { class: 'tag' }, t('blood.issue_status.' + i.status)), i.transfusion && i.transfusion.reaction !== 'none' ? h('span', { class: 'tag crit' }, t('blood.reaction.' + i.transfusion.reaction)) : null,
      i.status === 'issued' && can('blood.transfuse') ? h('button', { class: 'sm', onclick: () => transfusionDialog(i.id, () => openPatient(p.id)) }, t('blood.record_transfusion')) : null)) : h('div', { class: 'note' }, t('common.none')),
    can('blood.issue') ? h('button', { class: 'sm', onclick: () => issueBloodDialog(p, () => openPatient(p.id)) }, '+ ' + t('blood.issue')) : null));
  return out;
}

/* ---------------- procedures ---------------- */
async function procedureDialog(p, after) {
  await loadProcTypes(); const f = formKit(); const err = h('div', { class: 'err' }); const types = state.procTypes.filter((x) => x.surgical ? can('proc.surgical') : true);
  const sel = h('select', { id: 'mf_type_code', 'aria-label': t('proc.type') }, types.map((x) => h('option', { value: x.code }, x.name + (x.surgical ? ' ⚕' : '')))); const check = h('div');
  const showCheck = () => { const ty = types.find((x) => x.code === sel.value); check.replaceChildren(...(ty && ty.surgical ? [h('div', { class: 'banner info' }, h('b', {}, t('proc.checklist')), h('div', { class: 'checks' }, f.check('checklist_signin', t('proc.signin'), false), f.check('checklist_timeout', t('proc.timeout'), false), f.check('checklist_signout', t('proc.signout'), false)))] : [])); };
  sel.addEventListener('change', showCheck);
  const d = bigModal([h('h3', {}, `${t('proc.record')}: ${p.name_en || p.mrn}`), h('label', {}, t('proc.type'), sel), h('div', { class: 'grid' }, f.date('performed_on', t('child.date'), new Date().toISOString().slice(0, 10)), f.text('performed_time', t('appt.time'), { placeholder: 'HH:MM' }), f.select('anaesthesia', t('proc.anaesthesia'), ['none', 'local', 'spinal', 'general', 'sedation'], 'x', { blank: false, custom: (v) => t('proc.anaes.' + v) }), f.text('assistant', t('proc.assistant'))),
    f.text('indication', t('proc.indication')), h('div', { class: 'row' }, f.check('consent_obtained', t('proc.consent'), false)), f.text('consent_note', t('proc.consent_note')), h('p', { class: 'note' }, t('proc.consent_help')), check, f.area('findings', t('proc.findings')),
    h('div', { class: 'grid' }, f.select('outcome', t('proc.outcome'), ['uncomplicated', 'complication', 'referred'], 'x', { blank: false, custom: (v) => t('proc.outcome.' + v) }), f.text('complications', t('proc.complications'))), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const r = await api('POST', `/api/patients/${p.id}/procedures`, { ...f.values(), type_code: sel.value });
      if (!r.ok) { err.textContent = r.data.problems ? r.data.problems.map((x) => t('proc.problem.' + x)).join(' ') : (r.data.error || t('common.error')); return; } d.close(); after();
    } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]); showCheck();
}
async function proceduresView() {
  await loadProcTypes(); const from = state.procFrom || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to = state.procTo || new Date().toISOString().slice(0, 10);
  const r = await api('GET', `/api/procedures?from=${from}&to=${to}`); const rows = r.data.procedures || [];
  const f = h('input', { type: 'date', value: from, 'aria-label': t('proc.from') }), tt = h('input', { type: 'date', value: to, 'aria-label': t('proc.to') });
  return h('div', {}, h('div', { class: 'row' }, h('label', { class: 'check' }, t('proc.from'), f), h('label', { class: 'check' }, t('proc.to'), tt), h('button', { class: 'sm', onclick: () => { state.procFrom = f.value; state.procTo = tt.value; render(); } }, t('queue.refresh')),
    can('proc.write') ? h('button', { class: 'sm pri', onclick: () => pickPatient((p) => procedureDialog(p, () => render())) }, '+ ' + t('proc.record')) : null),
    h('div', { class: 'panel tablewrap' }, rows.length ? h('table', {}, h('tr', {}, ['child.date', 'patient.name_en', 'proc.type', 'proc.outcome', 'proc.by'].map((k) => h('th', {}, t(k)))),
      rows.map((x) => h('tr', { class: 'click', onclick: () => openPatient(x.patient.id) }, h('td', {}, x.performed_on), h('td', {}, x.patient.name_en || x.patient.mrn, x.patient.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null), h('td', {}, x.name, x.surgical ? h('span', { class: 'tag' }, ' ' + t('proc.surgical')) : null),
        h('td', {}, h('span', { class: 'tag ' + (x.outcome === 'complication' ? 'warn' : '') }, t('proc.outcome.' + x.outcome))), h('td', {}, x.performed_by_name || '')))) : h('p', { class: 'note' }, t('lab.empty'))));
}

/* ---------------- blood bank ---------------- */
async function bloodView() {
  const tab = state.bloodTab || 'stock'; const refresh = () => render(); const bank = can('blood.write');
  const tabs = h('div', { class: 'row' }, ['stock', 'units', 'issued', 'history'].map((s) => h('button', { class: s === tab ? 'pri' : '', onclick: () => { state.bloodTab = s; render(); } }, t('blood.tab.' + s))), bank ? h('button', { class: 'sm pri', onclick: () => unitDialog(refresh) }, '+ ' + t('blood.add_unit')) : null);
  if (tab === 'stock') {
    const s = (await api('GET', '/api/blood/summary')).data;
    return h('div', {}, tabs, h('div', { class: 'row' }, h('span', { class: 'tag' }, `${t('blood.in_quarantine')}: ${s.in_quarantine}`), h('span', { class: 'tag ' + (s.expiring_soon ? 'warn' : '') }, `${t('blood.expiring')}: ${s.expiring_soon}`), h('span', { class: 'tag ' + (s.expired_to_discard ? 'crit' : '') }, `${t('blood.expired')}: ${s.expired_to_discard}`)),
      h('div', { class: 'panel tablewrap' }, h('table', {}, h('tr', {}, ['blood.group', 'blood.comp.red_cells', 'blood.comp.whole_blood', 'blood.comp.plasma', 'blood.comp.platelets', 'enc.status'].map((k) => h('th', {}, t(k)))),
        s.groups.map((g) => h('tr', {}, h('td', {}, h('b', {}, g.group)), h('td', {}, String(g.red_cells)), h('td', {}, String(g.whole_blood)), h('td', {}, String(g.plasma)), h('td', {}, String(g.platelets)), h('td', {}, g.low ? h('span', { class: 'tag warn' }, t('stock.low')) : h('span', { class: 'tag ok' }, 'OK')))))),
      h('p', { class: 'note' }, `${t('blood.low_note')} (${s.min_units})`));
  }
  if (tab === 'issued') {
    const r = await api('GET', '/api/blood/pending'); const rows = r.data.issues || [];
    return h('div', {}, tabs, h('div', { class: 'panel tablewrap' }, rows.length ? h('table', {}, h('tr', {}, ['audit.time', 'patient.name_en', 'blood.unit_no', 'blood.group', 'blood.component', ''].map((k) => h('th', {}, t(k)))),
      rows.map((x) => h('tr', {}, h('td', {}, dtShort(x.issued_at)), h('td', {}, x.patient.name_en || x.patient.mrn), h('td', {}, x.unit_no), h('td', {}, groupLabel(x)), h('td', {}, t('blood.comp.' + x.component)),
        h('td', {}, can('blood.transfuse') ? h('button', { class: 'sm pri', onclick: () => transfusionDialog(x.id, refresh) }, t('blood.record_transfusion')) : null, ' ', can('blood.issue') ? h('button', { class: 'sm', onclick: () => returnDialog(x.id, refresh) }, t('blood.return')) : null)))) : h('p', { class: 'note' }, t('lab.empty'))));
  }
  const r = await api('GET', '/api/blood/units?status=' + (tab === 'history' ? 'history' : 'bank')); const rows = r.data.units || [];
  return h('div', {}, tabs, h('div', { class: 'panel tablewrap' }, rows.length ? h('table', {}, h('tr', {}, ['blood.unit_no', 'blood.group', 'blood.component', 'blood.volume', 'blood.expires', 'enc.status', ''].map((k) => h('th', {}, t(k)))),
    rows.map((u) => h('tr', {}, h('td', {}, u.unit_no), h('td', {}, groupLabel(u)), h('td', {}, t('blood.comp.' + u.component)), h('td', {}, u.volume_ml + ' ml'), h('td', {}, u.expires_on), h('td', {}, h('span', { class: 'tag ' + (u.status === 'available' ? 'ok' : u.status === 'expired' || u.status === 'discarded' ? 'crit' : '') }, t('blood.ustatus.' + u.status)),
      u.status === 'discarded' && u.discard_reason ? h('span', { class: 'note' }, ' ' + (u.discard_reason === 'screening' ? t('blood.failed_screening') : u.discard_reason)) : null),
      h('td', {}, bank && u.status === 'quarantine' ? h('button', { class: 'sm', onclick: () => screeningDialog(u, refresh) }, t('blood.screening')) : null, ' ', bank && (u.status === 'quarantine' || u.status === 'available' || u.status === 'expired') && u.stored_status !== 'discarded' ? h('button', { class: 'sm', onclick: () => discardUnitDialog(u, refresh) }, t('blood.discard')) : null)))) : h('p', { class: 'note' }, t('lab.empty'))),
    h('p', { class: 'note' }, bank ? t('blood.bank_note') : t('blood.nurse_note')));
}
function unitDialog(refresh) {
  const f = formKit(); const err = h('div', { class: 'err' }); const today = new Date().toISOString().slice(0, 10);
  const d = bigModal([h('h3', {}, t('blood.add_unit')), h('div', { class: 'grid' }, f.text('unit_no', t('blood.unit_no')), f.select('abo', t('blood.abo'), ['A', 'B', 'AB', 'O'], 'x', { blank: false, raw: true }), f.select('rh', t('blood.rh'), ['pos', 'neg'], 'x', { blank: false, custom: (v) => (v === 'pos' ? '+' : '-') }),
    f.select('component', t('blood.component'), ['red_cells', 'whole_blood', 'plasma', 'platelets'], 'x', { blank: false, custom: (v) => t('blood.comp.' + v) }), f.num('volume_ml', t('blood.volume'), { step: 1 }), f.date('collected_on', t('blood.collected'), today), f.date('expires_on', t('blood.expires')), f.text('donor_ref', t('blood.donor_ref'))), h('p', { class: 'note' }, t('blood.donor_note')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const r = await api('POST', '/api/blood/units', f.values()); if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); refresh(); } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function screeningDialog(u, refresh) {
  const f = formKit(); const err = h('div', { class: 'err' });
  const d = bigModal([h('h3', {}, `${t('blood.screening')}: ${u.unit_no} (${groupLabel(u)})`), h('div', { class: 'grid' }, ['hiv', 'hbv', 'hcv', 'syphilis', 'malaria'].map((k) => f.select(k, t('blood.test.' + k), ['pending', 'negative', 'positive'], 'x', { blank: false, value: u.tests[k], custom: (v) => t('blood.result.' + v) }))), h('p', { class: 'note' }, t('blood.screening_help')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const r = await api('POST', `/api/blood/units/${u.id}/screening`, f.values()); if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); alert(t('blood.outcome.' + r.data.outcome)); refresh(); } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function discardUnitDialog(u, refresh) {
  const why = h('input', { 'aria-label': t('enc.cancel_reason') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, `${t('blood.discard')}: ${u.unit_no}`), h('label', {}, t('enc.cancel_reason'), why), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const r = await api('POST', `/api/blood/units/${u.id}/discard`, { reason: why.value }); if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); refresh(); } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
async function issueBloodDialog(p, after) {
  const info = (await withAccess(p.id, () => api('GET', `/api/patients/${p.id}/blood`))); if (!info.ok) { if (info.status !== 428) oops(info); return; } const B = info.data; const f = formKit(); const err = h('div', { class: 'err' });
  const sel = h('select', { id: 'bl_unit', 'aria-label': t('blood.unit') }, B.candidates.map((u) => h('option', { value: u.id }, `${u.unit_no} · ${groupLabel(u)} · ${t('blood.comp.' + u.component)} · ${t('blood.expires')} ${u.expires_on}`)));
  const d = bigModal([h('h3', {}, `${t('blood.issue')}: ${p.name_en || p.mrn}`), B.recipient_group ? h('div', { class: 'tag ok' }, `${t('blood.group')}: ${B.recipient_group}`) : h('div', { class: 'banner' }, '⚠ ' + t('blood.group_unknown_help')),
    B.candidates.length ? h('label', {}, t('blood.unit'), sel) : h('div', { class: 'banner info' }, t('blood.no_candidates')), f.text('indication', t('blood.indication')),
    B.recipient_group ? h('div', { class: 'row' }, f.check('crossmatch', t('blood.crossmatch_done'), false)) : h('div', {}, h('div', { class: 'row' }, f.check('emergency_override', t('blood.emergency'), false)), f.text('emergency_reason', t('blood.emergency_reason')), h('p', { class: 'note' }, t('blood.emergency_help'))), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const v = f.values(); const r = await api('POST', `/api/patients/${p.id}/blood-issues`, { unit_id: sel.value, indication: v.indication, crossmatch: v.crossmatch ? 'compatible' : undefined, emergency_override: v.emergency_override, emergency_reason: v.emergency_reason });
      if (!r.ok) { err.textContent = r.data.reasons ? r.data.reasons.map((x) => t('blood.why.' + x)).join(' ') : (r.data.error || t('common.error')); return; } d.close(); alert(t('blood.issued_note')); after();
    } }, t('blood.issue')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function transfusionDialog(issueId, refresh) {
  const f = formKit(); const err = h('div', { class: 'err' });
  const d = bigModal([h('h3', {}, t('blood.record_transfusion')), h('h4', {}, t('blood.before')), h('div', { class: 'grid' }, f.num('pre_temp', t('vital.temp'), { step: 0.1 }), f.num('pre_pulse', t('vital.pulse'), { step: 1 }), f.num('pre_sys', t('vital.sys')), f.num('pre_dia', t('vital.dia'))),
    h('h4', {}, t('blood.after')), h('div', { class: 'grid' }, f.num('post_temp', t('vital.temp'), { step: 0.1 }), f.num('post_pulse', t('vital.pulse'), { step: 1 }), f.num('post_sys', t('vital.sys')), f.num('post_dia', t('vital.dia'))),
    h('div', { class: 'grid' }, f.num('volume_given_ml', t('blood.volume_given'), { step: 1 }), f.text('started_at', t('blood.started'), { placeholder: 'YYYY-MM-DD HH:MM' }), f.text('ended_at', t('blood.ended'), { placeholder: 'YYYY-MM-DD HH:MM' }), f.select('reaction', t('blood.reaction'), ['none', 'mild', 'severe'], 'x', { blank: false, custom: (v) => t('blood.reaction.' + v) })), f.text('reaction_note', t('blood.reaction_note')), h('p', { class: 'note' }, t('blood.baseline_help')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const r = await api('POST', `/api/blood-issues/${issueId}/transfusion`, f.values()); if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close();
      if (r.data.reaction === 'severe') alert(t('blood.severe_act')); refresh();
    } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function returnDialog(issueId, refresh) {
  const why = h('input', { 'aria-label': t('enc.cancel_reason') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('blood.return')), h('p', {}, t('blood.return_help')), h('label', {}, t('enc.cancel_reason'), why), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const r = await api('POST', `/api/blood-issues/${issueId}/return`, { reason: why.value }); if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); refresh(); } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
