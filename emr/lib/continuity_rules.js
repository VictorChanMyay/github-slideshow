'use strict';
// DRAFT rules for referral follow-up and appointment reminders. Pure functions (no database), unit-tested.
// The limits below must be confirmed by the clinic.
const { diffDays, addDays } = require('./maternal');

const FEEDBACK_AFTER = { emergency: 1, urgent: 3, routine: 14 }; // days after the referral with no news before it is flagged
const BACK_AFTER_ATTENDED = 30; // days after the patient attended with no reply from the receiving service
const REMIND_WITHIN = 2; // appointments in the next 2 days are on the call list
const MISSED_WINDOW = 14; // missed appointments stay on the call list for 14 days

const refAgeDays = (r, today) => diffDays(today, String(r.created_at).slice(0, 10));
function referralOverdue(r, today) {
  if (r.status === 'open') return refAgeDays(r, today) > FEEDBACK_AFTER[r.urgency];
  if (r.status === 'attended') return !!r.attended_on && diffDays(today, r.attended_on) > BACK_AFTER_ATTENDED;
  return false;
}
// A scheduled appointment in the past is "missed" (derived, never stored)
const apptState = (a, today) => (a.status === 'scheduled' && a.appt_date < today ? 'missed' : a.status);

// Who to ring: upcoming appointments not yet reached, and recently missed ones. Needs the patient's agreement to reminders.
function callList(appts, reminders, today) {
  const reached = new Set(reminders.filter((x) => x.result === 'reached').map((x) => x.appointment_id));
  const out = [];
  for (const a of appts) {
    if (a.status !== 'scheduled' || !a.reminder_ok) continue;
    const d = diffDays(a.appt_date, today);
    if (d >= 0 && d <= REMIND_WITHIN && !reached.has(a.id)) out.push({ ...a, reason: 'upcoming', days: d });
    else if (d < 0 && d >= -MISSED_WINDOW) out.push({ ...a, reason: 'missed', days: d });
  }
  return out.sort((x, y) => (x.reason === y.reason ? x.days - y.days : x.reason === 'missed' ? -1 : 1));
}
const urgencyOf = (daysOverdue) => (daysOverdue > 28 ? 2 : daysOverdue > 0 ? 1 : 0);
module.exports = { FEEDBACK_AFTER, BACK_AFTER_ATTENDED, REMIND_WITHIN, MISSED_WINDOW, referralOverdue, apptState, callList, urgencyOf, addDays };
