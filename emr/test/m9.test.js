'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const dbm = require('../lib/db');
const { seed, DEMO_PASSWORD } = require('../lib/seed');
const { createServer } = require('../server');
const R = require('../lib/reports');
const I = require('../lib/indicators');
const growth = require('../lib/growth');

/* ---------- a tiny fixture toolkit: insert rows with exact dates so every count is known ---------- */
let seq = 0;
function kit(db) {
  const k = {};
  k.patient = (sex, dob, o = {}) => Number(db.prepare('INSERT INTO patients(mrn,name_en,sex,dob,dob_estimated,village,restricted) VALUES(?,?,?,?,?,?,?)').run('T' + (++seq), o.name || 'Pt ' + seq, sex, dob, o.est ? 1 : 0, o.village === undefined ? 'Village' : o.village, o.restricted ? 1 : 0).lastInsertRowid);
  k.visit = (pid, date, status = 'signed', type = 'outpatient') => Number(db.prepare('INSERT INTO encounters(patient_id,visit_date,queue_no,type,status) VALUES(?,?,?,?,?)').run(pid, date, 1, type, status).lastInsertRowid);
  k.dx = (enc, code, kind = 'primary') => db.prepare('INSERT INTO diagnoses(encounter_id,code,kind) VALUES(?,?,?)').run(enc, code, kind);
  k.episode = (pid, booked, risk = '[]') => Number(db.prepare("INSERT INTO anc_episodes(patient_id,lmp,edd,edd_source,gravida,para,risk_factors,booked_at) VALUES(?,?,?,?,?,?,?,?)").run(pid, '2024-12-01', '2025-09-07', 'lmp', 2, 1, risk, booked + ' 10:00:00').lastInsertRowid);
  k.ancVisit = (ep, pid, date) => db.prepare('INSERT INTO anc_visits(episode_id,encounter_id,visit_date,ga_days) VALUES(?,?,?,?)').run(ep, k.visit(pid, date, 'cancelled'), date, 100);
  k.delivery = (ep, pid, o) => Number(db.prepare('INSERT INTO deliveries(episode_id,patient_id,delivered_on,ga_days,mode,place,blood_loss_ml,complications,maternal_outcome) VALUES(?,?,?,?,?,?,?,?,?)').run(ep, pid, o.on, o.ga ?? 280, o.mode || 'svd', o.place || 'clinic', o.blood ?? null, o.comp || '[]', o.outcome || 'well').lastInsertRowid);
  k.baby = (del, order, outcome, w) => db.prepare('INSERT INTO newborns(delivery_id,birth_order,outcome,birth_weight_g) VALUES(?,?,?,?)').run(del, order, outcome, w);
  k.pnc = (ep, date) => db.prepare('INSERT INTO postnatal_visits(episode_id,visit_date,days_postpartum) VALUES(?,?,?)').run(ep, date, 3);
  k.fp = (pid, date, method, action) => db.prepare('INSERT INTO family_planning(patient_id,visit_date,method,action) VALUES(?,?,?,?)').run(pid, date, method, action);
  k.imm = (pid, code, n, date, o = {}) => db.prepare('INSERT INTO immunizations(patient_id,vaccine_code,dose_no,given_on,source,valid,voided) VALUES(?,?,?,?,?,?,?)').run(pid, code, n, date, 'given_here', o.invalid ? 0 : 1, o.voided ? 1 : 0);
  k.growth = (pid, date, dob, w, l, muac) => db.prepare('INSERT INTO growth_measurements(patient_id,measured_on,age_days,weight_kg,length_cm,muac_cm) VALUES(?,?,?,?,?,?)').run(pid, date, Math.round((new Date(date) - new Date(dob)) / 86400000), w, l, muac);
  k.enrol = (pid, program, o = {}) => Number(db.prepare('INSERT INTO program_enrolments(patient_id,program,condition,registration_no,enrolled_on,status,outcome,outcome_on,details) VALUES(?,?,?,?,?,?,?,?,?)').run(pid, program, o.condition || '', 'R' + (++seq), o.on, o.outcome ? 'closed' : 'active', o.outcome || null, o.outcomeOn || null, JSON.stringify(o.details || {})).lastInsertRowid);
  k.pvisit = (en, date, data) => db.prepare('INSERT INTO program_visits(enrolment_id,visit_date,data) VALUES(?,?,?)').run(en, date, JSON.stringify(data));
  k.lab = (pid, enc, code, flag, at) => db.prepare("INSERT INTO lab_orders(encounter_id,patient_id,test_id,status,resulted_at,result_flag,result_value) VALUES(?,?,(SELECT id FROM lab_tests WHERE code=?),'resulted',?,?,'x')").run(enc, pid, code, at + ' 10:00:00', flag);
  return k;
}
const fresh = () => { const db = dbm.open(':memory:'); return { db, k: kit(db) }; };
const run = (db, key, from, to, o = {}) => R.run(db, key, from, to, { mask: false, ...o });
const sec = (r, title) => r.sections.find((s) => s.title === title);
const ind = (db, code, from, to, mask = false) => I.run(db, code, from, to, { mask });

/* ---------------- morbidity and workload ---------------- */
function janData() {
  const { db, k } = fresh(); const A = k.patient('F', '2024-06-01'), B = k.patient('M', '2022-03-01'), C = k.patient('F', '2015-01-01'), D = k.patient('F', '2005-05-05'), E = k.patient('M', '1990-01-01'), F = k.patient('F', '1960-01-01'), G = k.patient('F', '1990-02-02'), H = k.patient('M', '1985-03-03'), Z = k.patient('F', '1980-01-01');
  const e1 = k.visit(A, '2025-01-10'); k.dx(e1, 'B54'); const e2 = k.visit(B, '2025-01-10'); k.dx(e2, 'B54'); const e3 = k.visit(C, '2025-01-11'); k.dx(e3, 'J06'); const e4 = k.visit(D, '2025-01-12'); k.dx(e4, 'B54');
  const e5 = k.visit(E, '2025-01-12', 'signed', 'antenatal'); k.dx(e5, 'J06'); const e6 = k.visit(F, '2025-01-13'); k.dx(e6, 'I10'); const e7 = k.visit(A, '2025-01-14'); k.dx(e7, 'J06'); k.dx(e7, 'B54', 'secondary'); const e8 = k.visit(G, '2025-01-15'); k.dx(e8, 'B24');
  const e9 = k.visit(H, '2025-01-15', 'in_consult'); k.dx(e9, 'B54'); k.visit(Z, '2025-01-16', 'cancelled'); k.visit(E, '2025-02-02'); // unsigned, cancelled and out-of-period visits must not count
  return db;
}
test('morbidity: counts by diagnosis, sex and age group; unsigned and cancelled visits excluded; HIV shown as a total only', () => {
  const db = janData(); const r = run(db, 'morbidity', '2025-01-01', '2025-01-31'); const rows = r.sections[0].rows; const by = (c) => rows.find((x) => x.code === c);
  assert.deepEqual(rows.map((x) => x.code), ['B54', 'J06', 'B24', 'I10']);
  assert.deepEqual([by('B54').total, by('B54').female, by('B54').male, by('B54').u1, by('B54').a1_4, by('B54').a15_24, by('B54').a5_14], [3, 2, 1, 1, 1, 1, 0]);
  assert.deepEqual([by('J06').total, by('J06').female, by('J06').male, by('J06').u1, by('J06').a5_14, by('J06').a25_49], [3, 2, 1, 1, 1, 1]); assert.deepEqual([by('I10').total, by('I10').a50p], [1, 1]);
  assert.equal(by('B24').total, 1); assert.equal(by('B24').female, undefined); assert.ok(/sensitive/.test(by('B24').diagnosis)); // exact on screen for HIV-authorised roles, and no breakdown
  assert.equal(run(db, 'morbidity', '2025-01-01', '2025-01-31', { mask: true }).sections[0].rows.find((x) => x.code === 'B24').total, '<5');
  const allDx = run(db, 'morbidity', '2025-01-01', '2025-01-31', { allDx: true }).sections[0].rows; assert.equal(allDx.find((x) => x.code === 'B54').total, 4); // the secondary diagnosis is included on request
  assert.equal(run(db, 'morbidity', '2025-03-01', '2025-03-31').sections[0].rows.length, 0);
});
test('workload: visits, new patients, under-5s, per day, by type, by age and sex', () => {
  const db = janData(); const r = run(db, 'workload', '2025-01-01', '2025-01-31'); const ind0 = (c) => sec(r, 'Summary').rows.find((x) => x.label === I.BY_CODE[c].label).value;
  assert.equal(ind0('opd_visits'), 8); assert.equal(ind0('opd_visits_u5'), 3); assert.equal(ind0('opd_new_patients'), 8); // the cancelled-only patient is not new; the unsigned visit still makes a patient "new"
  assert.deepEqual(sec(r, 'Visits per day').rows, [{ date: '2025-01-10', visits: 2 }, { date: '2025-01-11', visits: 1 }, { date: '2025-01-12', visits: 2 }, { date: '2025-01-13', visits: 1 }, { date: '2025-01-14', visits: 1 }, { date: '2025-01-15', visits: 1 }]);
  assert.deepEqual(sec(r, 'Visits by type').rows, [{ type: 'outpatient', visits: 7 }, { type: 'antenatal', visits: 1 }]);
  const ag = Object.fromEntries(sec(r, 'Visits by age and sex').rows.map((x) => [x.age, x])); assert.deepEqual([ag['<1 year'].female, ag['1-4 years'].male, ag['5-14 years'].female, ag['15-24 years'].female, ag['25-49 years'].male, ag['25-49 years'].female, ag['50+ years'].female], [2, 1, 1, 1, 1, 1, 1]);
  assert.equal(sec(r, 'Visits by age and sex').rows.reduce((s, x) => s + x.total, 0), 8);
  assert.equal(ind(db, 'opd_new_patients', '2025-02-01', '2025-02-28').value, 0); // E's first visit was in January, so the February visit is a return visit
});

/* ---------------- maternal ---------------- */
test('maternal indicators and tables', () => {
  const { db, k } = fresh(); const w = [1, 2, 3, 4, 5].map(() => k.patient('F', '1995-01-01'));
  const ep1 = k.episode(w[0], '2025-03-05'), ep2 = k.episode(w[1], '2025-03-10', '["age_under_18"]'), ep3 = k.episode(w[2], '2025-02-20');
  for (const d of ['2025-03-06', '2025-03-13', '2025-03-20', '2025-03-27']) k.ancVisit(ep1, w[0], d); k.ancVisit(ep2, w[1], '2025-03-11'); k.ancVisit(ep3, w[2], '2025-02-25'); k.ancVisit(ep3, w[2], '2025-03-02');
  const ep4 = k.episode(w[3], '2024-12-01'), ep5 = k.episode(w[4], '2024-12-02'), ep6 = k.episode(k.patient('F', '1990-01-01'), '2024-12-03');
  const d1 = k.delivery(ep4, w[3], { on: '2025-03-15', mode: 'caesarean', place: 'clinic', blood: 700 }); k.baby(d1, 1, 'live', 3200);
  const d2 = k.delivery(ep5, w[4], { on: '2025-03-20', mode: 'svd', place: 'home', ga: 250, outcome: 'died' }); k.baby(d2, 1, 'live', 2300); k.baby(d2, 2, 'stillbirth_fresh', 1900);
  const d3 = k.delivery(ep6, 1, { on: '2025-04-02' }); k.baby(d3, 1, 'live', 3000); // outside the period
  k.pnc(ep4, '2025-03-18'); k.pnc(ep4, '2025-03-25'); k.pnc(ep4, '2025-04-20');
  k.fp(w[0], '2025-03-04', 'implant', 'start'); k.fp(w[1], '2025-03-05', 'injectable', 'start'); k.fp(w[1], '2025-03-30', 'injectable', 'continue'); k.fp(w[2], '2025-03-06', 'condom', 'counselling'); k.fp(w[2], '2025-04-06', 'implant', 'start');
  const g = (c) => ind(db, c, '2025-03-01', '2025-03-31'); const v = (c) => g(c).value;
  assert.equal(v('anc_bookings'), 2); assert.equal(v('anc_visits_total'), 6); assert.deepEqual([g('anc_4plus').value, g('anc_4plus').denominator], [1, 3]); assert.equal(v('anc_high_risk'), 1);
  assert.equal(v('deliveries'), 2); assert.equal(v('deliveries_clinic'), 1); assert.equal(v('deliveries_caesarean'), 1); assert.equal(v('live_births'), 2); assert.equal(v('stillbirths'), 1);
  assert.deepEqual([g('low_birth_weight').value, g('low_birth_weight').denominator, g('low_birth_weight').percent], [1, 2, 50]); assert.deepEqual([g('preterm_births').value, g('preterm_births').denominator], [1, 2]);
  assert.equal(v('pph_cases'), 1); assert.equal(v('maternal_deaths'), 1); assert.equal(v('pnc_visits'), 2); assert.equal(v('fp_visits'), 4); assert.equal(v('fp_new_acceptors'), 2);
  assert.equal(ind(db, 'maternal_deaths', '2025-03-01', '2025-03-31', true).value, '<5'); // a single death is hidden when numbers are masked
  const r = run(db, 'maternal', '2025-03-01', '2025-03-31'); assert.deepEqual(sec(r, 'Deliveries by mode and place').rows.map((x) => [x.mode, x.place, x.count]).sort(), [['caesarean', 'clinic', 1], ['svd', 'home', 1]]);
  assert.deepEqual(sec(r, 'Family planning by method').rows.map((x) => [x.method, x.visits, x.started]).sort(), [['condom', 1, 0], ['implant', 1, 1], ['injectable', 2, 1]]);
});

/* ---------------- child health ---------------- */
test('child health: doses, coverage among registered children, nutrition prevalence and programme outcomes', () => {
  const { db, k } = fresh(); const kid = (dob, sex = 'F') => k.patient(sex, dob);
  const k1 = kid('2024-12-01'), k2 = kid('2025-01-05'), k3 = kid('2025-02-02'); k.imm(k1, 'PENTA', 3, '2025-04-10'); k.imm(k2, 'MR', 1, '2025-04-12'); k.imm(k3, 'BCG', 1, '2025-04-03'); k.imm(k3, 'OPV', 0, '2025-04-04', { invalid: true }); k.imm(k3, 'HEPB_B', 1, '2025-04-05', { voided: true });
  const D1 = kid('2023-12-01'), D2 = kid('2023-11-15'), D3 = kid('2024-02-01'), D4 = kid('2024-06-01'), D5 = kid('2022-01-01');
  k.imm(D1, 'PENTA', 3, '2024-03-01'); k.imm(D2, 'PENTA', 1, '2024-02-01'); k.imm(D3, 'PENTA', 3, '2024-08-01'); k.imm(D4, 'PENTA', 3, '2024-10-01'); k.imm(D5, 'PENTA', 3, '2022-06-01');
  k.imm(D1, 'MR', 1, '2024-09-01'); k.imm(D2, 'MR', 1, '2025-05-10'); // D2's measles dose is after the end of the period: not counted
  const g = (c) => ind(db, c, '2025-04-01', '2025-04-30');
  assert.equal(g('immunization_doses').value, 3); assert.equal(g('penta3_doses').value, 1); assert.equal(g('mr1_doses').value, 1); // invalid and removed doses do not count
  assert.deepEqual([g('penta3_coverage').value, g('penta3_coverage').denominator, g('penta3_coverage').percent], [2, 3, 66.7]); assert.deepEqual([g('mr1_coverage').value, g('mr1_coverage').denominator, g('mr1_coverage').percent], [1, 3, 33.3]);
  const dob = '2023-10-15', on = '2025-04-15'; const C1 = kid(dob), C2 = kid(dob), C3 = kid(dob), C4 = kid(dob);
  k.growth(C1, on, dob, 5.9, 70, 11); k.growth(C2, on, dob, 10.2, 81.7, 14.5); k.growth(C3, on, dob, 9.5, 74, 14); k.growth(C4, '2025-04-02', dob, 10.2, 81.7, 14.5); k.growth(C4, on, dob, 5.9, 70, 11); // C4 got worse: only the latest counts
  const flags = (w, l, m) => growth.compute({ sex: 'F', dob, measured_on: on, weight_kg: w, length_cm: l, muac_cm: m }).flags.map((f) => f.code);
  assert.ok(flags(5.9, 70, 11).includes('sam')); assert.ok(!flags(10.2, 81.7, 14.5).length); assert.ok(flags(9.5, 74, 14).includes('stunted') && !flags(9.5, 74, 14).includes('sam')); // the fixtures mean what the comments say
  assert.equal(g('growth_measurements').value, 5); assert.deepEqual([g('sam_prevalence').value, g('sam_prevalence').denominator, g('sam_prevalence').percent], [2, 4, 50]);
  assert.deepEqual([g('stunting_prevalence').value, g('stunting_prevalence').denominator], [3, 4]); assert.deepEqual([g('underweight_prevalence').value, g('underweight_prevalence').denominator], [2, 4]);
  const n1 = k.enrol(C1, 'nutrition', { on: '2025-04-03', details: { type: 'sam' }, outcome: 'cured', outcomeOn: '2025-04-28' }); const n2 = k.enrol(C2, 'nutrition', { on: '2025-04-10', details: { type: 'mam' }, outcome: 'defaulted', outcomeOn: '2025-04-29' }); void n1; void n2; k.enrol(C3, 'nutrition', { on: '2025-03-01', details: { type: 'sam' } });
  assert.equal(g('nutrition_admissions').value, 2); assert.deepEqual([g('nutrition_cured').value, g('nutrition_cured').denominator], [1, 2]); assert.equal(g('nutrition_defaulted').value, 1);
  const r = run(db, 'child', '2025-04-01', '2025-04-30'); assert.deepEqual(sec(r, 'Vaccine doses given').rows.map((x) => [x.vaccine, x.dose, x.count]).sort(), [['BCG', 1, 1], ['Measles-containing (MR / MMR)', 1, 1], ['Pentavalent (DTP-HepB-Hib)', 3, 1]]);
});

/* ---------------- programmes ---------------- */
test('programmes: TB, malaria, HIV (sensitive), chronic disease and the outcome tables', () => {
  const { db, k } = fresh(); const p = () => k.patient('F', '1985-01-01'); const T0 = '2025-05-31';
  const tb = (on, conf, o = {}) => k.enrol(p(), 'tb', { on, details: { bacteriologically_confirmed: conf, site: 'pulmonary' }, ...o });
  tb('2025-05-02', true, { outcome: 'cured', outcomeOn: '2025-05-20' }); tb('2025-05-03', true, { outcome: 'lost_to_follow_up', outcomeOn: '2025-05-25' }); tb('2025-05-04', false, { outcome: 'died', outcomeOn: '2025-05-28' }); tb('2025-05-05', true); tb('2025-05-06', false); tb('2025-04-01', true);
  for (const [sp, sev] of [['pf', 'uncomplicated'], ['pv', 'uncomplicated'], ['pf_pv', 'severe'], ['pf', 'uncomplicated']]) k.enrol(p(), 'malaria', { on: '2025-05-10', details: { species: sp, severity: sev } });
  const hA = k.enrol(p(), 'hiv', { on: '2025-05-05', details: { art_start_on: '2025-05-12' } }), hB = k.enrol(p(), 'hiv', { on: '2025-05-15', details: { art_start_on: '2025-05-20' } }), hC = k.enrol(p(), 'hiv', { on: '2025-01-10', details: { art_start_on: '2025-01-20' } }), hD = k.enrol(p(), 'hiv', { on: '2024-06-01', details: {}, outcome: 'transferred_out', outcomeOn: '2025-06-10' });
  k.pvisit(hA, '2025-03-10', { viral_load: 50 }); k.pvisit(hB, '2025-04-10', { viral_load: 5000 }); k.pvisit(hC, '2024-01-10', { viral_load: 100 }); void hD; // hC's result is more than 12 months old
  const h1 = k.enrol(p(), 'chronic', { condition: 'hypertension', on: '2025-01-05' }), h2 = k.enrol(p(), 'chronic', { condition: 'hypertension', on: '2025-05-12' }); k.enrol(p(), 'chronic', { condition: 'hypertension', on: '2024-01-01', outcome: 'died', outcomeOn: '2025-02-01' }); k.enrol(p(), 'chronic', { condition: 'diabetes', on: '2025-05-12' });
  k.pvisit(h1, '2025-04-01', { sys: 120, dia: 78 }); k.pvisit(h2, '2025-05-20', { sys: 150, dia: 95 });
  const g = (c) => ind(db, c, '2025-05-01', T0);
  assert.equal(g('tb_cases').value, 5); assert.equal(g('tb_confirmed').value, 3); assert.deepEqual([g('tb_success').value, g('tb_success').denominator], [1, 3]); assert.equal(g('tb_lost').value, 1); assert.equal(g('tb_died').value, 1);
  assert.equal(g('malaria_cases').value, 4); assert.equal(g('malaria_falciparum').value, 3); assert.equal(g('malaria_severe').value, 1);
  assert.equal(g('hiv_new').value, 2); assert.equal(g('hiv_active').value, 4); assert.deepEqual([g('hiv_on_art').value, g('hiv_on_art').denominator], [3, 4]); assert.deepEqual([g('hiv_vl_suppressed').value, g('hiv_vl_suppressed').denominator], [1, 2]);
  assert.equal(g('ncd_hypertension').value, 2); assert.equal(g('ncd_diabetes').value, 1); assert.deepEqual([g('hypertension_controlled').value, g('hypertension_controlled').denominator], [1, 2]);
  const masked = (c) => ind(db, c, '2025-05-01', T0, true); assert.equal(masked('hiv_new').value, '<5'); assert.equal(masked('hiv_active').value, '<5'); assert.equal(masked('hiv_on_art').percent, null); assert.match(masked('hiv_on_art').text, /<5 \/ <5/); assert.equal(masked('tb_cases').value, 5); // only sensitive indicators are hidden
  assert.equal(masked('hiv_vl_suppressed').percent, null); assert.ok(!/%/.test(masked('hiv_vl_suppressed').text)); // a percentage could reveal the small numbers behind it
  const r = run(db, 'programmes', '2025-05-01', T0, { mask: true }); const prog = Object.fromEntries(sec(r, 'Records by programme').rows.map((x) => [x.program, x])); assert.deepEqual([prog.tb.new, prog.tb.active, prog.hiv.new, prog.hiv.active, prog.chronic.new, prog.chronic.active], [5, 3, '<5', '<5', 2, 3]);
  const out = sec(r, 'Outcomes of records closed in the period').rows; assert.deepEqual(out.filter((x) => x.program === 'tb').map((x) => [x.outcome, x.count]).sort(), [['cured', 1], ['died', 1], ['lost_to_follow_up', 1]]); assert.ok(!out.some((x) => x.program === 'hiv')); // the HIV closure was in June
});

/* ---------------- laboratory, pharmacy, blood, inpatient, referrals ---------------- */
test('laboratory: positivity and sensitive tests', () => {
  const { db, k } = fresh(); const p = k.patient('F', '1990-01-01'); const e = k.visit(p, '2025-06-01', 'cancelled'); const at = '2025-06-10';
  for (const f of ['abnormal', 'abnormal', 'abnormal', 'abnormal', 'abnormal', 'abnormal', 'normal', 'normal', 'normal', 'invalid']) k.lab(p, e, 'MAL_RDT', f, at);
  k.lab(p, e, 'HIV_RDT', 'abnormal', at); k.lab(p, e, 'HIV_RDT', 'normal', at); k.lab(p, e, 'HIV_RDT', 'normal', at); k.lab(p, e, 'HB', 'normal', at); k.lab(p, e, 'HB', 'critical', at); k.lab(p, e, 'MAL_RDT', 'normal', '2025-07-01');
  const g = (c, m) => ind(db, c, '2025-06-01', '2025-06-30', m); assert.equal(g('lab_tests_resulted').value, 15); assert.deepEqual([g('malaria_rdt_positivity').value, g('malaria_rdt_positivity').denominator, g('malaria_rdt_positivity').percent], [6, 9, 66.7]); // the invalid test is not in the denominator
  assert.deepEqual([g('hiv_tests').value, g('hiv_reactive').value, g('hiv_reactive').denominator], [3, 1, 3]); assert.equal(g('hiv_tests', true).value, '<5');
  const r = run(db, 'lab', '2025-06-01', '2025-06-30', { mask: true }); const rows = sec(r, 'Tests resulted').rows; const mal = rows.find((x) => x.test === 'Malaria rapid test'); assert.deepEqual([mal.resulted, mal.abnormal, mal.percent], [10, 6, 60]);
  const hiv = rows.find((x) => /HIV/.test(x.test)); assert.equal(hiv.resulted, '<5'); assert.equal(hiv.abnormal, undefined); assert.equal(rows.find((x) => x.test === 'Haemoglobin').abnormal, 1); // the HIV row has no positives column at all
});
test('pharmacy and blood bank', () => {
  const { db, k } = fresh(); const p = k.patient('F', '1990-01-01'); const e = k.visit(p, '2025-07-01', 'cancelled'); const drug = (n) => db.prepare('SELECT id FROM drugs WHERE name=?').get(n).id; const batch = (d) => Number(db.prepare("INSERT INTO stock_batches(drug_id,batch_no,expiry,qty_received,qty_on_hand) VALUES(?,?,?,?,?)").run(d, 'B' + (++seq), '2099-01-01', 100, 50).lastInsertRowid);
  const rx = (d) => Number(db.prepare("INSERT INTO prescriptions(encounter_id,patient_id,drug_id,dose,frequency,duration_days,quantity,status) VALUES(?,?,?,?,?,?,?,'dispensed')").run(e, p, d, 'x', 'x', 1, 1).lastInsertRowid);
  const disp = (r, b, q, at) => db.prepare('INSERT INTO dispensing(prescription_id,batch_id,qty,at) VALUES(?,?,?,?)').run(r, b, q, at + ' 09:00:00'); const para = drug('Paracetamol'), amox = db.prepare("SELECT id FROM drugs WHERE name='Amoxicillin' AND strength='250 mg'").get().id; const bp = batch(para), ba = batch(amox);
  const r1 = rx(para), r2 = rx(para), r3 = rx(amox); disp(r1, bp, 12, '2025-07-03'); disp(r1, bp, 8, '2025-07-04'); disp(r2, bp, 10, '2025-07-05'); disp(r3, ba, 15, '2025-07-06'); disp(r3, ba, 5, '2025-08-02');
  assert.equal(ind(db, 'rx_dispensed', '2025-07-01', '2025-07-31').value, 3); const tab = sec(run(db, 'pharmacy', '2025-07-01', '2025-07-31'), 'Medicines dispensed').rows; assert.deepEqual(tab.map((x) => [x.drug, x.quantity, x.prescriptions]), [['Paracetamol 500 mg tablet', 30, 2], ['Amoxicillin 250 mg capsule', 15, 1]]);
  const stock = sec(run(db, 'pharmacy', '2025-07-01', '2025-07-31'), 'Medicine stock today (a snapshot, not the period)').rows; assert.equal(stock.find((x) => x.drug.startsWith('Paracetamol')).usable, 50); assert.equal(stock.find((x) => x.drug.startsWith('Paracetamol')).status, 'Low or out of stock'); // 50 is below the reorder level of 500
  assert.equal(ind(db, 'stock_below_reorder_now', '2025-07-01', '2025-07-31').value, 24); // every medicine in the starter list is at or below its reorder level
  const unit = (n, code) => Number(db.prepare("INSERT INTO blood_units(unit_no,abo,rh,component,volume_ml,collected_on,expires_on,registered_at,status,discard_code) VALUES(?,?,?,?,?,?,?,?,?,?)").run('BU' + n, 'O', 'pos', 'red_cells', 300, '2025-07-01', '2025-08-01', '2025-07-0' + (n % 9 + 1) + ' 10:00:00', code ? 'discarded' : 'available', code || null).lastInsertRowid);
  const u1 = unit(1), u2 = unit(2), u3 = unit(3, 'screening_reactive'), u4 = unit(4); void u3; void u4;
  const iss = (u) => Number(db.prepare("INSERT INTO blood_issues(unit_id,patient_id,indication,crossmatch,status) VALUES(?,?,?,?,'transfused')").run(u, p, 'x', 'compatible').lastInsertRowid); db.prepare("INSERT INTO transfusions(issue_id,started_at,reaction) VALUES(?,?,?)").run(iss(u1), '2025-07-10 10:00', 'none'); db.prepare("INSERT INTO transfusions(issue_id,started_at,reaction) VALUES(?,?,?)").run(iss(u2), '2025-07-12 10:00', 'mild');
  const g = (c, m) => ind(db, c, '2025-07-01', '2025-07-31', m); assert.equal(g('blood_units_registered').value, 4); assert.equal(g('blood_units_screen_discarded').value, 1); assert.equal(g('blood_units_screen_discarded', true).value, '<5'); assert.equal(g('transfusions').value, 2); assert.deepEqual([g('transfusion_reactions').value, g('transfusion_reactions').denominator], [1, 2]);
});
test('inpatient: admissions, discharges, length of stay, bed occupancy and procedures', () => {
  const { db, k } = fresh(); const bedIds = db.prepare('SELECT id FROM beds ORDER BY id').all().map((b) => b.id); const adm = (i, at, dis, type) => db.prepare("INSERT INTO admissions(adm_no,patient_id,ward_id,bed_id,admitted_at,reason,status,discharged_at,discharge_type) VALUES(?,?,1,?,?,?,?,?,?)").run('A' + i, k.patient('F', '1990-01-01'), bedIds[i], at, 'x', dis ? 'discharged' : 'admitted', dis || null, type || null);
  adm(0, '2025-08-05 08:00:00', '2025-08-10 10:00:00', 'discharged'); adm(1, '2025-07-28 08:00:00', '2025-08-03 09:00:00', 'discharged'); adm(2, '2025-08-28 08:00:00'); adm(3, '2025-08-15 08:00:00', '2025-08-16 02:00:00', 'died');
  const g = (c, m) => ind(db, c, '2025-08-01', '2025-08-31', m); assert.equal(g('admissions').value, 3); assert.equal(g('discharges').value, 3); assert.equal(g('inpatient_deaths').value, 1); assert.equal(g('inpatient_deaths', true).value, '<5'); assert.equal(g('avg_length_of_stay').value, 4);
  assert.deepEqual([g('bed_occupancy').value, g('bed_occupancy').denominator, g('bed_occupancy').percent], [12, 496, 2.4]); // 5 + 2 + 4 + 1 nights, out of 16 beds x 31 days
  const p = k.patient('F', '1990-01-01'); const proc = (code, on, voided) => db.prepare("INSERT INTO procedures(patient_id,type_code,performed_on,indication,voided) VALUES(?,?,?,?,?)").run(p, code, on, 'x', voided ? 1 : 0); proc('SUTURE', '2025-08-02'); proc('CAESAREAN', '2025-08-05'); proc('WOUND_CARE', '2025-08-06'); proc('SUTURE', '2025-08-07', true); proc('SUTURE', '2025-09-01');
  assert.equal(g('procedures_total').value, 3); assert.equal(g('major_surgery').value, 1);
  const r = run(db, 'inpatient', '2025-08-01', '2025-08-31', { mask: true }); assert.deepEqual(sec(r, 'How stays ended').rows.map((x) => [x.type, x.count]).sort(), [['died', '<5'], ['discharged', 2]]); assert.deepEqual(sec(r, 'Procedures by type').rows.map((x) => [x.name, x.count]).sort(), [['Caesarean section', 1], ['Suturing of a wound', 1], ['Wound cleaning and dressing', 1]]);
});
test('referrals: written, replied and by destination', () => {
  const { db, k } = fresh(); const p = k.patient('F', '1990-01-01'); const ref = (n, dest, urg, status, at) => db.prepare("INSERT INTO referrals(ref_no,patient_id,destination_name,reason,urgency,clinical_summary,consent_to_share,status,created_at) VALUES(?,?,?,?,?,?,1,?,?)").run('REF' + n, p, dest, 'x', urg, 'summary text', status, at + ' 09:00:00');
  ref(1, 'Mae Sot Hospital', 'urgent', 'completed', '2025-09-10'); ref(2, 'Mae Sot Hospital', 'routine', 'open', '2025-09-12'); ref(3, 'Other clinic', 'emergency', 'attended', '2025-09-15'); ref(4, 'Other clinic', 'routine', 'cancelled', '2025-09-16'); ref(5, 'Mae Sot Hospital', 'routine', 'open', '2025-10-02');
  assert.equal(ind(db, 'referrals_out', '2025-09-01', '2025-09-30').value, 3); const r = ind(db, 'referrals_replied', '2025-09-01', '2025-09-30'); assert.deepEqual([r.value, r.denominator], [1, 3]);
  assert.deepEqual(sec(run(db, 'referrals', '2025-09-01', '2025-09-30'), 'By destination').rows, [{ destination: 'Mae Sot Hospital', total: 2, urgent: 1, replied: 1, open: 1 }, { destination: 'Other clinic', total: 1, urgent: 1, replied: 0, open: 1 }]);
});
test('data quality checks', () => {
  const { db, k } = fresh(); k.patient('F', '1990-01-01'); k.patient('F', '1991-01-01', { est: true }); k.patient('M', '1992-01-01', { village: '' }); k.patient('F', '1993-01-01', { name: 'Same Name' }); k.patient('F', '1993-01-01', { name: 'same name' }); k.patient('F', '1994-01-01', { name: 'Same Name' });
  const p = k.patient('F', '1980-01-01'); k.visit(p, '2020-01-01', 'in_consult'); const done = k.visit(p, '2025-01-01', 'signed'); void done; k.visit(p, '2025-01-02', 'signed');
  const rows = Object.fromEntries(R.run(db, 'dataquality', '2025-01-01', '2025-01-31', { mask: false }).sections[0].rows.map((x) => [x.check, x]));
  assert.deepEqual([rows['Patients registered'].count, rows['Patients with an estimated date of birth'].count, rows['Patients with no village or address'].count], [7, 1, 1]); assert.equal(rows['Possible duplicate patients'].count, 1); // one group of two patients
  assert.deepEqual([rows['Visits left unsigned for over 2 days'].count, rows['Visits left unsigned for over 2 days'].of], [1, 3]); assert.equal(rows['Signed visits without vital signs'].count, 2); assert.equal(rows['Signed visits without vital signs'].percent, 100);
});

/* ---------------- the catalogue, templates and indicator rules ---------------- */
test('every indicator has a written definition; the sensitive set is exactly the agreed one; templates only use real indicators', () => {
  assert.ok(I.INDICATORS.length >= 60); for (const x of I.INDICATORS) { assert.ok(x.definition.length > 25, x.code); assert.ok(x.label.length > 3, x.code); }
  assert.deepEqual(I.INDICATORS.filter((x) => x.sensitive).map((x) => x.code).sort(), ['blood_units_screen_discarded', 'hiv_active', 'hiv_new', 'hiv_on_art', 'hiv_reactive', 'hiv_tests', 'hiv_vl_suppressed', 'inpatient_deaths', 'maternal_deaths', 'tb_died']);
  for (const t of Object.values(R.TEMPLATES)) for (const c of t.indicators) assert.ok(I.BY_CODE[c], c);
  assert.equal(new Set(I.INDICATORS.map((x) => x.code)).size, I.INDICATORS.length);
  const db = janData(); for (const c of R.catalog()) { const r = R.run(db, c.key, '2025-01-01', '2025-01-31', { mask: true }); assert.ok(r.sections.length && r.meta.length === 3, c.key); assert.ok(r.sections.every((s) => s.columns.length && Array.isArray(s.rows)), c.key); }
  for (const t of Object.keys(R.TEMPLATES)) assert.ok(R.run(db, t, '2025-01-01', '2025-01-31', { mask: true }).sections[0].rows.every((x) => x.definition && x.code));
  assert.throws(() => R.run(db, 'nope', '2025-01-01', '2025-01-31', {}), /Unknown report/);
});
test('period rules', () => {
  const db = janData(); for (const [f, t] of [['2025-01-31', '2025-01-01'], ['2025-01-01', '2026-06-01'], ['x', '2025-01-01'], ['2025-02-30', '2025-03-01']]) assert.throws(() => R.run(db, 'workload', f, t, {}), /date|period|Choose/i, f + t);
  assert.doesNotThrow(() => R.run(db, 'workload', '2025-01-01', '2026-01-01', {}));
});

/* ---------------- over HTTP: permissions, exports, masking, dashboard, audit ---------------- */
let server, base, db;
before(async () => { db = dbm.open(':memory:'); seed(db, { demo: true }); server = createServer(db); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port;
  const k = kit(db); const hivP = k.patient('F', '1990-01-01'); k.enrol(hivP, 'hiv', { on: '2025-05-05', details: {} }); const P = k.patient('M', '1990-01-01'); const e = k.visit(P, '2025-05-06'); k.dx(e, 'B54'); const e2 = k.visit(hivP, '2025-05-07'); k.dx(e2, 'B24'); });
after(() => server.close());
const jar = {};
async function as(u) { if (!jar[u]) { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: DEMO_PASSWORD }) }); assert.equal(r.status, 200); jar[u] = r.headers.get('set-cookie').split(';')[0]; } return jar[u]; }
const get = async (path, who) => fetch(base + path, { headers: { 'X-Requested-With': 'emr', Cookie: await as(who) } });
test('who can read and export reports', async () => {
  for (const [u, read, exp] of [['reg1', 403, 403], ['lab1', 403, 403], ['pharm1', 403, 403], ['nurse1', 403, 403], ['doctor1', 200, 403], ['midwife1', 200, 403], ['his1', 200, 200], ['prog1', 200, 200], ['admin', 200, 200]]) {
    assert.equal((await get('/api/reports', u)).status, read, u + ' read'); assert.equal((await get('/api/reports/workload/export?from=2025-05-01&to=2025-05-31', u)).status, exp, u + ' export');
  }
  const cat = await (await get('/api/reports', 'his1')).json(); assert.equal(cat.can_export, true); assert.ok(cat.reports.some((r) => r.kind === 'template') && cat.reports.length === 12); assert.equal((await (await get('/api/reports', 'doctor1')).json()).can_export, false);
  for (const bad of ['from=2025-05-31&to=2025-05-01', 'from=nope&to=2025-05-01', 'from=2020-01-01&to=2025-05-01']) assert.equal((await get('/api/reports/workload?' + bad, 'his1')).status, 400, bad);
  assert.equal((await get('/api/reports/nonsense?from=2025-05-01&to=2025-05-31', 'his1')).status, 404);
});
test('screen numbers: sensitive counts are exact only for roles with HIV access', async () => {
  const hiv = async (u) => (await (await get('/api/reports/monthly_activity?from=2025-05-01&to=2025-05-31', u)).json()).sections[0].rows.find((r) => r.code === 'hiv_new').value;
  assert.equal(await hiv('doctor1'), 1); assert.equal(await hiv('prog1'), 1); assert.equal(await hiv('his1'), '<5'); assert.equal(await hiv('admin'), '<5'); // the records officer sees "<5"
  const morb = async (u) => (await (await get('/api/reports/morbidity?from=2025-05-01&to=2025-05-31', u)).json()).sections[0].rows.find((r) => r.code === 'B24').total; assert.equal(await morb('doctor1'), 1); assert.equal(await morb('his1'), '<5');
});
test('CSV export: headers, byte-order mark, definitions included, small numbers hidden even for HIV-authorised roles', async () => {
  const res = await get('/api/reports/monthly_activity/export?from=2025-05-01&to=2025-05-31&format=csv', 'prog1'); assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/csv/); assert.match(res.headers.get('content-disposition'), /attachment; filename="monthly_activity_2025-05-01_2025-05-31\.csv"/);
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8'); assert.ok(text.startsWith('﻿')); assert.ok(text.includes('Period: 2025-05-01 to 2025-05-31')); assert.ok(text.includes('Clinic visits (signed)')); assert.ok(/definition/i.test(text)); assert.ok(text.includes('Visits that were signed by a clinician'));
  const line = text.split('\r\n').find((l) => l.startsWith('hiv_new,')); assert.ok(line.includes('<5') && !/hiv_new,.*,1,/.test(line)); // prog1 sees 1 on screen, but a file always hides it
  const m = await (await get('/api/reports/morbidity/export?from=2025-05-01&to=2025-05-31', 'prog1')).text(); assert.ok(/B24,.*<5/.test(m)); assert.ok(!/B24,[^\r\n]*,1(,|\r)/.test(m));
});
test('Excel export: a real workbook with one sheet per section and the same hidden numbers', async () => {
  const res = await get('/api/reports/workload/export?from=2025-05-01&to=2025-05-31&format=xlsx', 'his1'); assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); const buf = Buffer.from(await res.arrayBuffer());
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); const n = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16); const files = {};
  for (let i = 0; i < n; i++) { const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42); const name = buf.slice(p + 46, p + 46 + nl).toString(); const ln = buf.readUInt16LE(off + 26), le = buf.readUInt16LE(off + 28); const data = buf.slice(off + 30 + ln + le, off + 30 + ln + le + size); assert.equal(zlib.crc32(data) >>> 0, crc, name); files[name] = data.toString(); p += 46 + nl + el + cl; }
  assert.deepEqual(Object.keys(files).filter((x) => x.startsWith('xl/worksheets/')).length, 4); assert.ok(files['xl/workbook.xml'].includes('Visits per day')); assert.ok(files['xl/worksheets/sheet1.xml'].includes('Clinic visits (signed)'));
});
test('exports and screens are written to the audit log, without any patient detail', async () => {
  const rows = db.prepare("SELECT action,detail FROM audit_log WHERE action IN ('report_viewed','report_exported','dashboard_viewed')").all(); const acts = new Set(rows.map((r) => r.action)); for (const a of ['report_viewed', 'report_exported']) assert.ok(acts.has(a), a);
  assert.ok(rows.some((r) => r.action === 'report_exported' && /monthly_activity 2025-05-01\.\.2025-05-31 csv/.test(r.detail))); assert.ok(rows.every((r) => !/Pt \d|name/i.test(r.detail || '')));
});
test('dashboard: each role gets only its own tiles; charts never show HIV diagnoses', async () => {
  const k = kit(db); const t = new Date().toISOString().slice(0, 10); const pp = k.patient('F', '1990-01-01'); const e = k.visit(pp, t); k.dx(e, 'B54'); const e2 = k.visit(pp, t); k.dx(e2, 'B24'); db.prepare("UPDATE encounters SET visit_date=? WHERE id=?").run(t, e);
  const tiles = async (u) => (await (await get('/api/dashboard', u)).json()); const keys = async (u) => (await tiles(u)).tiles.map((x) => x.key);
  assert.equal((await get('/api/dashboard', 'reg1')).status, 403); assert.equal((await get('/api/dashboard', 'lab1')).status, 403); assert.equal((await get('/api/dashboard', 'pharm1')).status, 403);
  const doc = await keys('doctor1'), his = await keys('his1'), prog = await keys('prog1'), nurse = await keys('nurse1');
  for (const x of ['visits_today', 'in_queue', 'admitted_now', 'anc_danger', 'rx_waiting', 'labs_waiting', 'followups', 'blood_low_groups', 'low_stock']) assert.ok(doc.includes(x), 'doctor ' + x);
  assert.ok(!his.includes('blood_low_groups') && his.includes('admitted_now') && his.includes('labs_waiting')); // the records officer has no blood bank access
  for (const x of ['visits_today', 'in_queue', 'admitted_now', 'rx_waiting', 'low_stock', 'blood_low_groups']) assert.ok(!prog.includes(x), 'programme officer must not get ' + x); // no queue, ward, pharmacy or stock access
  assert.ok(prog.includes('labs_waiting') && prog.includes('anc_danger')); assert.ok(nurse.includes('labs_waiting') && nurse.includes('blood_low_groups') && nurse.includes('visits_today'));
  const d = await tiles('doctor1'); assert.equal(d.charts.visits_per_day.length, 30); assert.equal(d.charts.visits_per_month.length, 12); assert.ok(d.charts.visits_per_day.at(-1).count >= 1); assert.ok(d.charts.top_diagnoses.some((x) => x.code === 'B54')); assert.ok(!d.charts.top_diagnoses.some((x) => x.code === 'B24'));
  assert.ok(d.tiles.every((x) => x.value !== undefined && typeof x.value === 'number'));
});
