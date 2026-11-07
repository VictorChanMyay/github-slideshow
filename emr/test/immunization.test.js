'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const imm = require('../lib/immunization');
const { DOSES, VACCINES } = require('../lib/immunization_seed');
const doses = DOSES.map(([vaccine_code, dose_no, due_days, min_age_days, min_interval_days, max_age_days, late_days]) => ({ vaccine_code, vaccine: VACCINES.find((v) => v[0] === vaccine_code)[1], dose_no, due_days, min_age_days, min_interval_days, max_age_days, late_days }));
const st = (dob, today, recs = []) => Object.fromEntries(imm.statuses(dob, today, recs, doses).map((r) => [`${r.vaccine_code}${r.dose_no}`, r]));
const rec = (vaccine_code, dose_no, given_on) => ({ id: 1, vaccine_code, dose_no, given_on });

test('newborn: birth doses are due, later doses are upcoming', () => {
  const s = st('2026-11-07', '2026-11-07');
  assert.equal(s.BCG1.status, 'due'); assert.equal(s.HEPB_B1.status, 'due'); assert.equal(s.OPV0.status, 'due');
  assert.equal(s.PENTA1.status, 'upcoming'); assert.equal(s.PENTA1.due_on, '2026-12-19'); // 6 weeks
  assert.equal(s.PENTA2.status, 'blocked'); assert.equal(s.MR1.status, 'upcoming');
});
test('6 weeks: first doses become due; four weeks later they are overdue', () => {
  assert.equal(st('2026-01-01', '2026-02-12').PENTA1.status, 'due');
  assert.equal(st('2026-01-01', '2026-02-11').PENTA1.status, 'upcoming');
  assert.equal(st('2026-01-01', '2026-03-12').PENTA1.status, 'due'); // 28 days late: still "due"
  assert.equal(st('2026-01-01', '2026-03-13').PENTA1.status, 'overdue'); assert.equal(st('2026-01-01', '2026-03-13').PENTA1.days_overdue, 29);
});
test('dose 2 cannot start until dose 1 is recorded, and waits for the minimum interval', () => {
  const dob = '2026-01-01';
  assert.equal(st(dob, '2026-04-01').PENTA2.status, 'blocked');
  const s = st(dob, '2026-03-01', [rec('PENTA', 1, '2026-02-20')]); // dose 1 given late: dose 2 earliest = 20 Feb + 28 d = 20 Mar
  assert.equal(s.PENTA2.status, 'upcoming'); assert.equal(s.PENTA2.due_on, '2026-03-20'); assert.equal(s.PENTA1.status, 'done');
  assert.equal(st(dob, '2026-03-20', [rec('PENTA', 1, '2026-02-20')]).PENTA2.status, 'due');
  assert.equal(st(dob, '2026-04-30', [rec('PENTA', 1, '2026-02-20')]).PENTA2.status, 'overdue');
});
test('dose 1 never depends on dose 0 (OPV)', () => {
  assert.equal(st('2026-01-01', '2026-02-12').OPV1.status, 'due'); assert.equal(st('2026-01-01', '2026-02-12').OPV0.status, 'too_late');
});
test('maximum age: birth dose and rotavirus windows close', () => {
  assert.equal(st('2026-01-01', '2026-01-08').HEPB_B1.status, 'due'); assert.equal(st('2026-01-01', '2026-01-09').HEPB_B1.status, 'too_late');
  assert.equal(st('2026-01-01', '2026-04-16').ROTA1.status, 'overdue'); // 105 days old
  assert.equal(st('2026-01-01', '2026-04-17').ROTA1.status, 'too_late'); // 106 days
  assert.equal(st('2026-01-01', '2026-02-12').ROTA1.status, 'due');
});
test('measles: first dose at 9 months, second at 18 months; a child past due is overdue', () => {
  assert.equal(st('2026-01-01', '2026-09-28').MR1.status, 'due'); assert.equal(st('2026-01-01', '2026-09-27').MR1.status, 'upcoming');
  assert.equal(st('2025-01-01', '2026-02-01').MR1.status, 'overdue');
  const s = st('2025-01-01', '2026-07-01', [rec('MR', 1, '2025-10-01')]); assert.equal(s.MR2.status, 'due');
});
test('summary: fully up to date child', () => {
  const recs = doses.map((d) => rec(d.vaccine_code, d.dose_no, '2026-01-02'));
  const sum = imm.summarise(imm.statuses('2026-01-01', '2026-02-01', recs, doses)); assert.equal(sum.up_to_date, true); assert.equal(sum.done, doses.length);
  assert.equal(imm.summarise(imm.statuses('2026-01-01', '2026-03-20', [], doses)).up_to_date, false);
});
test('invalid dose reasons use a 4-day grace period', () => {
  const dose = doses.find((d) => d.vaccine_code === 'PENTA' && d.dose_no === 2);
  assert.deepEqual(imm.invalidReasons('2026-01-01', '2026-02-12', doses.find((d) => d.vaccine_code === 'PENTA' && d.dose_no === 1), null), []);
  assert.deepEqual(imm.invalidReasons('2026-01-01', '2026-02-08', doses.find((d) => d.vaccine_code === 'PENTA' && d.dose_no === 1), null), []); // 38 days: inside grace
  assert.deepEqual(imm.invalidReasons('2026-01-01', '2026-02-07', doses.find((d) => d.vaccine_code === 'PENTA' && d.dose_no === 1), null), ['too_young']);
  assert.deepEqual(imm.invalidReasons('2026-01-01', '2026-03-20', dose, '2026-02-15'), []); // 33 days later
  assert.deepEqual(imm.invalidReasons('2026-01-01', '2026-03-14', dose, '2026-02-15'), []); // 27 days: inside grace
  assert.deepEqual(imm.invalidReasons('2026-01-01', '2026-03-10', dose, '2026-02-15'), ['too_soon']); // 23 days
});
