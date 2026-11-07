'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/inpatient_rules');
const g = (s) => R.parseGroup(s);
const unit = (abo, rh, component = 'red_cells') => ({ abo, rh, component });

test('blood group parsing', () => {
  assert.deepEqual(g('O+'), { abo: 'O', rh: 'pos' }); assert.deepEqual(g('ab-'), { abo: 'AB', rh: 'neg' }); assert.deepEqual(g('A pos'), { abo: 'A', rh: 'pos' }); assert.equal(g('C+'), null); assert.equal(g(''), null); assert.equal(g(null), null);
  assert.equal(R.groupText(g('B-')), 'B-');
});
test('red cell compatibility: every ABO pair, and Rh', () => {
  const ok = (r, u) => R.bloodCompatible(g(r), unit(...[g(u).abo, g(u).rh])).ok;
  for (const [r, donors] of Object.entries({ O: ['O'], A: ['A', 'O'], B: ['B', 'O'], AB: ['A', 'B', 'AB', 'O'] })) for (const d of ['A', 'B', 'AB', 'O']) assert.equal(ok(r + '+', d + '+'), donors.includes(d), `${d} to ${r}`);
  assert.equal(ok('A-', 'A+'), false); assert.equal(ok('A-', 'A-'), true); assert.equal(ok('A-', 'O-'), true); assert.equal(ok('AB-', 'O+'), false); assert.equal(ok('O+', 'O-'), true); assert.equal(ok('O-', 'O+'), false);
  assert.deepEqual(R.bloodCompatible(g('B+'), unit('A', 'neg')).reasons, ['abo_incompatible']); assert.deepEqual(R.bloodCompatible(g('A-'), unit('A', 'pos')).reasons, ['rh_positive_to_negative']);
  assert.deepEqual(R.bloodCompatible(g('A-'), unit('B', 'pos')).reasons, ['abo_incompatible', 'rh_positive_to_negative']);
  assert.deepEqual(R.bloodCompatible(null, unit('O', 'neg')), { ok: false, reasons: ['recipient_group_unknown'] });
});
test('plasma and platelets follow the reverse rule; Rh is not checked', () => {
  const p = (r, abo, c = 'plasma') => R.bloodCompatible(g(r), unit(abo, 'pos', c)).ok;
  assert.equal(p('O+', 'AB'), true); assert.equal(p('O+', 'A'), true); assert.equal(p('AB+', 'O'), false); assert.equal(p('AB+', 'AB'), true); assert.equal(p('A+', 'B'), false); assert.equal(p('A+', 'AB'), true); assert.equal(p('A-', 'AB', 'platelets'), true);
});
test('emergency uncrossmatched blood is only O negative red cells or whole blood', () => {
  assert.equal(R.isUniversalEmergencyRedCell(unit('O', 'neg')), true); assert.equal(R.isUniversalEmergencyRedCell(unit('O', 'neg', 'whole_blood')), true);
  assert.equal(R.isUniversalEmergencyRedCell(unit('O', 'pos')), false); assert.equal(R.isUniversalEmergencyRedCell(unit('A', 'neg')), false); assert.equal(R.isUniversalEmergencyRedCell(unit('O', 'neg', 'plasma')), false);
});
test('screening: all negative releases, any positive discards, anything else holds', () => {
  const u = (o) => ({ hiv: 'pending', hbv: 'pending', hcv: 'pending', syphilis: 'pending', malaria: 'pending', ...o }); const allNeg = { hiv: 'negative', hbv: 'negative', hcv: 'negative', syphilis: 'negative', malaria: 'negative' };
  assert.equal(R.screeningOutcome(u({})), 'hold'); assert.equal(R.screeningOutcome(u(allNeg)), 'release'); assert.equal(R.screeningOutcome(u({ ...allNeg, malaria: 'pending' })), 'hold');
  assert.equal(R.screeningOutcome(u({ ...allNeg, hbv: 'positive' })), 'discard'); assert.equal(R.screeningOutcome(u({ hiv: 'positive' })), 'discard');
});
test('unit state: unissued units past their date are expired; issued units keep their state', () => {
  const T = '2026-11-07';
  assert.equal(R.unitState({ status: 'available', expires_on: '2026-11-06' }, T), 'expired'); assert.equal(R.unitState({ status: 'available', expires_on: T }, T), 'available'); assert.equal(R.unitState({ status: 'quarantine', expires_on: '2026-11-01' }, T), 'expired');
  assert.equal(R.unitState({ status: 'transfused', expires_on: '2026-11-01' }, T), 'transfused'); assert.equal(R.unitState({ status: 'discarded', expires_on: '2026-11-01' }, T), 'discarded');
});
test('length of stay counts calendar days', () => {
  assert.equal(R.lengthOfStay('2026-11-07 08:00:00', '2026-11-07 17:00:00', '2026-11-09'), 0); assert.equal(R.lengthOfStay('2026-11-04 23:30:00', null, '2026-11-07'), 3); assert.equal(R.lengthOfStay('2026-11-04 08:00:00', '2026-11-06 09:00:00', '2026-11-30'), 2);
});
test('observations are overdue after the interval plus one hour', () => {
  const at = (s) => new Date(s + 'Z').getTime(); const now = at('2026-11-07T12:00:00');
  assert.equal(R.obsOverdue('2026-11-07 08:00:00', '2026-11-07 08:00:00', 4, now), false); // exactly 4h
  assert.equal(R.obsOverdue('2026-11-07 08:00:00', '2026-11-07 07:00:00', 4, now), false); // 5h = interval + 1h
  assert.equal(R.obsOverdue('2026-11-07 08:00:00', '2026-11-07 06:59:00', 4, now), true);
  assert.equal(R.obsOverdue('2026-11-07 11:30:00', null, 4, now), false); assert.equal(R.obsOverdue('2026-11-07 10:30:00', null, 4, now), true); // first set due within 1h of admission
  assert.equal(R.obsOverdue('2026-11-07 00:00:00', '2026-11-07 10:30:00', 1, now), false); assert.equal(R.obsOverdue('2026-11-07 00:00:00', '2026-11-07 09:30:00', 1, now), true);
});
test('procedures: consent and the surgical safety checklist', () => {
  const minor = { surgical: 0, needs_consent: 1 }, major = { surgical: 1, needs_consent: 1 }, none = { surgical: 0, needs_consent: 0 };
  assert.deepEqual(R.procedureProblems(minor, { consent_obtained: true }), []); assert.deepEqual(R.procedureProblems(minor, {}), ['consent_needed']); assert.deepEqual(R.procedureProblems(minor, { consent_note: 'unconscious, no relative' }), []);
  assert.deepEqual(R.procedureProblems(minor, { consent_note: 'no' }), ['consent_needed']); assert.deepEqual(R.procedureProblems(none, {}), []);
  assert.deepEqual(R.procedureProblems(major, { consent_obtained: true }), ['checklist_incomplete']); assert.deepEqual(R.procedureProblems(major, { consent_obtained: true, checklist_signin: true, checklist_timeout: true }), ['checklist_incomplete']);
  assert.deepEqual(R.procedureProblems(major, { consent_obtained: true, checklist_signin: true, checklist_timeout: true, checklist_signout: true }), []); assert.deepEqual(R.procedureProblems(major, {}), ['consent_needed', 'checklist_incomplete']);
});
