'use strict';
/* Child health screens: immunization schedule, growth records and charts, registers, schedule editor.
   Shares globals with the other scripts (h, t, api, state, can, modal, bigModal, formKit, withAccess, openPatient ...). */

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); for (const k of kids.flat()) if (k) el.append(k); return el; }
const STATUS_CLASS = { done: 'ok', due: 'warn', overdue: 'crit', too_late: 'crit', upcoming: '', blocked: '' };
const childFlagChips = (flags) => (flags || []).filter((f) => f.level !== 'info').map((f) => h('span', { class: 'tag ' + (f.level === 'critical' ? 'crit' : 'warn') }, '⚠ ' + t('child.flag.' + f.code)));
const infoNotes = (flags) => (flags || []).filter((f) => f.level === 'info').map((f) => h('div', { class: 'note' }, t('child.flag.' + f.code)));
const zClass = (z) => (z == null ? '' : Math.abs(z) > 3 ? 'crit' : Math.abs(z) > 2 ? 'warn' : 'ok');
const fmtZ = (z) => (z == null ? '—' : (z > 0 ? '+' : '') + z.toFixed(2));
async function loadChildMeta() { if (!state.childMeta && can('child.read')) state.childMeta = (await api('GET', '/api/child/meta')).data; }
function ageLabel(months) { return months < 24 ? `${Math.round(months)} ${t('age.months')}` : `${Math.floor(months / 12)} ${t('age.years')} ${Math.round(months % 12)} ${t('age.months')}`; }

/* ---- patient page panels ---- */
function childPanels(p) {
  const c = state.child; if (!c || !c.is_child) return null;
  const panels = [];
  if (c.immunization) panels.push(immunizationPanel(p, c)); else panels.push(h('div', { class: 'panel' }, h('h4', {}, t('child.immunization')), h('div', { class: 'note' }, t('child.no_schedule'))));
  panels.push(growthPanel(p, c));
  return panels;
}
function immunizationPanel(p, c) {
  const im = c.immunization; const canW = can('imm.write');
  const ordered = im.schedule.slice().sort((a, b) => (a.due_days - b.due_days) || a.vaccine.localeCompare(b.vaccine) || (a.dose_no - b.dose_no)); // by age, not alphabetically
  const rows = ordered.map((r) => h('tr', {}, h('td', {}, r.vaccine), h('td', {}, String(r.dose_no === 0 ? 'birth' : r.dose_no)),
    h('td', {}, r.status === 'done' ? r.given_on : r.due_on || (r.status === 'blocked' ? `${t('child.after_dose')} ${r.dose_no - 1}` : '—')),
    h('td', {}, h('span', { class: 'tag ' + STATUS_CLASS[r.status] }, t('child.imm.status.' + r.status)), r.status === 'overdue' ? h('span', { class: 'note' }, ` ${r.days_overdue} ${t('rx.days')}`) : null),
    h('td', {}, canW && r.status !== 'done' ? h('button', { class: 'sm', onclick: () => doseDialog(p, r) }, t('child.record_dose')) : null)));
  const invalid = im.records.filter((r) => !r.valid);
  return h('div', { class: 'panel tablewrap' }, h('h4', {}, t('child.immunization')), h('div', { class: 'row' }, h('span', { class: 'tag ' + (im.summary.up_to_date ? 'ok' : 'warn') }, im.summary.up_to_date ? t('child.up_to_date') : t('child.not_up_to_date')),
    h('span', { class: 'note' }, `${im.summary.done} ${t('child.imm.status.done')} · ${im.summary.due} ${t('child.imm.status.due')} · ${im.summary.overdue} ${t('child.imm.status.overdue')}`)),
    h('table', {}, h('tr', {}, ['child.vaccine', 'child.dose', 'child.due_on', 'enc.status', ''].map((k) => h('th', {}, t(k)))), rows),
    h('h4', {}, t('child.records')), im.records.length ? h('table', {}, im.records.map((r) => h('tr', {}, h('td', {}, r.given_on), h('td', {}, `${r.vaccine} #${r.dose_no}`), h('td', {}, [r.batch_no, r.site, t('child.source.' + r.source)].filter(Boolean).join(' · '),
      r.valid ? null : h('span', { class: 'tag warn' }, ' ' + t('child.invalid_dose') + ': ' + (r.invalid_reason || '').split(',').map((x) => t('child.invalid.' + x)).join(', '))),
      h('td', {}, canW ? h('button', { class: 'sm', onclick: () => voidDialog(t('child.void'), `/api/immunizations/${r.id}/void`, p) }, t('child.void')) : null)))) : h('div', { class: 'note' }, t('common.none')),
    invalid.length ? h('p', { class: 'note' }, t('child.invalid_note')) : null, h('p', { class: 'note' }, t('child.draftnote')));
}
function voidDialog(title, url, p) {
  const r = h('input', { 'aria-label': t('child.void_reason') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, title), h('label', {}, t('child.void_reason'), r), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    const x = await api('POST', url, { reason: r.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); openPatient(p.id);
  } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function doseDialog(p, r) {
  const f = formKit(); const err = h('div', { class: 'err' });
  const d = bigModal([h('h3', {}, `${t('child.record_dose')}: ${r.vaccine} (${r.dose_no === 0 ? 'birth' : '#' + r.dose_no})`), h('div', { class: 'grid' }, f.date('given_on', t('child.dose_given'), new Date().toISOString().slice(0, 10)), f.text('batch_no', t('child.batch')), f.text('site', t('child.site')),
    f.select('source', t('child.source'), ['given_here', 'card'], 'src', { blank: false })), h('p', { class: 'note' }, t('child.source_note')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => submit({}) }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
  async function submit(extra) {
    err.textContent = ''; const x = await api('POST', `/api/patients/${p.id}/immunizations`, { ...f.values(), vaccine_code: r.vaccine_code, dose_no: r.dose_no, ...extra });
    if (x.status === 409 && x.data.invalid_reasons) {
      const d2 = modal([h('h3', {}, t('child.invalid_title')), h('div', { class: 'banner' }, x.data.invalid_reasons.map((k) => h('div', {}, '⚠ ' + t('child.invalid.' + k)))), h('p', {}, t('child.invalid_text')),
        h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { d2.close(); submit({ confirm_invalid: true }); } }, t('child.invalid_confirm')), h('button', { onclick: () => d2.close() }, t('rx.back_change')))]);
      return;
    }
    if (x.status === 409 && x.data.missing_dose != null) { err.textContent = t('child.need_previous'); return; }
    if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; }
    d.close(); openPatient(p.id);
  }
}

/* ---- growth ---- */
function growthPanel(p, c) {
  const g = c.growth, latest = g.latest; const canW = can('growth.write');
  const zrow = (m) => h('div', { class: 'row' }, ['waz', 'haz', 'whz', 'baz', 'hcz'].map((k) => h('span', { class: 'tag ' + zClass(m.result.z[k]) }, `${t('child.z.' + k)}: ${fmtZ(m.result.z[k])}`)));
  const chartBox = h('div'); let current = state.chartInd || 'wfa';
  async function drawChart(ind) { current = ind; state.chartInd = ind; chartBox.replaceChildren(h('div', { class: 'note' }, '…')); const r = await api('GET', `/api/patients/${p.id}/growth/curves?indicator=${ind}`);
    chartBox.replaceChildren(r.ok ? growthChart(r.data) : h('div', { class: 'note' }, t('child.no_chart'))); }
  const tabs = ['wfa', 'hfa', 'wfh', 'bfa', 'hcfa'].map((k) => h('button', { class: 'sm', onclick: () => drawChart(k) }, t('child.chart.' + k)));
  setTimeout(() => { if (chartBox.isConnected) drawChart(current); }, 0);
  return h('div', { class: 'panel tablewrap' }, h('h4', {}, t('child.growth')), h('div', { class: 'note' }, `${t('child.age')}: ${ageLabel(c.age_months)}`),
    latest ? h('div', {}, h('div', { class: 'row' }, h('b', {}, `${t('child.latest')} (${latest.measured_on})`), childFlagChips(latest.result.flags), childFlagChips(latest.trend)),
      h('div', { class: 'note' }, [latest.weight_kg != null ? `${latest.weight_kg} kg` : null, latest.length_cm != null ? `${latest.length_cm} cm (${latest.result.height_used} ${t('child.used')})` : null, latest.head_cm != null ? `HC ${latest.head_cm} cm` : null, latest.muac_cm != null ? `MUAC ${latest.muac_cm} cm` : null, latest.edema ? t('child.edema_short') : null].filter(Boolean).join(' · ')),
      zrow(latest), infoNotes(latest.result.flags)) : h('div', { class: 'note' }, t('child.no_measurements')),
    canW ? h('button', { class: 'sm pri', onclick: () => growthDialog(p) }, '+ ' + t('child.record_growth')) : null,
    g.measurements.length ? h('div', {}, h('h4', {}, t('child.history')), h('table', {}, h('tr', {}, ['child.date', 'child.weight', 'child.length', 'child.muac', 'child.flags', ''].map((k) => h('th', {}, t(k)))),
      g.measurements.map((m) => h('tr', {}, h('td', {}, m.measured_on), h('td', {}, fmtN(m.weight_kg)), h('td', {}, fmtN(m.length_cm)), h('td', {}, fmtN(m.muac_cm)), h('td', {}, childFlagChips(m.result.flags.concat(m.trend))),
        h('td', {}, canW ? h('button', { class: 'sm', onclick: () => voidDialog(t('child.void'), `/api/growth/${m.id}/void`, p) }, t('child.void')) : null))))) : null,
    g.measurements.length ? h('div', {}, h('h4', {}, t('child.charts')), h('div', { class: 'row' }, tabs), chartBox) : null, h('p', { class: 'note' }, t('child.growth_note')));
}
function growthDialog(p, prefill) {
  const f = formKit(); const err = h('div', { class: 'err' }); const pre = prefill || {};
  const d = bigModal([h('h3', {}, t('child.record_growth') + ': ' + p.name_en), h('div', { class: 'grid' }, f.date('measured_on', t('child.date'), new Date().toISOString().slice(0, 10)), f.num('weight_kg', t('child.weight'), { step: 0.01 }), f.num('length_cm', t('child.length'), { step: 0.1 }),
    f.select('lying', t('child.measured'), ['auto', 'true', 'false'], 'lie', { blank: false }), f.num('head_cm', t('child.head'), { step: 0.1 }), f.num('muac_cm', t('child.muac'), { step: 0.1 })), h('div', { class: 'row' }, f.check('edema', t('child.edema'))), f.area('notes', t('mch.notes')),
    h('p', { class: 'note' }, t('child.lying_note')), err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const v = f.values(); v.lying = v.lying === 'auto' ? null : v.lying === 'true'; if (pre.encounter_id) v.encounter_id = pre.encounter_id;
      const x = await api('POST', `/api/patients/${p.id}/growth`, v); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; }
      d.close(); showGrowthResult(x.data, () => openPatient(p.id));
    } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
  for (const k of ['weight_kg', 'length_cm', 'head_cm', 'muac_cm']) if (pre[k] != null) document.getElementById('mf_' + k).value = pre[k];
}
function showGrowthResult(r, then) {
  const crit = r.flags.some((x) => x.level === 'critical');
  const d = modal([h('h3', {}, t('child.saved')), h('div', { class: 'row' }, ['waz', 'haz', 'whz', 'baz', 'hcz'].filter((k) => r.z[k] != null).map((k) => h('span', { class: 'tag ' + zClass(r.z[k]) }, `${t('child.z.' + k)}: ${fmtZ(r.z[k])}`))),
    r.flags.filter((x) => x.level !== 'info').length ? h('div', { class: crit ? 'banner' : 'banner info' }, childFlagChips(r.flags)) : h('span', { class: 'tag ok' }, t('flag.none')), infoNotes(r.flags), crit ? h('p', {}, t('child.sam_act')) : null,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { d.close(); then(); } }, t('common.confirm')))]);
}
function growthChart(data) {
  const W = 680, H = 380, L = 50, R = 16, T = 14, B = 44; const cs = data.curves;
  const xs = cs.map((c) => c.x), minX = Math.min(...xs), maxX = Math.max(...xs);
  const ys = cs.flatMap((c) => [c['-3'], c['3']]).concat(data.points.map((q) => q.y)); const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys));
  const X = (x) => L + ((x - minX) / (maxX - minX)) * (W - L - R), Y = (y) => T + (1 - (y - minY) / (maxY - minY)) * (H - T - B);
  const line = (key, color, wd, dash) => svg('polyline', { points: cs.map((c) => `${X(c.x).toFixed(1)},${Y(c[key]).toFixed(1)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': wd, ...(dash ? { 'stroke-dasharray': dash } : {}) });
  const ticks = []; const nx = 6, ny = 6;
  for (let i = 0; i <= nx; i++) { const v = minX + ((maxX - minX) * i) / nx; ticks.push(svg('text', { x: X(v), y: H - 24, 'text-anchor': 'middle', 'font-size': 11, fill: '#8aa3ab' }, Math.round(v))); }
  for (let i = 0; i <= ny; i++) { const v = minY + ((maxY - minY) * i) / ny; ticks.push(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: '#223540', 'stroke-width': 1 }), svg('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#8aa3ab' }, Math.round(v * 10) / 10)); }
  const pts = data.points.map((q) => [X(q.x), Y(q.y)]);
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `${data.y_label} / ${data.x_label}` }, ticks,
    svg('text', { x: W / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 12, fill: '#c9d8dc' }, data.x_label), svg('text', { x: 12, y: H / 2, 'text-anchor': 'middle', 'font-size': 12, fill: '#c9d8dc', transform: `rotate(-90 12 ${H / 2})` }, data.y_label),
    line('-3', '#ef6b6b', 1.5, '4 3'), line('-2', '#f2c230', 1.5, ''), line('0', '#4cb86a', 2, ''), line('2', '#f2c230', 1.5, ''), line('3', '#ef6b6b', 1.5, '4 3'),
    pts.length > 1 ? svg('polyline', { points: pts.map((q) => q.join(',')).join(' '), fill: 'none', stroke: '#ffffff', 'stroke-width': 2 }) : null, pts.map((q) => svg('circle', { cx: q[0], cy: q[1], r: 4.5, fill: '#ffffff', stroke: '#06210f', 'stroke-width': 1 })));
  return h('div', {}, el, h('div', { class: 'note' }, t('child.chart_legend')), data.points.length ? null : h('div', { class: 'note' }, t('child.no_points')));
}

/* ---- registers and schedule editor ---- */
async function childView() {
  await loadChildMeta();
  const tab = state.childTab || 'immunization'; const r = await api('GET', '/api/child/register?tab=' + tab); const rows = r.data.rows || [];
  const who = (q) => [q.name_en || q.mrn, q.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null];
  let table;
  if (tab === 'immunization') table = rows.length ? h('table', {}, h('tr', {}, ['patient.name_en', 'child.age', 'child.overdue_count', 'child.due_count', 'child.doses'].map((k) => h('th', {}, t(k)))),
    rows.map((x) => h('tr', { class: 'click', onclick: () => openPatient(x.patient.id) }, h('td', {}, who(x.patient)), h('td', {}, ageLabel(x.age_days / 30.4375)), h('td', {}, String(x.overdue + x.too_late)), h('td', {}, String(x.due)),
      h('td', {}, x.items.slice(0, 6).map((i) => h('span', { class: 'tag ' + STATUS_CLASS[i.status] }, `${i.vaccine_code} ${i.dose_no === 0 ? 'birth' : '#' + i.dose_no}`)))))) : null;
  else table = rows.length ? h('table', {}, h('tr', {}, ['patient.name_en', 'child.measured_on', 'child.z.whz', 'child.z.waz', 'child.muac', 'child.flags'].map((k) => h('th', {}, t(k)))),
    rows.map((x) => h('tr', { class: 'click', onclick: () => openPatient(x.patient.id) }, h('td', {}, who(x.patient)), h('td', {}, `${x.measured_on} (${x.days_ago} ${t('rx.days')})`), h('td', {}, fmtZ(x.z.whz)), h('td', {}, fmtZ(x.z.waz)), h('td', {}, fmtN(x.muac_cm)), h('td', {}, childFlagChips(x.flags))))) : null;
  return h('div', {}, h('div', { class: 'row' }, ['immunization', 'nutrition'].map((s) => h('button', { class: s === tab ? 'pri' : '', onclick: () => { state.childTab = s; render(); } }, t('child.tab.' + s)))),
    h('div', { class: 'panel tablewrap' }, table || h('p', { class: 'note' }, t('lab.empty'))), h('p', { class: 'note' }, t('child.draftnote')));
}
async function scheduleView() {
  await loadChildMeta(); state.childMeta = (await api('GET', '/api/child/meta')).data;
  const rows = state.childMeta.schedule.map((d) => { const f = {}; const mk = (k, v) => { f[k] = h('input', { type: 'number', min: '0', value: v == null ? '' : String(v), 'aria-label': t('child.sched.' + k) }); return h('td', {}, f[k]); };
    const msg = h('span', { class: 'note' });
    return h('tr', {}, h('td', {}, d.vaccine), h('td', {}, String(d.dose_no)), mk('due_days', d.due_days), mk('min_age_days', d.min_age_days), mk('min_interval_days', d.min_interval_days), mk('max_age_days', d.max_age_days), mk('late_days', d.late_days),
      h('td', {}, h('button', { class: 'sm', onclick: async () => { const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value === '' ? null : el.value]));
        const x = await api('PUT', `/api/immunization/schedule/${d.id}`, body); msg.textContent = x.ok ? t('child.sched.saved') : (x.data.error || t('common.error')); } }, t('common.save')), ' ', msg)); });
  return h('div', {}, h('div', { class: 'panel tablewrap' }, h('table', {}, h('tr', {}, ['child.vaccine', 'child.dose', 'child.sched.due_days', 'child.sched.min_age_days', 'child.sched.min_interval_days', 'child.sched.max_age_days', 'child.sched.late_days', ''].map((k) => h('th', {}, t(k)))), rows)),
    h('p', { class: 'note' }, t('child.sched.note')));
}
