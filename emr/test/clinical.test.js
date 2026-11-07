'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/clinical');
const flags = (v, m) => c.flagVitals({ temp: null, sys: null, dia: null, pulse: null, rr: null, spo2: null, weight: null, height: null, muac: null, ...v }, m).map((f) => f.code);

test('age in months handles birthdays', () => {
  assert.equal(c.ageInMonths('2020-03-15', new Date('2021-03-14T00:00:00Z')), 11);
  assert.equal(c.ageInMonths('2020-03-15', new Date('2021-03-15T00:00:00Z')), 12);
  assert.equal(c.ageInMonths('2030-01-01', new Date('2026-01-01T00:00:00Z')), 0);
});
test('parseVitals rejects impossible and non-numeric values', () => {
  assert.deepEqual(c.parseVitals({ temp: '37.2' }).errors, {});
  assert.equal(c.parseVitals({ temp: 99 }).errors.temp, 'out_of_range');
  assert.equal(c.parseVitals({ pulse: 'abc' }).errors.pulse, 'not_a_number');
  assert.equal(c.parseVitals({ sys: 100, dia: 110 }).errors.dia, 'dia_not_below_sys');
  assert.equal(c.parseVitals({ temp: '' }).values.temp, null);
});
test('temperature and oxygen flags apply to all ages', () => {
  assert.deepEqual(flags({ temp: 38.2 }, 300), ['fever']);
  assert.deepEqual(flags({ temp: 40 }, 20), ['high_fever']);
  assert.deepEqual(flags({ temp: 35 }, 20), ['low_temp']);
  assert.deepEqual(flags({ spo2: 92 }, 300), ['spo2_low']);
  assert.deepEqual(flags({ spo2: 85 }, 300), ['spo2_critical']);
  assert.deepEqual(flags({ temp: 37, spo2: 98 }, 300), []);
});
test('adult blood pressure and pulse', () => {
  assert.deepEqual(flags({ sys: 120, dia: 80 }, 400), []);
  assert.deepEqual(flags({ sys: 150, dia: 85 }, 400), ['bp_high']);
  assert.deepEqual(flags({ sys: 130, dia: 95 }, 400), ['bp_high']);
  assert.deepEqual(flags({ sys: 190, dia: 100 }, 400), ['bp_severe']);
  assert.deepEqual(flags({ sys: 85, dia: 50 }, 400), ['bp_low']);
  assert.deepEqual(flags({ pulse: 110 }, 400), ['tachycardia']);
  assert.deepEqual(flags({ pulse: 45 }, 400), ['bradycardia']);
});
test('child breathing uses WHO age cut-offs and BP is not flagged for children', () => {
  assert.deepEqual(flags({ rr: 45 }, 1), []);
  assert.deepEqual(flags({ rr: 60 }, 1), ['rr_fast_child']);
  assert.deepEqual(flags({ rr: 50 }, 6), ['rr_fast_child']);
  assert.deepEqual(flags({ rr: 40 }, 30), ['rr_fast_child']);
  assert.deepEqual(flags({ rr: 39 }, 30), []);
  assert.deepEqual(flags({ sys: 150, dia: 95 }, 60), []);
});
test('MUAC screening only for 6-59 months', () => {
  assert.deepEqual(flags({ muac: 11 }, 24), ['muac_sam']);
  assert.deepEqual(flags({ muac: 12 }, 24), ['muac_mam']);
  assert.deepEqual(flags({ muac: 13 }, 24), []);
  assert.deepEqual(flags({ muac: 11 }, 3), []);
  assert.deepEqual(flags({ muac: 11 }, 80), []);
});
test('BMI for adults only', () => {
  assert.equal(c.bmi({ weight: 70, height: 175 }), 22.9);
  assert.deepEqual(flags({ weight: 45, height: 170 }, 400), ['underweight']);
  assert.deepEqual(flags({ weight: 100, height: 165 }, 400), ['obese']);
  assert.equal(c.bmi({ weight: 70, height: null }), null);
});
