'use strict';
// DRAFT inpatient and blood bank rules. Pure functions (no database), unit-tested.
// Blood compatibility follows the standard ABO and Rh rules; the clinic's blood bank protocol must still be followed and approved.
const { diffDays } = require('./maternal');

const ABO = ['A', 'B', 'AB', 'O'];
const parseGroup = (g) => { const m = /^(AB|A|B|O)\s*([+-]|pos|neg)$/i.exec(String(g || '').trim()); return m ? { abo: m[1].toUpperCase(), rh: /^(\+|pos)$/i.test(m[2]) ? 'pos' : 'neg' } : null; };
const groupText = (g) => (g ? g.abo + (g.rh === 'pos' ? '+' : '-') : null);

// Red cells and whole blood: the donor's red cells must suit the recipient's plasma. Plasma and platelets: the donor plasma must suit the recipient's red cells.
const REDCELL_DONORS = { O: ['O'], A: ['A', 'O'], B: ['B', 'O'], AB: ['AB', 'A', 'B', 'O'] };
const PLASMA_DONORS = { O: ['O', 'A', 'B', 'AB'], A: ['A', 'AB'], B: ['B', 'AB'], AB: ['AB'] };
function bloodCompatible(recipient, unit) {
  const reasons = []; if (!recipient) return { ok: false, reasons: ['recipient_group_unknown'] };
  const redCells = unit.component === 'red_cells' || unit.component === 'whole_blood';
  const allowed = (redCells ? REDCELL_DONORS : PLASMA_DONORS)[recipient.abo];
  if (!allowed.includes(unit.abo)) reasons.push('abo_incompatible');
  if (redCells && recipient.rh === 'neg' && unit.rh === 'pos') reasons.push('rh_positive_to_negative'); // Rh positive red cells must not go to an Rh negative recipient
  return { ok: reasons.length === 0, reasons };
}
const isUniversalEmergencyRedCell = (unit) => unit.abo === 'O' && unit.rh === 'neg' && (unit.component === 'red_cells' || unit.component === 'whole_blood');

const TESTS = ['hiv', 'hbv', 'hcv', 'syphilis', 'malaria'];
// quarantine until every test is negative; any positive discards the unit
function screeningOutcome(unit) {
  const v = TESTS.map((k) => unit[k] || 'pending');
  if (v.includes('positive')) return 'discard'; if (v.every((x) => x === 'negative')) return 'release'; return 'hold';
}
const unitExpired = (unit, today) => unit.expires_on < today;
function unitState(unit, today) { // what staff should see: an unissued unit past its date is "expired"
  if ((unit.status === 'available' || unit.status === 'quarantine') && unitExpired(unit, today)) return 'expired';
  return unit.status;
}

// Calendar days in hospital: same-day discharge is 0
const lengthOfStay = (admittedAt, endAt, today) => diffDays(String(endAt || today).slice(0, 10), String(admittedAt).slice(0, 10));
// Observations are overdue when the last set is older than the planned interval plus one hour; a new admission has one hour for its first set
function obsOverdue(admittedAt, lastObsAt, everyHours, now) {
  const ms = (s) => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).getTime();
  const ref = lastObsAt || admittedAt; const limit = lastObsAt ? (everyHours + 1) * 3600000 : 3600000;
  return now - ms(ref) > limit;
}
// Procedure rules: consent (emergency exception), and the WHO surgical safety checklist for surgical procedures
function procedureProblems(type, input) {
  const p = [];
  if (type.needs_consent && !input.consent_obtained && !(String(input.consent_note || '').trim().length >= 5)) p.push('consent_needed');
  if (type.surgical && !(input.checklist_signin && input.checklist_timeout && input.checklist_signout)) p.push('checklist_incomplete');
  return p;
}
module.exports = { ABO, parseGroup, groupText, bloodCompatible, isUniversalEmergencyRedCell, TESTS, screeningOutcome, unitExpired, unitState, lengthOfStay, obsOverdue, procedureProblems };
