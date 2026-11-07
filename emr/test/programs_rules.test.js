'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/programs_rules');
const { addDays } = require('../lib/maternal');
const T = '2026-11-07';
const ev = (program, details, visits = [], today = T, extra = {}) => R.evaluate(program, { details, enrolled_on: extra.enrolled_on || details.treatment_start || '2026-01-01', next_due: extra.next_due, status: 'active', ...extra }, visits, today);
const codes = (r) => r.flags.map((f) => f.code).sort();
const vis = (visit_date, data) => ({ visit_date, data });

test('TB: smear schedule dates, states, and positive results', () => {
  const tb = { site: 'pulmonary', treatment_start: '2026-05-01', planned_months: 6, bacteriologically_confirmed: true, hiv_status: 'negative' };
  let r = ev('tb', tb, [], '2026-05-20'); assert.deepEqual(r.schedule.map((s) => [s.key, s.due_on, s.state]), [['month2', '2026-06-30', 'upcoming'], ['month5', '2026-09-28', 'upcoming'], ['end_of_treatment', '2026-10-28', 'upcoming']]);
  assert.equal(ev('tb', tb, [], '2026-06-25').schedule[0].state, 'due'); // within 7 days of the due date
  r = ev('tb', tb, [], '2026-08-15'); assert.equal(r.schedule[0].state, 'overdue'); assert.ok(codes(r).includes('tb_smear_overdue'));
  r = ev('tb', tb, [vis('2026-07-02', { smear_for: 'month2', smear_result: 'neg' })], '2026-08-15'); assert.equal(r.schedule[0].state, 'done'); assert.ok(!codes(r).includes('tb_smear_overdue'));
  assert.ok(codes(ev('tb', tb, [vis('2026-07-02', { smear_for: 'month2', smear_result: '1+' })], '2026-07-03')).includes('tb_smear_positive_m2'));
  const fail = ev('tb', tb, [vis('2026-10-01', { smear_for: 'month5', smear_result: 'scanty' })], '2026-10-02'); assert.ok(codes(fail).includes('tb_failure_suspected')); assert.equal(fail.flags.find((f) => f.code === 'tb_failure_suspected').level, 'critical');
  assert.deepEqual(ev('tb', { ...tb, site: 'extrapulmonary' }, [], T).schedule, []); // no smear schedule outside the lungs
});
test('TB: end of treatment, adherence, weight loss and unknown HIV status', () => {
  const tb = { site: 'pulmonary', treatment_start: '2026-05-01', planned_months: 6, hiv_status: 'unknown' };
  assert.ok(codes(ev('tb', tb, [], '2026-10-20')).includes('tb_end_near')); assert.ok(!codes(ev('tb', tb, [], '2026-09-01')).includes('tb_end_near'));
  assert.ok(codes(ev('tb', tb, [], T)).includes('tb_hiv_unknown'));
  assert.ok(codes(ev('tb', { ...tb, hiv_status: 'negative' }, [vis('2026-06-01', { adherence: 'many_missed' })], '2026-06-02')).includes('tb_adherence_poor'));
  const w = ev('tb', { ...tb, hiv_status: 'negative' }, [vis('2026-06-01', { weight_kg: 50 }), vis('2026-07-01', { weight_kg: 47 })], '2026-07-02'); assert.ok(codes(w).includes('weight_loss_5pct'));
  assert.ok(!codes(ev('tb', { ...tb, hiv_status: 'negative' }, [vis('2026-06-01', { weight_kg: 50 }), vis('2026-07-01', { weight_kg: 48 })], '2026-07-02')).includes('weight_loss_5pct')); // 4% is not 5%
});
test('TB outcome "cured" needs a confirmed pulmonary case and negative smears', () => {
  const base = { details: { site: 'pulmonary', bacteriologically_confirmed: true } }; const neg = (d) => vis(d, { smear_for: 'other', smear_result: 'neg' });
  assert.equal(R.outcomeCheck('tb', 'cured', { details: { site: 'pulmonary', bacteriologically_confirmed: false } }, [neg('2026-09-01'), neg('2026-10-30')]), 'cured_needs_confirmed');
  assert.equal(R.outcomeCheck('tb', 'cured', { details: { site: 'extrapulmonary', bacteriologically_confirmed: true } }, [neg('2026-09-01'), neg('2026-10-30')]), 'cured_needs_confirmed');
  assert.equal(R.outcomeCheck('tb', 'cured', base, []), 'cured_needs_negative_smears');
  assert.equal(R.outcomeCheck('tb', 'cured', base, [neg('2026-10-30')]), 'cured_needs_negative_smears'); // only one negative smear
  assert.equal(R.outcomeCheck('tb', 'cured', base, [neg('2026-09-01'), vis('2026-10-30', { smear_result: '1+' })]), 'cured_needs_negative_smears'); // last smear positive
  assert.equal(R.outcomeCheck('tb', 'cured', base, [neg('2026-09-01'), neg('2026-10-30')]), null);
  assert.equal(R.outcomeCheck('tb', 'treatment_completed', base, []), null);
});
test('HIV: viral load monitoring, ART start, symptoms and visit interval', () => {
  const hiv = { diagnosed_on: '2026-01-01', art_start_on: '2026-01-10' };
  assert.deepEqual(codes(ev('hiv', { diagnosed_on: '2026-10-01' }, [], T)), ['hiv_art_not_started']);
  assert.ok(!codes(ev('hiv', { diagnosed_on: '2026-10-30' }, [], T)).includes('hiv_art_not_started'));
  assert.ok(codes(ev('hiv', hiv, [], T)).includes('hiv_vl_due')); // 10 months on ART, never measured
  assert.ok(!codes(ev('hiv', hiv, [], '2026-05-01')).includes('hiv_vl_due')); // under 6 months
  assert.deepEqual(codes(ev('hiv', hiv, [vis('2026-09-01', { viral_load: 40, adherence: 'good' })], T)), []);
  assert.ok(codes(ev('hiv', hiv, [vis('2025-10-01', { viral_load: 40 })], T)).includes('hiv_vl_due')); // suppressed but over a year ago
  const un = ev('hiv', hiv, [vis('2026-07-01', { viral_load: 5000 })], T); assert.ok(codes(un).includes('hiv_vl_unsuppressed')); assert.ok(codes(un).includes('hiv_vl_due')); assert.equal(un.default_interval, 28);
  assert.equal(ev('hiv', hiv, [vis('2026-10-01', { viral_load: 20, adherence: 'good' })], T).default_interval, 90);
  assert.ok(codes(ev('hiv', hiv, [vis('2026-10-01', { viral_load: 20, tb_symptoms: ['cough'] })], T)).includes('hiv_tb_screen_positive'));
  assert.ok(codes(ev('hiv', hiv, [vis('2026-10-01', { viral_load: 20, cd4: 150 })], T)).includes('hiv_advanced'));
});
test('malaria: follow-up days, severity, pregnancy and primaquine safety', () => {
  const m = { species: 'pf', severity: 'uncomplicated', treatment_start: '2026-11-01', g6pd: 'normal' };
  assert.deepEqual(ev('malaria', m, [], '2026-11-02').schedule.map((s) => [s.key, s.due_on, s.state]), [['day3', '2026-11-04', 'upcoming'], ['day28', '2026-11-29', 'upcoming']]);
  assert.equal(ev('malaria', m, [], '2026-11-04').schedule[0].state, 'due'); assert.equal(ev('malaria', m, [], '2026-11-12').schedule[0].state, 'overdue');
  assert.ok(codes(ev('malaria', m, [], '2026-11-12')).includes('malaria_followup_overdue'));
  assert.ok(codes(ev('malaria', { ...m, severity: 'severe' }, [], T)).includes('malaria_severe'));
  assert.ok(codes(ev('malaria', { ...m, pregnant: true }, [], T)).includes('malaria_pf_pregnant'));
  assert.ok(!codes(ev('malaria', { ...m, species: 'pv', pregnant: true }, [], T)).includes('malaria_pf_pregnant'));
  assert.ok(codes(ev('malaria', { ...m, primaquine: true, pregnant: true }, [], T)).includes('malaria_primaquine_pregnancy'));
  assert.ok(codes(ev('malaria', { ...m, primaquine: true, g6pd: 'deficient' }, [], T)).includes('malaria_primaquine_g6pd_deficient'));
  assert.ok(codes(ev('malaria', { ...m, primaquine: true, g6pd: 'unknown' }, [], T)).includes('malaria_primaquine_g6pd_unknown'));
  assert.ok(!codes(ev('malaria', { ...m, primaquine: false, g6pd: 'unknown' }, [], T)).some((c) => c.startsWith('malaria_primaquine')));
  assert.ok(codes(ev('malaria', m, [vis('2026-11-04', { follow_up_day: 'day3', parasite_result: 'pos' })], '2026-11-05')).includes('malaria_day3_positive'));
  const f = ev('malaria', m, [vis('2026-11-29', { follow_up_day: 'day28', parasite_result: 'pos' })], '2026-11-30'); assert.equal(f.flags.find((x) => x.code === 'malaria_failure_suspected').level, 'critical');
  assert.equal(R.outcomeCheck('malaria', 'recovered', { details: m }, [vis('2026-11-29', { parasite_result: 'pos' })]), 'recovered_but_positive');
  assert.equal(R.outcomeCheck('malaria', 'recovered', { details: m }, [vis('2026-11-29', { parasite_result: 'neg' })]), null);
});
test('nutrition programme: discharge criteria, weight loss, appetite and no response', () => {
  const n = { type: 'sam' };
  const good = (d) => vis(d, { muac_cm: 12.6, whz: -1.8, edema: false });
  assert.equal(R.nutritionDischargeOk([good('2026-10-01')]), false); // needs two visits
  assert.equal(R.nutritionDischargeOk([good('2026-10-01'), good('2026-10-08')]), true);
  assert.equal(R.nutritionDischargeOk([good('2026-10-01'), vis('2026-10-08', { muac_cm: 12.6, edema: true })]), false);
  assert.equal(R.nutritionDischargeOk([vis('2026-10-01', { muac_cm: 11.9, whz: -2.4 }), good('2026-10-08')]), false);
  assert.equal(R.nutritionDischargeOk([vis('2026-10-01', { whz: -1.9 }), vis('2026-10-08', { whz: -1.5 })]), true); // weight-for-height alone is enough
  assert.ok(codes(ev('nutrition', n, [good('2026-10-01'), good('2026-10-08')], T, { enrolled_on: '2026-09-20' })).includes('nut_discharge_criteria_met'));
  assert.ok(codes(ev('nutrition', n, [vis('2026-10-01', { weight_kg: 7.0 }), vis('2026-10-08', { weight_kg: 6.9 })], T, { enrolled_on: '2026-09-20' })).includes('nut_weight_loss'));
  assert.ok(codes(ev('nutrition', n, [vis('2026-10-01', { appetite: 'fail' })], T, { enrolled_on: '2026-09-20' })).includes('nut_appetite_failed'));
  assert.ok(codes(ev('nutrition', n, [vis('2026-09-05', { muac_cm: 11 }), vis('2026-10-01', { muac_cm: 11.2 })], T, { enrolled_on: '2026-08-20' })).includes('nut_no_response')); // 79 days in, not recovered
  assert.ok(!codes(ev('nutrition', n, [vis('2026-10-01', { muac_cm: 11 }), vis('2026-10-08', { muac_cm: 11.2 })], T, { enrolled_on: '2026-10-01' })).includes('nut_no_response')); // too early to judge
  assert.equal(ev('nutrition', n, [], T).default_interval, 7); assert.equal(ev('nutrition', { type: 'mam' }, [], T).default_interval, 14);
  assert.equal(R.outcomeCheck('nutrition', 'cured', { details: n }, [good('2026-10-01')]), 'nutrition_cured_needs_criteria');
  assert.equal(R.outcomeCheck('nutrition', 'cured', { details: n }, [good('2026-10-01'), good('2026-10-08')]), null);
  assert.equal(R.outcomeCheck('nutrition', 'defaulted', { details: n }, []), null);
});
test('chronic disease: control flags and the visit interval', () => {
  const c = (condition) => ({ condition });
  assert.equal(ev('chronic', c('hypertension'), [vis('2026-10-01', { sys: 128, dia: 82 })]).default_interval, 90);
  assert.deepEqual(codes(ev('chronic', c('hypertension'), [vis('2026-10-01', { sys: 150, dia: 92 })])), ['ncd_bp_high']); assert.equal(ev('chronic', c('hypertension'), [vis('2026-10-01', { sys: 150, dia: 92 })]).default_interval, 28);
  assert.deepEqual(codes(ev('chronic', c('hypertension'), [vis('2026-10-01', { sys: 185, dia: 100 })])), ['ncd_bp_severe']);
  assert.deepEqual(codes(ev('chronic', c('diabetes'), [vis('2026-10-01', { glucose_mgdl: 60, glucose_type: 'fasting' })])), ['ncd_hypoglycaemia']);
  assert.deepEqual(codes(ev('chronic', c('diabetes'), [vis('2026-10-01', { glucose_mgdl: 140, glucose_type: 'fasting' })])), ['ncd_glucose_high']);
  assert.deepEqual(codes(ev('chronic', c('diabetes'), [vis('2026-10-01', { glucose_mgdl: 140, glucose_type: 'random' })])), []);
  assert.deepEqual(codes(ev('chronic', c('diabetes'), [vis('2026-10-01', { glucose_mgdl: 320, glucose_type: 'random' })])), ['ncd_glucose_very_high']);
  assert.deepEqual(codes(ev('chronic', c('diabetes'), [vis('2026-10-01', { hba1c: 9.1 })])), ['ncd_hba1c_high']);
  assert.deepEqual(codes(ev('chronic', c('asthma'), [vis('2026-10-01', { asthma_control: 'uncontrolled' })])), ['ncd_asthma_uncontrolled']);
  assert.deepEqual(codes(ev('chronic', c('epilepsy'), [vis('2026-10-01', { seizures_since_last: 2 })])), ['ncd_seizures']);
  assert.deepEqual(codes(ev('chronic', c('hypertension'), [vis('2026-10-01', { glucose_mgdl: 300, glucose_type: 'random' })])), []); // glucose is ignored for hypertension
});
test('overdue, due soon, and lost-to-follow-up suggestion', () => {
  const at = (days, program = 'tb') => ev(program, { site: 'extrapulmonary', treatment_start: '2026-01-01', hiv_status: 'negative', condition: 'hypertension', type: 'sam' }, [], T, { next_due: addDays(T, days) });
  assert.deepEqual([at(10).due.state, at(5).due.state, at(0).due.state, at(-1).due.state], ['ok', 'due_soon', 'due_soon', 'overdue']); assert.equal(at(-12).due.overdue_days, 12);
  assert.ok(!codes(at(-60)).includes('lost_suggested')); assert.ok(codes(at(-61)).includes('lost_suggested'));
  assert.ok(!codes(at(-28, 'nutrition')).includes('lost_suggested')); assert.ok(codes(at(-29, 'nutrition')).includes('lost_suggested'));
  assert.ok(!codes(at(-180, 'chronic')).includes('lost_suggested')); assert.ok(codes(at(-181, 'chronic')).includes('lost_suggested'));
  const closed = R.evaluate('tb', { details: { site: 'extrapulmonary', treatment_start: '2026-01-01' }, enrolled_on: '2026-01-01', next_due: '2026-01-15', status: 'cured' }, [], T); assert.ok(!closed.flags.some((f) => f.code === 'lost_suggested'));
});
test('first and default next due dates', () => {
  assert.equal(R.initialNextDue('tb', {}, '2026-11-01'), '2026-11-15'); assert.equal(R.initialNextDue('hiv', {}, '2026-11-01'), '2026-11-29'); assert.equal(R.initialNextDue('malaria', { treatment_start: '2026-11-01' }, '2026-11-01'), '2026-11-04');
  assert.equal(R.initialNextDue('nutrition', { type: 'sam' }, '2026-11-01'), '2026-11-08'); assert.equal(R.initialNextDue('nutrition', { type: 'mam' }, '2026-11-01'), '2026-11-15');
  assert.equal(R.defaultNextDue('chronic', { details: { condition: 'hypertension' }, enrolled_on: '2026-01-01' }, [vis(T, { sys: 120, dia: 80 })], T, T), '2027-02-05');
});
