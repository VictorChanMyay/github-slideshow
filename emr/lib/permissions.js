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
};
const ROLES = {
  doctor: ['patient.read', 'patient.write', 'patient.restricted', 'queue.read', 'encounter.read', 'encounter.checkin', 'triage.write', 'consult.write', 'consult.sign', 'allergy.write', 'problem.write'],
  nurse: ['patient.read', 'patient.write', 'queue.read', 'encounter.read', 'encounter.checkin', 'triage.write', 'allergy.write'],
  midwife: ['patient.read', 'patient.write', 'queue.read', 'encounter.read', 'encounter.checkin', 'triage.write', 'consult.write', 'consult.sign', 'allergy.write', 'problem.write'],
  pharmacist: ['patient.read', 'encounter.read'],
  lab: ['patient.read'],
  registration: ['patient.read', 'patient.write', 'queue.read', 'encounter.checkin'],
  his: ['patient.read', 'patient.write', 'patient.restricted', 'audit.read', 'queue.read', 'encounter.read'],
  program: ['patient.read', 'patient.restricted', 'encounter.read'],
  admin: ['patient.read', 'patient.write', 'patient.restricted', 'audit.read', 'user.admin', 'queue.read', 'encounter.read', 'encounter.checkin', 'triage.write', 'consult.write', 'consult.sign', 'allergy.write', 'problem.write'],
};
const can = (role, perm) => (ROLES[role] || []).includes(perm);
module.exports = { P, ROLES, can };
