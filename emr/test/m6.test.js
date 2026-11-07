'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dbm = require('../lib/db');
const { seed, DEMO_PASSWORD } = require('../lib/seed');
const { createServer } = require('../server');
const prog = require('../lib/programs');

let server, base, db;
before(async () => {
  db = dbm.open(':memory:'); seed(db, { demo: true });
  server = createServer(db); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server.close());
async function call(method, url, body, cookie) {
  const res = await fetch(base + url, { method, headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}
const jar = {};
async function as(u) { if (!jar[u]) { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: DEMO_PASSWORD }) }); assert.equal(r.status, 200); jar[u] = r.headers.get('set-cookie').split(';')[0]; } return jar[u]; }
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
async function newPatient(name, daysOld, sex = 'F', extra = {}) { const r = await call('POST', '/api/patients', { name_en: name, sex, dob: iso(-daysOld), force: true, ...extra }, await as('reg1')); assert.equal(r.status, 201); return r.data.id; }
const adult = (n, extra) => newPatient(n, 365 * 35, 'F', extra);
const enrol = async (pid, body, who = 'doctor1') => call('POST', `/api/patients/${pid}/programs`, body, await as(who));
const visit = async (id, body, who = 'doctor1') => call('POST', `/api/enrolments/${id}/visits`, body, await as(who));
const get = async (id, who = 'doctor1') => call('GET', `/api/enrolments/${id}`, undefined, await as(who));
const list = async (pid, who = 'doctor1') => (await call('GET', `/api/patients/${pid}/programs`, undefined, await as(who))).data;
const tbBody = (o = {}) => ({ program: 'tb', tb_type: 'new', site: 'pulmonary', bacteriologically_confirmed: true, treatment_start: iso(-10), regimen: 'HRZE / HR', ...o });
const flagCodes = (x) => x.flags.map((f) => f.code);

test('permissions: only clinical roles reach programmes; records and reception cannot write', async () => {
  const p = await adult('Perm Prog');
  for (const u of ['reg1', 'pharm1', 'lab1']) assert.equal((await call('GET', `/api/patients/${p}/programs`, undefined, await as(u))).status, 403, u);
  assert.equal((await call('GET', `/api/patients/${p}/programs`, undefined, await as('his1'))).status, 200);
  assert.equal((await enrol(p, tbBody(), 'his1')).status, 403);
  assert.equal((await call('GET', '/api/programs/register', undefined, await as('lab1'))).status, 403);
});
let tb1, pTb;
test('TB enrolment: validation, registration number, first due date, one active record', async () => {
  pTb = await adult('Tb Patient');
  for (const [bad, why] of [[{ tb_type: undefined }, 'type missing'], [{ site: 'foot' }, 'bad site'], [{ treatment_start: iso(3) }, 'future start'], [{ treatment_start: undefined }, 'start missing'], [{ planned_months: 2 }, 'months'], [{ program: 'nope' }, 'programme'], [{ enrolled_on: iso(2) }, 'future enrolment']]) {
    assert.equal((await enrol(pTb, tbBody(bad))).status, 400, why);
  }
  const ok = await enrol(pTb, tbBody({ contact_consent: true })); assert.equal(ok.status, 201); tb1 = ok.data.id; assert.match(ok.data.registration_no, new RegExp(`^TB-${new Date().getUTCFullYear()}-0001$`));
  const d = (await get(tb1)).data.enrolment; assert.equal(d.status, 'active'); assert.equal(d.next_due, iso(14)); assert.equal(d.details.planned_months, 6); assert.equal(d.details.hiv_status, 'unknown');
  const dup = await enrol(pTb, tbBody()); assert.equal(dup.status, 409); assert.equal(dup.data.enrolment_id, tb1);
  assert.match((await enrol(await adult('Tb Second'), tbBody())).data.registration_no, /-0002$/);
});
test('TB visits: validation, smear rules, flags and the next due date', async () => {
  for (const [bad, why] of [[{}, 'empty'], [{ smear_result: '1+' }, 'smear without which smear'], [{ weight_kg: 1 }, 'weight'], [{ weight_kg: 50, next_due: iso(-5) }, 'next due before visit'], [{ weight_kg: 50, visit_date: iso(3) }, 'future visit'], [{ weight_kg: 50, adherence: 'perfect' }, 'bad option'], [{ weight_kg: 50, visit_date: iso(-400) }, 'before enrolment']]) {
    assert.equal((await visit(tb1, bad)).status, 400, why);
  }
  const ok = await visit(tb1, { weight_kg: 52, adherence: 'good', doses_missed: 0 }); assert.equal(ok.status, 201); assert.equal(ok.data.next_due, iso(30)); assert.ok(flagCodes(ok.data).includes('tb_hiv_unknown'));
  assert.equal((await visit(tb1, { weight_kg: 52 }, 'pharm1')).status, 403);
  const withDate = await visit(tb1, { weight_kg: 51.5, next_due: iso(10) }); assert.equal(withDate.data.next_due, iso(10)); // the clinician's date wins
  assert.equal((await get(tb1)).data.visits.length, 2);
});
test('TB: a positive smear at month 5 is a critical flag; the smear schedule is shown', async () => {
  const p = await adult('Tb Late'); const id = (await enrol(p, tbBody({ treatment_start: iso(-170), enrolled_on: iso(-170), hiv_status: 'negative' }))).data.id;
  let d = (await get(id)).data.enrolment; assert.deepEqual(d.schedule.map((s) => [s.key, s.state]), [['month2', 'overdue'], ['month5', 'due'], ['end_of_treatment', 'upcoming']]);
  assert.ok(flagCodes(d).includes('tb_smear_overdue'));
  await visit(id, { smear_for: 'month5', smear_result: '2+', weight_kg: 55 });
  d = (await get(id)).data.enrolment; assert.equal(d.schedule[1].state, 'done'); assert.equal(d.flags.find((f) => f.code === 'tb_failure_suspected').level, 'critical');
});
test('TB outcomes: "cured" must be supported by the smears; notes; closing', async () => {
  const p = await adult('Tb Cure'); const id = (await enrol(p, tbBody({ treatment_start: iso(-200), enrolled_on: iso(-200), hiv_status: 'negative' }))).data.id; const nurse = 'nurse1';
  const cure = async () => call('POST', `/api/enrolments/${id}/outcome`, { outcome: 'cured' }, await as(nurse));
  let r = await cure(); assert.equal(r.status, 400); assert.equal(r.data.reason_code, 'cured_needs_negative_smears');
  await visit(id, { visit_date: iso(-60), smear_for: 'month5', smear_result: 'neg' });
  assert.equal((await cure()).data.reason_code, 'cured_needs_negative_smears'); // one negative smear is not enough
  await visit(id, { smear_for: 'end_of_treatment', smear_result: 'neg', weight_kg: 58 });
  assert.equal((await call('POST', `/api/enrolments/${id}/outcome`, { outcome: 'banana' }, await as(nurse))).status, 400);
  assert.equal((await call('POST', `/api/enrolments/${id}/outcome`, { outcome: 'died' }, await as(nurse))).status, 400); // note needed
  assert.equal((await call('POST', `/api/enrolments/${id}/outcome`, { outcome: 'cured' }, await as('his1'))).status, 403);
  assert.equal((await cure()).status, 200);
  const d = (await get(id)).data.enrolment; assert.equal(d.status, 'closed'); assert.equal(d.outcome, 'cured'); assert.deepEqual(d.flags, []);
  assert.equal((await visit(id, { weight_kg: 58 })).status, 409); assert.equal((await cure()).status, 409);
  assert.equal((await enrol(p, tbBody())).status, 201); // a new episode can start after closing
  const unconfirmed = (await enrol(await adult('Tb Unconfirmed'), tbBody({ bacteriologically_confirmed: false, treatment_start: iso(-200), enrolled_on: iso(-200) }))).data.id;
  const u = await call('POST', `/api/enrolments/${unconfirmed}/outcome`, { outcome: 'cured' }, await as('doctor1')); assert.equal(u.data.reason_code, 'cured_needs_confirmed');
  assert.equal((await call('POST', `/api/enrolments/${unconfirmed}/outcome`, { outcome: 'treatment_completed' }, await as('doctor1'))).status, 200);
});

test('HIV status inside a TB record is masked from roles without hiv.read, and only hiv.write can set it', async () => {
  const p = await adult('Tb Hiv Patient'); const id = (await enrol(p, tbBody({ hiv_status: 'positive' }))).data.id;
  assert.equal((await get(id, 'doctor1')).data.enrolment.details.hiv_status, 'positive');
  const his = (await get(id, 'his1')).data.enrolment; assert.equal(his.details.hiv_status, undefined); assert.equal(his.details.hiv_status_hidden, true);
  assert.ok(!JSON.stringify(await list(p, 'his1')).includes('positive')); assert.ok(!JSON.stringify((await call('GET', '/api/programs/register?program=tb', undefined, await as('his1'))).data).includes('positive'));
  const meta = (name) => call('GET', '/api/programs/meta', undefined, name); const sens = (r) => r.data.programs.tb.enrol.some((f) => f.key === 'hiv_status');
  assert.equal(sens(await meta(await as('his1'))), false); assert.equal(sens(await meta(await as('doctor1'))), true);
  assert.throws(() => prog.enrol(db, { id: 1, role: 'his' }, p + 0, tbBody({ hiv_status: 'positive', treatment_start: iso(-1) })), (e) => e.status === 403); // service-level rule, whatever the route
});
let hivId, pHiv;
test('HIV programme: enrolment, viral load alerts and visit interval', async () => {
  pHiv = await adult('Hiv Patient'); const hiv = (o = {}) => ({ program: 'hiv', diagnosed_on: iso(-300), art_start_on: iso(-290), who_stage: 2, enrolled_on: iso(-100), ...o });
  assert.equal((await enrol(pHiv, hiv({ art_start_on: iso(-400) }))).status, 400); // ART before diagnosis
  assert.equal((await enrol(pHiv, hiv({ who_stage: 7 }))).status, 400);
  assert.equal((await enrol(pHiv, hiv(), 'his1')).status, 403);
  const r = await enrol(pHiv, hiv(), 'nurse1'); assert.equal(r.status, 201); hivId = r.data.id; assert.match(r.data.registration_no, /^HIV-/);
  const v = await visit(hivId, { viral_load: 5000, adherence: 'some_missed', visit_date: iso(-5), weight_kg: 61 }, 'nurse1');
  assert.equal(v.status, 201); assert.equal(v.data.next_due, iso(23)); assert.ok(flagCodes(v.data).includes('hiv_vl_unsuppressed')); assert.ok(!flagCodes(v.data).includes('hiv_vl_due')); // just measured: the repeat is due in 3 months
  assert.equal((await visit(hivId, { tb_symptoms: ['sneezing'] }, 'nurse1')).status, 400);
  const v2 = await visit(hivId, { viral_load: 30, adherence: 'good', tb_symptoms: ['cough'] }, 'doctor1'); assert.equal(v2.data.next_due, iso(90)); assert.ok(flagCodes(v2.data).includes('hiv_tb_screen_positive')); assert.ok(!flagCodes(v2.data).includes('hiv_vl_unsuppressed'));
});
test('HIV records do not exist for roles without hiv.read: not in lists, details, registers, recall or metadata', async () => {
  for (const u of ['his1', 'admin']) {
    assert.ok(!(await list(pHiv, u)).enrolments.some((e) => e.program === 'hiv'), u);
    assert.equal((await get(hivId, u)).status, 404, u); assert.equal((await visit(hivId, { weight_kg: 60 }, u)).status, 404); // "not found", never "not allowed"
    assert.equal((await call('GET', '/api/programs/register?program=hiv', undefined, await as(u))).status, 403, u);
    for (const q of ['', '?tab=recall']) assert.ok(!(await call('GET', '/api/programs/register' + q, undefined, await as(u))).data.rows.some((r) => r.program === 'hiv'), u + q);
    assert.ok(!('hiv' in (await call('GET', '/api/programs/meta', undefined, await as(u))).data.programs), u);
  }
  assert.equal((await call('POST', `/api/enrolments/${hivId}/outcome`, { outcome: 'died', note: 'x y z' }, await as('his1'))).status, 404);
  for (const u of ['doctor1', 'nurse1', 'midwife1', 'prog1']) assert.ok((await list(pHiv, u)).enrolments.some((e) => e.program === 'hiv'), u);
  assert.ok((await call('GET', '/api/programs/register?program=hiv', undefined, await as('doctor1'))).data.rows.some((r) => r.id === hivId));
  assert.ok('hiv' in (await call('GET', '/api/programs/meta', undefined, await as('doctor1'))).data.programs);
  const actions = new Set(db.prepare("SELECT action FROM audit_log WHERE action LIKE 'hiv_%'").all().map((r) => r.action));
  for (const a of ['hiv_enrolled', 'hiv_visit_recorded', 'hiv_viewed', 'hiv_register_viewed']) assert.ok(actions.has(a), a);
});

test('malaria: schedule, safety flags and outcome rules', async () => {
  const p = await adult('Malaria Patient'); const body = { program: 'malaria', species: 'pf', severity: 'uncomplicated', treatment_start: iso(-4), pregnant: true, primaquine: true, g6pd: 'unknown', treatment: 'ACT' };
  for (const bad of [{ species: 'x' }, { severity: undefined }, { treatment_start: iso(2) }]) assert.equal((await enrol(p, { ...body, ...bad })).status, 400);
  const id = (await enrol(p, body, 'nurse1')).data.id; const d = (await get(id)).data.enrolment;
  for (const c of ['malaria_pf_pregnant', 'malaria_primaquine_pregnancy', 'malaria_primaquine_g6pd_unknown']) assert.ok(flagCodes(d).includes(c), c);
  assert.deepEqual(d.schedule.map((s) => [s.key, s.state]), [['day3', 'due'], ['day28', 'upcoming']]);
  assert.equal((await visit(id, { parasite_result: 'pos' })).status, 400); // which follow-up day?
  const v = await visit(id, { follow_up_day: 'day3', parasite_result: 'pos', temp: 38.1 }); assert.ok(flagCodes(v.data).includes('malaria_day3_positive'));
  const rec = await call('POST', `/api/enrolments/${id}/outcome`, { outcome: 'recovered' }, await as('doctor1')); assert.equal(rec.status, 400); assert.equal(rec.data.reason_code, 'recovered_but_positive');
  assert.equal((await call('POST', `/api/enrolments/${id}/outcome`, { outcome: 'referred', note: 'To Mae Sot Hospital, persistent parasites' }, await as('doctor1'))).status, 200);
});
test('nutrition programme: children only, visits become growth records, discharge criteria, candidates list', async () => {
  const doc = await as('doctor1'), nurse = await as('nurse1');
  assert.equal((await enrol(await adult('Not A Child'), { program: 'nutrition', type: 'sam' })).status, 400);
  const kid = await newPatient('Sam Child', 549, 'F');
  const flagged = await newPatient('Flagged Child', 549, 'M'); await call('POST', `/api/patients/${flagged}/growth`, { weight_kg: 7.0, length_cm: 76, muac_cm: 11 }, nurse);
  let cand = (await call('GET', '/api/programs/register?program=nutrition', undefined, nurse)).data.candidates; assert.ok(cand.some((c) => c.patient.id === flagged));
  const id = (await enrol(kid, { program: 'nutrition', type: 'sam', admission_muac_cm: 11, enrolled_on: iso(-30) }, 'nurse1')).data.id;
  assert.equal((await get(id)).data.enrolment.next_due, iso(-23)); // first visit was due 7 days after enrolment
  const v1 = await visit(id, { visit_date: iso(-14), weight_kg: 7.0, length_cm: 76, muac_cm: 11.0, appetite: 'pass', rutf_sachets: 14 }, 'nurse1'); assert.equal(v1.status, 201); assert.ok(v1.data.growth_id); assert.equal(v1.data.next_due, iso(-7));
  const first = (await get(id)).data.visits[0]; assert.equal(typeof first.data.whz, 'number'); assert.ok(first.data.whz < -2);
  assert.equal((await call('GET', `/api/patients/${kid}/child`, undefined, nurse)).data.growth.measurements.length, 1); // visible in the growth record too
  const early = await call('POST', `/api/enrolments/${id}/outcome`, { outcome: 'cured' }, nurse); assert.equal(early.data.reason_code, 'nutrition_cured_needs_criteria');
  await visit(id, { visit_date: iso(-7), weight_kg: 8.8, length_cm: 78, muac_cm: 12.6, appetite: 'pass' }, 'nurse1');
  assert.ok(!flagCodes((await get(id)).data.enrolment).includes('nut_discharge_criteria_met')); // one good visit is not enough
  await visit(id, { weight_kg: 9.1, length_cm: 79, muac_cm: 12.8, appetite: 'pass' }, 'nurse1');
  assert.ok(flagCodes((await get(id)).data.enrolment).includes('nut_discharge_criteria_met'));
  assert.equal((await call('POST', `/api/enrolments/${id}/outcome`, { outcome: 'cured' }, nurse)).status, 200);
  assert.equal((await visit(await (async () => (await enrol(flagged, { program: 'nutrition', type: 'sam' }, 'nurse1')).data.id)(), { weight_kg: 7.0, appetite: 'fail' }, 'nurse1')).status, 201);
  cand = (await call('GET', '/api/programs/register?program=nutrition', undefined, nurse)).data.candidates; assert.ok(!cand.some((c) => c.patient.id === flagged)); // enrolled children leave the list
  void doc;
});
test('chronic disease: condition required, two conditions allowed, control flags change the interval', async () => {
  const p = await adult('Chronic Patient');
  assert.equal((await enrol(p, { program: 'chronic' })).status, 400); assert.equal((await enrol(p, { program: 'chronic', condition: 'gout' })).status, 400);
  const htn = (await enrol(p, { program: 'chronic', condition: 'hypertension' })).data.id, dm = (await enrol(p, { program: 'chronic', condition: 'diabetes' })).data.id;
  assert.equal((await enrol(p, { program: 'chronic', condition: 'hypertension' })).status, 409); assert.equal((await list(p)).enrolments.filter((e) => e.program === 'chronic').length, 2);
  for (const [bad, why] of [[{ sys: 150 }, 'sys without dia'], [{ sys: 100, dia: 120 }, 'dia above sys'], [{ glucose_mgdl: 150 }, 'glucose without type'], [{ hba1c: 30 }, 'hba1c range']]) assert.equal((await visit(htn, bad)).status, 400, why);
  const high = await visit(htn, { sys: 152, dia: 96, adherence: 'good' }); assert.ok(flagCodes(high.data).includes('ncd_bp_high')); assert.equal(high.data.next_due, iso(28));
  const ok = await visit(htn, { sys: 124, dia: 80 }); assert.deepEqual(flagCodes(ok.data), []); assert.equal(ok.data.next_due, iso(90));
  const low = await visit(dm, { glucose_mgdl: 55, glucose_type: 'fasting' }); assert.equal(low.data.flags.find((f) => f.code === 'ncd_hypoglycaemia').level, 'critical');
});
test('recall lists: overdue first; phone only with consent; restricted patients stay hidden; nobody is closed automatically', async () => {
  const consent = await adult('Recall Consent', { phone: '081-111-2222' }), noConsent = await adult('Recall No Consent', { phone: '081-333-4444' });
  const a = (await enrol(consent, { program: 'chronic', condition: 'asthma', contact_consent: true })).data.id, b = (await enrol(noConsent, { program: 'chronic', condition: 'asthma' })).data.id;
  const doc = await as('doctor1'); const rs = await adult('Recall Restricted', { phone: '081-555-6666', restricted: true }); await call('GET', `/api/patients/${rs}?reason=${encodeURIComponent('Chronic care follow-up')}`, undefined, doc);
  const c = (await enrol(rs, { program: 'chronic', condition: 'epilepsy', contact_consent: true })).data.id;
  db.prepare('UPDATE program_enrolments SET next_due=? WHERE id=?').run(iso(-20), a); db.prepare('UPDATE program_enrolments SET next_due=? WHERE id=?').run(iso(-5), b); db.prepare('UPDATE program_enrolments SET next_due=? WHERE id=?').run(iso(-200), c);
  const rows = (await call('GET', '/api/programs/register?tab=recall', undefined, await as('nurse1'))).data.rows;
  const idx = (id) => rows.findIndex((r) => r.id === id); assert.ok(idx(c) < idx(a) && idx(a) < idx(b)); // most overdue first
  assert.equal(rows[idx(a)].phone, '081-111-2222'); assert.equal(rows[idx(b)].phone, null);
  assert.equal(rows[idx(c)].phone, null); assert.equal(rows[idx(c)].patient.name_en, null); assert.equal(rows[idx(c)].patient.restricted, true);
  assert.ok(rows[idx(c)].flags.some((f) => f.code === 'lost_suggested')); assert.equal(db.prepare('SELECT status FROM program_enrolments WHERE id=?').get(c).status, 'active');
  assert.ok(!rows.some((r) => r.due.state === 'ok'));
});
test('restricted patients: programme records need the right role and an access reason', async () => {
  const rs = await adult('Restricted Prog', { restricted: true });
  assert.equal((await call('GET', `/api/patients/${rs}/programs`, undefined, await as('nurse1'))).status, 403);
  assert.equal((await call('GET', `/api/patients/${rs}/programs`, undefined, await as('doctor1'))).status, 428);
  await call('GET', `/api/patients/${rs}?reason=${encodeURIComponent('Programme enrolment')}`, undefined, await as('doctor1'));
  assert.equal((await enrol(rs, { program: 'chronic', condition: 'diabetes' }, 'doctor1')).status, 201);
});
test('register ordering and filters', async () => {
  const rows = (await call('GET', '/api/programs/register?program=tb', undefined, await as('doctor1'))).data.rows;
  assert.ok(rows.length >= 3 && rows.every((r) => r.program === 'tb')); assert.equal(rows[0].level, 2); // critical (failure suspected) first
  assert.ok(rows.every((r, i) => i === 0 || r.level <= rows[i - 1].level));
});
test('audit trail covers programme actions', async () => {
  const actions = new Set(db.prepare('SELECT action FROM audit_log').all().map((r) => r.action));
  for (const a of ['program_enrolled', 'program_visit_recorded', 'program_closed', 'program_viewed']) assert.ok(actions.has(a), a);
});
