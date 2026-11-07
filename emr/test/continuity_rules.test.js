'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/continuity_rules');
const T = '2026-11-07';

test('referral feedback is overdue after 1, 3 or 14 days depending on urgency', () => {
  const r = (urgency, created, status = 'open', extra = {}) => R.referralOverdue({ urgency, created_at: created + ' 09:00:00', status, ...extra }, T);
  assert.equal(r('emergency', '2026-11-06'), false); assert.equal(r('emergency', '2026-11-05'), true);
  assert.equal(r('urgent', '2026-11-04'), false); assert.equal(r('urgent', '2026-11-03'), true);
  assert.equal(r('routine', '2026-10-24'), false); assert.equal(r('routine', '2026-10-23'), true);
});
test('after the patient attended, the reply is awaited for 30 days; closed referrals are never overdue', () => {
  const r = (status, attended_on) => R.referralOverdue({ urgency: 'routine', created_at: '2026-09-01 08:00:00', status, attended_on }, T);
  assert.equal(r('attended', '2026-10-08'), false); assert.equal(r('attended', '2026-10-07'), true);
  assert.equal(r('completed', '2026-09-02'), false); assert.equal(r('cancelled', null), false);
  assert.equal(R.referralOverdue({ urgency: 'emergency', created_at: '2026-01-01 08:00:00', status: 'open' }, T), true);
});
test('a scheduled appointment in the past is shown as missed; other states stay as they are', () => {
  assert.equal(R.apptState({ status: 'scheduled', appt_date: '2026-11-06' }, T), 'missed'); assert.equal(R.apptState({ status: 'scheduled', appt_date: T }, T), 'scheduled');
  assert.equal(R.apptState({ status: 'attended', appt_date: '2026-11-01' }, T), 'attended'); assert.equal(R.apptState({ status: 'cancelled', appt_date: '2026-11-01' }, T), 'cancelled');
});
test('call list: upcoming and recently missed, only with consent, reached people dropped, missed first', () => {
  const a = (id, appt_date, over = {}) => ({ id, appt_date, status: 'scheduled', reminder_ok: true, ...over });
  const list = R.callList([a(1, T), a(2, '2026-11-09'), a(3, '2026-11-10'), a(4, '2026-11-05'), a(5, '2026-10-20'), a(6, '2026-10-30'), a(7, T, { reminder_ok: false }), a(8, T, { status: 'attended' }), a(9, '2026-11-08')], [{ appointment_id: 9, result: 'reached' }, { appointment_id: 2, result: 'no_answer' }], T);
  assert.deepEqual(list.map((x) => [x.id, x.reason]), [[6, 'missed'], [4, 'missed'], [1, 'upcoming'], [2, 'upcoming']]);
  // 3 is 3 days away (not yet), 5 missed over 14 days ago (dropped), 7 has no consent, 8 attended, 9 already reached
});
test('urgency from days overdue', () => { assert.deepEqual([R.urgencyOf(0), R.urgencyOf(1), R.urgencyOf(28), R.urgencyOf(29)], [0, 1, 1, 2]); });
