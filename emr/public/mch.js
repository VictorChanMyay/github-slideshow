'use strict';
/* Maternal and child health screens: register, pregnancy record, forms, family planning, patient panel.
   Shares globals with app.js / clinical.js. Option lists come from the server (/api/mch/meta). */

async function loadMchMeta() { if (!state.mchMeta && can('mch.read')) state.mchMeta = (await api('GET', '/api/mch/meta')).data; }
const alertClass = (l) => (l === 'critical' ? 'crit' : 'warn');
const alertChips = (list) => (list && list.length ? list.map((a) => h('span', { class: 'tag ' + alertClass(a.level) }, '⚠ ' + t('mch.alert.' + a.code))) : []);
const tx = (prefix, v) => (v == null || v === '' ? '' : t('mch.' + prefix + '.' + v));
const fmtN = (v) => (v == null ? '' : String(v));
function bigModal(content) { const d = h('dialog', { class: 'wide' }, content); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); return d; }

/* ---- small form toolkit ---- */
function formKit() {
  const getters = {}; const nodes = [];
  const labelOf = (label, el, key) => h('label', { for: 'mf_' + key }, label, el);
  const kit = {
    num(key, label, o = {}) { const el = h('input', { type: 'number', id: 'mf_' + key, step: o.step || 'any', inputmode: 'decimal', min: o.min, max: o.max }); getters[key] = () => el.value; const n = labelOf(label, el, key); nodes.push(n); return n; },
    text(key, label, o = {}) { const el = h('input', { id: 'mf_' + key, placeholder: o.placeholder }); getters[key] = () => el.value; const n = labelOf(label, el, key); nodes.push(n); return n; },
    date(key, label, value) { const el = h('input', { type: 'date', id: 'mf_' + key, value: value || '' }); getters[key] = () => el.value; const n = labelOf(label, el, key); nodes.push(n); return n; },
    select(key, label, list, prefix, o = {}) { const el = h('select', { id: 'mf_' + key }, o.blank === false ? null : h('option', { value: '' }, '—'), list.map((x) => h('option', { value: x }, o.custom ? o.custom(x) : o.raw ? x : t('mch.' + prefix + '.' + x)))); if (o.value) el.value = o.value; getters[key] = () => el.value; const n = labelOf(label, el, key); nodes.push(n); return n; },
    check(key, label, checked) { const el = h('input', { type: 'checkbox', id: 'mf_' + key }); el.checked = !!checked; getters[key] = () => el.checked; const n = h('label', { class: 'check', for: 'mf_' + key }, el, label); nodes.push(n); return n; },
    area(key, label) { const el = h('textarea', { rows: 2, id: 'mf_' + key }); getters[key] = () => el.value; const n = labelOf(label, el, key); nodes.push(n); return n; },
    checks(key, label, list, prefix, custom) { const boxes = list.map((x) => { const el = h('input', { type: 'checkbox', value: x }); return el; }); getters[key] = () => boxes.filter((b) => b.checked).map((b) => b.value);
      return h('div', {}, h('div', { class: 'note' }, label), h('div', { class: 'checks' }, list.map((x, i) => h('label', { class: 'check' }, boxes[i], custom ? custom(x) : t('mch.' + prefix + '.' + x))))); },
    values() { return Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()])); },
  };
  return kit;
}
function showAlerts(title, alerts, then) {
  const crit = alerts.some((a) => a.level === 'critical');
  const d = modal([h('h3', {}, title), alerts.length ? h('div', { class: crit ? 'banner' : 'banner info' }, h('b', {}, crit ? t('mch.alerts.critical') : t('mch.alerts.check')), h('div', { class: 'row' }, alertChips(alerts))) : h('p', { class: 'tag ok' }, t('flag.none')),
    crit ? h('p', {}, t('mch.alerts.act')) : null, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { d.close(); then(); } }, t('common.confirm')))]);
}
async function todaysVisit(pid) {
  const r = await api('GET', '/api/queue'); const q = (r.data.queue || []).find((x) => x.patient.id === pid && x.status !== 'signed'); return q ? q.id : null;
}

/* ---- register ---- */
async function mchView() {
  await loadMchMeta();
  const tab = state.mchTab || 'antenatal'; const r = await api('GET', '/api/mch/register?tab=' + tab); const rows = r.data.rows || [];
  const who = (p) => [p.name_en || p.mrn, p.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null];
  let table;
  if (tab === 'antenatal') table = rows.length ? h('table', {}, h('tr', {}, ['patient.name_en', 'mch.ga', 'mch.edd', 'mch.risks', 'mch.last_visit', 'mch.next_contact', 'enc.status'].map((k) => h('th', {}, t(k)))),
    rows.map((x) => h('tr', { class: 'click', onclick: () => openEpisode(x.id, x.patient.id) }, h('td', {}, who(x.patient)), h('td', {}, x.ga_text), h('td', {}, x.edd), h('td', {}, String(x.risks.length)), h('td', {}, x.latest_visit_date || '—'),
      h('td', {}, x.next_contact && x.next_contact.week ? `${x.next_contact.week}w` : '—', x.overdue ? h('span', { class: 'tag warn' }, ' ' + t('mch.overdue')) : null), h('td', {}, alertChips(x.alerts.concat(x.latest_visit_alerts)))))) : null;
  else if (tab === 'postnatal') table = rows.length ? h('table', {}, h('tr', {}, ['patient.name_en', 'mch.days_pp', 'mch.contacts', 'mch.babies'].map((k) => h('th', {}, t(k)))),
    rows.map((x) => h('tr', { class: 'click', onclick: () => openEpisode(x.episode_id, x.patient.id) }, h('td', {}, who(x.patient)), h('td', {}, String(x.days)),
      h('td', {}, x.windows.map((w) => h('span', { class: 'tag ' + (w.state === 'missed' ? 'warn' : w.state === 'done' ? 'ok' : '') }, `${t('mch.pnc.' + w.key)}: ${t('mch.pncstate.' + w.state)}`))), h('td', {}, x.babies.map((b) => `${t('mch.outcome.' + b.outcome)} ${b.birth_weight_g} g`).join('; '))))) : null;
  else table = rows.length ? h('table', {}, h('tr', {}, ['patient.name_en', 'mch.fp_method', 'mch.last_visit', 'mch.next_due'].map((k) => h('th', {}, t(k)))),
    rows.map((x) => h('tr', { class: 'click', onclick: () => openPatient(x.patient.id) }, h('td', {}, who(x.patient)), h('td', {}, t('mch.fpm.' + x.method)), h('td', {}, x.last_visit), h('td', {}, x.next_due || '—', x.overdue ? h('span', { class: 'tag warn' }, ` ${t('mch.overdue')} (${x.days_overdue} ${t('rx.days')})`) : null)))) : null;
  return h('div', {}, h('div', { class: 'row' }, ['antenatal', 'postnatal', 'fp'].map((s) => h('button', { class: s === tab ? 'pri' : '', onclick: () => { state.mchTab = s; render(); } }, t('mch.tab.' + s)))),
    h('div', { class: 'panel tablewrap' }, table || h('p', { class: 'note' }, t('lab.empty'))), h('p', { class: 'note' }, t('mch.draftnote')));
}

/* ---- patient page panel ---- */
function mchPanels(p) {
  const m = state.mch; if (!m) return null;
  const active = m.episodes.find((e) => e.status === 'active');
  const eps = h('div', { class: 'panel' }, h('h4', {}, t('mch.title')),
    m.episodes.length ? m.episodes.map((e) => h('div', { class: 'row' }, h('span', { class: 'tag ' + (e.status === 'active' ? 'ok' : '') }, t('mch.status.' + e.status)), e.status === 'active' ? `${e.ga_text} · ${t('mch.edd')} ${e.edd}` : (e.delivered_on ? `${t('mch.delivered')} ${e.delivered_on}` : e.lmp),
      alertChips(e.alerts), h('button', { class: 'sm', onclick: () => openEpisode(e.id, p.id) }, t('mch.open')))) : h('div', { class: 'note' }, t('common.none')),
    !active && can('mch.write') ? h('button', { class: 'sm pri', onclick: () => bookDialog(p) }, '+ ' + t('mch.book')) : null);
  const fpRows = m.family_planning;
  const fp = h('div', { class: 'panel' }, h('h4', {}, t('mch.fp')),
    fpRows.length ? fpRows.slice(0, 5).map((f) => h('div', { class: 'row' }, h('span', {}, `${f.visit_date} · ${t('mch.fpm.' + f.method)} · ${t('mch.fpa.' + f.action)}`), f.next_due ? h('span', { class: 'note' }, `${t('mch.next_due')}: ${f.next_due}`) : null)) : h('div', { class: 'note' }, t('common.none')),
    can('fp.write') ? h('button', { class: 'sm', onclick: () => fpDialog(p) }, '+ ' + t('mch.fp_record')) : null);
  return [eps, fp];
}

/* ---- booking ---- */
function bookDialog(p) {
  const f = formKit(); const err = h('div', { class: 'err' }); const meta = state.mchMeta;
  const body = h('div', {}, h('h3', {}, t('mch.book') + ': ' + p.name_en),
    h('div', { class: 'grid' }, f.date('lmp', t('mch.lmp')), f.check('lmp_certain', t('mch.lmp_certain'), true), f.num('gravida', t('mch.gravida'), { min: 1, step: 1 }), f.num('para', t('mch.para'), { min: 0, step: 1 }), f.num('living_children', t('mch.living'), { min: 0, step: 1 })),
    f.checks('risk_factors', t('mch.risks'), meta.risk_factors, 'risk'), h('p', { class: 'note' }, t('mch.risks_auto')),
    h('h4', {}, t('mch.us_title')), h('div', { class: 'grid' }, f.date('us_date', t('mch.us_date')), f.num('us_weeks', t('mch.us_weeks'), { min: 4, max: 42, step: 1 }), f.num('us_days', t('mch.us_days'), { min: 0, max: 6, step: 1 })),
    f.area('notes', t('mch.notes')), err);
  const d = bigModal([body, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    err.textContent = '';
    const r = await api('POST', `/api/patients/${p.id}/anc-episodes`, f.values());
    if (r.status === 409 && r.data.episode_id) { d.close(); openEpisode(r.data.episode_id, p.id); return; }
    if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; }
    d.close();
    const info = `${t('mch.edd')}: ${r.data.edd} (${t('mch.eddsrc.' + r.data.edd_source)})` + (r.data.edd_source === 'ultrasound' ? ` · ${t('mch.us_differs')}: ${r.data.discrepancy_days} ${t('rx.days')}` : '');
    const m2 = modal([h('h3', {}, t('mch.booked')), h('p', {}, info), r.data.risks.length ? h('div', { class: 'banner info' }, t('mch.risks') + ': ' + r.data.risks.map((x) => t('mch.risk.' + x)).join(', ')) : null,
      h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { m2.close(); openEpisode(r.data.id, p.id); } }, t('mch.open')))]);
  } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

/* ---- pregnancy record screen ---- */
async function openEpisode(id, pid) {
  await loadMchMeta();
  const r = await withAccess(pid, () => api('GET', '/api/anc-episodes/' + id));
  if (r.status === 403) { alert(t('restricted.denied')); return; }
  if (!r.ok) { if (r.status !== 428) oops(r); return; }
  state.episode = r.data; state.view = 'episode'; render();
}
async function episodeView() {
  const E = state.episode, ep = E.episode, P = E.patient; const meta = state.mchMeta; const active = ep.status === 'active'; const delivered = ep.status === 'delivered';
  const refresh = () => openEpisode(ep.id, P.id);
  const root = h('div');
  root.append(h('div', { class: 'row' }, h('button', { onclick: () => { state.view = 'mch'; render(); } }, '← ' + t('nav.mch')), h('button', { onclick: () => openPatient(P.id) }, t('patients.title'))));
  root.append(h('div', { class: 'panel' }, h('h3', {}, P.name_en, ' ', h('span', { class: 'tag' }, P.mrn), ' ', h('span', { class: 'tag ' + (active ? 'ok' : '') }, t('mch.status.' + ep.status))),
    h('div', { class: 'grid' }, h('div', {}, h('div', { class: 'note' }, t('mch.ga')), h('b', {}, ep.ga_text || '—')), h('div', {}, h('div', { class: 'note' }, t('mch.edd')), h('b', {}, ep.edd), ` (${t('mch.eddsrc.' + ep.edd_source)})`),
      h('div', {}, h('div', { class: 'note' }, t('mch.lmp')), ep.lmp), h('div', {}, h('div', { class: 'note' }, 'G / P / ' + t('mch.living')), `${ep.gravida} / ${ep.para} / ${ep.living_children}`),
      active && ep.next_contact ? h('div', {}, h('div', { class: 'note' }, t('mch.next_contact')), ep.next_contact.week ? `${ep.next_contact.week}w` : '—', ep.next_contact.overdue ? h('span', { class: 'tag warn' }, ' ' + t('mch.overdue')) : null) : null),
    ep.risks.length ? h('div', { class: 'row' }, h('b', {}, t('mch.risks') + ':'), ep.risks.map((x) => h('span', { class: 'tag warn' }, t('mch.risk.' + x)))) : null,
    h('div', { class: 'row' }, alertChips(ep.alerts.concat(ep.latest_visit_alerts))),
    ep.status !== 'active' && ep.status !== 'delivered' ? h('div', { class: 'banner info' }, `${t('mch.status.' + ep.status)}: ${ep.closed_reason || ''}`) : null));

  /* antenatal visits */
  root.append(h('div', { class: 'panel tablewrap' }, h('h4', {}, t('mch.visits')),
    E.visits.length ? h('table', {}, h('tr', {}, ['visit.date', 'mch.ga', 'mch.bp', 'mch.weight', 'mch.fh', 'mch.fhr', 'mch.hb', 'mch.alerts'].map((k) => h('th', {}, t(k)))),
      E.visits.map((v) => h('tr', {}, h('td', {}, v.visit_date), h('td', {}, v.ga_text), h('td', {}, v.sys != null ? `${v.sys}/${v.dia}` : ''), h('td', {}, fmtN(v.weight)), h('td', {}, fmtN(v.fundal_height)), h('td', {}, fmtN(v.fhr)), h('td', {}, fmtN(v.hb)), h('td', {}, alertChips(v.alerts))))) : h('div', { class: 'note' }, t('common.none')),
    active && can('mch.write') ? h('button', { class: 'sm pri', onclick: () => visitDialog(ep, P, refresh) }, '+ ' + t('mch.record_visit')) : null));

  /* labour */
  if (active || E.partograph.length) root.append(h('div', { class: 'panel tablewrap' }, h('h4', {}, t('mch.labour')),
    E.partograph.length ? h('table', {}, h('tr', {}, ['audit.time', 'mch.cervix', 'mch.descent', 'mch.contractions', 'mch.fhr', 'mch.liquor', 'mch.bp', 'mch.alerts'].map((k) => h('th', {}, t(k)))),
      E.partograph.map((e) => h('tr', {}, h('td', {}, e.recorded_at), h('td', {}, fmtN(e.cervix_cm)), h('td', {}, fmtN(e.descent)), h('td', {}, fmtN(e.contractions)), h('td', {}, fmtN(e.fhr)), h('td', {}, tx('liquor', e.liquor)), h('td', {}, e.sys != null ? `${e.sys}/${e.dia}` : ''), h('td', {}, alertChips(e.flags))))) : h('div', { class: 'note' }, t('common.none')),
    active && can('mch.write') ? h('button', { class: 'sm', onclick: () => partographDialog(ep, refresh) }, '+ ' + t('mch.add_obs')) : null,
    h('p', { class: 'note' }, t('mch.partonote'))));

  /* delivery */
  if (E.delivery) {
    const d = E.delivery;
    root.append(h('div', { class: 'panel' }, h('h4', {}, t('mch.delivery')),
      h('div', { class: 'grid' }, h('div', {}, h('div', { class: 'note' }, t('visit.date')), `${d.delivered_on} ${d.delivered_time || ''}`), h('div', {}, h('div', { class: 'note' }, t('mch.ga')), d.ga_text), h('div', {}, h('div', { class: 'note' }, t('mch.mode')), tx('mode', d.mode)),
        h('div', {}, h('div', { class: 'note' }, t('mch.place')), tx('place', d.place)), h('div', {}, h('div', { class: 'note' }, t('mch.blood_loss')), d.blood_loss_ml != null ? d.blood_loss_ml + ' ml' : '—'), h('div', {}, h('div', { class: 'note' }, t('mch.maternal_outcome')), tx('mo', d.maternal_outcome), d.referred_to ? ' → ' + d.referred_to : '')),
      d.pph ? h('div', { class: 'banner' }, '⚠ ' + t('mch.pph.' + d.pph)) : null, d.complications.length ? h('div', { class: 'row' }, d.complications.map((c) => h('span', { class: 'tag warn' }, t('mch.comp.' + c)))) : null,
      h('h4', {}, t('mch.babies')), d.newborns.map((n) => h('div', { class: 'panel' }, h('div', { class: 'row' }, h('b', {}, `#${n.birth_order} ${t('mch.outcome.' + n.outcome)}`), h('span', {}, [n.sex ? sexLabel(n.sex) : null, `${n.birth_weight_g} g`, n.apgar5 != null ? `APGAR ${n.apgar1}/${n.apgar5}` : null].filter(Boolean).join(' · ')), alertChips(n.alerts),
        n.patient_id ? h('button', { class: 'sm', onclick: () => openPatient(n.patient_id) }, n.baby_mrn) : h('span', { class: 'note' }, t('mch.no_record'))),
        h('div', { class: 'note' }, [n.breastfed_within_hour ? t('mch.bf_hour') : null, n.skin_to_skin ? t('mch.skin') : null, n.vitamin_k ? t('mch.vitk') : null, n.bcg_given || n.opv0_given || n.hepb0_given ? t('mch.birth_vacc') : null].filter(Boolean).join(' · '))))));
  } else if (active && can('mch.write')) root.append(h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => deliveryDialog(ep, P, refresh) }, t('mch.record_delivery'))));

  /* postnatal */
  if (delivered) root.append(h('div', { class: 'panel tablewrap' }, h('h4', {}, t('mch.postnatal')),
    E.pnc ? h('div', { class: 'row' }, E.pnc.map((w) => h('span', { class: 'tag ' + (w.state === 'missed' ? 'warn' : w.state === 'done' ? 'ok' : '') }, `${t('mch.pnc.' + w.key)}: ${t('mch.pncstate.' + w.state)}`))) : null,
    E.postnatal.length ? h('table', {}, h('tr', {}, ['visit.date', 'mch.days_pp', 'mch.bp', 'mch.baby_weight', 'mch.feeding', 'mch.alerts'].map((k) => h('th', {}, t(k)))),
      E.postnatal.map((v) => h('tr', {}, h('td', {}, v.visit_date), h('td', {}, String(v.days_postpartum)), h('td', {}, v.sys != null ? `${v.sys}/${v.dia}` : ''), h('td', {}, v.baby_weight_g != null ? v.baby_weight_g + ' g' : ''), h('td', {}, tx('feed', v.feeding)), h('td', {}, alertChips(v.alerts))))) : h('div', { class: 'note' }, t('common.none')),
    can('mch.write') ? h('button', { class: 'sm pri', onclick: () => postnatalDialog(ep, P, E.delivery, refresh) }, '+ ' + t('mch.record_pnc')) : null));

  if (active && can('mch.write')) root.append(h('div', { class: 'row' }, h('button', { onclick: () => closeDialog(ep, refresh) }, t('mch.close'))));
  void meta; return root;
}

/* ---- forms ---- */
async function formDialog(title, build, post, afterTitle, refresh, extraNote) {
  const f = formKit(); const err = h('div', { class: 'err' }); const body = build(f);
  const d = bigModal([h('h3', {}, title), body, extraNote ? h('p', { class: 'note' }, extraNote) : null, err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    err.textContent = ''; const r = await post(f.values());
    if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; }
    d.close(); showAlerts(afterTitle, r.data.alerts || r.data.flags || [], refresh);
  } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
async function visitDialog(ep, P, refresh) {
  const enc = await todaysVisit(P.id);
  if (!enc) { const d = modal([h('h3', {}, t('mch.need_visit')), h('p', {}, t('mch.need_visit_text')), h('div', { class: 'row' }, can('encounter.checkin') ? h('button', { class: 'pri', onclick: () => { d.close(); doCheckin(P.id); } }, t('queue.checkin')) : null, h('button', { onclick: () => d.close() }, t('common.cancel')))]); return; }
  const m = state.mchMeta;
  formDialog(t('mch.record_visit'), (f) => h('div', {}, h('div', { class: 'grid' }, f.num('sys', t('vital.sys')), f.num('dia', t('vital.dia')), f.num('weight', t('vital.weight')), f.num('temp', t('vital.temp'), { step: 0.1 }), f.num('fundal_height', t('mch.fh')), f.num('fhr', t('mch.fhr'), { step: 1 }),
    f.select('presentation', t('mch.presentation'), m.presentations, 'pres'), f.select('fetal_movement', t('mch.fetal_movement'), m.fetal_movement, 'fm'), f.select('urine_protein', t('mch.protein'), m.protein, 'x', { raw: true }), f.num('hb', t('mch.hb'), { step: 0.1 }), f.date('next_visit_date', t('mch.next_visit'))),
    f.checks('danger_signs', t('mch.danger'), m.danger_signs, 'danger'), h('div', { class: 'row' }, f.check('iron_folate', t('mch.iron')), f.check('td_vaccine', t('mch.td'))), f.area('counselling', t('mch.counselling'))),
  (v) => api('POST', `/api/anc-episodes/${ep.id}/visits`, { ...v, encounter_id: enc }), t('mch.visit_saved'), refresh, t('mch.draftnote'));
}
function partographDialog(ep, refresh) {
  const m = state.mchMeta;
  formDialog(t('mch.add_obs'), (f) => h('div', { class: 'grid' }, f.text('recorded_at', t('mch.obs_time'), { placeholder: 'YYYY-MM-DD HH:MM' }), f.num('cervix_cm', t('mch.cervix'), { step: 1, min: 0, max: 10 }), f.num('descent', t('mch.descent'), { step: 1, min: 0, max: 5 }), f.num('contractions', t('mch.contractions'), { step: 1 }),
    f.num('fhr', t('mch.fhr'), { step: 1 }), f.num('pulse', t('vital.pulse'), { step: 1 }), f.num('sys', t('vital.sys')), f.num('dia', t('vital.dia')), f.num('temp', t('vital.temp'), { step: 0.1 }), f.select('liquor', t('mch.liquor'), m.liquor, 'liquor'), f.num('moulding', t('mch.moulding'), { step: 1, min: 0, max: 3 }), f.text('notes', t('mch.notes'))),
  (v) => api('POST', `/api/anc-episodes/${ep.id}/partograph`, v), t('mch.obs_saved'), refresh, t('mch.partonote'));
}
function babyForm(i, kit) {
  const m = state.mchMeta; const f = formKit(); kit.push(f);
  return h('div', { class: 'panel' }, h('h4', {}, `${t('mch.baby')} ${i + 1}`), h('div', { class: 'grid' }, f.select('outcome', t('mch.outcome'), m.outcomes, 'outcome', { blank: false }), f.select('sex', t('patient.sex'), ['F', 'M', 'O'], 'sexl', { raw: true }),
    f.num('birth_weight_g', t('mch.birth_weight'), { step: 1 }), f.num('apgar1', 'APGAR 1', { step: 1, min: 0, max: 10 }), f.num('apgar5', 'APGAR 5', { step: 1, min: 0, max: 10 })),
    h('div', { class: 'row' }, f.check('resuscitation', t('mch.resus')), f.check('breastfed_within_hour', t('mch.bf_hour')), f.check('skin_to_skin', t('mch.skin')), f.check('vitamin_k', t('mch.vitk')), f.check('bcg_given', 'BCG'), f.check('opv0_given', 'OPV0'), f.check('hepb0_given', 'HepB0'), f.check('referred', t('mch.baby_referred'))), f.text('notes', t('mch.notes')));
}
function deliveryDialog(ep, P, refresh) {
  const m = state.mchMeta; const f = formKit(); const err = h('div', { class: 'err' }); const kits = []; const babies = h('div');
  const addBaby = () => { if (kits.length < 4) babies.append(babyForm(kits.length, kits)); }; addBaby();
  const d = bigModal([h('h3', {}, t('mch.record_delivery') + ': ' + P.name_en),
    h('div', { class: 'grid' }, f.date('delivered_on', t('visit.date'), new Date().toISOString().slice(0, 10)), f.text('delivered_time', t('mch.time'), { placeholder: 'HH:MM' }), f.select('mode', t('mch.mode'), m.modes, 'mode'), f.select('place', t('mch.place'), m.places, 'place'),
      f.num('labour_hours', t('mch.labour_hours')), f.num('blood_loss_ml', t('mch.blood_loss'), { step: 1 }), f.select('third_stage', t('mch.third'), ['active', 'physiological'], 'third'), f.select('perineal_tear', t('mch.tear'), m.tears, 'tear'), f.select('maternal_outcome', t('mch.maternal_outcome'), ['well', 'referred', 'died'], 'mo', { blank: false }), f.text('referred_to', t('mch.referred_to'))),
    h('div', { class: 'row' }, f.check('oxytocin', t('mch.oxytocin'))), f.checks('complications', t('mch.complications'), m.complications, 'comp'), f.area('notes', t('mch.notes')),
    h('p', { class: 'note' }, t('mch.delivery_note')), babies, h('button', { class: 'sm', onclick: addBaby }, '+ ' + t('mch.add_baby')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      err.textContent = ''; const body = { ...f.values(), newborns: kits.map((k) => k.values()) };
      const r = await api('POST', `/api/anc-episodes/${ep.id}/delivery`, body);
      if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; }
      d.close(); const alerts = r.data.newborns.flatMap((n) => n.alerts); if (r.data.pph) alerts.push({ code: r.data.pph === 'severe' ? 'pph_severe' : 'pph', level: 'critical' });
      showAlerts(t('mch.delivery_saved') + ` (${r.data.live_births} ${t('mch.live_births')})`, alerts, refresh);
    } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
function postnatalDialog(ep, P, delivery, refresh) {
  const m = state.mchMeta; const live = delivery.newborns.filter((n) => n.patient_id);
  formDialog(t('mch.record_pnc'), (f) => h('div', {}, h('h4', {}, t('mch.mother')), h('div', { class: 'grid' }, f.num('sys', t('vital.sys')), f.num('dia', t('vital.dia')), f.num('temp', t('vital.temp'), { step: 0.1 }), f.num('pulse', t('vital.pulse'), { step: 1 }),
    f.select('bleeding', t('mch.bleeding'), ['none', 'normal', 'heavy', 'offensive'], 'bleed'), f.select('uterus', t('mch.uterus'), ['contracted', 'boggy'], 'uterus'), f.select('perineum', t('mch.perineum'), ['healed', 'healing', 'infected', 'na'], 'peri'), f.select('mood', t('mch.mood'), ['well', 'low', 'concerning'], 'mood')),
    f.checks('mother_danger', t('mch.danger'), m.mother_danger, 'md'),
    h('h4', {}, t('mch.baby')), h('div', { class: 'grid' }, live.length ? f.select('newborn_id', t('mch.baby'), live.map((n) => String(n.id)), 'x', { raw: true }) : null, f.num('baby_weight_g', t('mch.baby_weight'), { step: 1 }), f.num('baby_temp', t('mch.baby_temp'), { step: 0.1 }), f.num('baby_rr', t('mch.baby_rr'), { step: 1 }),
      f.select('feeding', t('mch.feeding'), ['exclusive', 'mixed', 'formula', 'not_feeding'], 'feed'), f.select('cord', t('mch.cord'), ['clean', 'infected'], 'cord')),
    f.checks('baby_danger', t('mch.danger'), m.baby_danger, 'bd'), h('div', { class: 'row' }, f.check('jaundice', t('mch.jaundice')), f.check('counselled_fp', t('mch.counselled_fp'))), f.area('notes', t('mch.notes'))),
  (v) => api('POST', `/api/anc-episodes/${ep.id}/postnatal`, { ...v, encounter_id: undefined }), t('mch.pnc_saved'), refresh, t('mch.draftnote'));
}
function closeDialog(ep, refresh) {
  const out = h('select', {}, ['miscarriage', 'transferred', 'closed'].map((x) => h('option', { value: x }, t('mch.status.' + x)))); const reason = h('input', { 'aria-label': t('enc.cancel_reason') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('mch.close')), h('p', {}, t('mch.close_text')), h('label', {}, t('enc.status'), out), h('label', {}, t('enc.cancel_reason'), reason), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const r = await api('POST', `/api/anc-episodes/${ep.id}/close`, { outcome: out.value, reason: reason.value }); if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; } d.close(); refresh(); } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

/* ---- family planning ---- */
function fpDialog(p) {
  const m = state.mchMeta; const f = formKit(); const err = h('div', { class: 'err' });
  const d = bigModal([h('h3', {}, t('mch.fp_record') + ': ' + p.name_en), h('div', { class: 'grid' }, f.select('method', t('mch.fp_method'), m.fp_methods, 'fpm', { blank: false, value: 'condom' }), f.select('action', t('mch.fp_action'), m.fp_actions, 'fpa', { blank: false }),
    f.num('sys', t('vital.sys')), f.num('dia', t('vital.dia')), f.date('next_due', t('mch.next_due')), f.text('side_effects', t('mch.side_effects'))), h('div', { class: 'row' }, f.check('pregnancy_excluded', t('mch.preg_excluded'))), f.area('notes', t('mch.notes')), h('p', { class: 'note' }, t('mch.fp_note')), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => submit({}) }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
  async function submit(extra) {
    err.textContent = ''; const r = await api('POST', `/api/patients/${p.id}/family-planning`, { ...f.values(), ...extra });
    if (r.status === 409 && r.data.warnings) {
      const boxes = r.data.warnings.map((w) => ({ w, el: h('input', { type: 'checkbox' }) })); const e2 = h('div', { class: 'err' });
      const d2 = modal([h('h3', {}, t('rx.safety')), boxes.map((b) => h('div', { class: 'banner' }, h('label', { class: 'check' }, b.el, t('mch.fpwarn.' + b.w)))), e2,
        h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { if (!boxes.every((b) => b.el.checked)) { e2.textContent = t('rx.dup_tick'); return; } d2.close(); submit({ acknowledged_warnings: r.data.warnings }); } }, t('rx.proceed')), h('button', { onclick: () => d2.close() }, t('rx.back_change')))]);
      return;
    }
    if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; }
    d.close(); if (r.data.next_due) alert(`${t('mch.next_due')}: ${r.data.next_due}`); openPatient(p.id);
  }
}
