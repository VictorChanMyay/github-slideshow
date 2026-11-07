'use strict';
/* Clinic EMR front end. No inline scripts or styles (strict CSP). All text is set via textContent. */
const root = document.getElementById('root');
const state = { user: null, lang: 'en', dict: {}, fallback: {}, view: 'patients', meta: null };

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const t = (key) => state.dict[key] ?? state.fallback[key] ?? key;

async function api(method, url, body) {
  const opt = { method, headers: { 'X-Requested-With': 'emr' }, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  let data = {}; try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && state.user && url !== '/api/login') { state.user = null; render(); }
  return { ok: res.ok, status: res.status, data };
}

async function loadLang(lang) {
  const [en, cur] = await Promise.all([
    fetch('i18n/en.json').then((r) => r.json()),
    lang === 'en' ? null : fetch(`i18n/${lang}.json`).then((r) => r.json()).catch(() => ({})),
  ]);
  state.fallback = en; state.dict = cur || en; state.lang = lang;
  document.documentElement.lang = lang === 'kar' ? 'ksw' : lang;
  try { localStorage.setItem('emr-lang', lang); } catch { /* ignore */ }
}

function ageText(dob) {
  const ms = Date.now() - new Date(dob + 'T00:00:00Z').getTime();
  const years = ms / 31557600000;
  return years < 2 ? `${Math.floor(years * 12)} ${t('age.months')}` : `${Math.floor(years)} ${t('age.years')}`;
}
const sexLabel = (s) => t('sex.' + s);

function langSelect() {
  return h('select', { 'aria-label': t('nav.language'), onchange: async (e) => {
    await loadLang(e.target.value);
    if (state.user) await api('PUT', '/api/me/lang', { lang: e.target.value });
    render();
  } }, ['en', 'my', 'kar'].map((l) => h('option', { value: l, selected: l === state.lang }, { en: 'English', my: 'မြန်မာ', kar: "Karen (S'gaw)" }[l])));
}

function modal(content) {
  const d = h('dialog', {}, content);
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
  return d;
}

/* ---------- screens ---------- */
function loginScreen() {
  const err = h('div', { class: 'err' });
  const u = h('input', { id: 'u', autocomplete: 'username', required: true });
  const p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password', required: true });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const r = await api('POST', '/api/login', { username: u.value, password: p.value });
    if (!r.ok) { err.textContent = r.status === 429 ? t('login.locked') : t('login.failed'); return; }
    state.user = r.data.user; state.view = state.user.perms.includes('queue.read') ? 'queue' : 'patients'; await loadLang(state.user.lang || state.lang); render();
  } },
  h('label', { for: 'u' }, t('login.username')), u, h('label', { for: 'p' }, t('login.password')), p, err,
  h('div', { class: 'row' }, h('button', { class: 'pri', type: 'submit' }, t('login.submit')), langSelect()));
  return h('div', { class: 'login' }, h('div', { class: 'logo' }, h('img', { src: 'assets/mtc-logo.png', alt: '' })),
    h('div', { class: 'panel' }, h('h2', {}, t('login.title')), form, h('p', { class: 'note' }, t('login.notice'))));
}

function changePasswordScreen() {
  const err = h('div', { class: 'err' });
  const c = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const n = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const r = await api('POST', '/api/me/password', { current: c.value, new: n.value });
    if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; }
    state.user.must_change = false; render();
  } }, h('label', {}, t('pw.current')), c, h('label', {}, t('pw.new')), n, err,
  h('div', { class: 'row' }, h('button', { class: 'pri', type: 'submit' }, t('pw.submit'))));
  return h('div', { class: 'login' }, h('div', { class: 'panel' }, h('h2', {}, t('pw.title')), form));
}

function shell(title, content) {
  const nav = [['queue', 'nav.queue', state.user.perms.includes('queue.read')], ['patients', 'nav.patients', true], ['mch', 'nav.mch', state.user.perms.includes('mch.read')], ['child', 'nav.child', state.user.perms.includes('child.read')], ['followup', 'nav.followup', state.user.perms.includes('followup.read')], ['appointments', 'nav.appointments', state.user.perms.includes('appt.read')], ['referrals', 'nav.referrals', state.user.perms.includes('ref.read')], ['inpatients', 'nav.inpatients', state.user.perms.includes('adm.read')], ['procedures', 'nav.procedures', state.user.perms.includes('proc.read')], ['blood', 'nav.blood', state.user.perms.includes('blood.read')], ['programs', 'nav.programs', state.user.perms.includes('prog.read')], ['lab', 'nav.lab', ['lab.collect', 'lab.result', 'lab.read'].some((x) => state.user.perms.includes(x))], ['pharmacy', 'nav.pharmacy', ['rx.dispense', 'rx.read'].some((x) => state.user.perms.includes(x))], ['stock', 'nav.stock', state.user.perms.includes('stock.read')], ['audit', 'nav.audit', state.user.perms.includes('audit.read')], ['schedule', 'nav.schedule', state.user.perms.includes('imm.admin')], ['users', 'nav.users', state.user.perms.includes('user.admin')]]
    .filter((n) => n[2]).map((n) => h('a', { href: '#', class: state.view === n[0] ? 'on' : '', onclick: (e) => { e.preventDefault(); state.view = n[0]; render(); } }, t(n[1])));
  return h('div', { class: 'layout' },
    h('aside', {}, h('div', { class: 'logo' }, h('img', { src: 'assets/mtc-logo.png', alt: 'Mae Tao Clinic' })),
      h('h1', {}, t('app.title')), h('div', { class: 'sub' }, t('app.subtitle')), nav,
      h('div', { class: 'sidefoot' }, h('div', { class: 'note' }, `${state.user.full_name} · ${t('role.' + state.user.role)}`), langSelect(),
        h('button', { class: 'nav', onclick: async () => { await api('POST', '/api/logout'); state.user = null; render(); } }, t('nav.logout')))),
    h('main', {}, h('div', { class: 'topbar' }, h('h2', {}, title)), content));
}

/* patients */
async function patientsView() {
  const wrap = h('div'); const listBox = h('div', { class: 'panel tablewrap' });
  const search = h('input', { class: 'grow', placeholder: t('patients.search'), 'aria-label': t('patients.search') });
  let timer;
  async function load() {
    const r = await api('GET', '/api/patients?q=' + encodeURIComponent(search.value));
    listBox.replaceChildren();
    const rows = (r.data.patients || []);
    if (!rows.length) { listBox.append(h('p', { class: 'note' }, t('patients.empty'))); return; }
    listBox.append(h('table', {}, h('tr', {}, ['patient.mrn', 'patient.name_en', 'patient.sex', 'patient.age', 'patient.village'].map((k) => h('th', {}, t(k)))),
      rows.map((p) => h('tr', { class: 'click', onclick: () => openPatient(p.id) },
        h('td', {}, p.mrn),
        h('td', {}, p.name_en, ...p.names.map((n) => h('span', { class: 'note' }, ' ' + n.name)), p.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null),
        h('td', {}, sexLabel(p.sex)), h('td', {}, ageText(p.dob) + (p.dob_estimated ? ' (' + t('age.estimated') + ')' : '')), h('td', {}, p.village || '')))));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  const canWrite = state.user.perms.includes('patient.write');
  wrap.append(h('div', { class: 'row' }, search, canWrite ? h('button', { class: 'pri', onclick: () => { state.view = 'register'; render(); } }, '+ ' + t('patients.register')) : null), listBox);
  await load();
  return wrap;
}

function detailView() {
  const p = state.patient;
  const field = (k, v) => h('div', {}, h('div', { class: 'note' }, t(k)), h('div', {}, v || '—'));
  return h('div', {}, h('div', { class: 'row' }, h('button', { onclick: () => { state.view = 'patients'; render(); } }, '← ' + t('common.back')),
      can('encounter.checkin') ? h('button', { class: 'pri', onclick: () => doCheckin(p.id) }, t('queue.checkin')) : null,
      can('encounter.read') ? h('button', { onclick: () => { state.view = 'summary'; render(); } }, t('summary.print')) : null),
    h('div', { class: 'panel' }, h('h3', {}, p.name_en, ' ', h('span', { class: 'tag' }, p.mrn), p.restricted ? h('span', { class: 'tag warn' }, ' ' + t('patient.restricted')) : null),
      h('div', { class: 'grid' }, field('patient.sex', sexLabel(p.sex)), field('patient.dob', p.dob), field('patient.age', ageText(p.dob) + (p.dob_estimated ? ' (' + t('age.estimated') + ')' : '')),
        field('patient.phone', p.phone), field('patient.village', p.village), field('patient.ethnicity', p.ethnicity), field('patient.language', p.language), field('patient.nationality', p.nationality)),
      p.mother ? h('div', { class: 'row' }, h('span', { class: 'note' }, t('mch.mother') + ':'), h('button', { class: 'sm', onclick: () => openPatient(p.mother.id) }, p.mother.restricted ? p.mother.mrn : p.mother.name_en)) : null,
      p.children && p.children.length ? h('div', { class: 'row' }, h('span', { class: 'note' }, t('mch.children') + ':'), p.children.map((c) => h('button', { class: 'sm', onclick: () => openPatient(c.id) }, `${c.name_en} (${c.dob})`))) : null,
      h('h4', {}, t('patient.names')), p.names.length ? p.names.map((n) => h('div', {}, `${t('script.' + n.script)}: ${n.name}`)) : h('div', { class: 'note' }, t('common.none')),
      h('h4', {}, t('patient.ids')), p.ids.length ? p.ids.map((n) => h('div', {}, `${t('idtype.' + n.id_type)}: ${n.number}`)) : h('div', { class: 'note' }, t('patient.no_id'))),
    clinicalPanels(p), mchPanels(p), childPanels(p), programPanels(p), continuityPanels(p), inpatientPanels(p));
}

function registerView() {
  const f = {}; const err = h('div', { class: 'err' });
  const inp = (k, type) => { f[k] = h('input', { type: type || 'text', id: 'f_' + k }); return h('label', { for: 'f_' + k }, t('patient.' + k), f[k]); };
  f.sex = h('select', { id: 'f_sex' }, ['F', 'M', 'O'].map((s) => h('option', { value: s }, sexLabel(s))));
  f.est = h('input', { type: 'checkbox' }); f.res = h('input', { type: 'checkbox' });
  const names = h('div'); const ids = h('div');
  const nameRow = () => { const s = h('select', {}, state.meta.scripts.map((x) => h('option', { value: x }, t('script.' + x)))); const i = h('input', { 'aria-label': t('name.value') }); const row = h('div', { class: 'row' }, s, i, h('button', { type: 'button', class: 'sm', onclick: () => row.remove() }, t('common.remove'))); row._get = () => ({ script: s.value, name: i.value }); names.append(row); };
  const idRow = () => { const s = h('select', {}, state.meta.id_types.map((x) => h('option', { value: x }, t('idtype.' + x)))); const i = h('input', { 'aria-label': t('id.number') }); const row = h('div', { class: 'row' }, s, i, h('button', { type: 'button', class: 'sm', onclick: () => row.remove() }, t('common.remove'))); row._get = () => ({ id_type: s.value, number: i.value }); ids.append(row); };
  async function submit(force) {
    err.textContent = '';
    const body = { name_en: f.name_en.value, sex: f.sex.value, dob: f.dob.value, dob_estimated: f.est.checked, phone: f.phone.value, village: f.village.value,
      ethnicity: f.ethnicity.value, language: f.language.value, nationality: f.nationality.value, restricted: f.res.checked,
      names: [...names.children].map((r) => r._get()), ids: [...ids.children].map((r) => r._get()), force: !!force };
    const r = await api('POST', '/api/patients', body);
    if (r.status === 409) {
      const d = modal([h('h3', {}, t('dup.title')), h('p', {}, t('dup.text')), r.data.duplicates.map((x) => h('div', {}, `${x.mrn} · ${x.name_en} · ${x.dob}`)),
        h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => { d.close(); submit(true); } }, t('dup.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
      return;
    }
    if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; }
    state.view = 'patients'; render();
  }
  return h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); submit(false); } },
    h('div', { class: 'grid' }, inp('name_en'), h('label', { for: 'f_sex' }, t('patient.sex'), f.sex), inp('dob', 'date'), h('label', {}, t('patient.dob_estimated'), h('div', { class: 'check' }, f.est)),
      inp('phone'), inp('village'), inp('ethnicity'), inp('language'), inp('nationality')),
    h('h4', {}, t('patient.names')), names, h('button', { type: 'button', class: 'sm', onclick: nameRow }, '+ ' + t('common.add')),
    h('h4', {}, t('patient.ids')), ids, h('button', { type: 'button', class: 'sm', onclick: idRow }, '+ ' + t('common.add')),
    h('h4', {}, t('patient.restricted')), h('label', { class: 'check' }, f.res, t('patient.restricted_help')),
    err, h('div', { class: 'row' }, h('button', { class: 'pri', type: 'submit' }, t('common.save')), h('button', { type: 'button', onclick: () => { state.view = 'patients'; render(); } }, t('common.cancel'))));
}

async function auditView() {
  const r = await api('GET', '/api/audit?limit=300');
  return h('div', { class: 'panel tablewrap' }, h('table', {}, h('tr', {}, ['audit.time', 'audit.user', 'audit.action', 'audit.detail'].map((k) => h('th', {}, t(k)))),
    (r.data.entries || []).map((e) => h('tr', {}, h('td', {}, e.ts), h('td', {}, e.username || ''), h('td', {}, e.action), h('td', {}, e.detail || '')))));
}

async function usersView() {
  const r = await api('GET', '/api/users'); const err = h('div', { class: 'err' }); const ok = h('div', { class: 'tag ok' });
  const u = h('input'), n = h('input'), pw = h('input', { type: 'password', autocomplete: 'new-password' });
  const role = h('select', {}, state.meta.roles.map((x) => h('option', { value: x }, t('role.' + x))));
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; ok.textContent = '';
    const res = await api('POST', '/api/users', { username: u.value, full_name: n.value, role: role.value, password: pw.value });
    if (!res.ok) { err.textContent = res.data.error || t('common.error'); return; }
    ok.textContent = t('users.created'); render();
  } }, h('div', { class: 'grid' }, h('label', {}, t('users.username'), u), h('label', {}, t('users.name'), n), h('label', {}, t('users.role'), role), h('label', {}, t('users.password'), pw)),
  err, ok, h('div', { class: 'row' }, h('button', { class: 'pri', type: 'submit' }, t('users.create'))));
  return h('div', {}, form, h('div', { class: 'panel tablewrap' }, h('table', {}, h('tr', {}, ['users.username', 'users.name', 'users.role'].map((k) => h('th', {}, t(k)))),
    (r.data.users || []).map((x) => h('tr', {}, h('td', {}, x.username), h('td', {}, x.full_name), h('td', {}, t('role.' + x.role)))))));
}

/* ---------- router ---------- */
async function render() {
  if (state.view !== 'queue') clearInterval(queueTimer);
  if (!state.user) { root.replaceChildren(loginScreen()); return; }
  if (state.user.must_change) { root.replaceChildren(changePasswordScreen()); return; }
  if (!state.meta) state.meta = (await api('GET', '/api/meta')).data;
  const views = { patients: ['patients.title', patientsView], register: ['patients.register', async () => registerView()], detail: ['patients.title', async () => detailView()], audit: ['audit.title', auditView], queue: ['queue.title', queueView], encounter: ['visit.title', async () => { await loadLabTests(); return encounterView(); }], lab: ['lab.worklist', labView], pharmacy: ['rx.worklist', pharmacyView], stock: ['stock.title', stockView], mch: ['nav.mch', mchView], child: ['nav.child', childView], programs: ['nav.programs', programsView], followup: ['nav.followup', followupView], inpatients: ['nav.inpatients', boardView], admission: ['adm.title', admissionView], dischargeprint: ['adm.summary_title', dischargePrintView], procedures: ['nav.procedures', proceduresView], blood: ['nav.blood', bloodView], appointments: ['nav.appointments', appointmentsView], referrals: ['nav.referrals', referralsView], referral: ['ref.title', async () => referralView()], referralprint: ['ref.letter', referralPrintView], visitprint: ['vs.title', visitPrintView], enrolment: ['prog.title', async () => { await loadProgMeta(); return enrolmentView(); }], schedule: ['nav.schedule', scheduleView], episode: ['mch.title', async () => { await loadMchMeta(); return episodeView(); }], summary: ['summary.title', summaryView], users: ['users.title', usersView] };
  const [title, fn] = views[state.view] || views.patients;
  root.replaceChildren(shell(t(title), await fn()));
}

(async function init() {
  let lang = 'en'; try { lang = localStorage.getItem('emr-lang') || 'en'; } catch { /* ignore */ }
  await loadLang(['en', 'my', 'kar'].includes(lang) ? lang : 'en');
  const me = await api('GET', '/api/me');
  if (me.ok) { state.user = me.data.user; state.view = state.user.perms.includes('queue.read') ? 'queue' : 'patients'; await loadLang(state.user.lang || lang); }
  render();
})();
