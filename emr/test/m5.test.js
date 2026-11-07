'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dbm = require('../lib/db');
const { seed, DEMO_PASSWORD } = require('../lib/seed');
const { createServer } = require('../server');

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
async function newChild(name, daysOld, sex = 'F', extra = {}) { const r = await call('POST', '/api/patients', { name_en: name, sex, dob: iso(-daysOld), force: true, ...extra }, await as('reg1')); assert.equal(r.status, 201); return r.data.id; }
const ov = async (pid, who = 'nurse1') => (await call('GET', `/api/patients/${pid}/child`, undefined, await as(who))).data;
const dose = async (pid, code, n, daysAgo, extra = {}, who = 'nurse1') => call('POST', `/api/patients/${pid}/immunizations`, { vaccine_code: code, dose_no: n, given_on: iso(-daysAgo), ...extra }, await as(who));
const row = (o, code, n) => o.immunization.schedule.find((r) => r.vaccine_code === code && r.dose_no === n);

test('permissions: who may read and write child records', async () => {
  const c = await newChild('Perm Baby', 30);
  assert.equal((await call('GET', `/api/patients/${c}/child`, undefined, await as('reg1'))).status, 403);
  assert.equal((await call('GET', `/api/patients/${c}/child`, undefined, await as('pharm1'))).status, 403);
  assert.equal((await call('GET', `/api/patients/${c}/child`, undefined, await as('lab1'))).status, 403);
  assert.equal((await call('GET', `/api/patients/${c}/child`, undefined, await as('his1'))).status, 200);
  assert.equal((await dose(c, 'BCG', 1, 5, {}, 'his1')).status, 403);
  assert.equal((await call('POST', `/api/patients/${c}/growth`, { weight_kg: 4 }, await as('his1'))).status, 403);
  assert.equal((await dose(c, 'BCG', 1, 5, {}, 'nurse1')).status, 201);
});
test('overview: an 8-week-old shows the right statuses; an adult is not a child', async () => {
  const c = await newChild('Eight Weeks', 56); const o = await ov(c);
  assert.equal(o.is_child, true); assert.equal(row(o, 'BCG', 1).status, 'overdue'); assert.equal(row(o, 'PENTA', 1).status, 'due'); assert.equal(row(o, 'PENTA', 2).status, 'blocked'); assert.equal(row(o, 'OPV', 0).status, 'too_late'); assert.equal(row(o, 'MR', 1).status, 'upcoming');
  assert.equal(o.immunization.summary.up_to_date, false);
  const adult = (await call('GET', '/api/patients/3/child', undefined, await as('doctor1')).then((r) => r)); assert.equal(adult.status, 428); // restricted adult needs a reason first
  const grown = await newChild('Grown Up', 365 * 30); assert.equal((await ov(grown)).is_child, false);
});
test('recording a dose: validation, sequence, duplicates', async () => {
  const c = await newChild('Dose Baby', 70);
  for (const [bad, why] of [[{ vaccine_code: 'XXX', dose_no: 1 }, 'unknown vaccine'], [{ vaccine_code: 'PENTA', dose_no: 9 }, 'unknown dose'], [{ given_on: iso(2) }, 'future'], [{ given_on: '2026-02-30' }, 'bad date'], [{ given_on: iso(-1000) }, 'before birth']]) {
    const body = { vaccine_code: 'PENTA', dose_no: 1, given_on: iso(-10), ...bad };
    assert.equal((await call('POST', `/api/patients/${c}/immunizations`, body, await as('nurse1'))).status, 400, why);
  }
  const d2 = await dose(c, 'PENTA', 2, 0); assert.equal(d2.status, 409); assert.equal(d2.data.missing_dose, 1);
  const d1 = await dose(c, 'PENTA', 1, 25, { batch_no: 'B123', site: 'left thigh' }); assert.equal(d1.status, 201); assert.equal(d1.data.valid, true);
  assert.equal((await dose(c, 'PENTA', 1, 20)).status, 409); // already recorded
  assert.equal(row(await ov(c), 'PENTA', 1).status, 'done'); assert.equal(row(await ov(c), 'PENTA', 1).given_on, iso(-25));
});
test('invalid doses: too early or too soon are not counted and need confirmation', async () => {
  const c = await newChild('Early Baby', 70);
  const early = await dose(c, 'PENTA', 1, 50); // given at 20 days of age
  assert.equal(early.status, 409); assert.deepEqual(early.data.invalid_reasons, ['too_young']);
  const forced = await dose(c, 'PENTA', 1, 50, { confirm_invalid: true }); assert.equal(forced.status, 201); assert.equal(forced.data.valid, false);
  assert.notEqual(row(await ov(c), 'PENTA', 1).status, 'done'); // an invalid dose does not count
  assert.equal((await dose(c, 'PENTA', 1, 10)).status, 201); // the repeat dose is accepted as the real dose 1
  assert.equal((await ov(c)).immunization.records.filter((r) => r.vaccine_code === 'PENTA').length, 2);
  const soon = await dose(c, 'PENTA', 2, 0); assert.equal(soon.status, 409); assert.deepEqual(soon.data.invalid_reasons, ['too_soon']); // 10 days after dose 1
});
test('records from a vaccination card can be entered out of order', async () => {
  const c = await newChild('Card Baby', 300);
  assert.equal((await dose(c, 'PENTA', 3, 100)).status, 409); // given here: needs dose 2
  const card = await dose(c, 'PENTA', 3, 100, { source: 'card' }); assert.equal(card.status, 201); assert.equal(card.data.valid, true);
  assert.equal(row(await ov(c), 'PENTA', 3).status, 'done');
});
test('voiding a dose needs a reason and makes it due again', async () => {
  const c = await newChild('Void Baby', 60); const id = (await dose(c, 'BCG', 1, 30)).data.id;
  assert.equal(row(await ov(c), 'BCG', 1).status, 'done');
  assert.equal((await call('POST', `/api/immunizations/${id}/void`, { reason: '' }, await as('nurse1'))).status, 400);
  assert.equal((await call('POST', `/api/immunizations/${id}/void`, { reason: 'Entered for wrong child' }, await as('his1'))).status, 403);
  assert.equal((await call('POST', `/api/immunizations/${id}/void`, { reason: 'Entered for wrong child' }, await as('nurse1'))).status, 200);
  assert.notEqual(row(await ov(c), 'BCG', 1).status, 'done'); assert.equal((await call('POST', `/api/immunizations/${id}/void`, { reason: 'again again' }, await as('nurse1'))).status, 404);
  assert.equal((await dose(c, 'BCG', 1, 30)).status, 201); // can be recorded again after voiding
});
test('immunization register: overdue children first, up-to-date children left out', async () => {
  const late = await newChild('Very Late', 200), fine = await newChild('All Done', 20);
  for (const [v, n] of [['BCG', 1], ['HEPB_B', 1], ['OPV', 0]]) await dose(fine, v, n, 19);
  const reg = (await call('GET', '/api/child/register', undefined, await as('nurse1'))).data.rows;
  assert.ok(reg.find((r) => r.patient.id === late).overdue >= 5); assert.ok(!reg.some((r) => r.patient.id === fine));
  assert.ok(reg[0].overdue >= reg[reg.length - 1].overdue);
  assert.equal((await call('GET', '/api/child/register', undefined, await as('lab1'))).status, 403);
});
test('birth doses noted at delivery become immunization records; a restricted mother\'s baby stays restricted', async () => {
  const mw = await as('midwife1'), reg = await as('reg1');
  const mom = (await call('POST', '/api/patients', { name_en: 'Birth Dose Mother', sex: 'F', dob: iso(-365 * 27), force: true }, reg)).data.id;
  const ep = (await call('POST', `/api/patients/${mom}/anc-episodes`, { lmp: iso(-39 * 7), lmp_certain: true, gravida: 2, para: 1 }, mw)).data.id;
  const r = await call('POST', `/api/anc-episodes/${ep}/delivery`, { delivered_on: iso(0), mode: 'svd', place: 'clinic', maternal_outcome: 'well', newborns: [{ outcome: 'live', sex: 'M', birth_weight_g: 3200, apgar1: 8, apgar5: 9, bcg_given: true, hepb0_given: true, opv0_given: true }, { outcome: 'live', sex: 'F', birth_weight_g: 2900, apgar1: 8, apgar5: 9, bcg_given: true }] }, mw);
  assert.equal(r.status, 201);
  const [a, b] = r.data.newborns.map((n) => n.patient_id);
  const oa = await ov(a); assert.equal(row(oa, 'BCG', 1).status, 'done'); assert.equal(row(oa, 'HEPB_B', 1).status, 'done'); assert.equal(row(oa, 'OPV', 0).status, 'done');
  assert.ok(oa.immunization.records.every((x) => x.source === 'birth_record'));
  const ob = await ov(b); assert.equal(row(ob, 'BCG', 1).status, 'done'); assert.equal(row(ob, 'HEPB_B', 1).status, 'due');
  // twin without flags gets no records; rollback safety is covered by the delivery tests
  const doc = await as('doctor1'); await call('GET', `/api/patients/3?reason=${encodeURIComponent('Antenatal care')}`, undefined, doc);
  const ep3 = (await call('POST', '/api/patients/3/anc-episodes', { lmp: iso(-39 * 7), lmp_certain: true, gravida: 3, para: 2 }, doc)).data.id;
  const rr = await call('POST', `/api/anc-episodes/${ep3}/delivery`, { delivered_on: iso(0), mode: 'svd', place: 'clinic', maternal_outcome: 'well', newborns: [{ outcome: 'live', sex: 'F', birth_weight_g: 3000, apgar1: 8, apgar5: 9, bcg_given: true }] }, doc);
  const baby = rr.data.newborns[0].patient_id;
  assert.equal((await call('GET', `/api/patients/${baby}/child`, undefined, await as('nurse1'))).status, 403); // restricted, nurse has no access
  assert.equal((await call('GET', `/api/patients/${baby}/child`, undefined, doc)).status, 428); // doctor needs a reason first
});
test('growth: validation and recording', async () => {
  const c = await newChild('Grow Baby', 549); const nurse = await as('nurse1'); const post = (b) => call('POST', `/api/patients/${c}/growth`, b, nurse);
  for (const [bad, why] of [[{}, 'nothing entered'], [{ weight_kg: 0.1 }, 'weight too low'], [{ weight_kg: 500 }, 'weight too high'], [{ length_cm: 5 }, 'length'], [{ muac_cm: 'x' }, 'muac'], [{ weight_kg: 10, measured_on: iso(3) }, 'future'], [{ weight_kg: 10, measured_on: iso(-600) }, 'before birth'], [{ weight_kg: 10, encounter_id: 99999 }, 'unknown visit']]) {
    assert.ok([400, 404].includes((await post(bad)).status), why);
  }
  const ok = await post({ weight_kg: 10.2, length_cm: 81.7, head_cm: 46.2, muac_cm: 14.5 }); assert.equal(ok.status, 201); assert.deepEqual(ok.data.flags, []); assert.equal(Math.round(ok.data.age_months), 18);
  const adult = await newChild('Too Old', 365 * 25); assert.equal((await call('POST', `/api/patients/${adult}/growth`, { weight_kg: 60 }, nurse)).status, 400);
  const other = await newChild('Other Sex', 300, 'O'); const o = await call('POST', `/api/patients/${other}/growth`, { weight_kg: 8, length_cm: 70, muac_cm: 11 }, nurse);
  assert.equal(o.status, 201); assert.equal(o.data.z.waz, null); assert.deepEqual(o.data.flags.map((f) => f.code).sort(), ['sam_muac', 'sex_unspecified']);
  assert.equal((await call('POST', `/api/patients/${other}/growth`, { edema: true }, nurse)).status, 201); // oedema alone is a valid entry
});
test('growth: severe acute malnutrition is critical; history, trend and void', async () => {
  const c = await newChild('Thin Baby', 549); const nurse = await as('nurse1');
  const first = await call('POST', `/api/patients/${c}/growth`, { weight_kg: 9.0, length_cm: 80, measured_on: iso(-60) }, nurse);
  const second = await call('POST', `/api/patients/${c}/growth`, { weight_kg: 5.9, length_cm: 70, muac_cm: 11, measured_on: iso(-1) }, nurse);
  assert.deepEqual(second.data.flags.map((f) => f.code).sort(), ['stunted_severe', 'sam', 'sam_muac', 'underweight_severe'].sort());
  const list = (await ov(c)).growth.measurements; assert.equal(list.length, 2); assert.equal(list[0].measured_on, iso(-1)); // newest first
  assert.deepEqual(list[0].trend.map((t) => t.code).sort(), ['waz_falling', 'weight_loss']); assert.deepEqual(list[1].trend, []);
  assert.equal((await ov(c)).growth.latest.id, second.data.id);
  assert.equal((await call('POST', `/api/growth/${second.data.id}/void`, { reason: '' }, nurse)).status, 400);
  assert.equal((await call('POST', `/api/growth/${second.data.id}/void`, { reason: 'Scale was faulty' }, nurse)).status, 200);
  assert.equal((await ov(c)).growth.measurements.length, 1); assert.equal(first.status, 201);
});
test('nutrition register: critical first, restricted names hidden', async () => {
  const doc = await as('doctor1'), nurse = await as('nurse1');
  const sam = await newChild('Register Sam', 549), mam = await newChild('Register Mam', 549), ok = await newChild('Register Fine', 549);
  await call('POST', `/api/patients/${mam}/growth`, { weight_kg: 10, length_cm: 81, muac_cm: 12.0 }, nurse);
  await call('POST', `/api/patients/${sam}/growth`, { weight_kg: 7.0, length_cm: 76, muac_cm: 11.0 }, nurse);
  await call('POST', `/api/patients/${ok}/growth`, { weight_kg: 10.2, length_cm: 81.7 }, nurse);
  const rs = await newChild('Restricted Child', 549, 'M', { restricted: true });
  await call('GET', `/api/patients/${rs}?reason=${encodeURIComponent('Child welfare follow-up')}`, undefined, doc);
  assert.equal((await call('POST', `/api/patients/${rs}/growth`, { weight_kg: 8, length_cm: 76, muac_cm: 11.2 }, doc)).status, 201);
  const rows = (await call('GET', '/api/child/register?tab=nutrition', undefined, nurse)).data.rows;
  assert.ok(!rows.some((r) => r.patient.id === ok)); assert.equal(rows[0].level, 'critical');
  assert.ok(rows.findIndex((r) => r.patient.id === sam) < rows.findIndex((r) => r.patient.id === mam));
  const hidden = rows.find((r) => r.patient.id === rs); assert.equal(hidden.patient.name_en, null); assert.equal(hidden.patient.restricted, true);
  assert.equal((await call('POST', `/api/patients/${rs}/growth`, { weight_kg: 8 }, nurse)).status, 403);
});
test('growth charts: reference curves and the child\'s points', async () => {
  const c = await newChild('Chart Baby', 400, 'M'); const nurse = await as('nurse1');
  await call('POST', `/api/patients/${c}/growth`, { weight_kg: 9.5, length_cm: 75, head_cm: 46, measured_on: iso(-200) }, nurse); await call('POST', `/api/patients/${c}/growth`, { weight_kg: 10.4, length_cm: 79, head_cm: 47, measured_on: iso(-5) }, nurse);
  const w = (await call('GET', `/api/patients/${c}/growth/curves?indicator=wfa`, undefined, nurse)).data;
  assert.equal(w.curves.length, 61); assert.equal(w.points.length, 2); assert.ok(w.curves[12]['-3'] < w.curves[12]['0'] && w.curves[12]['0'] < w.curves[12]['3']);
  const wfh = (await call('GET', `/api/patients/${c}/growth/curves?indicator=wfh`, undefined, nurse)).data; assert.equal(wfh.curves[0].x, 45); assert.equal(wfh.points[1].x, 79); // lying by default under 24 months: no adjustment
  for (const i of ['hfa', 'bfa', 'hcfa']) assert.ok((await call('GET', `/api/patients/${c}/growth/curves?indicator=${i}`, undefined, nurse)).data.curves.length > 20, i);
  assert.equal((await call('GET', `/api/patients/${c}/growth/curves?indicator=nope`, undefined, nurse)).status, 400);
  const o = await newChild('Chart Other', 400, 'O'); assert.equal((await call('GET', `/api/patients/${o}/growth/curves?indicator=wfa`, undefined, nurse)).status, 400);
});
test('schedule administration: only admins, with sensible limits; changes alter the due dates', async () => {
  const sched = (await call('GET', '/api/child/meta', undefined, await as('nurse1'))).data.schedule; const penta1 = sched.find((d) => d.vaccine_code === 'PENTA' && d.dose_no === 1);
  const admin = await as('admin');
  assert.equal((await call('PUT', `/api/immunization/schedule/${penta1.id}`, { due_days: 60 }, await as('nurse1'))).status, 403);
  for (const bad of [{ due_days: -1 }, { due_days: 30 }, { max_age_days: 10 }, { late_days: 'x' }, { min_interval_days: 999 }]) assert.equal((await call('PUT', `/api/immunization/schedule/${penta1.id}`, bad, admin)).status, 400, JSON.stringify(bad));
  assert.equal((await call('PUT', '/api/immunization/schedule/99999', { due_days: 60 }, admin)).status, 404);
  const c = await newChild('Schedule Baby', 50); assert.equal(row(await ov(c), 'PENTA', 1).status, 'due'); // due at 42 days
  assert.equal((await call('PUT', `/api/immunization/schedule/${penta1.id}`, { due_days: 60, min_age_days: 42 }, admin)).status, 200);
  assert.equal(row(await ov(c), 'PENTA', 1).status, 'upcoming'); // now due at 60 days
  await call('PUT', `/api/immunization/schedule/${penta1.id}`, { due_days: 42 }, admin);
});
test('audit trail covers child health actions', async () => {
  const actions = new Set(db.prepare('SELECT action FROM audit_log').all().map((r) => r.action));
  for (const a of ['imm_recorded', 'imm_recorded_invalid', 'imm_voided', 'growth_recorded', 'growth_voided', 'schedule_changed', 'child_viewed']) assert.ok(actions.has(a), a);
});
