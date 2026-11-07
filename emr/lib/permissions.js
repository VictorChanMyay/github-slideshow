'use strict';
// Single place to review who can do what. Keep it readable for the clinic.
const P = {
  'patient.read': 'View patient records',
  'patient.write': 'Register and edit patients',
  'patient.restricted': 'Open restricted records (needs a reason, logged)',
  'audit.read': 'View the audit log',
  'user.admin': 'Manage users',
};
const ROLES = {
  doctor: ['patient.read', 'patient.write', 'patient.restricted'],
  nurse: ['patient.read', 'patient.write'],
  midwife: ['patient.read', 'patient.write'],
  pharmacist: ['patient.read'],
  lab: ['patient.read'],
  registration: ['patient.read', 'patient.write'],
  his: ['patient.read', 'patient.write', 'patient.restricted', 'audit.read'],
  program: ['patient.read', 'patient.restricted'],
  admin: ['patient.read', 'patient.write', 'patient.restricted', 'audit.read', 'user.admin'],
};
const can = (role, perm) => (ROLES[role] || []).includes(perm);
module.exports = { P, ROLES, can };
