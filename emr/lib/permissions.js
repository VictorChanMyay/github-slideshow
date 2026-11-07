'use strict';
// Single place to review who can do what. Keep it readable for the clinic.
const P = {
  'patient.read': 'View patient records',
  'patient.write': 'Register and edit patients',
  'patient.restricted': 'Open restricted records (needs a reason, logged)',
  'audit.read': 'View the audit log',
  'user.admin': 'Manage users',
  'queue.read': 'See the daily queue',
  'encounter.read': 'View visits (vitals, notes, diagnoses)',
  'encounter.checkin': 'Check patients in and cancel check-ins',
  'triage.write': 'Record triage and vital signs',
  'consult.write': 'Write consultation notes and diagnoses',
  'consult.sign': 'Sign (close) a consultation and add addenda',
  'allergy.write': 'Record allergies',
  'problem.write': 'Maintain the problem list',
  'lab.order': 'Order laboratory tests',
  'lab.read': 'View laboratory orders and results',
  'lab.collect': 'Mark specimens as collected',
  'lab.result': 'Enter and amend laboratory results',
  'lab.sensitive': 'See results of sensitive tests (HIV, hepatitis B, syphilis)',
  'rx.write': 'Prescribe medicines',
  'rx.read': 'View prescriptions',
  'rx.dispense': 'Dispense medicines',
  'stock.read': 'View medicine stock',
  'stock.write': 'Receive, adjust and write off stock',
  'formulary.admin': 'Edit the medicine list',
};
const ROLES = {
  doctor: ['patient.read', 'patient.write', 'patient.restricted', 'queue.read', 'encounter.read', 'encounter.checkin', 'triage.write', 'consult.write', 'consult.sign', 'allergy.write', 'problem.write', 'lab.order', 'lab.read', 'lab.sensitive', 'rx.write', 'rx.read', 'stock.read'],
  nurse: ['patient.read', 'patient.write', 'queue.read', 'encounter.read', 'encounter.checkin', 'triage.write', 'allergy.write', 'lab.read', 'lab.collect', 'rx.read', 'stock.read'],
  midwife: ['patient.read', 'patient.write', 'queue.read', 'encounter.read', 'encounter.checkin', 'triage.write', 'consult.write', 'consult.sign', 'allergy.write', 'problem.write', 'lab.order', 'lab.read', 'lab.collect', 'lab.sensitive', 'rx.write', 'rx.read', 'stock.read'],
  pharmacist: ['patient.read', 'encounter.read', 'rx.read', 'rx.dispense', 'stock.read', 'stock.write'],
  lab: ['patient.read', 'lab.read', 'lab.collect', 'lab.result', 'lab.sensitive'],
  registration: ['patient.read', 'patient.write', 'queue.read', 'encounter.checkin'],
  his: ['patient.read', 'patient.write', 'patient.restricted', 'audit.read', 'queue.read', 'encounter.read', 'lab.read', 'rx.read', 'stock.read'],
  program: ['patient.read', 'patient.restricted', 'encounter.read', 'lab.read', 'lab.sensitive'],
  admin: ['patient.read', 'patient.write', 'patient.restricted', 'audit.read', 'user.admin', 'queue.read', 'encounter.read', 'encounter.checkin', 'triage.write', 'consult.write', 'consult.sign', 'allergy.write', 'problem.write', 'lab.read', 'rx.read', 'stock.read', 'stock.write', 'formulary.admin'],
};
const can = (role, perm) => (ROLES[role] || []).includes(perm);
module.exports = { P, ROLES, can };
