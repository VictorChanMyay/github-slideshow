'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../lib/maternal');
const codes = (x) => x.map((a) => a.code).sort();

test('EDD = LMP + 280 days and gestational age arithmetic', () => {
  assert.equal(m.eddFromLmp('2026-01-01'), '2026-10-08');
  assert.equal(m.gaDays('2026-10-08', '2026-10-08'), 280);
  assert.equal(m.gaDays('2026-10-08', '2026-01-01'), 0);
  assert.equal(m.gaDays('2026-10-08', '2026-01-08'), 7);
  assert.equal(m.gaText(9 * 7 + 3), '9w 3d'); assert.equal(m.gaText(-1), '–');
  assert.equal(m.eddFromLmp('2024-03-01'), '2024-12-06'); // across a leap day
});
test('dates and age', () => {
  assert.ok(m.validDate('2026-02-28')); assert.ok(!m.validDate('2026-02-30')); assert.ok(!m.validDate('26-1-1')); assert.ok(!m.validDate(null));
  assert.equal(m.ageYearsAt('2000-06-15', '2026-06-14'), 25); assert.equal(m.ageYearsAt('2000-06-15', '2026-06-15'), 26);
});
test('choosing the due date: scan versus LMP', () => {
  const lmp = '2026-01-01'; // EDD 2026-10-08
  assert.deepEqual(m.chooseEdd({ lmp, lmp_certain: true }), { edd: '2026-10-08', source: 'lmp', discrepancy_days: 0 });
  // scan on 2026-03-12 (10w0d by LMP). A scan saying 10w0d agrees: keep LMP
  assert.equal(m.chooseEdd({ lmp, lmp_certain: true, us: { date: '2026-03-12', weeks: 10, days: 0 } }).source, 'lmp');
  // scan says 11w0d on that date (7 days older): within 7 days => LMP kept
  assert.equal(m.chooseEdd({ lmp, lmp_certain: true, us: { date: '2026-03-12', weeks: 11, days: 0 } }).source, 'lmp');
  // scan says 12w0d (14 days difference, before 22 weeks) => scan wins
  const r = m.chooseEdd({ lmp, lmp_certain: true, us: { date: '2026-03-12', weeks: 12, days: 0 } });
  assert.equal(r.source, 'ultrasound'); assert.equal(r.edd, '2026-09-24'); assert.equal(r.discrepancy_days, -14);
  // uncertain LMP: scan always used
  assert.equal(m.chooseEdd({ lmp, lmp_certain: false, us: { date: '2026-03-12', weeks: 10, days: 0 } }).source, 'ultrasound');
  // late scan (22w+) with certain LMP: LMP kept even if different
  assert.equal(m.chooseEdd({ lmp, lmp_certain: true, us: { date: '2026-06-18', weeks: 28, days: 0 } }).source, 'lmp');
});
test('automatic risk factors from age and parity', () => {
  assert.deepEqual(m.autoRisks({ age: 16, para: 0 }), ['age_under_18']);
  assert.deepEqual(m.autoRisks({ age: 36, para: 5 }), ['age_35_plus', 'grand_multipara']);
  assert.deepEqual(m.autoRisks({ age: 25, para: 2 }), []);
});
test('antenatal alerts: blood pressure, pre-eclampsia, anaemia', () => {
  const ga28 = 28 * 7;
  assert.deepEqual(codes(m.ancAlerts({ sys: 120, dia: 80 }, ga28)), []);
  assert.deepEqual(codes(m.ancAlerts({ sys: 142, dia: 88 }, ga28)), ['bp_high']);
  assert.deepEqual(codes(m.ancAlerts({ sys: 165, dia: 100 }, ga28)), ['bp_severe']);
  assert.deepEqual(codes(m.ancAlerts({ sys: 145, dia: 92, urine_protein: '1+' }, ga28)), ['bp_high', 'preeclampsia_suspected']);
  assert.deepEqual(codes(m.ancAlerts({ sys: 145, dia: 92, urine_protein: '1+' }, 16 * 7)), ['bp_high']); // before 20 weeks: not pre-eclampsia
  assert.deepEqual(codes(m.ancAlerts({ sys: 120, dia: 80, urine_protein: '3+' }, ga28)), ['proteinuria']);
  assert.deepEqual(codes(m.ancAlerts({ hb: 6.5 }, ga28)), ['anaemia_severe']);
  assert.deepEqual(codes(m.ancAlerts({ hb: 10.2 }, ga28)), ['anaemia']);
  assert.deepEqual(codes(m.ancAlerts({ hb: 11.5 }, ga28)), []);
});
test('antenatal alerts: fetus, fundal height, presentation, danger signs', () => {
  assert.deepEqual(codes(m.ancAlerts({ fetal_movement: 'reduced' }, 30 * 7)), ['fetal_movement_reduced']);
  assert.deepEqual(codes(m.ancAlerts({ fetal_movement: 'absent' }, 30 * 7)), ['fetal_movement_absent']);
  assert.deepEqual(codes(m.ancAlerts({ fetal_movement: 'absent' }, 15 * 7)), []); // too early to judge
  assert.deepEqual(codes(m.ancAlerts({ fhr: 100 }, 30 * 7)), ['fhr_abnormal']);
  assert.deepEqual(codes(m.ancAlerts({ fhr: 0 }, 30 * 7)), ['fhr_absent']);
  assert.deepEqual(codes(m.ancAlerts({ fhr: 140 }, 30 * 7)), []);
  assert.deepEqual(codes(m.ancAlerts({ fundal_height: 34 }, 28 * 7)), ['fundal_mismatch']);
  assert.deepEqual(codes(m.ancAlerts({ fundal_height: 27 }, 28 * 7)), []);
  assert.deepEqual(codes(m.ancAlerts({ presentation: 'breech' }, 37 * 7)), ['malpresentation']);
  assert.deepEqual(codes(m.ancAlerts({ presentation: 'breech' }, 30 * 7)), []); // breech is common before 36 weeks
  const d = m.ancAlerts({ danger_signs: ['bleeding', 'convulsions'] }, 30 * 7);
  assert.deepEqual(codes(d), ['danger.bleeding', 'danger.convulsions']); assert.ok(d.every((x) => x.level === 'critical'));
});
test('episode alerts: post-term and high risk', () => {
  assert.deepEqual(codes(m.episodeAlerts({}, 41 * 7 + 1, [])), ['post_term_41']);
  assert.deepEqual(codes(m.episodeAlerts({}, 42 * 7, ['age_35_plus'])), ['high_risk', 'post_term_42']);
  assert.deepEqual(codes(m.episodeAlerts({}, 30 * 7, [])), []);
});
test('next antenatal contact (WHO 8-contact schedule)', () => {
  assert.deepEqual(m.nextContact(null, 8 * 7), { week: 12, overdue: false, first: true });
  assert.equal(m.nextContact(null, 14 * 7).overdue, true);
  assert.equal(m.nextContact(10 * 7, 11 * 7).week, 12);
  assert.equal(m.nextContact(18 * 7, 19 * 7).week, 20);
  assert.equal(m.nextContact(20 * 7, 22 * 7).week, 26);
  assert.equal(m.nextContact(20 * 7, 28 * 7).overdue, true);
  assert.equal(m.nextContact(40 * 7, 40 * 7).done, true);
});
test('postpartum haemorrhage levels and newborn alerts', () => {
  assert.equal(m.pphLevel(300), null); assert.equal(m.pphLevel(500), 'pph'); assert.equal(m.pphLevel(999), 'pph'); assert.equal(m.pphLevel(1000), 'severe'); assert.equal(m.pphLevel(null), null);
  assert.deepEqual(codes(m.newbornAlerts({ birth_weight_g: 2400, apgar5: 9 }, 39 * 7)), ['lbw']);
  assert.deepEqual(codes(m.newbornAlerts({ birth_weight_g: 1400, apgar5: 3, resuscitation: true }, 30 * 7)), ['apgar_very_low', 'resuscitated', 'very_preterm', 'vlbw']);
  assert.deepEqual(codes(m.newbornAlerts({ birth_weight_g: 3200, apgar5: 6 }, 36 * 7)), ['apgar_low', 'preterm']);
  assert.deepEqual(codes(m.newbornAlerts({ birth_weight_g: 3200, apgar5: 9 }, 40 * 7)), []);
});
test('partograph observation flags', () => {
  assert.deepEqual(codes(m.partographFlags({ fhr: 140, liquor: 'clear', cervix_cm: 5, contractions: 4 })), []);
  assert.deepEqual(codes(m.partographFlags({ fhr: 105 })), ['fhr_abnormal']);
  assert.equal(m.partographFlags({ fhr: 90 })[0].level, 'critical');
  assert.deepEqual(codes(m.partographFlags({ liquor: 'meconium' })), ['liquor_meconium']);
  assert.equal(m.partographFlags({ liquor: 'blood' })[0].level, 'critical');
  assert.deepEqual(codes(m.partographFlags({ cervix_cm: 6, contractions: 2 })), ['contractions_weak']);
  assert.deepEqual(codes(m.partographFlags({ cervix_cm: 2, contractions: 2 })), []); // latent phase: not judged
  assert.deepEqual(codes(m.partographFlags({ cervix_cm: 6, contractions: 6 })), ['contractions_excessive']);
  assert.deepEqual(codes(m.partographFlags({ sys: 150, dia: 95, temp: 38.2, pulse: 130 })), ['bp_high', 'fever', 'tachycardia']);
});
test('postnatal alerts and contact windows', () => {
  assert.deepEqual(codes(m.postnatalAlerts({ mother_danger: ['fever'], baby_danger: ['not_feeding'] })), ['baby.not_feeding', 'mother.fever']);
  assert.deepEqual(codes(m.postnatalAlerts({ bleeding: 'heavy' })), ['bleeding_heavy']);
  assert.deepEqual(codes(m.postnatalAlerts({ baby_temp: 38, baby_rr: 65 })), ['baby_fast_breathing', 'baby_fever']);
  assert.deepEqual(codes(m.postnatalAlerts({ baby_temp: 36.8, baby_rr: 45, bleeding: 'normal' })), []);
  const s = m.pncStatus('2026-10-01', ['2026-10-02', '2026-10-04'], '2026-10-10'); // day 1 and day 3 done, day 9 today
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'due', 'upcoming']);
  const t = m.pncStatus('2026-10-01', [], '2026-10-20'); // day 19 and nothing recorded
  assert.deepEqual(t.map((x) => x.state), ['missed', 'missed', 'missed', 'upcoming']);
});
test('family planning warnings and rules', () => {
  assert.deepEqual(m.fpWarnings({ method: 'coc', action: 'start', sys: 150, dia: 95 }), ['coc_hypertension']);
  assert.deepEqual(m.fpWarnings({ method: 'coc', action: 'start', daysPostpartum: 20 }), ['coc_postpartum']);
  assert.deepEqual(m.fpWarnings({ method: 'coc', action: 'start', hasHypertensionProblem: true, daysPostpartum: 20 }), ['coc_hypertension', 'coc_postpartum']);
  assert.deepEqual(m.fpWarnings({ method: 'implant', action: 'start', sys: 150, dia: 95, daysPostpartum: 5 }), []);
  assert.deepEqual(m.fpWarnings({ method: 'coc', action: 'stop', sys: 150 }), []);
  assert.ok(m.NEEDS_PREG_CHECK.includes('implant') && !m.NEEDS_PREG_CHECK.includes('condom'));
});
