'use strict';
/* Programme screens: TB, HIV, malaria, malnutrition, chronic disease. Forms are generated from the server's field definitions
   (/api/programs/meta), so labels and options come from i18n keys prog.f.<field> and prog.o.<field>.<value>. */

const PROG_ORDER = ['tb', 'hiv', 'malaria', 'nutrition', 'chronic'];
async function loadProgMeta() { if (!state.progMeta && can('prog.read')) state.progMeta = (await api('GET', '/api/programs/meta')).data.programs; }
const progChips = (flags) => (flags || []).map((f) => h('span', { class: 'tag ' + (f.level === 'critical' ? 'crit' : f.level === 'warn' ? 'warn' : 'ok') }, (f.level === 'info' ? '✓ ' : '⚠ ') + t('prog.flag.' + f.code)));
const progName = (e) => t('prog.name.' + e.program) + (e.condition ? ' · ' + t('prog.o.condition.' + e.condition) : '');
const fmtVal = (spec, v) => (spec.type === 'bool' ? t('common.yes') : spec.type === 'enum' ? t('prog.o.' + spec.key + '.' + v) : spec.type === 'list' ? v.map((x) => t('prog.o.' + spec.key + '.' + x)).join(', ') : String(v));
const dueChip = (due) => (!due || !due.next_due ? null : h('span', { class: 'tag ' + (due.state === 'overdue' ? 'crit' : due.state === 'due_soon' ? 'warn' : '') }, `${t('child.due_on')}: ${due.next_due}` + (due.state === 'overdue' ? ` (${due.overdue_days} ${t('rx.days')} ${t('mch.overdue')})` : '')));

/* ---- generic form from field specs ---- */
function specFields(f, specs, preset) {
  return specs.map((s) => {
    const label = t('prog.f.' + s.key);
    if (s.type === 'enum') return f.select(s.key, label + (s.required ? ' *' : ''), s.values.map((v) => v), 'x', { blank: !s.required && s.default === undefined, value: s.default, raw: false, custom: (v) => t('prog.o.' + s.key + '.' + v) });
    if (s.type === 'int' || s.type === 'num') return f.num(s.key, label, { min: s.min, max: s.max, step: s.type === 'int' ? 1 : 'any' });
    if (s.type === 'date') return f.date(s.key, label + (s.required ? ' *' : ''), (preset && preset[s.key]) || '');
    if (s.type === 'bool') return f.check(s.key, label, false);
    if (s.type === 'list') return f.checks(s.key, label, s.values, 'x', (v) => t('prog.o.' + s.key + '.' + v));
    return f.text(s.key, label);
  });
}

/* ---- patient page panel ---- */
function programPanels(p) {
  const list = state.programs; if (!list) return null;
  const rows = list.map((e) => h('div', { class: 'row' }, h('span', { class: 'tag ' + (e.status === 'active' ? 'ok' : '') }, e.status === 'active' ? t('prog.active') : t('prog.outcome.' + e.outcome)), h('b', {}, progName(e)), h('span', { class: 'note' }, e.registration_no), e.status === 'active' ? dueChip(e.due) : null, progChips(e.flags),
    h('button', { class: 'sm', onclick: () => openEnrolment(e.id, p.id) }, t('mch.open'))));
  return h('div', { class: 'panel' }, h('h4', {}, t('prog.title')), rows.length ? rows : h('div', { class: 'note' }, t('common.none')),
    can('prog.write') || can('hiv.write') ? h('button', { class: 'sm pri', onclick: () => enrolDialog(p) }, '+ ' + t('prog.enrol')) : null);
}

/* ---- enrol ---- */
function enrolDialog(p, preselect) {
  const meta = state.progMeta; const progs = PROG_ORDER.filter((k) => meta[k] && (k !== 'hiv' || can('hiv.write')) && (k === 'hiv' || can('prog.write')));
  const body = h('div'); const err = h('div', { class: 'err' }); let f; let current = preselect && progs.includes(preselect) ? preselect : progs[0];
  const sel = h('select', { 'aria-label': t('prog.programme') }, progs.map((k) => h('option', { value: k }, t('prog.name.' + k)))); sel.value = current;
  function build() { f = formKit(); body.replaceChildren(h('div', { class: 'grid' }, specFields(f, meta[current].enrol), f.date('enrolled_on', t('prog.enrolled_on'), new Date().toISOString().slice(0, 10))), h('div', { class: 'row' }, f.check('contact_consent', t('prog.consent'), false)), h('p', { class: 'note' }, t('prog.consent_note')),
    current === 'hiv' ? h('div', { class: 'banner' }, t('prog.hiv_banner')) : null); }
  sel.addEventListener('change', () => { current = sel.value; build(); }); build();
  const d = bigModal([h('h3', {}, t('prog.enrol') + ': ' + p.name_en), h('label', {}, t('prog.programme'), sel), body, err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    err.textContent = ''; const r = await api('POST', `/api/patients/${p.id}/programs`, { ...f.values(), program: current });
    if (r.status === 409 && r.data.enrolment_id) { d.close(); openEnrolment(r.data.enrolment_id, p.id); return; }
    if (!r.ok) { err.textContent = (r.data.field ? t('prog.f.' + r.data.field) + ': ' : '') + (r.data.error || t('common.error')); return; }
    d.close(); openEnrolment(r.data.id, p.id);
  } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

/* ---- enrolment screen ---- */
async function openEnrolment(id, pid) {
  await loadProgMeta();
  const r = await withAccess(pid, () => api('GET', '/api/enrolments/' + id));
  if (r.status === 403) { alert(t('restricted.denied')); return; }
  if (!r.ok) { if (r.status !== 428) oops(r); return; }
  state.enrolment = r.data; state.view = 'enrolment'; render();
}
async function enrolmentView() {
  const D = state.enrolment, e = D.enrolment; const meta = state.progMeta; const spec = meta[e.program]; const active = e.status === 'active'; const refresh = () => openEnrolment(e.id, D.patient_id);
  const canW = e.program === 'hiv' ? can('hiv.write') : can('prog.write'); const root = h('div');
  root.append(h('div', { class: 'row' }, h('button', { onclick: () => { state.view = 'programs'; render(); } }, '← ' + t('nav.programs')), h('button', { onclick: () => openPatient(D.patient_id) }, t('patients.title'))));
  if (e.program === 'hiv') root.append(h('div', { class: 'banner' }, '🔒 ' + t('prog.hiv_banner')));
  const details = spec.enrol.concat(e.program === 'tb' ? [] : []).filter((s) => e.details[s.key] !== undefined).map((s) => h('div', {}, h('div', { class: 'note' }, t('prog.f.' + s.key)), fmtVal(s, e.details[s.key])));
  if (e.details.hiv_status_hidden) details.push(h('div', {}, h('div', { class: 'note' }, t('prog.f.hiv_status')), h('span', { class: 'tag warn' }, t('lab.hidden'))));
  root.append(h('div', { class: 'panel' }, h('h3', {}, progName(e), ' ', h('span', { class: 'tag' }, e.registration_no), ' ', h('span', { class: 'tag ' + (active ? 'ok' : '') }, active ? t('prog.active') : t('prog.outcome.' + e.outcome))),
    h('div', { class: 'row' }, h('span', { class: 'note' }, `${t('prog.enrolled_on')}: ${e.enrolled_on}`), active ? dueChip(e.due) : h('span', { class: 'note' }, `${e.outcome_on} ${e.outcome_note || ''}`), h('span', { class: 'note' }, e.contact_consent ? t('prog.consent_yes') : t('prog.consent_no'))),
    h('div', { class: 'row' }, progChips(e.flags)), h('div', { class: 'grid' }, details),
    active && canW ? h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => visitDialog(e, spec, refresh) }, '+ ' + t('prog.record_visit')), h('button', { onclick: () => closeProgDialog(e, spec, refresh) }, t('prog.close'))) : null));
  if (e.schedule.length) root.append(h('div', { class: 'panel tablewrap' }, h('h4', {}, t('prog.schedule')), h('table', {}, h('tr', {}, ['prog.sched_item', 'child.due_on', 'enc.status', 'prog.result'].map((k) => h('th', {}, t(k)))),
    e.schedule.map((s) => h('tr', {}, h('td', {}, t('prog.sched_key.' + s.key)), h('td', {}, s.due_on), h('td', {}, h('span', { class: 'tag ' + (s.state === 'done' ? 'ok' : s.state === 'overdue' ? 'crit' : s.state === 'due' ? 'warn' : '') }, t('prog.sched.' + s.state))), h('td', {}, s.result ? t('prog.o.' + (e.program === 'tb' ? 'smear_result' : 'parasite_result') + '.' + s.result) : '—'))))));
  root.append(h('div', { class: 'panel tablewrap' }, h('h4', {}, t('prog.visits')), D.visits.length ? h('table', {}, h('tr', {}, ['visit.date', 'prog.findings', 'child.due_on'].map((k) => h('th', {}, t(k)))),
    D.visits.slice().reverse().map((v) => h('tr', {}, h('td', {}, v.visit_date), h('td', {}, spec.visit.filter((s) => v.data[s.key] !== undefined).map((s) => `${t('prog.f.' + s.key)}: ${fmtVal(s, v.data[s.key])}`).join(' · ') + (v.data.whz != null ? ` · ${t('child.z.whz')}: ${fmtZ(v.data.whz)}` : '')), h('td', {}, v.next_due || '')))) : h('div', { class: 'note' }, t('common.none')), h('p', { class: 'note' }, t('prog.draftnote'))));
  return root;
}
function visitDialog(e, spec, refresh) {
  const f = formKit(); const err = h('div', { class: 'err' });
  const d = bigModal([h('h3', {}, t('prog.record_visit') + ': ' + progName(e)), h('div', { class: 'grid' }, f.date('visit_date', t('prog.visit_date'), new Date().toISOString().slice(0, 10)), specFields(f, spec.visit), f.date('next_due', t('prog.next_due_optional'))), h('p', { class: 'note' }, t('prog.next_due_note')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const r = await api('POST', `/api/enrolments/${e.id}/visits`, f.values());
      if (!r.ok) { err.textContent = (r.data.field ? t('prog.f.' + r.data.field) + ': ' : '') + (r.data.error || t('common.error')); return; }
      d.close(); const crit = r.data.flags.some((x) => x.level === 'critical');
      const m = modal([h('h3', {}, t('prog.visit_saved')), r.data.flags.length ? h('div', { class: crit ? 'banner' : 'banner info' }, h('div', { class: 'row' }, progChips(r.data.flags))) : h('span', { class: 'tag ok' }, t('flag.none')), h('p', { class: 'note' }, `${t('prog.next_due')}: ${r.data.next_due}`),
        h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { m.close(); refresh(); } }, t('common.confirm')))]);
    } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function closeProgDialog(e, spec, refresh) {
  const out = h('select', {}, spec.outcomes.map((o) => h('option', { value: o }, t('prog.outcome.' + o)))); const note = h('input', { 'aria-label': t('prog.note') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('prog.close')), h('p', {}, t('prog.close_text')), h('label', {}, t('prog.outcome'), out), h('label', {}, t('prog.note'), note), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    const r = await api('POST', `/api/enrolments/${e.id}/outcome`, { outcome: out.value, note: note.value });
    if (!r.ok) { err.textContent = r.data.reason_code ? t('prog.reason.' + r.data.reason_code) : (r.data.error || t('common.error')); return; } d.close(); refresh();
  } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

/* ---- register ---- */
async function programsView() {
  await loadProgMeta(); const meta = state.progMeta; const tab = state.progTab || 'recall';
  const tabs = ['recall'].concat(PROG_ORDER.filter((k) => meta[k]));
  const q = tab === 'recall' ? '?tab=recall' : '?program=' + tab; const r = await api('GET', '/api/programs/register' + q); const rows = r.data.rows || [];
  const showHiv = tab === 'hiv';
  const table = rows.length ? h('table', {}, h('tr', {}, ['patient.name_en', 'prog.programme', 'prog.reg_no', 'child.due_on', 'child.flags', 'patient.phone'].map((k) => h('th', {}, t(k)))),
    rows.map((x) => h('tr', { class: 'click', onclick: () => openEnrolment(x.id, x.patient.id) }, h('td', {}, x.patient.name_en || x.patient.mrn, x.patient.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null), h('td', {}, progName(x)), h('td', {}, x.registration_no),
      h('td', {}, dueChip(x.due)), h('td', {}, progChips(x.flags)), h('td', {}, x.phone || (x.contact_consent ? '—' : h('span', { class: 'note' }, t('prog.no_consent'))))))) : null;
  const cand = r.data.candidates && r.data.candidates.length ? h('div', { class: 'panel tablewrap' }, h('h4', {}, t('prog.candidates')), h('table', {}, r.data.candidates.map((c) => h('tr', { class: 'click', onclick: async () => { const pr = await api('GET', '/api/patients/' + c.patient.id); if (pr.ok) enrolDialog(pr.data.patient, 'nutrition'); } },
    h('td', {}, c.patient.name_en || c.patient.mrn), h('td', {}, childFlagChips(c.flags)), h('td', {}, h('button', { class: 'sm' }, t('prog.enrol'))))))) : null;
  return h('div', {}, h('div', { class: 'row' }, tabs.map((s) => h('button', { class: s === tab ? 'pri' : '', onclick: () => { state.progTab = s; render(); } }, s === 'recall' ? t('prog.tab.recall') : t('prog.name.' + s)))),
    showHiv ? h('div', { class: 'banner' }, '🔒 ' + t('prog.hiv_banner')) : null, cand, h('div', { class: 'panel tablewrap' }, table || h('p', { class: 'note' }, t('lab.empty'))), h('p', { class: 'note' }, t('prog.recall_note')));
}
