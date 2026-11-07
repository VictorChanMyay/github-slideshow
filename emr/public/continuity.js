'use strict';
/* Continuity of care: combined follow-up list, appointments and reminders, referrals, printable referral letter and visit summary.
   Shares globals with the other scripts (h, t, api, state, can, modal, bigModal, formKit, withAccess, openPatient, ...). */

const today = () => new Date().toISOString().slice(0, 10);
const addD = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
async function loadContMeta() { if (!state.contMeta && (can('appt.read') || can('ref.read'))) state.contMeta = (await api('GET', '/api/continuity/meta')).data; }
const urgencyChip = (u) => h('span', { class: 'tag ' + (u === 'emergency' ? 'crit' : u === 'urgent' ? 'warn' : '') }, t('ref.urgency.' + u));
const refStatusChip = (r) => h('span', { class: 'tag ' + (r.status === 'completed' ? 'ok' : r.status === 'cancelled' ? '' : r.overdue ? 'crit' : 'warn') }, t('ref.status.' + r.status));

/* ---- pick a patient (used by "new appointment") ---- */
function pickPatient(onPick) {
  const q = h('input', { placeholder: t('patients.search'), 'aria-label': t('patients.search') }); const out = h('div'); let timer;
  const d = modal([h('h3', {}, t('fu.pick_patient')), q, out, h('div', { class: 'row' }, h('button', { onclick: () => d.close() }, t('common.cancel')))]);
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (q.value.trim().length < 2) { out.replaceChildren(); return; }
    const r = await api('GET', '/api/patients?q=' + encodeURIComponent(q.value));
    out.replaceChildren(...(r.data.patients || []).slice(0, 8).map((p) => h('div', { class: 'pick', tabindex: '0', role: 'button', onclick: () => { d.close(); onPick(p); }, onkeydown: (e) => { if (e.key === 'Enter') e.target.click(); } }, `${p.mrn} · ${p.name_en} · ${ageText(p.dob)}`)));
  }, 250); });
}

/* ---- follow-up list ---- */
function fuDetail(x) {
  const d = x.detail || {};
  if (x.kind === 'appointment') return `${t('fu.purpose.' + d.purpose)} · ${t('fu.state.' + d.state)}${d.time ? ' ' + d.time : ''}`;
  if (x.kind === 'referral') return `${d.ref_no} · ${t('ref.urgency.' + d.urgency)} · ${t('ref.status.' + d.status)}`;
  if (x.kind === 'anc') return `${d.ga || ''}${d.week ? ' · ' + t('mch.next_contact') + ' ' + d.week + 'w' : ''}`;
  if (x.kind === 'postnatal') return `${d.days} ${t('mch.days_pp')}`;
  if (x.kind === 'fp') return t('mch.fpm.' + d.method);
  if (x.kind === 'immunization') return `${d.overdue} ${t('child.imm.status.overdue')} · ${d.due} ${t('child.imm.status.due')}`;
  if (x.kind === 'programme') return t('prog.name.' + d.program) + (d.condition ? ' · ' + t('prog.o.condition.' + d.condition) : '');
  return '';
}
function fuOpen(x) {
  const d = x.detail || {}; const pid = x.patient.id;
  if (x.kind === 'appointment') { state.apptDate = x.due_on; state.apptTab = 'day'; state.view = 'appointments'; render(); }
  else if (x.kind === 'referral') openReferral(d.referral_id, pid);
  else if (x.kind === 'anc' || x.kind === 'postnatal') openEpisode(d.episode_id, pid);
  else if (x.kind === 'programme') openEnrolment(d.enrolment_id, pid);
  else openPatient(pid);
}
async function followupView() {
  const r = await api('GET', '/api/followup'); const all = r.data.items || []; const kinds = [...new Set(all.map((x) => x.kind))]; const sel = state.fuKind || 'all';
  const rows = all.filter((x) => sel === 'all' || x.kind === sel);
  return h('div', {}, h('div', { class: 'row' }, ['all'].concat(kinds).map((k) => h('button', { class: 'sm ' + (k === sel ? 'pri' : ''), onclick: () => { state.fuKind = k; render(); } }, k === 'all' ? `${t('fu.all')} (${all.length})` : `${t('fu.kind.' + k)} (${all.filter((x) => x.kind === k).length})`))),
    h('div', { class: 'panel tablewrap' }, rows.length ? h('table', {}, h('tr', {}, ['fu.what', 'patient.name_en', 'fu.detail', 'child.due_on', 'patient.phone'].map((k) => h('th', {}, t(k)))),
      rows.map((x) => h('tr', { class: 'click', onclick: () => fuOpen(x) }, h('td', {}, h('span', { class: 'tag ' + (x.urgency === 2 ? 'crit' : x.urgency === 1 ? 'warn' : '') }, t('fu.kind.' + x.kind))),
        h('td', {}, x.patient.name_en || x.patient.mrn, x.patient.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null), h('td', {}, fuDetail(x)),
        h('td', {}, x.due_on ? x.due_on + (x.days_overdue ? ` (${x.days_overdue} ${t('rx.days')})` : '') : '—'), h('td', {}, x.phone || '—')))) : h('p', { class: 'note' }, t('fu.empty'))), h('p', { class: 'note' }, t('fu.note')));
}

/* ---- appointments ---- */
function apptDialog(p, encounterId, after) {
  const f = formKit(); const err = h('div', { class: 'err' }); const meta = state.contMeta;
  const d = bigModal([h('h3', {}, t('appt.new') + ': ' + (p.name_en || p.mrn)), h('div', { class: 'grid' }, f.date('appt_date', t('appt.date'), addD(today(), 7)), f.text('appt_time', t('appt.time'), { placeholder: 'HH:MM' }), f.select('purpose', t('appt.purpose'), meta.purposes, 'x', { blank: false, custom: (v) => t('fu.purpose.' + v) })),
    f.text('note', t('appt.note')), h('p', { class: 'note' }, t('appt.note_warning')), h('div', { class: 'row' }, f.check('reminder_ok', t('appt.reminder_ok'), false)), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const r = await api('POST', `/api/patients/${p.id}/appointments`, { ...f.values(), encounter_id: encounterId || undefined });
      if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); after();
    } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function apptActions(a, refresh) {
  const out = [];
  if (a.status === 'scheduled' && can('appt.write')) {
    out.push(h('button', { class: 'sm', onclick: () => moveDialog(a, refresh) }, t('appt.move')), ' ', h('button', { class: 'sm', onclick: () => {
      const r = h('input', { 'aria-label': t('enc.cancel_reason') }); const err = h('div', { class: 'err' });
      const d = modal([h('h3', {}, t('appt.cancel')), h('label', {}, t('enc.cancel_reason'), r), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const x = await api('POST', `/api/appointments/${a.id}/cancel`, { reason: r.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); refresh(); } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
    } }, t('common.remove')));
  }
  return out;
}
function moveDialog(a, refresh) {
  const f = formKit(); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('appt.move')), h('div', { class: 'grid' }, f.date('appt_date', t('appt.date'), addD(today(), 7)), f.text('appt_time', t('appt.time'), { placeholder: 'HH:MM' })), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    const x = await api('POST', `/api/appointments/${a.id}/reschedule`, f.values()); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); refresh();
  } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function reminderDialog(a, refresh) {
  const m = h('select', {}, state.contMeta.methods.map((x) => h('option', { value: x }, t('fu.method.' + x)))); const r = h('select', {}, state.contMeta.results.map((x) => h('option', { value: x }, t('fu.result.' + x)))); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('appt.log_contact') + ': ' + (a.patient.name_en || a.patient.mrn)), a.phone ? h('p', {}, '📞 ' + a.phone) : null, h('label', {}, t('appt.method'), m), h('label', {}, t('appt.result'), r), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    const x = await api('POST', `/api/appointments/${a.id}/reminder`, { method: m.value, result: r.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); refresh();
  } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
async function appointmentsView() {
  await loadContMeta(); const tab = state.apptTab || 'day'; const day = state.apptDate || today(); const refresh = () => render();
  const tabs = h('div', { class: 'row' }, ['day', 'calls'].map((s) => h('button', { class: s === tab ? 'pri' : '', onclick: () => { state.apptTab = s; render(); } }, t('appt.tab.' + s))),
    can('appt.write') ? h('button', { class: 'sm pri', onclick: () => pickPatient((p) => apptDialog(p, null, refresh)) }, '+ ' + t('appt.new')) : null);
  if (tab === 'calls') {
    const r = await api('GET', '/api/appointments/calllist'); const rows = r.data.rows || [];
    return h('div', {}, tabs, h('div', { class: 'panel tablewrap' }, rows.length ? h('table', {}, h('tr', {}, ['patient.name_en', 'appt.date', 'appt.purpose', 'enc.status', 'patient.phone', ''].map((k) => h('th', {}, t(k)))),
      rows.map((a) => h('tr', {}, h('td', {}, a.patient.name_en || a.patient.mrn), h('td', {}, a.appt_date + (a.appt_time ? ' ' + a.appt_time : '')), h('td', {}, t('fu.purpose.' + a.purpose)), h('td', {}, h('span', { class: 'tag ' + (a.reason === 'missed' ? 'crit' : 'warn') }, t('fu.reason.' + a.reason)), a.reminders.length ? h('span', { class: 'note' }, ' ' + a.reminders.map((x) => t('fu.result.' + x.result)).join(', ')) : null),
        h('td', {}, a.phone || '—'), h('td', {}, can('appt.write') ? h('button', { class: 'sm', onclick: () => reminderDialog(a, refresh) }, t('appt.log_contact')) : null)))) : h('p', { class: 'note' }, t('fu.empty'))), h('p', { class: 'note' }, t('appt.calls_note')));
  }
  const r = await api('GET', `/api/appointments?from=${day}&to=${addD(day, 13)}`); const rows = (r.data.rows || []).filter((a) => a.appt_date === day); const counts = r.data.counts || {};
  const nav = h('div', { class: 'row' }, h('button', { class: 'sm', onclick: () => { state.apptDate = addD(day, -1); render(); } }, '◀'), h('input', { type: 'date', value: day, 'aria-label': t('appt.date'), onchange: (e) => { if (e.target.value) { state.apptDate = e.target.value; render(); } } }), h('button', { class: 'sm', onclick: () => { state.apptDate = addD(day, 1); render(); } }, '▶'), h('button', { class: 'sm', onclick: () => { state.apptDate = today(); render(); } }, t('appt.today')));
  const load = h('div', { class: 'row' }, Array.from({ length: 14 }, (_, i) => addD(day, i)).map((d) => h('button', { class: 'sm ' + (d === day ? 'pri' : ''), onclick: () => { state.apptDate = d; render(); } }, `${d.slice(5)} (${counts[d] || 0})`)));
  return h('div', {}, tabs, nav, load, h('div', { class: 'panel tablewrap' }, rows.length ? h('table', {}, h('tr', {}, ['appt.time', 'patient.name_en', 'appt.purpose', 'enc.status', 'patient.phone', ''].map((k) => h('th', {}, t(k)))),
    rows.map((a) => h('tr', {}, h('td', {}, a.appt_time || '—'), h('td', {}, a.patient.name_en || a.patient.mrn, a.patient.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null, a.note ? h('div', { class: 'note' }, a.note) : null), h('td', {}, t('fu.purpose.' + a.purpose)),
      h('td', {}, h('span', { class: 'tag ' + (a.status === 'attended' ? 'ok' : a.status === 'missed' ? 'crit' : '') }, t('fu.astatus.' + a.status)), a.cancel_reason ? h('span', { class: 'note' }, ' ' + a.cancel_reason) : null), h('td', {}, a.phone || '—'), h('td', {}, apptActions(a, refresh))))) : h('p', { class: 'note' }, t('fu.empty'))));
}

/* ---- patient page panels ---- */
function continuityPanels(p) {
  const out = [];
  if (state.appts) out.push(h('div', { class: 'panel' }, h('h4', {}, t('appt.title')), state.appts.length ? state.appts.map((a) => h('div', { class: 'row' }, h('span', {}, `${a.appt_date}${a.appt_time ? ' ' + a.appt_time : ''} · ${t('fu.purpose.' + a.purpose)}`), h('span', { class: 'tag ' + (a.status === 'attended' ? 'ok' : a.status === 'missed' ? 'crit' : '') }, t('fu.astatus.' + a.status)), apptActions(a, () => openPatient(p.id)))) : h('div', { class: 'note' }, t('common.none')),
    can('appt.write') ? h('button', { class: 'sm', onclick: () => apptDialog(p, null, () => openPatient(p.id)) }, '+ ' + t('appt.new')) : null));
  if (state.refs) out.push(h('div', { class: 'panel' }, h('h4', {}, t('ref.title')), state.refs.length ? state.refs.map((r) => h('div', { class: 'row' }, h('b', {}, r.ref_no), r.destination_name, urgencyChip(r.urgency), refStatusChip(r), h('button', { class: 'sm', onclick: () => openReferral(r.id, p.id) }, t('mch.open')))) : h('div', { class: 'note' }, t('common.none')),
    can('ref.write') ? h('button', { class: 'sm', onclick: () => referralDialog(p, null) }, '+ ' + t('ref.new')) : null));
  return out;
}

/* ---- referrals ---- */
async function referralDialog(p, encounterId) {
  await loadContMeta(); const dests = (await api('GET', '/api/referrals/destinations')).data.destinations || [];
  const f = formKit(); const err = h('div', { class: 'err' });
  const dsel = h('select', { id: 'rf_dest', 'aria-label': t('ref.destination') }, dests.map((d) => h('option', { value: d.id }, d.name)), h('option', { value: '' }, t('ref.other_dest'))); const other = h('input', { 'aria-label': t('ref.other_dest'), placeholder: t('ref.other_dest') });
  const summary = h('textarea', { rows: 8, id: 'rf_summary', 'aria-label': t('ref.summary') });
  const body = h('div', {}, h('label', {}, t('ref.destination'), dsel), other, h('div', { class: 'grid' }, f.text('service', t('ref.service')), f.select('urgency', t('ref.urgency'), state.contMeta.urgencies, 'x', { blank: false, value: 'routine', custom: (v) => t('ref.urgency.' + v) })),
    f.text('reason', t('ref.reason')), h('label', {}, t('ref.summary'), summary), encounterId ? h('button', { class: 'sm', onclick: async () => { const r = await api('GET', `/api/encounters/${encounterId}/referral-draft`); if (r.ok) summary.value = r.data.summary; } }, t('ref.fill')) : null,
    h('p', { class: 'note' }, t('ref.sensitive_note')), f.text('needs', t('ref.needs')), h('div', { class: 'row' }, f.check('consent_to_share', t('ref.consent'), false)), f.text('consent_note', t('ref.consent_note')), h('p', { class: 'note' }, t('ref.consent_help')));
  const d = bigModal([h('h3', {}, t('ref.new') + ': ' + p.name_en), body, err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    err.textContent = ''; const v = f.values(); const payload = { ...v, clinical_summary: summary.value, encounter_id: encounterId || undefined };
    if (dsel.value) payload.destination_id = dsel.value; else payload.destination_name = other.value;
    const r = await api('POST', `/api/patients/${p.id}/referrals`, payload); if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); openReferral(r.data.id, p.id);
  } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
  if (encounterId) { const r = await api('GET', `/api/encounters/${encounterId}/referral-draft`); if (r.ok) summary.value = r.data.summary; }
}
async function openReferral(id, pid) {
  const r = await withAccess(pid, () => api('GET', '/api/referrals/' + id));
  if (r.status === 403) { alert(t('restricted.denied')); return; } if (!r.ok) { if (r.status !== 428) oops(r); return; }
  state.referral = r.data; state.view = 'referral'; render();
}
async function referralsView() {
  const tab = state.refTab || 'active'; const r = await api('GET', '/api/referrals?tab=' + tab); const rows = r.data.referrals || [];
  return h('div', {}, h('div', { class: 'row' }, ['active', 'closed'].map((s) => h('button', { class: s === tab ? 'pri' : '', onclick: () => { state.refTab = s; render(); } }, t('ref.tab.' + s)))),
    h('div', { class: 'panel tablewrap' }, rows.length ? h('table', {}, h('tr', {}, ['ref.number', 'patient.name_en', 'ref.destination', 'ref.urgency', 'enc.status', 'ref.waiting'].map((k) => h('th', {}, t(k)))),
      rows.map((x) => h('tr', { class: 'click', onclick: () => openReferral(x.id, x.patient.id) }, h('td', {}, x.ref_no), h('td', {}, x.patient.name_en || x.patient.mrn, x.patient.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null), h('td', {}, x.destination_name), h('td', {}, urgencyChip(x.urgency)),
        h('td', {}, refStatusChip(x)), h('td', {}, `${x.age_days} ${t('rx.days')}`, x.overdue ? h('span', { class: 'tag crit' }, ' ' + t('ref.no_reply')) : null)))) : h('p', { class: 'note' }, t('lab.empty'))), h('p', { class: 'note' }, t('ref.draftnote')));
}
async function referralView() {
  const D = state.referral, r = D.referral, p = D.patient; const refresh = () => openReferral(r.id, p.id); const root = h('div');
  root.append(h('div', { class: 'row' }, h('button', { onclick: () => { state.view = 'referrals'; render(); } }, '← ' + t('nav.referrals')), h('button', { onclick: () => openPatient(p.id) }, t('patients.title'))));
  const open = r.status === 'open', attended = r.status === 'attended';
  root.append(h('div', { class: 'panel' }, h('h3', {}, r.ref_no, ' ', urgencyChip(r.urgency), ' ', refStatusChip(r), r.overdue ? h('span', { class: 'tag crit' }, ' ' + t('ref.no_reply')) : null),
    h('div', { class: 'note' }, `${p.name_en} · ${p.mrn} · ${sexLabel(p.sex)} · ${ageText(p.dob)}`), h('div', { class: 'grid' }, h('div', {}, h('div', { class: 'note' }, t('ref.destination')), r.destination_name), h('div', {}, h('div', { class: 'note' }, t('ref.service')), r.service || '—'), h('div', {}, h('div', { class: 'note' }, t('ref.written')), `${String(r.created_at).slice(0, 10)} · ${r.created_by_name || ''}`),
      r.attended_on ? h('div', {}, h('div', { class: 'note' }, t('ref.attended_on')), r.attended_on) : null),
    h('h4', {}, t('ref.reason')), h('div', {}, r.reason), h('h4', {}, t('ref.summary')), h('div', { class: 'prewrap' }, r.clinical_summary), r.needs ? h('div', { class: 'note' }, t('ref.needs') + ': ' + r.needs) : null,
    h('div', { class: 'note' }, r.consent_to_share ? t('ref.consent_yes') : `${t('ref.consent_no')}: ${r.consent_note}`),
    r.status === 'completed' ? h('div', { class: 'banner info' }, h('b', {}, t('ref.back_title')), h('div', { class: 'prewrap' }, `${t('ref.outcome')}: ${r.back_outcome}`), r.back_treatment ? h('div', { class: 'prewrap' }, `${t('ref.treatment')}: ${r.back_treatment}`) : null, r.back_followup ? h('div', { class: 'prewrap' }, `${t('ref.followup')}: ${r.back_followup}`) : null, h('div', { class: 'note' }, `${r.back_by_name || ''} ${r.back_at || ''}`)) : null,
    r.status === 'cancelled' ? h('div', { class: 'banner info' }, `${t('ref.status.cancelled')}: ${r.cancel_reason}`) : null,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { state.view = 'referralprint'; render(); } }, t('ref.print')),
      open && can('ref.feedback') ? h('button', { onclick: async () => { const x = await api('POST', `/api/referrals/${r.id}/attended`, {}); if (x.ok) refresh(); else oops(x); } }, t('ref.mark_attended')) : null,
      (open || attended) && can('ref.feedback') ? h('button', { onclick: () => backDialog(r, refresh) }, t('ref.record_back')) : null,
      open && can('ref.write') ? h('button', { onclick: () => { const x = h('input', { 'aria-label': t('enc.cancel_reason') }); const err = h('div', { class: 'err' }); const d = modal([h('h3', {}, t('ref.cancel')), h('label', {}, t('enc.cancel_reason'), x), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const z = await api('POST', `/api/referrals/${r.id}/cancel`, { reason: x.value }); if (!z.ok) { err.textContent = z.data.error || t('common.error'); return; } d.close(); refresh(); } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]); } }, t('ref.cancel')) : null)));
  return root;
}
function backDialog(r, refresh) {
  const f = formKit(); const err = h('div', { class: 'err' });
  const d = bigModal([h('h3', {}, t('ref.record_back')), h('p', { class: 'note' }, t('ref.back_help')), f.area('outcome', t('ref.outcome')), f.area('treatment', t('ref.treatment')), f.area('followup', t('ref.followup')), f.date('attended_on', t('ref.attended_on'), r.attended_on || today()), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const x = await api('POST', `/api/referrals/${r.id}/back`, f.values()); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); refresh(); } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function letterHead(title, sub) { return h('div', { class: 'printhead' }, h('img', { src: 'assets/mtc-logo.png', alt: '', class: 'printlogo' }), h('div', {}, h('h2', {}, title), h('div', { class: 'note' }, sub))); }
async function referralPrintView() {
  const D = state.referral, r = D.referral, p = D.patient;
  return h('div', { class: 'summary' }, h('div', { class: 'row noprint' }, h('button', { onclick: () => { state.view = 'referral'; render(); } }, '← ' + t('common.back')), h('button', { class: 'pri', onclick: () => window.print() }, t('ref.print'))),
    letterHead(t('ref.letter'), `${r.ref_no} · ${String(r.created_at).slice(0, 10)}`),
    h('p', {}, h('b', {}, t('ref.to') + ': '), r.destination_name + (r.service ? ' · ' + r.service : '')), h('p', {}, h('b', {}, t('ref.urgency') + ': '), t('ref.urgency.' + r.urgency)),
    h('h3', {}, p.name_en), h('div', {}, `${p.mrn} · ${sexLabel(p.sex)} · ${p.dob} (${ageText(p.dob)})`), h('h4', {}, t('ref.reason')), h('div', {}, r.reason), h('h4', {}, t('ref.summary')), h('div', { class: 'prewrap' }, r.clinical_summary),
    h('h4', {}, t('allergy.title')), D.allergies.length ? D.allergies.map((a) => h('div', {}, `${a.allergen}${a.reaction ? ' – ' + a.reaction : ''} [${t('severity.' + a.severity)}]`)) : h('div', {}, t('allergy.none')),
    D.medicines.length ? h('div', {}, h('h4', {}, t('rx.title')), D.medicines.map((m) => h('div', {}, `${m.drug}: ${m.dose}, ${m.frequency}, ${m.duration_days} ${t('rx.days')}`))) : null, r.needs ? h('p', {}, h('b', {}, t('ref.needs') + ': '), r.needs) : null,
    h('p', { class: 'note' }, r.consent_to_share ? t('ref.consent_yes') : `${t('ref.consent_no')}: ${r.consent_note}`), h('p', {}, `${t('ref.signed')}: ${r.created_by_name || ''}`), h('div', { class: 'sigline' }, t('ref.signature')),
    h('p', { class: 'note' }, t('ref.reply_request')), h('p', { class: 'note' }, t('ref.confidential')));
}

/* ---- take-home visit summary ---- */
async function openVisitSummary(encId, pid) {
  const r = await withAccess(pid, () => api('GET', `/api/encounters/${encId}/summary`));
  if (r.status === 409) { alert(t('vs.not_signed')); return; } if (!r.ok) { if (r.status !== 428) oops(r); return; }
  state.visitSummary = r.data; state.view = 'visitprint'; render();
}
async function visitPrintView() {
  const s = state.visitSummary; const incPlan = h('input', { type: 'checkbox' }); incPlan.checked = true; const planBox = h('div');
  const showPlan = () => planBox.replaceChildren(...(incPlan.checked && s.plan ? [h('h4', {}, t('soap.plan')), h('div', { class: 'prewrap' }, s.plan)] : []));
  incPlan.addEventListener('change', showPlan); showPlan();
  return h('div', { class: 'summary' }, h('div', { class: 'row noprint' }, h('button', { onclick: () => { state.view = 'encounter'; render(); } }, '← ' + t('common.back')), h('button', { class: 'pri', onclick: () => window.print() }, t('vs.print')), h('label', { class: 'check' }, incPlan, t('vs.include_plan'))),
    letterHead(t('vs.title'), `${s.visit.date} · ${t('enc.type.' + s.visit.type)}`), h('h3', {}, s.patient.name_en), h('div', {}, `${s.patient.mrn} · ${sexLabel(s.patient.sex)} · ${s.patient.dob} (${ageText(s.patient.dob)})`),
    s.diagnoses.length ? h('div', {}, h('h4', {}, t('dx.title')), s.diagnoses.map((d) => h('div', {}, `${d.code} ${d.name}${d.certainty === 'suspected' ? ' (' + t('dx.cert.suspected') + ')' : ''}`))) : null,
    s.medicines.length ? h('div', {}, h('h4', {}, t('rx.title')), s.medicines.map((m) => h('div', {}, h('b', {}, m.drug), `: ${m.dose}, ${m.frequency}, ${m.duration_days} ${t('rx.days')}`, m.instructions ? ' – ' + m.instructions : ''))) : null,
    s.results.length ? h('div', {}, h('h4', {}, t('vs.results')), s.results.map((x) => h('div', {}, `${x.name}: ${x.result_value}${x.unit ? ' ' + x.unit : ''}`))) : null, planBox,
    h('h4', {}, t('allergy.title')), s.allergies.length ? s.allergies.map((a) => h('div', {}, `${a.allergen}${a.reaction ? ' – ' + a.reaction : ''}`)) : h('div', {}, t('allergy.none')),
    s.next_appointment ? h('div', { class: 'banner info' }, h('b', {}, t('vs.next') + ': '), `${s.next_appointment.appt_date}${s.next_appointment.appt_time ? ' ' + s.next_appointment.appt_time : ''} · ${t('fu.purpose.' + s.next_appointment.purpose)}`) : null,
    h('p', {}, `${t('ref.signed')}: ${s.visit.signed_by || ''}`), h('p', { class: 'note' }, t('vs.footer')));
}
